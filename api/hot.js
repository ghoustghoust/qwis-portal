// GET /api/hot —— AIHOT 时间轴(对齐主系统 server/routes/hot.js 的 / 响应)
// ?tab=featured|all &category &q &source &cursor(序号);响应 {ok, items, nextCursor}
// 快照无 featured 标记:featured 与 all 同数据,category/q/source 过滤照做
const { aihot } = require('./_data');

const PAGE = 30;

module.exports = function handler(req, res) {
  try {
    let list = aihot().slice();
    const { category, q, source } = req.query;
    if (req.query.tab === 'featured' && category) {
      list = list.filter((r) => (r.category || '') === category);
    }
    if (req.query.tab !== 'featured') {
      if (q) {
        const kw = String(q).toLowerCase();
        list = list.filter(
          (r) => (r.title || '').toLowerCase().includes(kw) || (r.summary || '').toLowerCase().includes(kw)
        );
      }
      if (source) list = list.filter((r) => (r.source_name || '') === source);
    }
    list.sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
    const offset = Number(req.query.cursor) || 0;
    const page = list.slice(offset, offset + PAGE);
    res.json({
      ok: true,
      items: page,
      nextCursor: offset + PAGE < list.length ? String(offset + PAGE) : null,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
