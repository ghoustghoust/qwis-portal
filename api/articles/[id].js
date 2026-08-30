// GET /api/articles/:id —— 单篇全文(阅读视图)
const { articles } = require('../_data');

module.exports = function handler(req, res) {
  const id = Number(req.query.id);
  const item = articles().find((a) => a.id === id);
  if (!item) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, item });
};
