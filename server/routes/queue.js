// 队列 API（T35，F24/F31/F41/F44）：手动同步 + 待处理区查询
const express = require('express');
const { db } = require('../db');
const poller = require('../services/queue/poller');

const router = express.Router();

// POST /api/queue/sync {name?} —— 手动同步全部或指定队列（wechat|bilibili|douyin）
router.post('/sync', async (req, res) => {
  const name = req.body && req.body.name ? String(req.body.name) : null;
  const names = name ? [name] : poller.QUEUE_NAMES;
  if (name && !poller.QUEUE_NAMES.includes(name)) {
    return res.status(400).json({ ok: false, error: `未知队列: ${name}` });
  }
  let imported = 0;
  let updated = 0;
  let cleared = 0;
  const errors = [];
  for (const n of names) {
    try {
      const r = await poller.syncQueue(n);
      imported += r.imported;
      updated += r.updated;
      cleared += r.cleared;
    } catch (err) {
      errors.push(`${n}: ${err.message}`);
    }
  }
  if (errors.length && imported + updated === 0 && errors.length === names.length) {
    return res.status(500).json({ ok: false, error: errors.join('；') });
  }
  // F24：公众号仅本地保存供手动复制；F31/F41：视频类后台解析订阅
  const tail = name === 'wechat'
    ? '已保存到待提交区供手动复制'
    : '本地后台正在解析订阅';
  res.json({
    ok: true,
    imported,
    updated,
    cleared,
    errors: errors.length ? errors : undefined,
    message: `导入 ${imported} 个，更新 ${updated} 个，清空云端 ${cleared} 个；${tail}`,
  });
});

// GET /api/queue/pending?type=wechat|bilibili|douyin —— 前端待处理区
router.get('/pending', (req, res) => {
  const conds = [];
  const args = [];
  if (req.query.type) { conds.push('type=?'); args.push(String(req.query.type)); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const items = db.prepare(`SELECT * FROM pending_items ${where} ORDER BY id DESC`).all(...args);
  res.json({ ok: true, items });
});

module.exports = router;
