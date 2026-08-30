// GET /api/hot/categories —— 六类清单(与主系统默认值一致)
module.exports = function handler(req, res) {
  res.json({ ok: true, categories: ['模型', '产品', '行业', '论文', '教程', '观点'], map: {} });
};
