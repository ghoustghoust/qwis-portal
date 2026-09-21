// 「我的阅读」type 口径唯一实现（AGENTS §1：同一份实现放 lib/，本地与云端读层共用）
//
// 为什么要有这个文件（2026-09-19 线上实测）：type 的 SQL 条件原本在**四处**各手写一份
// —— 本地列表、本地计数、云端列表、云端计数。结果三处漂移：
//   ① 两端列表与计数都漏 'wemp'：article Tab 计数 6413，真实 7282（869 篇公众号文章不计入）
//   ② 播客列表按音频外壳匹配到 143 条、计数却写 s.type='douyin' 恒 0 → 列表有行、计数显示 0
//   ③ 本地列表的播客条件与云端不同 → 同一份数据两端筛出不同结果
const ARTICLE_SOURCE_TYPES = ['wemp', 'wechat', 'rss', 'x'];

// 播客目前只能靠音频封面外壳识别（enclosure 落进了 cover），没有独立的 source type。
// 定义只有一份：lib/media.js 的 audioCoverSql（detectAudioUrl 的 SQL 镜像）。
// 这是权宜口径，正式方案见 docs/specs/36-reading-semantics/spec.md。
const { audioCoverSql, detectAudioUrl } = require('./media');
const PODCAST_COVER_SQL = audioCoverSql('a.cover');

const ARTICLE_COND_SQL = `s.type IN (${ARTICLE_SOURCE_TYPES.map((t) => `'${t}'`).join(', ')})`;

// → { articleCond, includeArticles, includeVideos }
function readingTypeFilter(type) {
  switch (String(type || 'all')) {
    case 'article':
      return { articleCond: ARTICLE_COND_SQL, includeArticles: true, includeVideos: false };
    case 'podcast':
      return { articleCond: PODCAST_COVER_SQL, includeArticles: true, includeVideos: false };
    case 'video':
      return { articleCond: null, includeArticles: false, includeVideos: true };
    default:
      return { articleCond: null, includeArticles: true, includeVideos: true };
  }
}

// 「我的阅读」视频侧口径（B29 残余）：交互过 = 收藏过 **或观看过**。
// 此前两端只认 favorite=1 —— 线上视频收藏常年为 0 → 视频区恒空。
// watched_at 目前只有本地端写回（B30/36-4 未做），云端加这个 OR 当下是零行为变化的前置修正。
const READING_VIDEO_COND = '(v.favorite = 1 OR v.watched_at IS NOT NULL)';

// 计数侧用同一个表达式；'AND 0' 是既有调用点用来跳过文章侧计数的哨兵
function readingTypeCondSql(type) {
  const f = readingTypeFilter(type);
  if (!f.includeArticles) return 'AND 0';
  return f.articleCond ? `AND ${f.articleCond}` : '';
}

// 列表条目的"到底是什么"标记（B62）：前端原来用 sourceType==='douyin' 猜播客，
// 而播客的真实判定是封面音频特征——同一个分类的又一份副本，且与筛选口径互相矛盾
// （筛得出来、徽章却写「文章」）。kind 一律由本函数出，两端与前端共用。
function readingItemKind(row) {
  if (!row) return 'article';
  if (row.item_type === 'video') return 'video';
  return detectAudioUrl(row.cover) ? 'podcast' : 'article';
}
function withReadingKinds(items) {
  return (items || []).map((it) => ({ ...it, kind: readingItemKind(it) }));
}

module.exports = {
  ARTICLE_SOURCE_TYPES,
  PODCAST_COVER_SQL,
  READING_VIDEO_COND,
  readingTypeFilter,
  readingTypeCondSql,
  readingItemKind,
  withReadingKinds,
};
