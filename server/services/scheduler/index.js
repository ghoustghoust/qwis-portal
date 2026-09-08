// 调度中心（重构 Phase 3 瘦身 + Phase 5 任务队列集成）
// 职责：due 驱动扫描 + tick 防重入 + 各 Job 模块编排注册
// Phase 5：tick 改为 scanAndEnqueue（入队）+ taskQueue 异步消费（并发 5，同源去重）

const { db, getSetting, setSetting } = require('../../db');
const log = require('../../util/log');
const { fetchSource, markSourceError } = require('../collectors/store');
const { taskQueue, TaskQueue } = require('../queue/taskQueue');

// Job 模块
const jobsDaily = require('./jobs/daily');
const jobsFulltext = require('./jobs/fulltext');
const jobsOpml = require('./jobs/opml');
const jobsMaintenance = require('./jobs/maintenance');
const jobsPortal = require('./jobs/portal');
const jobsRecovery = require('./jobs/recovery');

let timers = [];
// 2026-09-05 修复：调度器是否已启动。reschedule() 在未启动的进程（测试/脚本）中不得自启调度器，
// 否则 setInterval 句柄会让进程无法退出（regression-views-filter.test.js 全量测试挂起事件）
let started = false;
// ticking 防重入：通过共享对象引用传递给 daily job（两者共用同一把锁）
const tickingRef = { value: false };
jobsDaily.setTickingRef(tickingRef);

// 任务队列是否启用（环境变量 QUEUE_ENABLED=false 回退串行模式）
const QUEUE_ENABLED = process.env.QUEUE_ENABLED !== 'false';

// 2026-09-05b A5 修复：风控敏感平台跨源串行——队列并发 5 下多个 bilibili/douyin 源会真并发，
// 与已知坑 #6「调度器串行是有意的（抖音/B站并发会被秒封）」冲突；douyin 适配器内部另有 ≥10s 队列，双保险无害
const typeChains = new Map(); // type → Promise 链
function withTypeMutex(type, fn) {
  if (type !== 'bilibili' && type !== 'douyin') return fn();
  const prev = typeChains.get(type) || Promise.resolve();
  const next = prev.then(fn, fn);
  typeChains.set(type, next.catch(() => {}));
  return next;
}

// 注册 fetch_source 任务处理器
TaskQueue.registerHandler('fetch_source', async (payload) => {
  const s = db.prepare('SELECT * FROM sources WHERE id = ?').get(payload.sourceId);
  if (!s || !s.enabled) return;
  await withTypeMutex(s.type, () => fetchOne(s));
});

function intervals() {
  const v = getSetting('intervals', {});
  return {
    opmlMs: (Number(v.opml) || 12) * 3600e3, // 小时
  };
}

// 抓取单个源并记录结果；异常 markSourceError（连失 3 次自动暂停），不中断调度
async function fetchOne(s) {
  try {
    const r = await fetchSource(s);
    if (r.articles || r.videos) {
      log.info(`抓取 ${s.name}: 新增文章 ${r.articles}，视频 ${r.videos}`);
    }
  } catch (err) {
    log.error(`抓取失败 [${s.type}] ${s.name}:`, err.message);
    const { failCount, autoPaused } = markSourceError(s, err.message);
    if (autoPaused) log.warn(`源「${s.name}」连续失败 ${failCount} 次，已自动暂停（enabled=0），可在设置页手动恢复`);
  }
}

// scanAndEnqueue：扫到期源 → 入队（队列模式）或串行执行（fallback）
async function scanAndEnqueue() {
  if (tickingRef.value) return;
  tickingRef.value = true;
  try {
    const due = db.prepare(
      'SELECT * FROM sources WHERE enabled=1 AND (next_fetch_at IS NULL OR next_fetch_at <= ?)'
    ).all(new Date().toISOString());
    for (const s of due) {
      if (QUEUE_ENABLED) {
        taskQueue.enqueue('fetch_source', { sourceId: s.id }, {
          priority: s.focus ? 100 : 50,
          sourceId: s.id,
        });
      } else {
        await fetchOne(s);
      }
    }
  } catch (err) {
    log.error('调度 scanAndEnqueue 异常:', err.message);
  } finally {
    tickingRef.value = false;
  }
}

