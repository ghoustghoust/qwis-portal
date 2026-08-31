// 云端读取层(十一期 M3):优先读 Turso,无配置/出错/无数据时回退 public/data 静态快照
// 输出字段形状与 _data.js 快照保持一致,前端无感
const data = require('./_data');
const turso = require('./_turso');

const IS_CLOUD = !!process.env.TURSO_DATABASE_URL;

// 单次冷启动内缓存,避免同一请求重复查库
const cache = new Map();

async function cloud(name, loader) {
  if (!IS_CLOUD) return null;
  if (cache.has(name)) return cache.get(name);
  let v = null;
  try {
    v = await loader();
    if (v == null || (Array.isArray(v) && !v.length)) v = null;
  } catch { /* 出错回退快照 */ }
  cache.set(name, v);
  return v;
}

// ---------- 读者端数据 ----------
async function articles() {
  const rows = await cloud('articles', () => turso.dbAll(
    `SELECT a.id, a.source_id, a.title, a.url, a.author, a.cover, a.summary, a.content_html,
            a.published_at, a.read_at, a.later, a.created_at,
            s.name AS source_name, s.type AS source_type, g.name AS domain
     FROM articles a
     LEFT JOIN sources s ON s.id = a.source_id
     LEFT JOIN groups g ON g.id = s.group_id
     ORDER BY a.published_at DESC LIMIT 3000`
  ));
  return rows || data.articles();
}

// 写操作(read_at/later/read-all)后调用,避免同一 lambda 实例继续返回旧缓存
function invalidate(name) {
  if (name) cache.delete(name);
  else cache.clear();
}

async function sources() {
  const rows = await cloud('sources', () => turso.dbAll(
    `SELECT s.id, s.name, s.type, s.avatar, s.group_id, s.status, s.enabled,
            g.name AS domain, 0 AS unread
     FROM sources s LEFT JOIN groups g ON g.id = s.group_id
     ORDER BY s.id`
  ));
  return rows || data.sources();
}

async function groups() {
  const rows = await cloud('groups', () => turso.dbAll(
    'SELECT id, kind, name, sort, 0 AS unread FROM groups ORDER BY sort, id'
  ));
  return rows || data.groups();
}

async function videos() {
  const rows = await cloud('videos', () => turso.dbAll(
    `SELECT v.id, v.source_id, v.platform, v.title, v.url, v.vid, v.cover, v.duration,
            v.author, v.intro, v.published_at, v.created_at,
            s.name AS source_name, s.type AS source_type
     FROM videos v LEFT JOIN sources s ON s.id = v.source_id
     ORDER BY v.published_at DESC LIMIT 500`
  ));
  return rows || data.videos();
}

// AIHOT 列表在云端无独立表:取 hotlist 源文章,extra.domain 作 category
async function aihot() {
  const rows = await cloud('aihot', () => turso.dbAll(
    `SELECT a.id, a.title, a.url, a.summary, a.cover, a.published_at, a.source_id,
            s.name AS source_name,
            json_extract(COALESCE(s.extra,'{}'),'$.domain') AS category
     FROM articles a JOIN sources s ON s.id = a.source_id
     WHERE s.type = 'hotlist'
     ORDER BY a.published_at DESC LIMIT 1000`
  ));
  return rows || data.aihot();
}

async function meta() {
  const m = await cloud('meta', async () => {
    const [a, s, d] = await Promise.all([
      turso.dbGet('SELECT COUNT(*) n FROM articles'),
      turso.dbGet('SELECT COUNT(*) n FROM sources'),
      turso.dbAll("SELECT DISTINCT g.name d FROM sources s JOIN groups g ON g.id=s.group_id WHERE g.name IS NOT NULL"),
    ]);
    return {
      exportedAt: turso.nowIso(),
      sources: s ? s.n : 0,
      articles: a ? a.n : 0,
      domains: d.map((r) => r.d),
      cloud: true,
      live: true, // 标记:数据实时来自 Turso
    };
  });
  return m || data.meta();
}

module.exports = {
  IS_CLOUD,
  articles, sources, groups, videos, aihot, meta, invalidate,
  titleTokens: data.titleTokens,
  jaccard: data.jaccard,
  sortKey: data.sortKey,
};
