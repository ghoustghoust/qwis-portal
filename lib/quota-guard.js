// Turso 额度保命闸（唯一实现；用户 10-13："reads 又要满了，不预防好数据库又会直接死亡"）
//
// 为什么单独成文件：读层端点（/api/quota/guard、数据页/仪表盘用量卡）与 runner 批次闸门
// 要共享同一份"等级判定 + 烧速/耗尽日推算"，各写一遍必然漂移（坑 #59 同族）。
//
// 等级语义（消费方只认这四个值）：
//   none  —— 正常
//   watch —— reads ≥80%：报警提示，不降档
//   light —— reads ≥90%：跳过 quickscore/翻译/补抓等非必要 AI 段（保采集主链+日报）
//   hard  —— reads ≥96%：日报 AI 段也跳过（出关键词档），只保采集与读层
//
// 重置口径：Turso 计费页写明"每月 1 日出账"，用量窗口按自然月推断（官网未给另一口径；
// 判错的表现只是"距重置"天数偏差 ≤1 天，量级判断不受影响）。
'use strict';

const QUOTA = { rowsRead: 500e6, rowsWritten: 10e6, storageBytes: 5 * 1024 ** 3 };
const LEVELS = { none: 0, watch: 80, light: 90, hard: 96 }; // 阈值是 reads 占用百分比

function levelOf(pctReads) {
  if (pctReads >= LEVELS.hard) return 'hard';
  if (pctReads >= LEVELS.light) return 'light';
  if (pctReads >= LEVELS.watch) return 'watch';
  return 'none';
}

// 距下次重置的天数（北京时区；重置 = 每月 1 日 08:00 北京 = UTC 00:00）
// 北京换算只用 lib/time-window 导出的常量与函数（B90/B4：全库日界只许一份实现）
const { beijingNow, BJ_OFFSET_MS, beijingDateStr } = require('./time-window');
function daysUntilReset(nowMs = Date.now()) {
  const bj = beijingNow(nowMs);
  const next = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth() + 1, 1) - BJ_OFFSET_MS;
  return Math.max(0, Math.ceil((next - nowMs) / 86400e3));
}

// 烧速与预计耗尽日：snapshots = [{ d:'YYYY-MM-DD', r, w, s }]（按日一条，同日覆盖）
// 用最近两个不同日期的读数差分；不足两个点返回 null（不编数）。
function burnRate(snapshots) {
  const pts = (snapshots || []).filter((p) => p && p.d && Number.isFinite(p.r));
  if (pts.length < 2) return null;
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  const days = (Date.parse(b.d) - Date.parse(a.d)) / 86400e3;
  if (days <= 0) return null;
  const perDay = (b.r - a.r) / days;
  return perDay > 0 ? perDay : null;
}

// 纯计算：由用量与快照出判定对象（不写库、不报警）
function computeGuard(usage, snapshots, nowMs = Date.now()) {
  const pctReads = usage?.rowsRead != null ? (usage.rowsRead / QUOTA.rowsRead) * 100 : null;
  const daysLeft = daysUntilReset(nowMs);
  const burn = burnRate(snapshots);
  let projectedExhaustion = null;
  if (pctReads != null && burn) {
    const remainRows = QUOTA.rowsRead - usage.rowsRead;
    const daysToBurn = remainRows / burn;
    projectedExhaustion = {
      date: new Date(nowMs + daysToBurn * 86400e3).toISOString().slice(0, 10),
      beforeReset: daysToBurn < daysLeft,
      daysToBurn: Math.round(daysToBurn * 10) / 10,
    };
  }
  return {
    at: new Date(nowMs).toISOString(),
    pctReads: pctReads == null ? null : Math.round(pctReads * 10) / 10,
    daysLeft,
    dailyBurnM: burn == null ? null : Math.round((burn / 1e6) * 10) / 10,
    projectedExhaustion,
    level: pctReads == null ? 'none' : levelOf(pctReads),
  };
}

// 刷新入口（读层调用；runner 不直连平台 API，它读本函数落库的判定结果）：
// 拉平台用量 → 同日快照覆盖写 → 算判定 → 跨级报警（每周期每级一次）→ 落 settings['turso.quotaGuard']。
// 失败不抛：返回 null，调用方按"闸读不到=不降档"放行（fail-open 但日志出声）。
async function refreshQuotaGuard({ qAll: _q, getSetting, setSetting, alert, env = process.env }) {
  if (!env.TURSO_ORG || !env.TURSO_API_TOKEN) return null;
  const r = await fetch(`https://api.turso.tech/v1/organizations/${env.TURSO_ORG}/usage`, {
    headers: { Authorization: `Bearer ${env.TURSO_API_TOKEN}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`turso usage HTTP ${r.status}`);
  const data = await r.json();
  const u = data?.organization?.usage; // 与读层用量卡同一解析路径（api/[...slug].js 原内联实现）
  const usage = u && typeof u.rows_read === 'number'
    ? { rowsRead: u.rows_read, rowsWritten: u.rows_written, storageBytes: u.storage_bytes, databases: u.databases }
    : null;
  if (!usage) return null;

  const today = beijingDateStr();
  const snapshots = (await getSetting('turso.usageDaily', [])) || [];
  const next = [...snapshots.filter((p) => p.d !== today), { d: today, r: usage.rowsRead, w: usage.rowsWritten, s: usage.storageBytes }].slice(-40);
  await setSetting('turso.usageDaily', next);

  const guard = computeGuard(usage, next);
  await setSetting('turso.quotaGuard', guard);

  // 跨级报警：每周期每级只报一次（cycle 锚到当前自然月，跨月自动复位）
  const cycle = today.slice(0, 7);
  const alerted = (await getSetting('turso.quotaAlerted', {})) || {};
  const prev = alerted.cycle === cycle ? alerted.level : 'none';
  const order = ['none', 'watch', 'light', 'hard'];
  if (order.indexOf(guard.level) > order.indexOf(prev) && guard.level !== 'none' && typeof alert === 'function') {
    await alert(`Turso reads 用量 ${guard.pctReads}%（${guard.level} 档）：烧速 ${guard.dailyBurnM ?? '?'}M/天，距重置 ${guard.daysLeft} 天` +
      (guard.projectedExhaustion?.beforeReset ? `，按此速率 ${guard.projectedExhaustion.date} 耗尽（早于重置）` : ''));
    await setSetting('turso.quotaAlerted', { cycle, level: guard.level });
  }
  return { usage, guard };
}

// runner 侧入口：读云端判定端点（平台凭据只在 Vercel env，runner 不直连 Turso 平台 API）。
// 读不到/失败 → null，调用方按"闸读不到 = 不降档"放行并出声。
async function fetchQuotaGuard({ base, key, timeoutMs = 8000 } = {}) {
  if (!base || !key) return null;
  const r = await fetch(`${base}/api/quota/guard?key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  return d && d.guard ? d.guard : null;
}

module.exports = { QUOTA, LEVELS, levelOf, daysUntilReset, burnRate, computeGuard, refreshQuotaGuard, fetchQuotaGuard };
