// 抓取编排层（重构 Phase 2 提取）
// 职责：调用适配器 fetch → 落库 → 更新源状态 → 触发 enrich
// 从 store.js 提取，与 repo.js（CRUD）和 store.js（源生命周期）职责分离

const { db } = require('../../db');
const { nowIso } = require('../../util/time');
const log = require('../../util/log');
const registry = require('./registry');
const { saveArticles, saveVideos } = require('./repo');
const { withSourceLock, intervalMinFor } = require('./_shared');

// ─── 抓取单源（带并发防护） ──────────────────────────────────────────────────
// P2 并发防护：同一 source.id 同时只允许一次抓取在飞
// 覆盖 tick / 手动 refresh / refresh-all / daily 补抓 / restore-all 全部调用方
// 七期：ETag 写回 extra；304 短路（notModified）；marksFeatured 源命中置 featured
// aggregator 源刷新后异步补抓详情页富字段（enrichMissing）
async function fetchSource(source) {
  const id = source && source.id != null ? source.id : null;
  return withSourceLock(id, () => fetchSourceInner(source));
}

async function fetchSourceInner(source) {
  const adapter = registry.getAdapter(source.type);
  if (!adapter) throw new Error(`未知订阅源类型: ${source.type}`);
  let extra = {};
  try { extra = JSON.parse(source.extra || '{}'); } catch { /* 非法 JSON 按无 extra 处理 */ }
  const result = await adapter.fetch(source, {});
  const addedArticles = saveArticles(source.id, result.articles || [], { marksFeatured: !!extra.marksFeatured });
  const addedVideos = saveVideos(source.id, result.videos || []);
  // ETag/Last-Modified 写回 extra，供下次条件请求；同时清除上次错误标记
  if (result.etag || result.lastModified) {
    if (result.etag) extra.etag = result.etag;
    if (result.lastModified) extra.lastModified = result.lastModified;
  }
  if (extra.lastError) {
    delete extra.lastError;
    delete extra.lastErrorAt;
  }
  db.prepare('UPDATE sources SET extra=? WHERE id=?').run(JSON.stringify(extra), source.id);
  const now = nowIso();
  const next = new Date(Date.now() + intervalMinFor(source, registry) * 60000).toISOString();
  db.prepare("UPDATE sources SET last_fetched_at=?, next_fetch_at=?, status='ok', fail_count=0 WHERE id=?")
    .run(now, next, source.id);
  // 聚合源刷新后异步补抓详情页富字段（串行限速，不阻塞本次刷新；304 无变更时也顺带补存量缺字段条目）
  if (extra.aggregator) {
    setImmediate(() => {
      // 整体 try/catch：异步回调内任何异常（含 SQL schema 问题）不得逃逸成 uncaughtException 崩进程
      try {
        // P1: 将 score IS NULL 的文章加入 pending_items 待处理队列
        // 注意：pending_items 表结构为 (type,url,name,status,error,imported_at)，无 source_id/created_at 列
        const newItems = db.prepare(`
          INSERT INTO pending_items(type, url, name, status, imported_at)
          SELECT 'aihot_enrich', a.url, a.title, 'pending', ?
          FROM articles a JOIN sources s ON s.id = a.source_id
          WHERE json_extract(COALESCE(s.extra,'{}'),'$.aggregator') = 1
            AND a.score IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM pending_items p
              WHERE p.url = a.url AND p.type = 'aihot_enrich'
            )
          LIMIT 50  -- 每轮最多插入 50 条，避免单次写入过大
        `).run(nowIso());

        log.info(`[aihot] pending_items 新增 ${newItems.changes || 0} 条待补抓记录`);
        require('../aihot/enrich').enrichMissing(10).catch((err) => log.warn('[aihot] enrichMissing 异常:', err.message));
      } catch (err) {
        log.warn('[aihot] 待补抓队列写入异常:', err.message);
      }
    });
  }
  return { articles: addedArticles, videos: addedVideos, notModified: !!result.notModified };
}

module.exports = { fetchSource };
