// POST /api/articles/read-all —— 云端只读,no-op
module.exports = function handler(req, res) {
  res.json({ ok: true, updated: 0 });
};
