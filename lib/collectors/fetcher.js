// 异步抓取编排层 —— Serverless 兼容版本
// 对应 server/services/collectors/fetcher.js，使用 lib/db.js 异步接口
// 职责：调用适配器 fetch → 落库 → 更新源状态

const { dbRun, dbGet, nowIso } = require('../db');
const { saveArticles, saveVideos } = require('./repo');

// ─── 刷新间隔计算（从 _shared.js 提取，去掉 getSetting 依赖） ───
function intervalMinFor(source, intervals = {}) {
  let extra = {};
  try { extra = JSON.parse(source.extra || '{}'); } catch { /* 无 extra */ }
  const per = Number(extra.intervalMin);
  if (Number.isFinite(per) && per > 0) return per;

  const type = source.type;
  if (type === 'bilibili') return Number(intervals.bilibili) || 60;
  if (type === 'rss' || type === 'wechat' || type === 'x' || type === 'youtube') {
    return (Number(intervals.rss) || 8) * 60;
  }
  // hotlist / 其他
  return (Number(intervals.rss) || 8) * 60;
}

// ─── 抓取单源 ───
async function fetchSource(source, adapter) {
  let extra = {};
  try { extra = JSON.parse(source.extra || '{}'); } catch { /* 非法 JSON */ }

  const result = await adapter.fetch(source, {});
  const addedArticles = await saveArticles(source.id, result.articles || [], {
    marksFeatured: !!extra.marksFeatured,
  });
  const addedVideos = await saveVideos(source.id, result.videos || []);

  // ETag/Last-Modified 写回 extra
  if (result.etag) extra.etag = result.etag;
  if (result.lastModified) extra.lastModified = result.lastModified;
  if (extra.lastError) {
    delete extra.lastError;
    delete extra.lastErrorAt;
  }

  const now = nowIso();
  const next = new Date(Date.now() + intervalMinFor(source) * 60000).toISOString();

  await dbRun(
    "UPDATE sources SET extra=?, last_fetched_at=?, next_fetch_at=?, status='ok', fail_count=0 WHERE id=?",
    JSON.stringify(extra), now, next, source.id
  );

  return { articles: addedArticles, videos: addedVideos, notModified: !!result.notModified };
}

// ─── 源错误处理（熔断计数） ───
async function markSourceError(source, errMsg) {
  let extra = {};
  try { extra = JSON.parse(source.extra || '{}'); } catch { /* 无 extra */ }
  extra.lastError = String(errMsg || '未知错误').slice(0, 300);
  extra.lastErrorAt = nowIso();

  await dbRun(
    "UPDATE sources SET status='error', fail_count=COALESCE(fail_count,0)+1, extra=? WHERE id=?",
    JSON.stringify(extra), source.id
  );

  const row = await dbGet('SELECT fail_count, enabled FROM sources WHERE id=?', source.id);
  const failCount = row ? row.fail_count : 1;
  let autoPaused = false;
  if (failCount >= 3 && row && row.enabled !== 0) {
    await dbRun('UPDATE sources SET enabled=0 WHERE id=?', source.id);
    autoPaused = true;
  }
  return { failCount, autoPaused };
}

// ─── 解冻源 ───
async function unfreezeSource(id) {
  const row = await dbGet('SELECT extra FROM sources WHERE id=?', id);
  if (!row) return false;
  let extra = {};
  try { extra = JSON.parse(row.extra || '{}'); } catch { /* 无 extra */ }
  delete extra.lastError;
  delete extra.lastErrorAt;
  await dbRun(
    "UPDATE sources SET enabled=1, fail_count=0, status='ok', extra=? WHERE id=?",
    JSON.stringify(extra), id
  );
  return true;
}

module.exports = { fetchSource, markSourceError, unfreezeSource, intervalMinFor };
