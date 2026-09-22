// 35B · 每源滚动尝试窗口 + 成功率公式（唯一实现；runner / Vercel 手动采集 / 本地调度三端写入口共用）
// 为什么落在 lib（AGENTS §1）：B23 的「rate: ok?100:0」假成功率、B24 的心跳无正样本，
// 根因都是「没有逐源的真分母」——本文件就是那份分母。
//
// 数据结构（塞进 sources.extra.health，定长滚动不增长，spec 35B F2/F7）：
//   { v:1, s:"nnfen…", t:[absMinEpoch, Δmin, Δmin…], k:["net",null,…] }
//   s 每字符一次尝试：n=ok-new（有新条目）/ e=ok-empty（抓成功但无新内容，源安静不是坏）/ f=fail
//   t 为分钟级时间戳（首项绝对，其后为与前一项的差）；k 与 s 平行，仅 fail 位带类别
//   ——滑出窗口即自动过期（F7），类别计数读取时由窗口现算，不存在"旧类别赖着不走"
// 公式（F3，前后端同一实现——读这个文件，别另写）：
//   wi = 0.5^(Δi小时 / H)，H=48h；W=Σwi；S=Σwi·si（n=1，e=0.6，f=0）
//   p̂ = (α+S)/(α+β+W)，α=β=2；W < 3 → 返回 null（样本不足显示「—」，不许显示 100%/0%）
'use strict';

const WINDOW_N = 40;
const HALF_LIFE_H = 48;
const EMPTY_W = 0.6;
const PRIOR = 2;
const WMIN = 3;
const VERSION = 1;

// 错误归类（粗粒度；35A-F1 的细分类归它管，这里只服务「主导失败类别」展示）
function classifyErr(msg) {
  const m = String(msg || '');
  if (/401|403|cookie|登录态|授权|unauthorized/i.test(m)) return 'auth';
  if (/timeout|timed?\s*out|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|socket|terminated|网络/i.test(m)) return 'net';
  if (/parse|解析|JSON|Unexpected|格式/i.test(m)) return 'parse';
  if (/HTTP\s*\d|status\s*4|status\s*5|404|429|500|502|503/i.test(m)) return 'http';
  return 'other';
}

// 读窗口 → [{ ms, outcome, kind }]；形状坏了返回 null（调用方按"无数据"处理）
function windowOf(extra) {
  const h = extra && extra.health;
  if (!h || typeof h.s !== 'string' || !Array.isArray(h.t) || h.t.length !== h.s.length || h.t.length === 0) return null;
  const out = [];
  let t = Number(h.t[0]);
  if (!Number.isFinite(t)) return null;
  for (let i = 0; i < h.s.length; i++) {
    if (i > 0) t += Number(h.t[i]);
    out.push({ ms: t * 60000, outcome: h.s[i], kind: (Array.isArray(h.k) && h.k[i]) || null });
  }
  return out;
}

/** 记一次尝试（纯函数：吃旧 extra 吐新 extra，写库由调用方做）。outcome ∈ n/e/f；fail 带 kind */
function recordAttempt(extra, outcome, errKind, nowMs) {
  const nx = { ...(extra || {}) };
  let entries = windowOf(extra) || [];
  entries.push({ ms: nowMs || Date.now(), outcome, kind: outcome === 'f' ? (errKind || 'other') : null });
  if (entries.length > WINDOW_N) entries = entries.slice(entries.length - WINDOW_N);
  const mins = entries.map((e) => Math.floor(e.ms / 60000));
  const dt = [mins[0]];
  for (let i = 1; i < mins.length; i++) dt.push(mins[i] - mins[i - 1]);
  nx.health = {
    v: VERSION,
    s: entries.map((e) => e.outcome).join(''),
    t: dt,
    k: entries.map((e) => e.kind),
  };
  return nx;
}

/** 成功率：样本不足返回 null（前端显示「—」），永远造不出 100/0 两极假数 */
function successRate(extra, opts = {}) {
  const entries = windowOf(extra);
  if (!entries || !entries.length) return null;
  const now = opts.nowMs || Date.now();
  const H = opts.halfLifeH || HALF_LIFE_H;
  const eW = opts.emptyWeight ?? EMPTY_W;
  const prior = opts.prior ?? PRIOR;
  const wmin = opts.wmin ?? WMIN;
  let W = 0, S = 0;
  let consecutiveFails = 0, lastOkAt = null;
  const kinds = {};
  for (const e of entries) {
    const w = Math.pow(0.5, ((now - e.ms) / 3600000) / H);
    W += w;
    S += w * (e.outcome === 'n' ? 1 : e.outcome === 'e' ? eW : 0);
    if (e.outcome !== 'f') lastOkAt = e.ms;
    if (e.kind) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].outcome === 'f') consecutiveFails++;
    else break;
  }
  if (W < wmin) return null;
  const p = (prior + S) / (prior + prior + W);
  const dominantErr = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return {
    p: Math.round(p * 1000) / 10,          // 百分比一位小数
    W: Math.round(W * 10) / 10,
    n: entries.length,
    dominantErr,
    consecutiveFails,
    lastOkAt: lastOkAt ? new Date(lastOkAt).toISOString() : null,
    v: VERSION,
  };
}

module.exports = {
  WINDOW_N, HALF_LIFE_H, EMPTY_W, PRIOR, WMIN, VERSION,
  classifyErr, windowOf, recordAttempt, successRate,
};
