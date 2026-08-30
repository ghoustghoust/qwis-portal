// GET /api/events?domain= —— 事件热点榜
const { events } = require('./_data');

module.exports = function handler(req, res) {
  const domain = req.query.domain;
  let list = events();
  if (domain && domain !== 'all') list = list.filter((e) => e.domain === domain);
  res.json({
    ok: true,
    events: list.map((e, i) => ({ rank: i + 1, ...e })),
    domains: [...new Set(events().map((e) => e.domain))],
  });
};
