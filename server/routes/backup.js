// 备份 API（T15）：POST /api/backup、POST /api/backup/restore、GET /api/backup/latest
// 职责边界（C23 厘清,勿与 /api/data 混淆）:
//   /api/backup = 配置轻量迁移(JSON,仅 sources/groups/settings,跨机器搬迁配置用,管理台「公众号 RSS」Tab 底部)
//   /api/data   = 整库快照(八表 SQLite,含文章/视频/凭据,灾备回滚用,管理台「数据」Tab)
// 两者并存是有意的;不要互相合并或替代。
const express = require('express');
const backupService = require('../services/backup');

const router = express.Router();

router.post('/', (req, res) => {
  try {
    const r = backupService.backup();
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/restore', (req, res) => {
  try {
    const r = backupService.restore();
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/latest', (req, res) => {
  res.json({ ok: true, backup: backupService.latest() });
});

module.exports = router;
