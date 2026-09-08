// 数据仓储层（重构 Phase 2 提取）
// 职责：文章/视频的 INSERT OR IGNORE + 冲突更新（纯 CRUD，不含抓取逻辑）
// 从 store.js 提取，与 fetcher.js（抓取编排）和 store.js（源生命周期）职责分离

const { db } = require('../../db');
const { nowIso } = require('../../util/time');

// 2026-09-05：正文纯文本字数（剥 HTML 标签/实体），入库时维护 word_count
// 用于列表/详情的「N 字 · 约 M 分钟」展示——LENGTH(content_html) 会把公众号内联样式算进去，虚高几十倍
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

// ─── Prepared Statements ─────────────────────────────────────────────────────
const insertArticle = db.prepare(`
  INSERT OR IGNORE INTO articles(source_id, title, url, author, cover, summary, content_html, published_at, created_at, category, original_url, score, word_count)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

// ─── 文章落库 ─────────────────────────────────────────────────────────────────
function saveArticles(sourceId, articles, { marksFeatured = false } = {}) {
  let added = 0;
  for (const a of articles) {
    const score = Number(a.score); // 归一：字符串热度（如 "99"）也可入库，非数值落 NULL
    const r = insertArticle.run(
      sourceId, a.title || '', a.url, a.author || '', a.cover || null,
      a.summary || '', a.content_html || '', a.published_at || null, nowIso(), a.category || null,
      a.original_url || null, Number.isFinite(score) ? score : null, textLen(a.content_html)
    );
    added += r.changes;
    // 冲突（已存在）时同步 original_url 与 score（hotlist 热度随刷新更新）；marksFeatured 源命中即置 featured=1（含新插入条目）
    if (!r.changes && a.original_url) updateArticleOriginalUrl.run(a.original_url, a.url);
    if (!r.changes && Number.isFinite(score)) updateArticleScore.run(score, a.url, score);
    if (marksFeatured) markFeaturedByUrl.run(a.url);
  }
  return added;
}

// ─── 视频落库 ─────────────────────────────────────────────────────────────────
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

module.exports = { saveArticles, saveVideos, textLen };
