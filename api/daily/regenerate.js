// POST /api/daily/regenerate —— 云端只读快照,不支持重新生成
module.exports = function handler(req, res) {
  res.status(400).json({ ok: false, error: '云端为只读快照,请在主系统重新生成日报' });
};
