// GET /api/videos/:id —— {ok, item};POST favorite 等写操作 no-op
const { videos } = require('../_data');

module.exports = function handler(req, res) {
  if (req.method === 'POST') return res.json({ ok: true });
  const it = videos().find((v) => String(v.id) === String(req.query.id));
  if (!it) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, item: it });
};
