// GET /api/hot/sources —— aihot 快照按 source_name 聚合计数(全部动态 Tab 来源筛选)
const { aihot } = require('../_data');

module.exports = function handler(req, res) {
  const counts = new Map();
  for (const r of aihot()) {
    const name = r.source_name || '';
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const sources = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  res.json({ ok: true, sources });
};
