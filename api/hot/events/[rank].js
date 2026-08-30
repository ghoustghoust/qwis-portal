// GET /api/hot/events/:rank?domain= —— 事件详情(含报道时间线)
const { events } = require('../../_data');

module.exports = function handler(req, res) {
  const domain = req.query.domain;
  let list = events();
  if (domain && domain !== 'all') list = list.filter((e) => e.domain === domain);
  const idx = Number(req.query.rank) - 1;
  if (!Number.isInteger(idx) || idx < 0 || !list[idx]) {
    return res.status(404).json({ ok: false, error: '事件不存在' });
  }
  res.json({ ok: true, event: { rank: idx + 1, ...list[idx] } });
};
