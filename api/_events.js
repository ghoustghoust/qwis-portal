// 事件聚合引擎云端版(十一期 M3):移植主系统 server/services/events.js
// 近 72h 全域条目跨平台同事件聚类;读 Turso articles(云端无 score 列,热度权重退化为 1)
// 与主系统差异:无内存缓存跨请求(serverless),直接实时算;聚合数百条 <200ms 可接受
const turso = require('./_turso');
const { titleTokens, jaccard } = require('./_data');

const WINDOW_H = 72;
const HALF_LIFE_H = 24;
const SIM_THRESHOLD = 0.4;

function statusOf(ev, nowMs) {
  const ageH = (nowMs - ev.firstAt) / 3600e3;
  const freshH = (nowMs - ev.latestAt) / 3600e3;
  if (ageH < 6) return '新';
  if (ev.sources.length >= 5 && freshH < 3) return '爆';
  if (ageH > 12 && freshH < 12) return '发酵中';
  return '收尾';
}

async function collectItems() {
  const cutoff = new Date(Date.now() - WINDOW_H * 3600e3).toISOString();
  const rows = await turso.dbAll(
    `SELECT a.id, a.title, a.url, a.summary, a.cover, a.published_at,
            a.source_id, s.name AS source_name, s.type AS source_type, g.name AS domain
     FROM articles a
     JOIN sources s ON s.id = a.source_id AND s.enabled = 1
     LEFT JOIN groups g ON g.id = s.group_id
     WHERE a.published_at >= ?
     ORDER BY a.published_at DESC`,
    cutoff
  );
  return rows.filter((r) => (r.title || '').trim().length >= 6);
}

async function aggregate() {
  const nowMs = Date.now();
  const items = await collectItems();
  const clusters = [];

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
    const firstAt = Math.min(...times);
    const latestAt = Math.max(...times);
    const domainCount = new Map();
    for (const i of c.items) {
      const d = i.domain || '其它';
      domainCount.set(d, (domainCount.get(d) || 0) + 1);
    }
    const domain = [...domainCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
    let heat = 0;
    for (const i of c.items) {
      const t = Date.parse(i.published_at || 0) || nowMs;
      const decay = Math.pow(0.5, Math.max(0, nowMs - t) / 3600e3 / HALF_LIFE_H);
      heat += decay; // 云端 articles 无 score 列,条目权重恒为 1
    }
    heat *= Math.pow(1.5, c.sourceIds.size - 1);
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
          cover: i.cover, published_at: i.published_at,
          source_name: i.source_name, source_type: i.source_type,
        })),
    };
    ev.status = statusOf({ firstAt, latestAt, sources: [...c.sourceIds] }, nowMs);
    events.push(ev);
  }
  events.sort((a, b) => b.heat - a.heat);
  return events.slice(0, 100);
}

async function getEvents(domain) {
  const all = await aggregate();
  if (!domain || domain === 'all') return all;
  return all.filter((e) => e.domain === domain);
}

module.exports = { getEvents, aggregate };