// 兼容旧 tick() 调用（测试/外部引用）
async function tick() { return scanAndEnqueue(); }

function start() {
  stop();
  started = true;
  // 崩溃恢复：将上次进程中断的 running 任务重置为 pending
  TaskQueue.recoverCrashed();

  const iv = intervals();
  timers.push(setInterval(() => { jobsOpml.runOpmlSync().catch(() => {}); }, iv.opmlMs));
  // due 驱动：每 60s 扫到期源 → 入队（队列模式异步消费，或 fallback 串行）
  timers.push(setInterval(() => { scanAndEnqueue().catch(() => {}); }, 60000));
  // 队列消费：持续处理 pending 任务
  if (QUEUE_ENABLED) taskQueue.startProcessing(2000);
  // 失败重试：每 30s 扫描 failed 且可重试的任务
  if (QUEUE_ENABLED) timers.push(setInterval(() => { taskQueue.retryFailed().catch(() => {}); }, 30000));
  jobsDaily.scheduleDaily();
  jobsFulltext.scheduleFulltextRecovery();
  // 补跑机制：服务启动时若今日已过生成时间但还没有日报（比如 08:00 时服务没开），立即补一份
  const dailySvc = require('../ai/daily');
  if (dailySvc.needsGeneration()) {
    log.info('检测到今日日报缺失（服务启动晚于定时时间），立即补跑');
    (async () => {
      try {
        await jobsDaily.fetchDueBeforeDaily();
        await dailySvc.generate();
      } catch (err) {
        log.error('日报补跑失败:', err.message);
      }
    })();
  }
  // T35：云端队列轮询（默认 10min，queue.enabled 控制，三队列依次）
  const q = getSetting('queue', {});
  const queueMs = (Number(q.intervalMin) || 10) * 60e3;
  if (q.enabled) {
    timers.push(setInterval(() => { require('../queue/poller').pollAll().catch(() => {}); }, queueMs));
    log.info(`队列轮询已注册: 每 ${queueMs / 60e3}min（wechat/bilibili/douyin 依次）`);
  }
  // 九期:Vercel 只读门户数据同步(每 2 小时,portal.enabled!==false 时启用)
  if (getSetting('portal.enabled', true)) {
    timers.push(setInterval(() => { jobsPortal.runPortalSync(); }, 2 * 3600e3));
    log.info('门户数据同步已注册: 每 2h(需 portal/ 完成 git 绑定)');
  }
  // 1.3:数据生命周期——每 24h 清理过期数据
  timers.push(setInterval(() => {
    try { jobsMaintenance.runDataCleanup(); } catch (err) { log.error('数据清理失败:', err.message); }
  }, 24 * 3600e3));
  // 报警 housekeeping：每 10min 自动清理过期冷却记录与报警日志（7 天）
  timers.push(setInterval(() => { jobsMaintenance.runAlertHousekeeping(); }, 10 * 60e3));
  jobsRecovery.resumeInterrupted(); // T48：恢复上次进程中断的 pending 解析/串行队列
  // 健康自检心跳（服务器无人值守场景）：每 5 分钟检查采集是否停滞
  timers.push(setInterval(() => { jobsMaintenance.healthCheck().catch(() => {}); }, 5 * 60e3));
  log.info(`调度中心已启动: OPML 每 ${iv.opmlMs / 3600e3}h，抓取 due 驱动（每 60s 扫到期源），抖音严格串行，健康自检每 5min`);
}

function stop() {
  started = false;
  for (const t of timers) clearInterval(t);
  timers = [];
  taskQueue.stopProcessing();
  jobsDaily.stopDaily();
  jobsFulltext.stopFulltextRecovery(); // A2 修复：reschedule 不再累积重复 cron
}

// settings 变更后清旧任务重建；调度器未启动的进程（测试/脚本）中为空操作，防止自启挂住事件循环
function reschedule() {
  if (!started) return;
  log.info('调度中心重新排程');
  start();
}

module.exports = { start, stop, reschedule, tick, fetchDueBeforeDaily: jobsDaily.fetchDueBeforeDaily, healthCheck: jobsMaintenance.healthCheck, runOpmlSync: jobsOpml.runOpmlSync };
