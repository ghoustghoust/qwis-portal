// GET /api/settings/daily —— 云端空配置;PUT no-op
module.exports = function handler(req, res) {
  if (req.method === 'GET') return res.json({ ok: true, settings: {} });
  res.json({ ok: true });
};
