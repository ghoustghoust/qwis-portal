// 异步数据仓储层 —— Serverless 兼容版本
// 对应 server/services/collectors/repo.js，但使用 lib/db.js 的异步接口
// 职责：文章/视频的 INSERT OR IGNORE + 冲突更新（纯 CRUD，不含抓取逻辑）

const { dbRun, dbGet, nowIso } = require('../db');

// 正文纯文本字数（剥 HTML 标签/实体）
function textLen(html) {
  if (!html) return 0;
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-zA-Z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

// ─── 文章落库 ───
async function saveArticles(sourceId, articles, { marksFeatured = false } = {}) {
  let added = 0;
  const now = nowIso();
  for (const a of articles) {
    const score = Number(a.score);
    const wc = textLen(a.content_html);
    const r = await dbRun(
      `INSERT OR IGNORE INTO articles(source_id, title, url, author, cover, summary, content_html, published_at, created_at, category, original_url, score, word_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sourceId, a.title || '', a.url, a.author || '', a.cover || null,
      a.summary || '', a.content_html || '', a.published_at || null, now,
      a.category || null, a.original_url || null,
      Number.isFinite(score) ? score : null, wc
    );
    added += r.changes;
    // 冲突时回填 original_url / score / featured
    if (!r.changes && a.original_url) {
      await dbRun('UPDATE articles SET original_url = COALESCE(?, original_url) WHERE url = ?', a.original_url, a.url);
    }
    if (!r.changes && Number.isFinite(score)) {
      await dbRun('UPDATE articles SET score = ? WHERE url = ? AND ? IS NOT NULL', score, a.url, score);
    }
    if (marksFeatured) {
      await dbRun('UPDATE articles SET featured = 1 WHERE url = ?', a.url);
    }
  }
  return added;
}

// ─── 视频落库 ───
async function saveVideos(sourceId, videos) {
  let added = 0;
  const now = nowIso();
  for (const v of videos) {
    const r = await dbRun(
      `INSERT INTO videos(source_id, platform, title, url, vid, cover, duration, author, intro, published_at, play_uri, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET play_uri=COALESCE(excluded.play_uri, videos.play_uri)`,
      sourceId, v.platform || '', v.title || '', v.url, v.vid || null,
      v.cover || null, v.duration || null, v.author || '', v.intro || '',
      v.published_at || null, v.play_uri || null, now
    );
    added += r.changes;
  }
  return added;
}

module.exports = { saveArticles, saveVideos, textLen };
