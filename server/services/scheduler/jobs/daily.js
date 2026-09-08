// 日报 Job（重构 Phase 3 从 scheduler/index.js 提取）
// 职责：日报定时生成 + 生成前补抓到期源

const cron = require('node-cron');
const { db, getSetting } = require('../../../db');
const log = require('../../../util/log');
const { fetchSource, markSourceError } = require('../../collectors/store');

let ticking = false; // 与调度核心共享的防重入守卫（由外部注入）

/**
 * 注入 ticking 守卫引用（由 scheduler/index.js 在 start() 时调用）
 * 解决循环依赖：daily job 需要设置 ticking，scheduler 需要 daily job 的 fetchDueBeforeDaily
 */
function setTickingRef(ref) {
  // ref 是一个对象 { get: () => boolean, set: (v) => void }
  // 简单实现：直接引用 scheduler 模块的 _ticking 属性
  ticking = ref;
}

// 日报生成前先补抓到期源（与 /api/daily/regenerate 同逻辑），保证日报数据新鲜
// P2-1 修复：与 tick() 共用 ticking 守卫——先等待在飞 tick 结束（最多 5min），再全程持有守卫补抓
async function fetchDueBeforeDaily() {
  const waitStart = Date.now();
  while (ticking.value && Date.now() - waitStart < 5 * 60e3) {
    log.info('日报补抓：调度 tick 进行中，等待其结束…');
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (ticking.value) { log.warn('日报补抓：等待 tick 超时（5min），跳过本次补抓直接生成'); return; }
  ticking.value = true; // 持有守卫，期间 tick() 会直接 return
  try {
    const due = db.prepare(
      'SELECT * FROM sources WHERE enabled=1 AND (next_fetch_at IS NULL OR next_fetch_at <= ?)'
    ).all(new Date().toISOString());
    if (!due.length) return;
    log.info(`日报生成前补抓 ${due.length} 个到期源…`);
    for (const s of due) {
      try { await fetchSource(s); } catch (err) { markSourceError(s, err.message); log.warn(`补抓失败 [${s.name}]: ${err.message}`); }
    }
  } finally {
    ticking.value = false;
  }
}

// 日报定时（T27）：node-cron 按 settings['daily'].time（默认 08:00）触发 generate
let dailyCron = null;
function scheduleDaily() {
  if (dailyCron) {
    dailyCron.stop();
    dailyCron = null;
  }
  const time = (getSetting('daily', {}) || {}).time || '08:00';
  const m = /^(-?(\d{1,2}):(\d{2}))$/.exec(time);
  const hh = m ? Number(m[2]) : 8;
  const mm = m ? Number(m[3]) : 0;
  dailyCron = cron.schedule(`${mm} ${hh} * * *`, async () => {
    log.info(`到达每日日报生成时间（${time}），开始生成日报`);
    try {
      await fetchDueBeforeDaily();
      await require('../../ai/daily').generate();
    } catch (err) {
      log.error('日报自动生成失败:', err.message);
      require('../../alerts').dailyFailed(err.message).catch(() => {});
    }
  });
  log.info(`日报定时已注册：每天 ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
}

function stopDaily() {
  if (dailyCron) {
    dailyCron.stop();
    dailyCron = null;
  }
}

module.exports = { scheduleDaily, stopDaily, fetchDueBeforeDaily, setTickingRef };
