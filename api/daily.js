// GET /api/daily —— 最新日报
const { daily } = require('./_data');

module.exports = function handler(req, res) {
  res.json({ ok: true, report: daily() });
};
