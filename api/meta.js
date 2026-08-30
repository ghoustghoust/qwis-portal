// GET /api/meta —— 门户元信息(导出时间/计数/领域清单)
const { meta } = require('./_data');

module.exports = function handler(req, res) {
  res.json({ ok: true, ...meta() });
};
