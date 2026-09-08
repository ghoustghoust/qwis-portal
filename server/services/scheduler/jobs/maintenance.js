// 维护 Job（重构 Phase 3 从 scheduler/index.js 提取）
// 职责：数据生命周期清理 + 报警冷却清理 + 健康自检

const { db, getSetting } = require('../../../db');
const log = require('../../../util/log');

// ─── 数据生命周期清理 ─────────────────────────────────────────────────────────
// 1.3:数据生命周期——每 24h 清理过期数据(默认保留 7 天,可用 settings.data.retentionDays 覆盖)
function runDataCleanup() {
  const rd = Number((getSetting('data', {}) || {}).retentionDays);
  const retentionDays = Number.isFinite(rd) && rd >= 1 ? Math.floor(rd) : 7; // 下限 1 天，防误配清库
  const r = require('../../datamgr').cleanup(retentionDays);
  log.info(`数据清理完成(保留 ${retentionDays} 天): 文章 ${r.deleted.articles}，视频 ${r.deleted.videos}，待解析 ${r.deleted.pending_items}，日报 ${r.deleted.daily_reports}`);
  // P1-3（2026-09-05）：job_queue 历史任务一并清理（completed>24h / failed>7d），防无限膨胀
  try {
    require('../../queue/taskQueue').taskQueue.purgeDone();
  } catch (err) {
    log.warn('[数据清理] job_queue 清理失败:', err.message);
  }
}

// ─── 报警冷却清理 ─────────────────────────────────────────────────────────────
// 报警 housekeeping：每 10min 自动清理过期冷却记录与报警日志（7 天）
function runAlertHousekeeping() {
  try { require('../../alerts').autoCleanupOldCooldowns(7); require('../../alerts').autoCleanupOldLogs(7); } catch {}
}

// ─── 健康自检 ─────────────────────────────────────────────────────────────────
// 健康自检（服务器无人值守）：启动 N 分钟后开始生效，检查最近 1 小时是否有源成功刷新
// 如果 enabled 源数 > 0 但 1 小时内 0 成功 → WARN 日志 + 报警通知
async function healthCheck() {
  // P2: 启动初期跳过（通过环境变量控制冷却期，默认 30min）
  if (!healthCheck._startTime) healthCheck._startTime = Date.now();
  const warmupMin = Number(process.env.HEALTH_CHECK_WARMUP_MIN) || 30;
  if (Date.now() - healthCheck._startTime < warmupMin * 60e3) return;

  try {
    const enabledCount = db.prepare('SELECT COUNT(*) c FROM sources WHERE enabled=1').get().c;
    if (enabledCount === 0) return; // 无启用源，不检查

    const oneHourAgo = new Date(Date.now() - 3600e3).toISOString();
    const recentOk = db.prepare(
      'SELECT COUNT(*) c FROM sources WHERE enabled=1 AND last_fetched_at >= ?'
    ).get(oneHourAgo).c;

    if (recentOk === 0) {
      const detail = `启用源 ${enabledCount} 个，最近 1h 成功刷新 0 个`;
      log.warn(`[健康自检] 采集停滞: ${detail}`);
      try { await require('../../alerts').collectStalled(detail); } catch { /* 报警失败不阻塞 */ }
    }
  } catch (err) {
    log.error('[健康自检] 检查异常:', err.message);
  }
}

module.exports = { runDataCleanup, runAlertHousekeeping, healthCheck };
