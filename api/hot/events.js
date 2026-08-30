// GET /api/hot/events?domain= —— 事件热点榜(对齐主系统 server/routes/hot.js /events)
const { events } = require('../_data');

module.exports = function handler(req, res) {
  const domain = req.query.domain;
  let list = events();
  if (domain && domain !== 'all') list = list.filter((e) => e.domain === domain);
  res.json({
    ok: true,
    events: list.map((e, i) => ({ rank: i + 1, ...e, items: undefined })), // 列表不带簇内条目
    domains: [...new Set(events().map((e) => e.domain))],
  });
};
