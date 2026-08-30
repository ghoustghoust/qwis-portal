// POST /api/articles/:id/later —— 云端只读,no-op(前端 localStorage 自行记忆)
module.exports = function handler(req, res) {
  res.json({ ok: true, later: 1 });
};
