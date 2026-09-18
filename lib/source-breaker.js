// 熔断阈值与"这轮失败该不该记到源头上"的唯一实现
// （三端共用：server/services/collectors/store.js、api/collect.js、tools/collect-turso.js）
//
// 为什么单独成文件：同一份"连跪几次算熔断"的判据此前在两端各写一遍，
// 结果同一个 YouTube 源在本地 3 次就锁、在云端 10 次才锁（docs/ISSUES.md H14、坑 #35）。
// YouTube 对数据中心 IP 反爬会返回假 404/500（间歇性、按 IP 掷骰），阈值放宽到 10 防误杀；真死频道 10 连跪后照停。
const BREAKER_THRESHOLDS = { youtube: 10, default: 3 };

function breakerThreshold(sourceType) {
  return BREAKER_THRESHOLDS[String(sourceType || '').toLowerCase()] || BREAKER_THRESHOLDS.default;
}

// 是否应因连续失败而暂停该源
function shouldPauseOnFail(sourceType, failCount) {
  return Number(failCount || 0) >= breakerThreshold(sourceType);
}

// ── F6 系统性故障抑制（spec 35A / T6 第 1 步已批准的那"一条判据"）──────────────
// 为什么必须有：一次代理挂掉就把 458 个源全部记为失败并逐个熔断，是本项目最贵的误杀
// （docs/ISSUES.md 坑 #35、docs/specs/35-selfheal-admin-console/35a-selfheal-engine.md F6/AC5）。
// 网络/代理/DNS 这类故障的特征是"一次性命中一大批源且错误长得一样"，
// 它证明的是**我们出不去**，不是**那些源死了**——所以不该折算成每个源的连跪次数。
const SYSTEMIC_MIN_ATTEMPTS = 5;      // 一轮少于 5 个源不判系统性（否则 1/1 就是 100%）
const SYSTEMIC_FAIL_RATIO = 0.3;      // ≥30% 到期源失败
const SYSTEMIC_DOMINANT_SHARE = 0.6;  // 且失败里 ≥60% 是同一个错误指纹
const SYSTEMIC_ABSOLUTE_FAILS = 20;   // 或失败绝对数 ≥20（大轮次比例可能不高，但量级已是事故）

// 只有"环境类"错误才允许抑制：一批同样的 404/500 是那些源真的坏了，不该被豁免；
// ECONNREFUSED / ETIMEDOUT / EAI_AGAIN / ENOTFOUND / socket hang up / TLS / 代理 / 429 / 503
// 才说明是我们出不去或对端限流。少这一道闸，一次上游集体 404 就会被整批赦免（真发生过判例讨论）。
const ENV_CLASS_FP_RE = /(econnrefused|econnreset|etimedout|econnaborted|epipe|ehostunreach|enethostunreach|eai_again|enotfound|enetunreach|socket hang up|und_err|fetch failed|proxy|dns|tls|ssl|certificate|too many requests|\b429\b|\b503\b|timeout|network)/;

// 错误指纹：把"同一个故障换了个 URL / 换了个端口 / 换了个 request id"归一成同一个键
function errorFingerprint(err) {
  let m = err instanceof Error ? ((err.cause && err.cause.code) || err.code || err.message) : String(err || '');
  m = String(m || '').toLowerCase();
  m = m.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]*/g, '#uuid');
  m = m.replace(/https?:\/\/\S+/g, '#url');
  m = m.replace(/(\d+\.){3}\d+/g, '#ip');
  m = m.replace(/\d+/g, '#');
  m = m.replace(/\s+/g, ' ').trim();
  return m.slice(0, 160) || 'unknown';
}

// outcomes: [{ ok:boolean, error?:string|Error }] —— 一轮内每个源的抓取结果
// → { systemic, reason, ratio, dominant, dominantShare, dominantIsEnv, failed, attempted }
function detectSystemicFailure(outcomes = [], opts = {}) {
  const minAttempts = opts.minAttempts ?? SYSTEMIC_MIN_ATTEMPTS;
  const ratioGate = opts.failRatio ?? SYSTEMIC_FAIL_RATIO;
  const shareGate = opts.dominantShare ?? SYSTEMIC_DOMINANT_SHARE;
  const absGate = opts.absoluteFails ?? SYSTEMIC_ABSOLUTE_FAILS;

  const list = Array.isArray(outcomes) ? outcomes : [];
  const attempted = list.length;
  const fails = list.filter((o) => o && !o.ok);
  const failed = fails.length;
  const ratio = attempted ? failed / attempted : 0;

  const buckets = new Map();
  for (const f of fails) {
    const k = errorFingerprint(f.error);
    buckets.set(k, (buckets.get(k) || 0) + 1);
  }
  let dominant = null, dominantCount = 0;
  for (const [k, c] of buckets) if (c > dominantCount) { dominant = k; dominantCount = c; }
  const dominantShare = failed ? dominantCount / failed : 0;
  const dominantIsEnv = dominant ? ENV_CLASS_FP_RE.test(dominant) : false;

  let systemic = false, reason = '';
  if (attempted < minAttempts) {
    reason = `样本不足（${attempted} < ${minAttempts}）不判系统性`;
  } else if (!dominantIsEnv && (failed >= absGate || ratio >= ratioGate)) {
    reason = `失败 ${failed}/${attempted}（${Math.round(ratio * 100)}%）但错误属源侧（非网络/环境类）→ 照常计入各源`;
  } else if (failed >= absGate && dominantShare >= shareGate) {
    systemic = true; reason = `环境类故障：失败 ${failed} 个、${Math.round(dominantShare * 100)}% 同一指纹（量级即事故）`;
  } else if (ratio >= ratioGate && dominantShare >= shareGate) {
    systemic = true; reason = `环境类故障：失败率 ${Math.round(ratio * 100)}%、${Math.round(dominantShare * 100)}% 同一指纹`;
  } else if (ratio >= ratioGate) {
    reason = `失败率 ${Math.round(ratio * 100)}% 达标但指纹分散（${Math.round(dominantShare * 100)}% < ${Math.round(shareGate * 100)}%），按真实故障处理`;
  } else {
    reason = `失败 ${failed}/${attempted}（${Math.round(ratio * 100)}%）未达阈值`;
  }
  return { systemic, reason, ratio, dominant, dominantShare, dominantIsEnv, failed, attempted };
}

module.exports = {
  BREAKER_THRESHOLDS, breakerThreshold, shouldPauseOnFail,
  SYSTEMIC_MIN_ATTEMPTS, SYSTEMIC_FAIL_RATIO, SYSTEMIC_DOMINANT_SHARE, SYSTEMIC_ABSOLUTE_FAILS,
  ENV_CLASS_FP_RE, errorFingerprint, detectSystemicFailure,
};
