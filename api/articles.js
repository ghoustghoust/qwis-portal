// GET /api/articles —— 对齐主系统契约(server/routes/articles.js)
// ?tab=all|unread|later|history|read &source_id &group_id &q &from &to &cursor &sort=new|old &dedup=1
// 游标: sortKey|id 复合键(sortKey=published_at,DESC 新→旧);dedup 模式游标=簇序号
// 列表响应剥掉 content_html(快照文件 3.4MB,列表不需要全文)
// 云端无已读/稍后读状态:unread→全部;later/history/read→空
const { articles, sources, titleTokens, jaccard, sortKey } = require('./_data');

const PAGE = 30;

// 快照无 source_id:用 sources.json 建 名称→源 映射,支持 source_id/group_id 过滤
function sourceIndex() {
  const byName = new Map();
  for (const s of sources()) if (s.name && !byName.has(s.name)) byName.set(s.name, s);
  return byName;
}

function strip(r) {
  const { content_html, ...rest } = r;
  return rest;
}

function applyFilters(rows, query) {
  const byName = sourceIndex();
  const tab = query.tab || 'all';
  if (tab === 'later' || tab === 'history' || tab === 'read') return [];
  let list = rows;
  if (query.source_id) {
    const sid = Number(query.source_id);
    list = list.filter((r) => byName.get(r.source_name)?.id === sid);
  }
  if (query.group_id) {
    const gid = Number(query.group_id);
    list = list.filter((r) => byName.get(r.source_name)?.group_id === gid);
  }
  if (query.domain) list = list.filter((r) => r.domain === query.domain);
  if (query.q) {
    const kw = String(query.q).toLowerCase();
    list = list.filter(
      (r) =>
        (r.title || '').toLowerCase().includes(kw) ||
        (r.summary || '').toLowerCase().includes(kw) ||
        (r.content_html || '').toLowerCase().includes(kw)
    );
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.from || '')) {
    list = list.filter((r) => sortKey(r) >= `${query.from}T00:00:00.000Z`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.to || '')) {
    list = list.filter((r) => sortKey(r) <= `${query.to}T23:59:59.999Z`);
  }
  return list;
}

function spanOf(list) {
  if (!list.length) return { min: null, max: null };
  let min = null;
  let max = null;
  for (const r of list) {
    const k = sortKey(r);
    if (!k) continue;
    if (min === null || k < min) min = k;
    if (max === null || k > max) max = k;
  }
  return { min, max };
}

module.exports = function handler(req, res) {
  try {
    const list = applyFilters(articles(), req.query);
    const span = spanOf(list);
    const desc = req.query.sort !== 'old';
    const sorted = list
      .slice()
      .sort((a, b) => {
        const c = sortKey(a).localeCompare(sortKey(b));
        if (c !== 0) return desc ? -c : c;
        return desc ? b.id - a.id : a.id - b.id;
      });

    // ---- dedup=1:同事件合并(簇序号游标) ----
    if (req.query.dedup === '1') {
      const clusters = [];
      for (const r of sorted.slice(0, 500)) {
        const tokens = titleTokens(r.title);
        let hit = null;
        if (tokens.size) {
          for (const c of clusters) {
            if (jaccard(tokens, c.tokens) >= 0.5) { hit = c; break; }
          }
        }
        if (!hit) clusters.push({ rep: r, related: [], tokens });
        else {
          hit.related.push({ source_name: r.source_name, url: r.url, id: r.id });
          for (const t of tokens) hit.tokens.add(t);
          if (sortKey(r) > sortKey(hit.rep)) {
            hit.related.push({ source_name: hit.rep.source_name, url: hit.rep.url, id: hit.rep.id });
            hit.rep = r;
          }
        }
      }
      const offset = Number(req.query.cursor) || 0;
      const page = clusters.slice(offset, offset + PAGE).map((c) => ({
        ...strip(c.rep),
        sort_key: sortKey(c.rep),
        relatedCount: c.related.length,
        related: c.related,
      }));
      const nextCursor = offset + PAGE < clusters.length ? String(offset + PAGE) : null;
      return res.json({ ok: true, items: page, nextCursor, span, deduped: true, totalClusters: clusters.length });
    }

    // ---- 原始模式:sortKey|id 复合游标 ----
    let start = 0;
    if (req.query.cursor) {
      const sep = String(req.query.cursor).lastIndexOf('|');
      if (sep > 0) {
        const key = req.query.cursor.slice(0, sep);
        const id = Number(req.query.cursor.slice(sep + 1));
        start = sorted.findIndex((r) =>
          desc
            ? sortKey(r) < key || (sortKey(r) === key && r.id < id)
            : sortKey(r) > key || (sortKey(r) === key && r.id > id)
        );
        if (start < 0) start = sorted.length;
      } else {
        const id = Number(req.query.cursor);
        start = sorted.findIndex((r) => (desc ? r.id < id : r.id > id));
        if (start < 0) start = sorted.length;
      }
    }
    const pageRows = sorted.slice(start, start + PAGE);
    const hasMore = start + PAGE < sorted.length;
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last ? `${sortKey(last)}|${last.id}` : null;
    res.json({
      ok: true,
      items: pageRows.map((r) => ({ ...strip(r), sort_key: sortKey(r) })),
      nextCursor,
      span,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
