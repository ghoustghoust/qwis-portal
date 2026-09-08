// OPML 同步 Job（重构 Phase 3 从 scheduler/index.js 提取）
// 职责：定时从远程 OPML URL 同步公众号订阅源

const { getSetting, setSetting } = require('../../../db');
const log = require('../../../util/log');
const wechat = require('../../collectors/wechat');

// OPML 同步任务
async function runOpmlSync() {
  const url = getSetting('opml.url', null);
  const enabled = getSetting('opml.enabled', true);
  if (!url || !enabled) return;
  setSetting('wechat.opmlStatus', '同步中');
  try {
    const r = await wechat.syncOpml(url);
    log.info(`OPML 同步完成: 新增 ${r.added}，恢复 ${r.restored}，更新 ${r.updated}`);
    setSetting('wechat.opmlStatus', '空闲');
  } catch (err) {
    log.error('OPML 同步失败:', err.message);
    setSetting('wechat.opmlStatus', '空闲');
    setSetting('wechat.lastError', err.message);
  }
}

module.exports = { runOpmlSync };
