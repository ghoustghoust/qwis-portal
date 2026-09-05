// 调度中心：due 驱动（六期 F2）——每 60s 扫描 next_fetch_at 到期的 enabled 源逐个抓取（支持源级间隔）；
// 保留：OPML 12h 独立 interval、node-cron 日报定时（T27，F19）、队列轮询 10min、抖音串行限速（N4）
const cron = require('node-cron');
const { db, getSetting, setSetting } = require('../../db');
const log = require('../../util/log');
const wechat = require('../collectors/wechat');
const { fetchSource, markSourceError } = require('../collectors/store');

let timers = [];
let dailyCron = null;
let ticking = false; // 防重入：上一轮抓取未结束时跳过本次 tick

function intervals() {
  const v = getSetting('intervals', {});
  return {
    opmlMs: (Number(v.opml) || 12) * 3600e3, // 小时
  };
}

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

// 抓取单个源并记录结果；异常 markSourceError（连失 3 次自动暂停），不中断调度
async function fetchOne(s) {
  try {
    // 抖音源：fetch 内部经 douyin.enqueue 严格串行限速（≥10s，N4）；tick 本身逐个 await 也不并行
    const r = await fetchSource(s);
    if (r.articles || r.videos) {
      log.info(`抓取 ${s.name}: 新增文章 ${r.articles}，视频 ${r.videos}`);
    }
  } catch (err) {
    log.error(`抓取失败 [${s.type}] ${s.name}:`, err.message);
    const { failCount, autoPaused } = markSourceError(s, err.message); // ✅ 补全错误消息参数
    if (autoPaused) log.warn(`源「${s.name}」连续失败 ${failCount} 次，已自动暂停（enabled=0），可在设置页手动恢复`);
  }
}

// due 驱动 tick：扫 enabled=1 且 next_fetch_at 到期（或从未抓取）的源，逐个 fetchSource
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const due = db.prepare(
      'SELECT * FROM sources WHERE enabled=1 AND (next_fetch_at IS NULL OR next_fetch_at <= ?)'
    ).all(new Date().toISOString());
    for (const s of due) await fetchOne(s);
  } catch (err) {
    log.error('调度 tick 异常:', err.message);
  } finally {
    ticking = false;
  }
}

// 日报生成前先补抓到期源（与 /api/daily/regenerate 同逻辑），保证日报数据新鲜
// P2-1 修复：与 tick() 共用 ticking 守卫——先等待在飞 tick 结束（最多 5min），再全程持有守卫补抓，
// 彻底消除 08:00 日报补抓与 60s tick 并发双抓同一源（避免带宽浪费 + 对端风控）
async function fetchDueBeforeDaily() {
  const waitStart = Date.now();
  while (ticking && Date.now() - waitStart < 5 * 60e3) {
    log.info('日报补抓：调度 tick 进行中，等待其结束…');
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (ticking) { log.warn('日报补抓：等待 tick 超时（5min），跳过本次补抓直接生成'); return; }
  ticking = true; // 持有守卫，期间 tick() 会直接 return
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
    ticking = false;
  }
}

