// POST /api/hot/original —— 云端无抓取能力,明确失败(前端 HotDetail 会回退到「阅读原文」链接)
module.exports = function handler(req, res) {
  res.status(400).json({ ok: false, error: '云端只读快照不提供原文抓取,请点击「阅读原文」' });
};
