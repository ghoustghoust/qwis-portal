// 中断恢复 Job（重构 Phase 3 从 scheduler/index.js 提取）
// 职责：服务启动时恢复上次进程中断的 pending 解析任务

const { db } = require('../../../db');
const log = require('../../../util/log');

// T48 启动恢复：
//  1) pending_items 中 status='pending' 的 bilibili/douyin 条目（上次进程中断未解析完）后台继续 resolve；
//  2) 抖音串行队列限速状态（douyin.lastFetchAt）由适配器从 settings 恢复，重启后仍遵守 ≥10s 间隔（N4）。
function resumeInterrupted() {
  try {
    const pending = db.prepare(
      "SELECT type, COUNT(*) c FROM pending_items WHERE status='pending' AND type IN ('bilibili','douyin') GROUP BY type"
    ).all();
    if (!pending.length) return;
    const poller = require('../../queue/poller');
    for (const { type, c } of pending) {
      log.info(`启动恢复：${type} 队列有 ${c} 条中断的待解析订阅，后台继续解析`);
      poller.resolvePending(type).catch((err) => log.error(`启动恢复[${type}]异常:`, err.message));
    }
  } catch (err) {
    log.error('启动恢复检查失败:', err.message);
  }
}

module.exports = { resumeInterrupted };
