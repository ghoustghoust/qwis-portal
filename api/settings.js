// GET /api/settings —— 云端空配置({ok, settings:{}});写操作一律 no-op
module.exports = function handler(req, res) {
  if (req.method === 'GET') return res.json({ ok: true, settings: {} });
  res.json({ ok: true });
};
