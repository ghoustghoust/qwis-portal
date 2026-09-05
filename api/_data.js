// Vercel Serverless 数据层：读取随部署打包的 JSON 快照(public/data/*.json)
// 数据新鲜度 = 本地最近一次 sync(每 2h 导出+部署)。只读,无数据库依赖。
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'public', 'data');
const cache = {};

function load(name) {
  if (!cache[name]) {
    cache[name] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  }
  return cache[name];
}

// ---- 与主系统 server/services/ai/daily.js 同算法的标题聚类(dedup 用) ----
function normalizeTitle(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/^(\d{4}[-/年])?\d{1,2}[-/月]\d{1,2}[日号]?[\s:：,，.、-]*/, '')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function titleTokens(title) {
  const t = normalizeTitle(title);
  const tokens = new Set();
  for (const m of t.matchAll(/[a-z0-9]+/g)) tokens.add(m[0]);
  for (const m of t.matchAll(/[一-鿿]+/g)) {
    const s = m[0];
    if (s.length === 1) tokens.add(s);
    else for (let i = 0; i < s.length - 1; i++) tokens.add(s.slice(i, i + 2));
  }
  return tokens;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// 排序键（快照无 created_at,以 published_at 为准）
const sortKey = (r) => r.published_at || r.created_at || '';

module.exports = {
  meta: () => load('meta.json'),
  daily: () => load('daily-latest.json'),
  events: () => load('events.json'),
  articles: () => load('articles.json'),
  sources: () => load('sources.json'),
  groups: () => load('groups.json'),
  videos: () => load('videos.json'),
  aihot: () => load('aihot.json'),
  titleTokens,
  jaccard,
  sortKey,
};
