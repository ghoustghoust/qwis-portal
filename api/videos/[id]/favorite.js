// POST /api/videos/:id/favorite —— 云端只读,no-op
module.exports = function handler(req, res) {
  res.json({ ok: true, favorite: 1 });
};
