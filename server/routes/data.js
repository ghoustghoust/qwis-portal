// 数据管理 API（七期 F6）
// POST /api/data/snapshot                 —— 生成整库快照（data/backups/app-*.db）
// POST /api/data/restore {file}           —— 恢复快照（八表同事务清插，免重启）
// GET  /api/data/list                     —— 快照列表
// POST /api/data/cleanup/preview {days}   —— 清理预览（将删条数）
// POST /api/data/cleanup {days, confirm}  —— 执行清理（需 confirm:true）
// GET  /api/data/stats                    —— 库体积 + 各表条数
const express = require('express');
const datamgr = require('../services/datamgr');
const audit = require('../services/audit');

const router = express.Router();

router.post('/snapshot', async (req, res) => {
  try {
    const r = await datamgr.snapshot();
    audit.record('data.snapshot', { target: r.file, ip: req.ip });
    res.json({ ok: true, ...r });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.post('/restore', (req, res) => {
  const file = (req.body || {}).file;
  if (!file) return res.status(400).json({ ok: false, error: '缺少 file' });
  try {
    const r = datamgr.restore(file);
    audit.record('data.restore', { target: file, ip: req.ip });
    res.json({ ok: true, ...r });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.get('/list', (req, res) => {
  res.json({ ok: true, backups: datamgr.list() });
});

// POST /api/data/upload?name=app-*.db —— 上传快照文件到 data/backups/（原始字节流，不立即恢复）
router.post(
  '/upload',
  express.raw({ type: () => true, limit: '1gb' }),
  (req, res) => {
    try {
      const r = datamgr.saveUpload(String((req.query || {}).name || ''), req.body);
      res.json({ ok: true, ...r });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  }
);

router.post('/cleanup/preview', (req, res) => {
  try {
    res.json({ ok: true, ...datamgr.previewCleanup((req.body || {}).days) });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.post('/cleanup', (req, res) => {
  const body = req.body || {};
  if (body.confirm !== true) return res.status(400).json({ ok: false, error: '需 confirm:true 确认执行' });
  try {
    const r = datamgr.cleanup(body.days);
    audit.record('data.cleanup', { detail: { days: body.days, ...r }, ip: req.ip });
    res.json({ ok: true, ...r });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.get('/stats', (req, res) => {
  res.json({ ok: true, ...datamgr.stats() });
});

module.exports = router;
