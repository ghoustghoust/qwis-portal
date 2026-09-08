// 3.1 操作审计日志 API
// GET /api/audit?limit=50&action=source.create —— 查询最近审计记录
// GET /api/audit/count —— 审计总数
// DELETE /api/audit?days=30 —— 清理旧审计记录
const express = require('express');
const audit = require('../services/audit');

const router = express.Router();

router.get('/', (req, res) => {
  const limit = Number(req.query.limit) || 50;
  const action = req.query.action || undefined;
  const items = audit.list(limit, action);
  const total = audit.count();
  res.json({ ok: true, items, total });
});

router.get('/count', (req, res) => {
  res.json({ ok: true, count: audit.count() });
});

router.delete('/', (req, res) => {
  const days = Number(req.query.days) || 30;
  const deleted = audit.cleanup(days);
  res.json({ ok: true, deleted });
});

module.exports = router;
