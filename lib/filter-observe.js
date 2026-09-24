// 早报初筛可观测（2026-09-23，P0-2 配套）：失败计数与报警判定只许这一份。
// 为什么存在：初筛失败此前只在内存的 reason 字符串里存活——stats 不落、报警不发，
// "0 剔除"与"初筛根本没工作"在数据上完全同形，用户无法分辨今天筛没筛（第 22 期实测同形）。
// 分工：AI 通道全挂已有 api/_ai.js 的 consecFail≥3 报警；这里管"失败但没全挂"的盲区。
// 用户裁定：异常信号发报警渠道给管理者（飞书），不上前台页面。
'use strict';

// 失败率报警线：免费推理模型有日常抖动，零星失败不值得叫；五分之一以上说明通道在出问题
const FILTER_FAIL_ALERT_RATE = 0.2;

// ─── 失败因由分类（2026-09-24 H35）────────────────────────────────────
// 为什么要这一层：`filterStats.failed` 只回答"失败多少"，答不了"是哪一种失败"，
//   而修法完全不同 —— reasoning_only 要抬 maxTokens/换模型（H33），timeout 要抬 timeoutMs，
//   rate_limited 要退避，parse 是提示词/解析器的事。09-24 线上量到一期 171/500=34.2% 失败，
//   却因为只有总数而**拍不了该怎么修**（见 docs/ISSUES.md H35、docs/eval/2026-09-24-turso-read-amp.md §十七）。
// ⚠️ 每条正则都指向 api/_ai.js 里**真实存在的抛错串**（行号是 09-24 实测），不许凭印象加类别：
//   HTTP 状态 = `_ai.js:75`、reasoning-only = `:88`、未配置 key = `:113`、
//   AbortSignal 超时 = `:71`（fetch 以 TimeoutError 拒绝）、网络 = fetch 直接 reject、
//   掏不出 JSON = `_ai.js:274` 的 `解析失败放行`。顺序有意义：timeout 必须在 transport 之前，
//   否则 "This operation was aborted" 会被网络那条抢走（判据表由锁 F7 钉住顺序）。
const FILTER_FAIL_WHY = [
  ['parse', /解析失败放行/],
  ['reasoning_only', /仅含 reasoning 无 content|输出为思维链/],
  ['no_key', /未配置 AI API Key/],
  ['rate_limited', /HTTP 429/],
  ['server', /HTTP 5\d\d/],
  ['client', /HTTP 4\d\d/],
  ['timeout', /TimeoutError|aborted due to timeout|operation was aborted|ETIMEDOUT|timeout/i],
  ['transport', /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up/i],
];

// 认不出的一律归 other（**不许塞进上面任何一类**：塞进去就是把"未知的失败"伪装成"已知的失败"）
function classifyFilterFail(reason) {
  const s = String(reason == null ? '' : reason);
  for (const [key, re] of FILTER_FAIL_WHY) if (re.test(s)) return key;
  return 'other';
}

// 就地累加，返回这次落的键（调用方只负责"每条失败都记一笔"，分类口径只此一份）
function tallyFilterFailWhy(why, reason) {
  const key = classifyFilterFail(reason);
  why[key] = (why[key] || 0) + 1;
  return key;
}

// attempted = 实际发起初筛的篇数（不含被预算截断、根本没轮到的篇数——截断由 truncated 单独表达）
// why（可选，H35）= tallyFilterFailWhy 累加出来的分布；有它时报警文案带上前 3 类因由，
//   让管理端一眼看到"该抬 maxTokens 还是该加退避"，不必再去翻代码猜。
// 返回 { alert, rate, text }：text 给报警文案与日志共用，空串 = 无异常
function filterAlert({ attempted = 0, failed = 0, truncated = false, why = null } = {}) {
  const a = Number(attempted) || 0;
  const f = Number(failed) || 0;
  const rate = a > 0 ? f / a : 0;
  const reasons = [];
  if (a > 0 && rate >= FILTER_FAIL_ALERT_RATE) {
    const top = Object.entries(why || {}).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(' ');
    reasons.push(`失败 ${f}/${a}（${Math.round(rate * 100)}%）${top ? `：${top}` : ''}`);
  }
  if (truncated) reasons.push('预算截断，部分候选没来得及筛');
  return { alert: reasons.length > 0, rate, text: reasons.join('；') };
}

module.exports = { FILTER_FAIL_ALERT_RATE, filterAlert, FILTER_FAIL_WHY, classifyFilterFail, tallyFilterFailWhy };
