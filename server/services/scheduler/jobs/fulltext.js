// 全文补抓 Job（重构 Phase 3 从 scheduler/index.js 提取）
// 职责：定时批量补抓摘要不足的文章（每 6h，limit 300 条，2s 间隔）

const cron = require('node-cron');
const { db } = require('../../../db');
const log = require('../../../util/log');

// P1: 全文补抓定时任务 - 每 6 小时批量补抓摘要不足的文章（P2-4：原每天 1 次×100 条远低于 87 源产文速度）
async function performFulltextRecovery() {
  // 查找内容长度 < 1000 字符且启用过全文补抓的文章（limit 300 条/次防请求风暴，2s 间隔≈10min 跑完）
  // 2026-09-05 修复（P1-1）：aggregator 是 extra JSON 标志而非 sources.type 取值，
  // 原条件 `s.type != 'aggregator'` 恒真，导致 AIHOT 聚合源文章被直抓第三方原站（与 rss 适配器设计矛盾）
  const articles = db.prepare(
    `SELECT a.*, s.name as source_name, s.extra 
     FROM articles a 
     JOIN sources s ON a.source_id = s.id 
     WHERE a.content_html IS NOT NULL 
       AND LENGTH(a.content_html) < 1000 
       AND json_extract(COALESCE(s.extra,'{}'),'$.aggregator') IS NOT 1  -- aggregator 由 enrich 管线处理
     LIMIT 300`
  ).all();
  
  if (!articles.length) {
    log.info('[全文补抓] 无需要补抓的文章');
    return;
  }
  
  log.info(`[全文补抓] 启动：发现 ${articles.length} 篇摘要文章需要补抓…`);
  const rssAdapter = require('../../collectors/rss');
  const { fetchFulltext } = rssAdapter;
  
  let successCount = 0;
  let failCount = 0;
  
  for (const a of articles) {
    try {
      const full = await fetchFulltext(a.url);
      if (full && full.content.length > (a.content_html || '').length) {
        // 更新数据库（使用 Readability 提取的干净正文）；articles 表无 updated_at 列，不得引用
        // 注意：better-sqlite3 的编号参数 ?1 不支持位置绑定，必须用匿名 ?
        // 2026-09-05：同步维护 word_count（纯文本字数）
        const { textLen } = require('../../collectors/repo');
        const sql = 'UPDATE articles SET content_html = ?, summary = ?, word_count = ? WHERE id = ?';
        db.prepare(sql).run(full.content, full.summary || summarizer(full.content), textLen(full.content), a.id);
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

// P1: 全文补抓定时任务注册（P2-4：每 6h 一次，凌晨 2 点那轮保留在周期内）
// 2026-09-05b A2 修复：模块级句柄管理——reschedule() 会重复调用本函数，
// 原先每次多挂一个 cron（设置改 N 次 = 同一时刻 N 轮 300 条×2s 补抓）；照 jobs/daily.js 模式先停旧再挂新
let fulltextCron = null;
function scheduleFulltextRecovery() {
  stopFulltextRecovery();
  fulltextCron = cron.schedule('0 2,8,14,20 * * *', async () => {
    log.info('[全文补抓] 定时任务触发');
    try {
      await performFulltextRecovery();
    } catch (err) {
      log.error('[全文补抓] 定时任务失败:', err.message);
    }
  }, { name: 'fulltext-recovery' });
  log.info('[全文补抓] 定时任务已注册：每 6 小时一次（02/08/14/20 点，保留原凌晨 2 点低峰槽）');
  return fulltextCron;
}

function stopFulltextRecovery() {
  if (fulltextCron) {
    // node-cron v3 无 destroy；stop() 会停掉调度定时器（注册表条目不再触发）
    fulltextCron.stop();
    fulltextCron = null;
  }
}

module.exports = { performFulltextRecovery, scheduleFulltextRecovery, stopFulltextRecovery, summarizer };
