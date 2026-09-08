// 采集层公共工具（重构 Phase 1 提取）
// 职责：并发防护锁 + 刷新间隔计算（纯逻辑，不持有数据库连接）
// 从 store.js 提取，消除 store/fetcher/scheduler 之间的循环依赖

const { getSetting } = require('../../db');

// ─── 并发防护 ────────────────────────────────────────────────────────────────
// P2 并发防护：同一 source.id 同时只允许一次抓取在飞
// 覆盖 tick / 手动 refresh / refresh-all / daily 补抓 / restore-all 全部调用方
const inFlight = new Set();

/**
 * 以 sourceId 为粒度的互斥锁包装器。
 * 同一 sourceId 同时只允许一个 fn() 执行；后续调用直接返回 {skipped:true}。
 * sourceId 为 null 时不加锁（兼容无 id 场景）。
 */
async function withSourceLock(sourceId, fn) {
  if (sourceId == null) return fn();
  if (inFlight.has(sourceId)) {
    return { articles: 0, videos: 0, skipped: true, reason: 'in-flight' };
  }
  inFlight.add(sourceId);
  try {
    return await fn();
  } finally {
    inFlight.delete(sourceId);
  }
}

// ─── 刷新间隔计算 ─────────────────────────────────────────────────────────────
// 该源的刷新间隔（分钟）：extra.intervalMin（>0）优先，否则按 type 走全局 settings.intervals
// 兼容旧调用：传入字符串时视为 type
function intervalMinFor(source, registry) {
  const type = typeof source === 'string' ? source : source.type;
  if (source && typeof source === 'object') {
    let extra = {};
    try { extra = JSON.parse(source.extra || '{}'); } catch { /* 非法 JSON 按无覆盖处理 */ }
    const per = Number(extra.intervalMin);
    if (Number.isFinite(per) && per > 0) return per;
  }
  const intervals = getSetting('intervals', {});
  // 适配器契约字段 defaultIntervalMin 作为该 type 的默认间隔
  const adapterDefault = (t) => {
    const a = registry ? registry.getAdapter(t) : null;
    const d = a && Number(a.defaultIntervalMin);
    return Number.isFinite(d) && d > 0 ? d : null;
  };
  if (type === 'bilibili') return Number(intervals.bilibili) || adapterDefault('bilibili') || 60;
  if (type === 'douyin') return Number(intervals.douyin) || adapterDefault('douyin') || 360;
  // wechat / rss / x / youtube 有意共用 RSS 文章刷新间隔（小时）——保留既有共享语义
  if (type === 'rss' || type === 'wechat' || type === 'x' || type === 'youtube') {
    return (Number(intervals.rss) || 8) * 60;
  }
  // 其余类型（hotlist / 未知）用各自适配器默认间隔，无则回退 RSS 间隔
  return adapterDefault(type) || (Number(intervals.rss) || 8) * 60;
}

module.exports = { inFlight, withSourceLock, intervalMinFor };
