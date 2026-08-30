// GET /api/videos —— 对齐主系统契约(server/routes/videos.js)
// ?tab=all|favorite|history &source_id &from &to &cursor(sortKey|id) &sort=new|old,响应带 span
// 云端无收藏/观看状态:favorite/history → 空
const { videos } = require('./_data');

const PAGE = 30;
const key = (v) => v.published_at || v.created_at || '';

module.exports = function handler(req, res) {
  try {
    const tab = req.query.tab || 'all';
    if (tab === 'favorite' || tab === 'history') {
      return res.json({ ok: true, items: [], nextCursor: null, span: { min: null, max: null } });
    }
    let list = videos().slice();
    if (req.query.source_id) list = list.filter((v) => Number(v.source_id) === Number(req.query.source_id));
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '')) {
      list = list.filter((v) => key(v) >= `${req.query.from}T00:00:00.000Z`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '')) {
      list = list.filter((v) => key(v) <= `${req.query.to}T23:59:59.999Z`);
    }
    const desc = req.query.sort !== 'old';
    list.sort((a, b) => {
      const c = key(a).localeCompare(key(b));
      if (c !== 0) return desc ? -c : c;
      return desc ? b.id - a.id : a.id - b.id;
    });
    const span = list.length
      ? { min: key(list[list.length - 1]), max: key(list[0]) }
      : { min: null, max: null };
    // 游标定位
    let start = 0;
    if (req.query.cursor) {
      const sep = String(req.query.cursor).lastIndexOf('|');
      if (sep > 0) {
        const k = req.query.cursor.slice(0, sep);
        const id = Number(req.query.cursor.slice(sep + 1));
        start = list.findIndex((v) =>
          desc ? key(v) < k || (key(v) === k && v.id < id) : key(v) > k || (key(v) === k && v.id > id)
        );
        if (start < 0) start = list.length;
      }
    }
    const page = list.slice(start, start + PAGE);
    const last = page[page.length - 1];
    res.json({
      ok: true,
      items: page.map((v) => ({ ...v, sort_key: key(v) })),
      nextCursor: start + PAGE < list.length && last ? `${key(last)}|${last.id}` : null,
      span,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
