// POST /api/sources/:id/refresh —— 云端只读,no-op
module.exports = function handler(req, res) {
  res.json({ ok: true, articles: 0, videos: 0, notModified: true });
};