// P1: 全文补抓定时任务 - 每 6 小时批量补抓摘要不足的文章（P2-4：原每天 1 次×100 条远低于 87 源产文速度）
async function performFulltextRecovery() {
  // 查找内容长度 < 1000 字符且启用过全文补抓的文章（limit 300 条/次防请求风暴，2s 间隔≈10min 跑完）
  const articles = db.prepare(
    `SELECT a.*, s.name as source_name, s.extra 
     FROM articles a 
     JOIN sources s ON a.source_id = s.id 
     WHERE a.content_html IS NOT NULL 
       AND LENGTH(a.content_html) < 1000 
       AND s.type != 'aggregator'  -- aggregator 由 enrich 管线处理
     LIMIT 300`
  ).all();
  
  if (!articles.length) {
    log.info('[全文补抓] 无需要补抓的文章');
    return;
  }
  
  log.info(`[全文补抓] 启动：发现 ${articles.length} 篇摘要文章需要补抓…`);
  const rssAdapter = require('../collectors/rss');
  const { fetchFulltext, cleanContent } = rssAdapter._internals;
  
  let successCount = 0;
  let failCount = 0;
  
  for (const a of articles) {
    try {
      const full = await fetchFulltext(a.url);
      if (full && full.content.length > (a.content_html || '').length) {
        // 更新数据库（使用 Readability 提取的干净正文）；articles 表无 updated_at 列，不得引用
        // 注意：better-sqlite3 的编号参数 ?1 不支持位置绑定，必须用匿名 ?
        const sql = 'UPDATE articles SET content_html = ?, summary = ? WHERE id = ?';
        db.prepare(sql).run(full.content, full.summary || summarizer(full.content), a.id);
        successCount++;
      }
      // 未获取到更好正文属于正常情况（登录墙/反爬），不逐条记日志，见末尾汇总
    } catch (err) {
      failCount++;
      log.warn(`[全文补抓] ❌ ${a.source_name}: ${a.title.slice(0, 30)}… 失败 (${err.message})`);
    }
    // 限速：每条间隔 2s（避免触发第三方反爬）
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  log.info(`[全文补抓] 完成：成功 ${successCount}，失败 ${failCount}，处理 ${articles.length} 篇`);
}

// 简单的摘要生成器（从 HTML 中提取文本段落）
function summarizer(html, limit = 200) {
  const c = String(html || '');
  // 移除标签
  const text = c.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  // 找第一个像样的段落（≥40 字符）
  const paras = text.split(/\.\s+/).filter(p => p.length >= 40);
  if (paras.length > 0) {
    return paras[0].slice(0, limit);
  }
  // 回退：截断全文
  return text.slice(0, limit);
}

// 日报定时（T27）：node-cron 按 settings['daily'].time（默认 08:00）触发 generate
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
      await require('../ai/daily').generate();
    } catch (err) {
      log.error('日报自动生成失败:', err.message);
      require('../alerts').dailyFailed(err.message).catch(() => {});
    }
  });
  log.info(`日报定时已注册：每天 ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
}

// P1: 全文补抓定时任务注册（P2-4：每 6h 一次，凌晨 2 点那轮保留在周期内）
function scheduleFulltextRecovery() {
  const fulltextCron = cron.schedule('0 2,8,14,20 * * *', async () => {
    log.info('[全文补抓] 定时任务触发');
    try {
      await performFulltextRecovery();
    } catch (err) {
      log.error('[全文补抓] 定时任务失败:', err.message);
    }
  });
  log.info('[全文补抓] 定时任务已注册：每 6 小时一次（02/08/14/20 点，保留原凌晨 2 点低峰槽）');
  return fulltextCron;
}

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
      try { await require('../alerts').collectStalled(detail); } catch { /* 报警失败不阻塞 */ }
    }
  } catch (err) {
    log.error('[健康自检] 检查异常:', err.message);
  }
}

function start() {
  stop();
  const iv = intervals();
  timers.push(setInterval(() => { runOpmlSync().catch(() => {}); }, iv.opmlMs));
  // due 驱动：每 60s 扫到期源（源级间隔由 store.intervalMinFor(source) 在每次抓取后重算 next_fetch_at）
  timers.push(setInterval(() => { tick().catch(() => {}); }, 60000));
  scheduleDaily();
  scheduleFulltextRecovery();  // P1: 全文补抓定时任务
  // 补跑机制：服务启动时若今日已过生成时间但还没有日报（比如 08:00 时服务没开），立即补一份
  const dailySvc = require('../ai/daily');
  if (dailySvc.needsGeneration()) {
    log.info('检测到今日日报缺失（服务启动晚于定时时间），立即补跑');
    (async () => {
      try {
        await fetchDueBeforeDaily();
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
  // 九期:Vercel 只读门户数据同步(每 2 小时,portal.enabled!==false 时启用;未绑定 git 时自动跳过)
  if (getSetting('portal.enabled', true)) {
    timers.push(setInterval(() => {
      try { require('../../tools/sync-portal').run(); } catch { /* 同步失败不影响主系统 */ }
    }, 2 * 3600e3));
    log.info('门户数据同步已注册: 每 2h(需 portal/ 完成 git 绑定)');
  }
  // 1.3:数据生命周期——每 24h 清理过期数据(默认保留 7 天,可用 settings.data.retentionDays 覆盖,与数据管理 Tab 联动;与云端 mode=cleanup 对齐)
  timers.push(setInterval(() => {
    try {
      const rd = Number((getSetting('data', {}) || {}).retentionDays);
      const retentionDays = Number.isFinite(rd) && rd >= 1 ? Math.floor(rd) : 7; // 下限 1 天，防误配清库
      const r = require('../datamgr').cleanup(retentionDays);
      log.info(`数据清理完成(保留 ${retentionDays} 天): 文章 ${r.deleted.articles}，视频 ${r.deleted.videos}，待解析 ${r.deleted.pending_items}，日报 ${r.deleted.daily_reports}`);
    } catch (err) {
      log.error('数据清理失败:', err.message);
    }
  }, 24 * 3600e3));
  // 报警 housekeeping：每 10min 自动清理过期冷却记录与报警日志（7 天）
  // （we-mp-rss 已退役，原 wemp 可达性/Cookie 心跳随之移除）
  timers.push(setInterval(() => {
    try { require('../alerts').autoCleanupOldCooldowns(7); require('../alerts').autoCleanupOldLogs(7); } catch {}
  }, 10 * 60e3));
  resumeInterrupted(); // T48：恢复上次进程中断的 pending 解析/串行队列
  // 健康自检心跳（服务器无人值守场景）：每 5 分钟检查采集是否停滞
  timers.push(setInterval(() => { healthCheck().catch(() => {}); }, 5 * 60e3));
  log.info(`调度中心已启动: OPML 每 ${iv.opmlMs / 3600e3}h，抓取 due 驱动（每 60s 扫到期源），抖音严格串行，健康自检每 5min`);
}

// T48 启动恢复：
//  1) pending_items 中 status='pending' 的 bilibili/douyin 条目（上次进程中断未解析完）后台继续 resolve；
//  2) 抖音串行队列限速状态（douyin.lastFetchAt）由适配器从 settings 恢复，重启后仍遵守 ≥10s 间隔（N4）。
function resumeInterrupted() {
  try {
    const pending = db.prepare(
      "SELECT type, COUNT(*) c FROM pending_items WHERE status='pending' AND type IN ('bilibili','douyin') GROUP BY type"
    ).all();
    if (!pending.length) return;
    const poller = require('../queue/poller');
    for (const { type, c } of pending) {
      log.info(`启动恢复：${type} 队列有 ${c} 条中断的待解析订阅，后台继续解析`);
      poller.resolvePending(type).catch((err) => log.error(`启动恢复[${type}]异常:`, err.message));
    }
  } catch (err) {
    log.error('启动恢复检查失败:', err.message);
  }
}

function stop() {
  for (const t of timers) clearInterval(t);
  timers = [];
  if (dailyCron) {
    dailyCron.stop();
    dailyCron = null;
  }
}

// settings 变更后清旧任务重建
function reschedule() {
  log.info('调度中心重新排程');
  start();
}

module.exports = { start, stop, reschedule, runOpmlSync, tick, resumeInterrupted, healthCheck, fetchDueBeforeDaily };
