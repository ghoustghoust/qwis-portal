// GET /api/articles?cursor=&domain=&q=&dedup=1 —— 分页/领域筛选/搜索/同事件合并
const { articles } = require('./_data');

const PAGE = 30;

// 标题归一化 + token(与主系统 daily.js 同算法)
function normalizeTitle(t) {
  return String(t || '').toLowerCase()
    .replace(/^(\d{4}[-/年])?\d{1,2}[-/月]\d{1,2}[日号]?[\s:：,，.、-]*/, '')
    .replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
function titleTokens(title) {
  const t = normalizeTitle(title);
  const tokens = new Set();
  for (const m of t.matchAll(/[a-z0-9]+/g)) tokens.add(m[0]);
  for (const m of t.matchAll(/[一-鿿]+/g)) {
    const s = m[0];
    if (s.length === 1) tokens.add(s);
    else for (let i = 0; i < s.length - 1; i++) tokens.add(s.slice(i, i + 2));
  }
  return tokens;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

module.exports = function handler(req, res) {
  try {
    let rows = articles();
    const { domain, q, dedup } = req.query;
    if (domain) rows = rows.filter((r) => r.domain === domain);
    if (q) {
      const kw = String(q).toLowerCase();
      rows = rows.filter((r) => (r.title || '').toLowerCase().includes(kw) || (r.content_html || '').toLowerCase().includes(kw));
    }
    rows = rows.slice().sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));

    let items;
    let totalClusters;
    if (dedup === '1') {
      const clusters = [];
      for (const r of rows) {
        const tokens = titleTokens(r.title);
        let hit = null;
        if (tokens.size) {
          for (const c of clusters) {
            if (jaccard(tokens, c.tokens) >= 0.5) { hit = c; break; }
          }
        }
        if (!hit) clusters.push({ rep: r, related: [], tokens });
        else {
          hit.related.push({ id: r.id, source_name: r.source_name, url: r.url });
          for (const t of tokens) hit.tokens.add(t);
        }
      }
      totalClusters = clusters.length;
      items = clusters.map((c) => ({ ...c.rep, relatedCount: c.related.length, related: c.related }));
    } else {
      items = rows;
    }

    const offset = Number(req.query.cursor) || 0;
    const page = items.slice(offset, offset + PAGE);
    res.json({
      ok: true,
      items: page,
      nextCursor: offset + PAGE < items.length ? String(offset + PAGE) : null,
      total: items.length,
      totalClusters,
      deduped: dedup === '1',
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
