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
const { audioCoverSql } = require('./media');
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

// 计数侧用同一个表达式；'AND 0' 是既有调用点用来跳过文章侧计数的哨兵
function readingTypeCondSql(type) {
  const f = readingTypeFilter(type);
  if (!f.includeArticles) return 'AND 0';
  return f.articleCond ? `AND ${f.articleCond}` : '';
}

module.exports = {
  ARTICLE_SOURCE_TYPES,
  PODCAST_COVER_SQL,
  readingTypeFilter,
  readingTypeCondSql,
};
