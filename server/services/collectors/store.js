// 采集落库公共助手：url 去重入库 + fetchSource（适配器 fetch → 入库 → 更新源状态）
const { db, getSetting } = require('../../db');
const { nowIso } = require('../../util/time');
const log = require('../../util/log');
const registry = require('./registry');

const insertArticle = db.prepare(`
  INSERT OR IGNORE INTO articles(source_id, title, url, author, cover, summary, content_html, published_at, created_at, category, original_url, score)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
// 七期 F1/F2：已存在条目冲突时回填 original_url（feed 🔗 链接后补的场景）
const updateArticleOriginalUrl = db.prepare(`
  UPDATE articles SET original_url = COALESCE(?, original_url) WHERE url = ?
`);
// 冲突时刷新热度值（hotlist 热度随时间变化；只在新值非空时覆盖，避免误清 AIHOT 评分）
const updateArticleScore = db.prepare(`
  UPDATE articles SET score = ? WHERE url = ? AND ? IS NOT NULL
`);
// 七期 F2：full.xml 精选源命中条目置 featured=1
const markFeaturedByUrl = db.prepare(`UPDATE articles SET featured = 1 WHERE url = ?`);
const insertVideo = db.prepare(`
  INSERT INTO videos(source_id, platform, title, url, vid, cover, duration, author, intro, published_at, play_uri, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(url) DO UPDATE SET play_uri=COALESCE(excluded.play_uri, videos.play_uri)
`);

function saveArticles(sourceId, articles, { marksFeatured = false } = {}) {
  let added = 0;
  for (const a of articles) {
    const score = Number(a.score); // 归一：字符串热度（如 "99"）也可入库，非数值落 NULL
    const r = insertArticle.run(
      sourceId, a.title || '', a.url, a.author || '', a.cover || null,
      a.summary || '', a.content_html || '', a.published_at || null, nowIso(), a.category || null,
      a.original_url || null, Number.isFinite(score) ? score : null
    );
    added += r.changes;
    // 冲突（已存在）时同步 original_url 与 score（hotlist 热度随刷新更新）；marksFeatured 源命中即置 featured=1（含新插入条目）
    if (!r.changes && a.original_url) updateArticleOriginalUrl.run(a.original_url, a.url);
    if (!r.changes && Number.isFinite(score)) updateArticleScore.run(score, a.url, score);
    if (marksFeatured) markFeaturedByUrl.run(a.url);
  }
  return added;
}

function saveVideos(sourceId, videos) {
  let added = 0;
  for (const v of videos) {
    const r = insertVideo.run(
      sourceId, v.platform || '', v.title || '', v.url, v.vid || null,
      v.cover || null, v.duration || null, v.author || '', v.intro || '',
      v.published_at || null, v.play_uri || null, nowIso()
    );
    added += r.changes;
  }
  return added;
}

// 该源的刷新间隔（分钟）：extra.intervalMin（>0）优先，否则按 type 走全局 settings.intervals（F2）
// 兼容旧调用：传入字符串时视为 type
function intervalMinFor(source) {
  const type = typeof source === 'string' ? source : source.type;
  if (source && typeof source === 'object') {
    let extra = {};
    try { extra = JSON.parse(source.extra || '{}'); } catch { /* 非法 JSON 按无覆盖处理 */ }
    const per = Number(extra.intervalMin);
    if (Number.isFinite(per) && per > 0) return per;
  }
  const intervals = getSetting('intervals', {});
  // 适配器契约字段 defaultIntervalMin（plan.md 定义）作为该 type 的默认间隔，消除硬编码魔数；settings.intervals 仍可全局覆盖
  const adapterDefault = (t) => {
    const a = registry.getAdapter(t);
    const d = a && Number(a.defaultIntervalMin);
    return Number.isFinite(d) && d > 0 ? d : null;
  };
  if (type === 'bilibili') return Number(intervals.bilibili) || adapterDefault('bilibili') || 60;
  if (type === 'douyin') return Number(intervals.douyin) || adapterDefault('douyin') || 360;
  // wechat / rss / x / youtube 有意共用 RSS 文章刷新间隔（小时）——保留既有共享语义
  if (type === 'rss' || type === 'wechat' || type === 'x' || type === 'youtube') {
    return (Number(intervals.rss) || 8) * 60;
  }
  // 其余类型（hotlist / wemp / 未知）用各自适配器默认间隔，无则回退 RSS 间隔
  return adapterDefault(type) || (Number(intervals.rss) || 8) * 60;
}

// P2 并发防护：同一 source.id 同时只允许一次抓取在飞，覆盖 tick / 手动 refresh / refresh-all / daily 补抓 / restore-all 全部调用方
// 避免 08:00 日报补抓与 60s tick、或用户连点手动刷新对同一源并发双抓（带宽浪费 + 对端风控 + 重复入库竞态）
const inFlight = new Set();

// 拉取一个源并入库；成功更新 last_fetched_at/next_fetch_at/status='ok' 并清零连续失败计数，失败抛出（调用方记 error）
// 七期：ETag 写回 extra；304 短路（notModified，空变更但照常更新 next_fetch_at）；
//       marksFeatured 源命中置 featured；aggregator 源刷新后异步补抓详情（enrichMissing）
async function fetchSource(source) {
  const id = source && source.id != null ? source.id : null;
  if (id !== null && inFlight.has(id)) {
    log.info(`[并发防护] 源 ${id}（${source.name || source.type}）抓取已在飞，跳过重复触发`);
    return { articles: 0, videos: 0, skipped: true, reason: 'in-flight' };
  }
  if (id !== null) inFlight.add(id);
  try {
    return await fetchSourceInner(source);
  } finally {
    if (id !== null) inFlight.delete(id);
  }
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
  const next = new Date(Date.now() + intervalMinFor(source) * 60000).toISOString();
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

// T48 异常恢复：抓取失败记 status='error' 且 fail_count+1；连续失败 3 次自动暂停（enabled=0），
// 手动重新启用（toggle）时清零 fail_count 恢复。返回 {failCount, autoPaused}
// 九期补丁:失败原因写入 extra.lastError/lastErrorAt(健康度展示用);成功时由 fetchSource 清除
// opts.silent:批量刷新(refresh-all / opml /refresh)时置 true——逐源报警会打爆渠道限流,由调用方结尾汇总一次
function markSourceError(source, errMsg, opts = {}) {
  let extra = {};
  try { extra = JSON.parse(source.extra || '{}'); } catch { /* 非法 JSON 按无处理 */ }
  // ✅ 使用 log.mask() 脱敏敏感信息（Token/Cookie/API Key）
  extra.lastError = log.mask(String(errMsg || '未知错误')).slice(0, 300);
  extra.lastErrorAt = nowIso();
  db.prepare("UPDATE sources SET status='error', fail_count=COALESCE(fail_count,0)+1, extra=? WHERE id=?")
    .run(JSON.stringify(extra), source.id);
  const row = db.prepare('SELECT fail_count, enabled FROM sources WHERE id=?').get(source.id);
  const failCount = row ? row.fail_count : 1;
  let autoPaused = false;
  if (failCount >= 3 && row.enabled !== 0) {
    db.prepare('UPDATE sources SET enabled=0 WHERE id=?').run(source.id);
    autoPaused = true;
  }
  // 九期:报警触发(异步,不阻塞调度;失败只记日志);批量路径(opts.silent)跳过,由调用方汇总
  if (!opts.silent && failCount >= 2) {
    setImmediate(() => {
      require('../alerts').sourceError(source, failCount, errMsg).catch((e) => log.warn('[报警] 触发失败:', e.message));
    });
  }
  return { failCount, autoPaused };
}

// 解冻语义唯一实现（2026-09-04 收敛）:enabled=1 + fail_count=0 + status='ok' + 清 extra.lastError/lastErrorAt,
// 其余 extra 配置(intervalMin/etag 等)保留。所有解冻入口(sources toggle / health unfreeze(-all) /
// restore-all / scripts/restore-frozen-sources.js)必须走这里,防多套实现语义漂移
function unfreezeSource(id) {
  const row = db.prepare('SELECT extra FROM sources WHERE id=?').get(id);
  if (!row) return false;
  let extra = {};
  try { extra = JSON.parse(row.extra || '{}'); } catch { /* 非法 JSON 按无处理 */ }
  delete extra.lastError;
  delete extra.lastErrorAt;
  db.prepare("UPDATE sources SET enabled=1, fail_count=0, status='ok', extra=? WHERE id=?")
    .run(JSON.stringify(extra), id);
  return true;
}

module.exports = { saveArticles, saveVideos, fetchSource, intervalMinFor, markSourceError, unfreezeSource };
