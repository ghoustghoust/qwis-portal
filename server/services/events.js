// 事件聚合引擎（九期 M4，八期 spec F1 落地改造版）
// 聚合范围：近 72h 全域条目（热榜 hotlist + 公众号（rss/wechat2rss) + RSS + AIHOT），跨平台同事件聚类
// 热度 = Σ 条目权重(1 + score/100万 归一) × 24h 半衰时间衰减 × 信源多样性加成(每多一信源 ×1.5)
// 缓存 5 分钟；聚合数百条 <200ms；纯内存，不锁库
const { db } = require('../db');
const { titleTokens, jaccard } = require('./ai/_tokens');

const CACHE_MS = 5 * 60e3;
const WINDOW_H = 72;
const HALF_LIFE_H = 24;
const SIM_THRESHOLD = 0.4; // 跨平台标题差异大，比日报去重(0.5)略宽

let cache = { at: 0, events: null };

// 事件状态标：新(首发<6h) / 爆(信源≥5 且仍在更新) / 发酵中(首发>12h 且 最新<12h) / 收尾
function statusOf(ev, nowMs) {
  const ageH = (nowMs - ev.firstAt) / 3600e3;
  const freshH = (nowMs - ev.latestAt) / 3600e3;
  if (ageH < 6) return '新';
  if (ev.sources.length >= 5 && freshH < 3) return '爆';
  if (ageH > 12 && freshH < 12) return '发酵中';
  return '收尾';
}

function collectItems() {
  const cutoff = new Date(Date.now() - WINDOW_H * 3600e3).toISOString();
  return db
    .prepare(
      `SELECT a.id, a.title, a.url, a.summary, a.cover, a.published_at, a.score, a.category,
              a.source_id, s.name AS source_name, s.type AS source_type, g.name AS domain
       FROM articles a
       JOIN sources s ON s.id = a.source_id AND s.enabled = 1
       LEFT JOIN groups g ON g.id = s.group_id
       WHERE a.published_at >= ?
       ORDER BY a.published_at DESC`
    )
    .all(cutoff)
    .filter((r) => (r.title || '').trim().length >= 6);
}

function aggregate() {
  const nowMs = Date.now();
  const items = collectItems();
  const clusters = []; // {tokens, items, sourceIds:Set}

  for (const item of items) {
    const tokens = titleTokens(item.title);
    if (!tokens.size) continue;
    let hit = null;
    for (const c of clusters) {
      if (jaccard(tokens, c.tokens) >= SIM_THRESHOLD) { hit = c; break; }
    }
    if (!hit) {
      clusters.push({ tokens, items: [item], sourceIds: new Set([item.source_id]) });
    } else {
      hit.items.push(item);
      hit.sourceIds.add(item.source_id);
      for (const t of tokens) hit.tokens.add(t);
    }
  }

  const events = [];
  for (const c of clusters) {
    if (c.items.length < 2) continue; // 单源单篇不成事件
    const times = c.items.map((i) => Date.parse(i.published_at || 0)).filter(Boolean);
    // 2026-09-05 修复（P1-4）：簇内条目 published_at 全部不可解析时 times 为空，
    // Math.min(...[]) = Infinity → new Date(Infinity).toISOString() 抛 RangeError 导致整接口 500
    const firstAt = times.length ? Math.min(...times) : nowMs;
    const latestAt = times.length ? Math.max(...times) : nowMs;
    // 领域归属：簇内条目的 domain/category 多数派
    const domainCount = new Map();
    for (const i of c.items) {
      const d = i.domain || i.category || '其它';
      domainCount.set(d, (domainCount.get(d) || 0) + 1);
    }
    const domain = [...domainCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
    // 热度：条目权重 × 时间衰减，再乘信源多样性加成
    let heat = 0;
    for (const i of c.items) {
      const t = Date.parse(i.published_at || 0) || nowMs;
      const decay = Math.pow(0.5, Math.max(0, nowMs - t) / 3600e3 / HALF_LIFE_H);
      const w = 1 + Math.min(1, (i.score || 0) / 1e6); // 热度值归一(百万级封顶)
      heat += w * decay;
    }
    heat *= Math.pow(1.5, c.sourceIds.size - 1); // 信源多样性加成
    // 标题取簇内最新条目(信息最新)
    const rep = c.items.slice().sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''))[0];
    const ev = {
      title: rep.title,
      domain,
      heat: Math.round(heat * 10) / 10,
      sourceCount: c.sourceIds.size,
      reportCount: c.items.length,
      firstAt: new Date(firstAt).toISOString(),
      latestAt: new Date(latestAt).toISOString(),
      items: c.items
        .slice()
        .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''))
        .map((i) => ({
          id: i.id, title: i.title, url: i.url, summary: (i.summary || '').slice(0, 200),
          cover: i.cover, published_at: i.published_at, score: i.score,
          source_name: i.source_name, source_type: i.source_type,
        })),
    };
    ev.status = statusOf({ firstAt, latestAt, sources: [...c.sourceIds] }, nowMs);
    events.push(ev);
  }
  events.sort((a, b) => b.heat - a.heat);
  return events;
}

// domain 过滤 + 缓存
function getEvents(domain) {
  if (!cache.events || Date.now() - cache.at > CACHE_MS) {
    cache = { at: Date.now(), events: aggregate() };
  }
  const all = cache.events;
  if (!domain || domain === 'all') return all;
  return all.filter((e) => e.domain === domain);
}

function getEvent(index, domain) {
  return getEvents(domain)[index] || null;
}

function invalidate() { cache.at = 0; }

module.exports = { getEvents, getEvent, invalidate, aggregate, SIM_THRESHOLD };
