// 级3「每源预配额」唯一实现 —— 零额度预筛层的第一刀（docs/specs/44-prescreen-tier/spec.md）
//
// 为什么（锁的纪律：每条判据指到用户的一句话或一个实测数字）：
//   用户 2026-09-24 裁决「初筛的职责是削减，不是理解」。实测支撑：24h 窗口 2,688 篇 / 469 个活跃源，
//   而候选的 `ORDER BY published_at DESC LIMIT 500` 只覆盖 94 源（20%）——500 个坑里 352 个是同一批
//   高频源的"第 3 篇以后"。先按源限量再截断，源覆盖 94 → 约 450，**AI 调用量不变**。
//   ↑ 09-24 第一期实测把这句证伪：覆盖 94→202（2.15×）、调用量 500→337。根因不是 cap，而是**宽池读被
//   `LIMIT 2000` 自己截断**（`prescreen.pool` 恰等于 2000，池里只剩 202 个源）→ 见下方 CANDIDATE_POOL_READ
//   与 `docs/eval/2026-09-24-prescreen-step1.md` §九。原句按"作废不静默删"留在上面。
//   判据文档：`docs/RSS高质量信息流系统设计参考文档 (1).md` §1.6 级3（每源每日最多送 2 篇，
//   选篇用零成本信号、不用评分）。
//
// 为什么是 JS 纯函数而不是 SQL 窗口函数：三端方言不同（runner/云端 libsql、本地 better-sqlite3），
//   同一条配额写三遍必漂（坑 #59「同一算术写两遍必然分叉」）。SQL 侧只负责取"轻量宽池"。
'use strict';

const DEFAULT_PER_SOURCE_CAP = 2;
const DEFAULT_POOL_LIMIT = 500;

// 宽池读的行数上限——级3 的**真天花板**（用户 09-24 裁定"抬"，H25）。取值的实测依据：
//   24h 窗口全量 = 3,645 篇 / 327 源，30h = 4,361 篇 / 387 源（谓词逐字复刻候选查询，只读取数）；
//   轻量列（title+summary+url）全量才 **928 KB / 3,645 行** → "宽池不能抬"的旧顾虑只对
//   `content_html` 成立（runWeekly :865 那条），对轻量列不成立。
//   取 6000 ≈ 1.5× 当前 30h 池，留增长余量；配额后仍由 DEFAULT_POOL_LIMIT/500 决定送模型量，
//   所以抬这个数**只换源覆盖，不加 AI 调用**（Σmin(n,2)=530 > 500 → 500 个坑重新填满）。
const CANDIDATE_POOL_READ = 6000;

// 配额值的唯一归一：缺键/空串/布尔/小数/越界一律回默认。
// 口径照 `lib/brief-guards.js#dailyMinScoreOf`：`Number('')` 是 0，而 0 的意思是"配额关了"——
// 配置缺失绝不能读成"故意设为 0"（坑 #38「静默降级=没人知道」同族）。
// 第二个参数 log 可选：**键存在但值不可用**才出声（缺键 = 正常走默认，不吵）；
// 对抗审查抓出这一句此前只是注释里的承诺、无人执行，导致 stats 里的 cap=2 分不清
// 是"运营设的 2"还是"打错字退回的 2"。
function prescreenCapOf(raw, log) {
  const fallback = () => {
    if (typeof log === 'function' && raw !== undefined && raw !== null) {
      log(`每源配额配置不可用（prescreen.perSourceCap=${JSON.stringify(raw)}），按默认 ${DEFAULT_PER_SOURCE_CAP} 执行`);
    }
    return DEFAULT_PER_SOURCE_CAP;
  };
  if (raw === null || raw === undefined) return DEFAULT_PER_SOURCE_CAP;
  if (raw === '' || typeof raw === 'boolean') return fallback();
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : fallback();
}

const defaultKeyOf = (r) => {
  const k = r && (r.source_id != null ? r.source_id : r.sourceId);
  return k == null ? '?' : String(k);
};

// rows 必须已按 published_at DESC 排好（= 池内出现顺序就是"最新优先"这一零成本选篇信号）。
// 逐源计数超过 cap 就丢，凑满 limit 即停——所以"cap 之后还剩很多"时上限照样兜住额度。
// `limit: Infinity` 表示"只限量不截断"（本地灾备端今天没有候选上限，本函数不替它新造一个）。
function applySourceQuota(rows, { cap, limit, keyOf } = {}) {
  const c = prescreenCapOf(cap);
  const lim = limit === undefined
    ? DEFAULT_POOL_LIMIT
    : (limit === null || limit === Infinity ? Infinity : Number(limit));
  // Infinity 是真的"不截断"；NaN/0/负数/字符串坏值才退回默认（不许把坏值读成"上限关了"）
  const safeLim = lim === Infinity ? Infinity : (Number.isFinite(lim) && lim > 0 ? lim : DEFAULT_POOL_LIMIT);
  const key = keyOf || defaultKeyOf;
  const seen = new Map();
  const kept = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = key(r);
    const n = (seen.get(k) || 0) + 1;
    if (n > c) continue;
    seen.set(k, n);
    kept.push(r);
    if (kept.length >= safeLim) break;
  }
  return kept;
}

// 落 stats 的读数：没有这组数，"配额今天有没有生效 / 有没有把源覆盖换回来"又变成不可判别
// （P0-2 的原话就是"0 剔除与没筛在数据上同形"）。
function prescreenStats(poolRows, keptRows, cap) {
  const pool = Array.isArray(poolRows) ? poolRows : [];
  const kept = Array.isArray(keptRows) ? keptRows : [];
  return {
    cap: prescreenCapOf(cap),
    pool: pool.length,
    poolSources: new Set(pool.map(defaultKeyOf)).size,
    kept: kept.length,
    keptSources: new Set(kept.map(defaultKeyOf)).size,
  };
}

module.exports = { DEFAULT_PER_SOURCE_CAP, DEFAULT_POOL_LIMIT, CANDIDATE_POOL_READ, prescreenCapOf, applySourceQuota, prescreenStats };
