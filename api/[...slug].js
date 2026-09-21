// Vercel Serverless Function: Catch-all API 路由
// api/[...slug].js → 处理全部 /api/* 请求
// 使用 Turso (libSQL) 作为数据库，纯异步查询
//
// 路由表:
//   GET  /api/articles          文章列表（分页/筛选/搜索）
//   GET  /api/videos            视频列表
//   GET  /api/hot               热榜条目
//   GET  /api/daily             最新日报
//   GET  /api/sources           源列表
//   GET  /api/groups            分组列表
//   GET  /api/status            状态汇总
//   GET  /api/settings          公开设置
//   GET  /api/reading           阅读统计
//   POST /api/reading/batch     批量操作（取消稍后读/取消收藏/清除已读）
//   POST /api/reading/export    导出阅读条目为 Markdown
//   POST /api/auth/login        登录获取 JWT
//   POST /api/articles/:id/read 标记已读
//   POST /api/articles/:id/later 稍后读
//   POST /api/sources/:id/toggle 启用/停用源
//   ... 更多写操作路由

const { createClient } = require('@libsql/client');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// ─── 数据库连接 ───
let _db = null;
function getDb() {
  if (!_db) {
    _db = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return _db;
}

// ─── 工具函数 ───
function nowIso() { return new Date().toISOString(); }
function jsonOk(data) { return { ok: true, ...data }; }
function jsonErr(msg) { return { ok: false, error: msg }; }

// 热度值格式化：1370000 → "137万"，1.2亿 → "1.2亿"
function formatHeat(n) {
  if (n == null || !Number.isFinite(n)) return '-';
  if (n >= 1e8) return `${Math.round(n / 1e8 * 10) / 10}亿`;
  if (n >= 1e4) return `${Math.round(n / 1e4 * 10) / 10}万`;
  return String(Math.round(n));
}

// 查询辅助
async function qAll(sql, args = []) {
  const r = await getDb().execute({ sql, args });
  return Array.from(r.rows);
}
async function qOne(sql, args = []) {
  const rows = await qAll(sql, args);
  return rows[0] || undefined;
}
async function qRun(sql, args = []) {
  const r = await getDb().execute({ sql, args });
  return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : undefined };
}

// Settings 缓存（Serverless 进程内缓存，冷启动后重建）
const _settingsCache = new Map();
const CACHE_TTL = 30000;
async function getSetting(key, def = null) {
  const cached = _settingsCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.val;
  const row = await qOne('SELECT value FROM settings WHERE key = ?', [key]);
  const val = row ? (JSON.parse(row.value) ?? def) : def;
  _settingsCache.set(key, { val, ts: Date.now() });
  return val;
}
async function setSetting(key, val) {
  await qRun(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(val)]
  );
  _settingsCache.set(key, { val, ts: Date.now() });
}

// ─── 鉴权 ───
const PUBLIC_GET_PATHS = new Set([
  '/api/articles', '/api/articles/since', '/api/videos', '/api/hot', '/api/daily',
  '/api/groups', '/api/sources', '/api/status', '/api/status/daily-sources', '/api/settings', '/api/settings/daily',
  '/api/reading', '/api/img', '/api/meta', '/api/mybrief', '/api/weekly',
  '/api/hot/events', '/api/hot/categories', '/api/hot/sources', '/api/hot/groups',
  '/api/opml/export',
]);

function verifyAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.AUTH_SECRET || 'dev-secret');
  } catch { return null; }
}

function requireAuth(req) {
  const path = req.url.split('?')[0];
  // 登录端点必须豁免：否则没有 token 永远拿不到 token（鸡生蛋死锁）
  // [2026-09-11 P1-10 真根因] 此前登录 401 报 "Unauthorized" 来自本中间件而非 handleLogin，
  // 与 ADMIN_PASSWORD 值无关——改密码永远修不好
  if (path === '/api/auth/login' && req.method === 'POST') return null;
  // 公开 GET 请求不需要鉴权（含 /api/articles/:id、/api/videos/:id(/play)）
  if (req.method === 'GET') {
    if (PUBLIC_GET_PATHS.has(path)) return null;
    if (/^\/api\/articles\/\d+$/.test(path)) return null;
    if (/^\/api\/videos\/\d+(\/play)?$/.test(path)) return null;
    if (/^\/api\/hot\/events\/\d+$/.test(path)) return null;
  }
  const user = verifyAuth(req);
  if (!user) return { status: 401, body: jsonErr('Unauthorized') };
  return null;
}

// ─── 路由处理器 ───

// GET /api/articles
async function handleArticles(req) {
  const q = req.query;
  const PAGE_SIZE = 30;
  const tab = q.tab || 'all';
  const sort = q.sort || 'new';
  const dir = sort === 'old' ? 'ASC' : 'DESC';

  const conds = [];
  const args = [];

  // 阅读器降噪：排除热榜/聚合源；27b（2026-09-15）：屏蔽(muted)/未收录(reader_visible=0)源同口径排除
  if (tab === 'later') conds.push('a.later=1');
  else if (tab === 'history') conds.push('a.read_at IS NOT NULL');

  if (q.source_id) { conds.push('a.source_id=?'); args.push(Number(q.source_id)); }
  else if (q.include_hot !== '1') conds.push(NOT_NOISE_READER);

  if (q.group_id) { conds.push('s.group_id=?'); args.push(Number(q.group_id)); }
  if (q.q) { conds.push('(a.title LIKE ? OR a.content_html LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
  // B99：from/to 是**北京日历日**（前端日期控件给的也是北京日），边界不许拼成 UTC 零点
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) { conds.push('COALESCE(a.published_at, a.created_at) >= ?'); args.push(beijingDayRangeIso(q.from).startIso); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) { conds.push('COALESCE(a.published_at, a.created_at) <= ?'); args.push(beijingDayRangeIso(q.to).endIso); }
  // 27-reader-today：since=<ISO datetime> 精确时刻下限（「今日」滚动 24h 窗口）
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(q.since || '')) { conds.push('COALESCE(a.published_at, a.created_at) >= ?'); args.push(String(q.since)); }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const orderExpr = sort === 'smart'
    ? '(unixepoch(COALESCE(a.published_at,a.created_at)) + COALESCE(s.spotlight,0)*259200)'
    : 'COALESCE(a.published_at, a.created_at)';

  // 游标分页
  let cursorCond = '';
  if (q.cursor) {
    const [cursorVal, cursorId] = q.cursor.split('|');
    if (cursorVal && cursorId) {
      const op = dir === 'DESC' ? '<' : '>';
      // 游标值必须与排序键同型：new/old 的排序键是 ISO 文本列（SQLite TEXT vs 数字串按类型序恒假，2026-09-13 F1）；
      // smart 的排序键是数值表达式，必须绑数字
      const sortArg = sort === 'smart' ? Number(cursorVal) : cursorVal;
      cursorCond = ` AND (${orderExpr} ${op} ? OR (${orderExpr} = ? AND a.id ${op} ?))`;
      args.push(sortArg, sortArg, Number(cursorId));
    }
  }

  const fields = `a.id, a.source_id, a.title, a.translated_title, a.url, a.author, a.cover, a.summary,
    a.published_at, a.read_at, a.later, a.created_at, s.name AS source_name,
    s.spotlight AS source_spotlight, s.avatar AS source_avatar, a.score, a.tags, a.reason, a.word_count`;

  const rows = (await qAll(
    `SELECT ${fields} FROM articles a JOIN sources s ON s.id=a.source_id ${where}${cursorCond} ORDER BY ${orderExpr} ${dir}, a.id ${dir} LIMIT ?`,
    [...args, PAGE_SIZE + 1]
  )).map((r) => {
    const m = mapAudioFields(r); // 播客音频识别（cover 里的 enclosure 音频 → audio_url）
    if (m.translated_title) m.translated_title = cleanTranslatedTitle(m.translated_title);
    if (m.cover === 'null') m.cover = null;
    if (m.source_avatar === 'null') m.source_avatar = null;
    return m;
  });

  let nextCursor = null;
  if (rows.length > PAGE_SIZE) {
    rows.pop();
    const last = rows[rows.length - 1];
    // 游标发排序键的原生列值（ISO 文本），与 cursorCond 的文本比较同型（2026-09-13 F1：
    // 原 epoch 秒数值与 ISO 文本列字典序比较恒假 → 第二页恒空 → 阅读器 30 条后无法下滑）
    if (sort === 'smart') {
      // Number() 防御：libsql 空值可能回字符串 'null'（P1-5 同族），NaN 游标会让第二页恒空
      const sortVal = Math.floor(new Date(last.published_at || last.created_at).getTime() / 1000) + (Number(last.source_spotlight) || 0) * 259200;
      nextCursor = `${sortVal}|${last.id}`;
    } else {
      nextCursor = `${last.published_at || last.created_at}|${last.id}`;
    }
  }

  // 计数（轻量级：只查 later/history 总数，不做 NOT EXISTS 子查询）
  // 27-reader-today：补 today（近 24h 条数，「今日」视图导航计数）
  // 对抗审查 P2-1 修：today 与本地 articleCounts 同口径（排噪），否则云端数字显著虚高
  const dayAgo = new Date(Date.now() - 24 * 3600e3).toISOString();
  const todayCount = (await qOne(
    `SELECT COUNT(*) c FROM articles a JOIN sources s ON s.id=a.source_id
     WHERE COALESCE(a.published_at, a.created_at) >= ? AND ${NOT_NOISE_READER}`,
    [dayAgo])).c;
  const laterCount = (await qOne('SELECT COUNT(*) c FROM articles WHERE later=1')).c;
  const historyCount = (await qOne('SELECT COUNT(*) c FROM articles WHERE read_at IS NOT NULL')).c;

  return jsonOk({ items: rows, nextCursor, counts: { today: todayCount, later: laterCount, history: historyCount } });
}

// GET /api/articles/since?ts=<ISO> — 增量计数（无感刷新轮询专用，返回极小）
// ts 为空 = 建立基线（只回当前最新 sortKey，不计数）
async function handleArticlesSince(req) {
  const q = req.query;
  const conds = [];
  const args = [];
  const ts = String(q.ts || '');
  if (ts) { conds.push('COALESCE(a.published_at, a.created_at) > ?'); args.push(ts); }
  if (q.include_hot !== '1') conds.push(NOT_NOISE_READER);
  if (q.source_id) { conds.push('a.source_id=?'); args.push(Number(q.source_id)); }
  if (q.group_id) { conds.push('s.group_id=?'); args.push(Number(q.group_id)); }
  if (q.tab === 'later') conds.push('a.later=1');
  else if (q.tab === 'history') conds.push('a.read_at IS NOT NULL');
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const row = await qOne(
    // NULLIF 排掉字面串 'null'：published_at/created_at 是 TEXT 列，文本序 `'null' > '2026-…'`，
    // 一行脏数据就能让"最新一条"变成 null（B93 同族；W15 现在按 DDL 派生扫所有这类点）
    `SELECT COUNT(*) c, MAX(COALESCE(NULLIF(a.published_at,'null'), NULLIF(a.created_at,'null'))) latest
     FROM articles a JOIN sources s ON s.id=a.source_id ${where}`, args);
  return jsonOk({ newCount: ts ? (row.c || 0) : 0, latest: row.latest || null });
}

// GET /api/articles/:id — 单篇文章详情（含 content_html）
async function handleArticleById(req, id) {
  const row = await qOne(
    `SELECT a.*, s.name AS source_name, s.spotlight AS source_spotlight, s.avatar AS source_avatar
     FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.id=?`,
    [id]
  );
  if (!row) return { status: 404, body: jsonErr('Article not found') };
  // 顺手标记已读
  await qRun('UPDATE articles SET read_at=COALESCE(read_at, ?) WHERE id=? AND read_at IS NULL', [nowIso(), id]);
  const item = mapAudioFields(row);
  if (item.translated_title) item.translated_title = cleanTranslatedTitle(item.translated_title);
  return jsonOk({ item });
}

// libsql 空值可能回字符串 'null'（P1-5 同族）——展示层图片字段统一归一，否则渲染 src="null" 破图
const cleanNull = (v) => (v && v !== 'null' ? v : null);

// GET /api/videos — 视频+播客列表（2026-09-14 v2）
// 修：①此前无游标，永远只有首屏 30 条（用户：「源不少但未能全部展现」）
//     ②tab=favorite/history 云端此前未生效；③播客并入媒体板块（用户拍板「播客默认和视频放一起」）
// 播客=articles 里 cover 为音频 enclosure 的条目（lib/media.js 同口径），id 加 'a' 前缀与视频区分
async function handleVideos(req) {
  const q = req.query;
  const PAGE_SIZE = 30;
  const withPodcasts = q.podcasts !== '0' && q.tab !== 'favorite' && q.tab !== 'history';
  const vConds = [];
  const vArgs = [];
  if (q.source_id) { vConds.push('v.source_id=?'); vArgs.push(Number(q.source_id)); }
  else vConds.push('COALESCE(s.muted,0)=0 AND COALESCE(s.reader_visible,1)=1'); // 27b：屏蔽/未收录源豁免显式 source_id
  if (q.platform) { vConds.push('v.platform=?'); vArgs.push(q.platform); }
  if (q.group_id) { vConds.push('s.group_id=?'); vArgs.push(Number(q.group_id)); }
  if (q.tab === 'favorite') vConds.push('v.favorite=1');
  else if (q.tab === 'history') vConds.push('v.watched_at IS NOT NULL');
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) { vConds.push('COALESCE(v.published_at, v.created_at) >= ?'); vArgs.push(beijingDayRangeIso(q.from).startIso); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) { vConds.push('COALESCE(v.published_at, v.created_at) <= ?'); vArgs.push(beijingDayRangeIso(q.to).endIso); }

  // 播客侧条件（音频 enclosure 落 cover 的历史形态）——口径唯一来源 lib/media.js#audioCoverSql
  const pConds = ['s.enabled=1', audioCoverSql('a.cover')];
  if (!q.source_id) pConds.push('COALESCE(s.muted,0)=0 AND COALESCE(s.reader_visible,1)=1'); // 27b 同视频侧口径
  const pArgs = [];
  if (q.source_id) { pConds.push('a.source_id=?'); pArgs.push(Number(q.source_id)); }
  if (q.group_id) { pConds.push('s.group_id=?'); pArgs.push(Number(q.group_id)); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) { pConds.push('COALESCE(a.published_at, a.created_at) >= ?'); pArgs.push(beijingDayRangeIso(q.from).startIso); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) { pConds.push('COALESCE(a.published_at, a.created_at) <= ?'); pArgs.push(beijingDayRangeIso(q.to).endIso); }

  // 游标：sort_key|kind|id 复合（kind 字典序 video>podcast，同刻视频在前）
  let cursorCond = '';
  const cursorArgs = [];
  if (q.cursor) {
    const [ck, ckind, cid] = String(q.cursor).split('|');
    if (ck && ckind && cid) {
      cursorCond = ' AND (sort_key < ? OR (sort_key = ? AND (kind < ? OR (kind = ? AND id < ?))))';
      cursorArgs.push(ck, ck, ckind, ckind, Number(cid));
    }
  }

  const videoSql = `SELECT v.id AS id, 'video' AS kind, v.platform, v.title, v.url, v.cover, v.duration, v.author, v.intro,
      v.published_at, v.favorite, NULL AS audio_url, s.name AS source_name, s.avatar AS source_avatar,
      COALESCE(v.published_at, v.created_at) AS sort_key
    FROM videos v JOIN sources s ON s.id=v.source_id ${vConds.length ? 'WHERE ' + vConds.join(' AND ') : ''}`;
  const podcastSql = `SELECT a.id, 'podcast' AS kind, 'podcast' AS platform, a.title, a.url, NULL AS cover, NULL AS duration,
      COALESCE(NULLIF(a.author,''), s.name) AS author, substr(a.summary,1,300) AS intro,
      a.published_at, 0 AS favorite, a.cover AS audio_url, s.name AS source_name, s.avatar AS source_avatar,
      COALESCE(a.published_at, a.created_at) AS sort_key
    FROM articles a JOIN sources s ON s.id=a.source_id WHERE ${pConds.join(' AND ')}`;

  const unionSql = withPodcasts
    ? `SELECT * FROM (${videoSql} UNION ALL ${podcastSql})`
    : `SELECT * FROM (${videoSql})`;
  const rows = await qAll(
    `${unionSql} WHERE 1=1${cursorCond} ORDER BY sort_key DESC, kind DESC, id DESC LIMIT ?`,
    [...vArgs, ...(withPodcasts ? pArgs : []), ...cursorArgs, PAGE_SIZE + 1]
  );

  let nextCursor = null;
  if (rows.length > PAGE_SIZE) {
    rows.pop();
    const last = rows[rows.length - 1];
    nextCursor = `${last.sort_key || ''}|${last.kind}|${last.id}`;
  }
  // 播客条目 id 加 'a' 前缀防与 videos 主键混淆（前端按此前缀路由到音频详情）
  const items = rows.map((r) => {
    const base = { ...r, cover: cleanNull(r.cover), source_avatar: cleanNull(r.source_avatar) };
    return r.kind === 'podcast'
      ? { ...base, id: `a${r.id}`, cover: base.source_avatar || null, audio_url: cleanNull(r.audio_url) }
      : base;
  });
  return jsonOk({ items, nextCursor });
}

// GET /api/videos/:id — 视频详情（云端移植 2026-09-14；此前 404，视频详情/播放全挂）
async function handleVideoById(req, id) {
  const row = await qOne(
    `SELECT v.*, s.name AS source_name, s.avatar AS source_avatar
     FROM videos v LEFT JOIN sources s ON s.id=v.source_id WHERE v.id=?`,
    [id]
  );
  if (!row) return { status: 404, body: jsonErr('Video not found') };
  return jsonOk({ item: row });
}

// GET /api/videos/:id/play — 播放地址（云端版：YouTube/B站走官方 embed；douyin 外链；本地直链解析不回源到云端）
async function handleVideoPlay(req, id) {
  const row = await qOne('SELECT id, vid, platform, url FROM videos WHERE id=?', [id]);
  if (!row) return { status: 404, body: jsonErr('Video not found') };
  if (row.platform === 'bilibili') {
    return jsonOk({ mode: 'official', url: `https://player.bilibili.com/player.html?bvid=${row.vid}&autoplay=0` });
  }
  if (row.platform === 'youtube') {
    // youtube-nocookie 域（隐私模式）；浏览器侧可达性由用户网络决定
    return jsonOk({ mode: 'official', url: `https://www.youtube-nocookie.com/embed/${row.vid}` });
  }
  // douyin 等无 iframe embed：外链原平台
  return jsonOk({ mode: 'external', url: row.url || `https://www.douyin.com/video/${row.vid}` });
}

// POST /api/videos/:id/favorite — 切换收藏
async function handleVideoFavorite(req, id) {
  const row = await qOne('SELECT id, favorite FROM videos WHERE id=?', [id]);
  if (!row) return { status: 404, body: jsonErr('Video not found') };
  const favorite = row.favorite ? 0 : 1;
  await qRun('UPDATE videos SET favorite=? WHERE id=?', [favorite, id]);
  return jsonOk({ favorite });
}

// ─── AI 相关性词表：已抽为共享模块 lib/ai-relevance.js（本文件与 tools/collect-turso.js 同用一份） ───
// 坑 #31：OR 链必须平衡二叉树拼接（SQLite 表达式树深度上限 100，实测超长 OR 链报 Expression tree is too large）
const { aiRelevanceCond, aiTitleConds } = require('../lib/ai-relevance');
// ─── 源四轴（27b，2026-09-15）：订阅集合/轴 action/组级 SQL 与 runner、本地路由共用 ───
const axes = require('../lib/source-axes');
// ─── 热搜事件聚合：共享纯函数 lib/hot-events.js（runner 预聚合写 settings，云端读缓存优先） ───
const { aggregateEventRows, EVENTS_SAMPLE_SQL, EVENTS_WINDOW_H, pickZhDigest, hasCJK } = require('../lib/hot-events');
// 播客音频识别（cover 里的音频 enclosure → audio_url）；audioCoverSql 是其 SQL 镜像，全库唯一口径
const { mapAudioFields, audioCoverSql } = require('../lib/media');
const { cleanTranslatedTitle, decodeXmlEntities } = require('../lib/text-clean');
// 2026-09-18：日报/周刊 AI 守卫（runner 与读层共用同一份实现）
const briefGuards = require('../lib/brief-guards');
// B90：「今日」日界、日报窗口与北京日期串的唯一口径（北京 0 点）。Vercel 容器是 UTC，
// 用 setHours(0,0,0,0) 会统计到 UTC 那一天 —— 同刻实测线上 3554 vs 北京日 9626。
const { beijingDayStartMs, beijingDayStartIso, beijingNow, beijingDateStr, beijingDayRangeIso, weekAgoIso, dailyReportWindowIso } = require('../lib/time-window');
// B58（2026-09-19）：热点榜六类与分类映射与本地服务层共用一份实现
const hotCats = require('../lib/hot-categories');
// B60（2026-09-19）：「我的阅读」type 口径与本地端、与列表/计数共用一份实现
const { readingTypeFilter, readingTypeCondSql, withReadingKinds } = require('../lib/reading-filters');
// B107（2026-09-21）：噪声（热榜/聚合）判定的轴只有一份实现。本文件此前自己写了 7 份，
// 其中 `handleArticlesReadAll` 那份**少两轴**（只排热榜/聚合，不排 muted/未收录）→
// "全部标已读"会标掉列表里根本看不见的条目。现在三处阅读器口径共用下面这一个常量。
const { notNoiseSql, notNoiseExistsSql, notNoiseJoinSql, notHotlistSql, hotlistCondSql, isNoiseSql } = require('../lib/noise');
// B109/B45（spec 37-2）：报警事件表与开关状态也走一份实现（原本地 5 键、云端 7 键、响应里再硬写 4 个不存在的键）
const { eventsState, eventMetaTable } = require('../lib/alert-events');
const NOT_NOISE_READER = notNoiseSql('s', { reader: true });

// GET /api/hot — 热点榜（2026-09-14 重设计，specs/25：读自有评分源 + 热榜聚合为辅）
// tab: all(AI 信息实时流=全源 AI 相关内容时间序) | featured(AI 精选=自有源六维≥60 且 AI 相关) | hotlist(纯热搜子视图)
// 分类=gname(分组名，重名分组合并) / category(六类关键词) / q / source / cursor；时间窗默认 7 天（days 可调，上限 30）
async function handleHot(req) {
  const q = req.query;
  const tab = q.tab || 'all';
  const category = q.category || '';
  const searchQ = (q.q || '').trim();
  const source = q.source || '';
  const PAGE_SIZE = 200;
  const days = Math.min(Number(q.days) || 7, 30);

  const conds = [];
  const args = [];

  // 27b：屏蔽(muted)源从热点榜全部视图排除（L2 脉搏层的反对面）
  conds.push('COALESCE(s.muted,0)=0');

  if (tab === 'featured') {
    // AI 精选（2026-09-14 三阶段修正）：自有源六维≥60 且 AI 相关。
    // 此前「热榜热度>10000」量纲失误——热榜热度百万级，全部越过门槛，精选被知乎/酷安热榜淹没；已剔除热榜源。
    conds.push(`${notHotlistSql('s')} AND COALESCE(CAST(a.score AS REAL), 0) >= 60`);
    conds.push(aiRelevanceCond(args));
  } else if (tab === 'hotlist') {
    conds.push(hotlistCondSql('s'));
  } else if (tab === 'all') {
    // AI 信息实时流（2026-09-14）：从全源只挑 AI 相关内容——AI 主题分组源全收，其余源按标题命中 AI 词表
    conds.push(aiRelevanceCond(args));
    // 噪声源排除：GitHub 提交聚合源（每条 commit 一篇，刷屏信息流；实测占首屏 20%）
    conds.push("s.name NOT LIKE 'Recent Commits to %'");
  }

  // 真实分类过滤（T5-1）：分类映射到 tags 关键词组（实际词表为 模型发布/论文/研究/大佬观点 等复合词）
  const CATEGORY_KWS = {
    '模型': ['模型'],
    '产品': ['产品'],
    '行业': ['行业', '现象/趋势', '产业', '市场'],
    '论文': ['论文', '研究', 'arXiv'],
    '教程': ['教程', '实战', '指南', '入门', '手把手'],
    '观点': ['观点', '思考', '评论', '观察'],
  };
  if (category && CATEGORY_KWS[category]) {
    // 匹配 标题/摘要/tags（tags 只有深析文章才有，单靠 tags 命中率过低）
    conds.push(`(${CATEGORY_KWS[category].map(() => '(a.title LIKE ? OR a.summary LIKE ? OR a.tags LIKE ?)').join(' OR ')})`);
    args.push(...CATEGORY_KWS[category].flatMap((k) => [`%${k}%`, `%${k}%`, `%${k}%`]));
  }
  if (searchQ) {
    conds.push('(a.title LIKE ? OR a.summary LIKE ?)');
    args.push(`%${searchQ}%`, `%${searchQ}%`);
  }
  if (source) {
    conds.push('s.name=?');
    args.push(source);
  }
  // T5-14 H-D：分类对齐阅读器分组（group_id 过滤）
  if (q.group_id && /^\d+$/.test(q.group_id)) {
    conds.push('s.group_id=?');
    args.push(Number(q.group_id));
  }
  // 2026-09-14：gname 按分组名过滤（重名分组「人工智能」×2 等自动合并，前端 pills 按名去重）
  if (q.gname) {
    conds.push('g.name=?');
    args.push(String(q.gname));
  }

  // 时间窗口：默认 7 天（覆盖回溯，G5；参数化命中 idx_articles_pubco）
  conds.push('a.published_at >= ?');
  args.push(new Date(Date.now() - days * 86400e3).toISOString());

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  // 游标分页
  let cursorCond = '';
  const cursorArgs = [];
  if (q.cursor) {
    const [cursorVal, cursorId] = q.cursor.split('|');
    if (cursorVal && cursorId) {
      cursorCond = ' AND (a.published_at < ? OR (a.published_at = ? AND a.id < ?))';
      cursorArgs.push(cursorVal, cursorVal, Number(cursorId));
    }
  }

  // 排序：精选=六维分高优先（2026-09-14：热榜已不入精选，无需分列）+ 时间序；
  //       实时流按全局时间序（2026-09-11 修复：原来按 score 排导致同源成块）
  const orderBy = tab === 'featured'
    ? 'CAST(a.score AS REAL) DESC, a.published_at DESC, a.id DESC'
    : 'a.published_at DESC, a.id DESC';
  const rows = await qAll(
    `SELECT a.id, a.title, a.translated_title, a.url, a.author, a.cover, substr(a.summary,1,300) AS summary,
            CASE WHEN a.translated_content IS NOT NULL AND a.translated_content != '' THEN substr(a.translated_content,1,300) END AS zh_digest,
            CASE WHEN a.summary IS NULL OR trim(a.summary)='' THEN substr(a.content_html,1,500) ELSE NULL END AS content_fallback,
            a.score, a.reason, a.published_at, a.category, a.later, s.name AS source_name
     FROM articles a JOIN sources s ON s.id=a.source_id
     LEFT JOIN groups g ON g.id = s.group_id
     ${where}${cursorCond}
     ORDER BY ${orderBy} LIMIT ?`,
    [...args, ...cursorArgs, PAGE_SIZE + 1]
  );

  let nextCursor = null;
  if (rows.length > PAGE_SIZE) {
    rows.pop();
    const last = rows[rows.length - 1];
    // 游标发原生列值（ISO 文本），与 cursorCond 的 published_at 文本比较同型（2026-09-13 F1，同 handleArticles）
    nextCursor = `${last.published_at || ''}|${last.id}`;
  }

  // 格式化热度值；标题优先译文（2026-09-14：实时流英文标题有阅读障碍）；摘要截断 300；
  // 摘要兜底（2026-09-14：热榜源采集不带摘要，卡片曾只剩标题）——取正文片段剥标签
  const plainText = (h) => String(h || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-zA-Z#0-9]+;/g, ' ')
    .replace(/<[^>]*$/g, '') // substr 截断产生的半标签
    .replace(/\s+/g, ' ')
    .trim();
  const items = rows.map(r => {
    const rawSum = String(r.summary || '').trim();
    // 中文摘要直接用；纯英文摘要且有译文则换中文（2026-09-14：英文报道给中文摘要）
    const sum = (rawSum && hasCJK(rawSum)) ? rawSum
      : (String(r.zh_digest || '').trim() || rawSum || plainText(r.content_fallback));
    const { content_fallback, zh_digest, ...rest } = r;
    return mapAudioFields({
      ...rest,
      cover: cleanNull(rest.cover),
      title: cleanTranslatedTitle(r.translated_title) || r.title,
      original_title: r.translated_title ? r.title : undefined,
      summary: sum.slice(0, 300),
      scoreFormatted: formatHeat(r.score),
    });
  });
  return jsonOk({ items, nextCursor });
}

// GET /api/hot/groups?tab= — 当前 tab 下有内容的分组计数（2026-09-14：分类 pills 数据源；
// 按分组名聚合自动合并重名分组，只返回有内容的组，前端不再出现「点进去为空」的分类）
async function handleHotGroups(req) {
  const tab = req.query.tab || 'all';
  const conds = ['a.published_at >= ?'];
  const args = [new Date(Date.now() - 7 * 86400e3).toISOString()];
  if (tab === 'featured') {
    conds.push(`${notHotlistSql('s')} AND COALESCE(CAST(a.score AS REAL), 0) >= 60`);
    conds.push(aiRelevanceCond(args));
  } else if (tab === 'all') {
    conds.push(aiRelevanceCond(args));
    conds.push("s.name NOT LIKE 'Recent Commits to %'");
  }
  const rows = await qAll(
    `SELECT g.name AS name, COUNT(*) AS count
     FROM articles a JOIN sources s ON s.id=a.source_id
     LEFT JOIN groups g ON g.id = s.group_id
     WHERE ${conds.join(' AND ')} AND g.name IS NOT NULL AND g.name != ''
     GROUP BY g.name ORDER BY count DESC`,
    args
  );
  return jsonOk({ groups: rows });
}

// GET /api/hot/categories — 分类清单 + 生效映射（B58）
// 原实现读到了 settings['hot.categories'] 这个映射，却只回 Object.keys(...)——
// 映射在 API 边界就被丢掉，前端 if (d?.map) 永不成立，于是分类表一直在显示前端自带过时的默认值。
async function handleHotCategories(req) {
  const { map, source } = hotCats.categoryMapOf(await getSetting('hot.categories', null));
  return jsonOk({ categories: Object.keys(map), map, categorySource: source });
}

// GET /api/hot/sources — 实时流来源下拉（2026-09-14：改为全量源计数，此前只查聚合热榜源，下拉里全是「xx热榜」）
// 与实时流同口径（AI 相关 + 7 天窗 + 噪声源排除），保证选中的源一定有内容
async function handleHotSources(req) {
  const args = [new Date(Date.now() - 7 * 86400e3).toISOString()];
  const aiCond = aiRelevanceCond(args);
  const rows = await qAll(
    `SELECT s.name AS name, COUNT(*) AS count
     FROM articles a JOIN sources s ON s.id=a.source_id
     LEFT JOIN groups g ON g.id = s.group_id
     WHERE a.published_at >= ? AND ${aiCond} AND s.name NOT LIKE 'Recent Commits to %'
     GROUP BY s.name ORDER BY count DESC LIMIT 200`,
    args
  );
  return jsonOk({ sources: rows });
}

// ─── 事件聚合引擎：逻辑在 lib/hot-events.js（纯函数，runner/云端共用） ───
// 2026-09-14 加载慢根因治理：内联聚合（3000 行窗口查询 + Jaccard 聚类）在 serverless 冷启动超 30s 上限会 504，
// 改为「runner 每 15min 预聚合写 settings['hot.eventsCache']，云端读缓存优先；缓存缺失/超 45min 才内联兜底」
// 2026-09-16 兜底策略修复：缓存过期时不再做内联聚合（SQL 太重必然超时），改为返回旧缓存 + stale 标记
let _eventsCache = { at: 0, events: null, stale: false };
const EVENTS_CACHE_MS = 90 * 1000; // 进程内 90s（settings 读的缓存）
const EVENTS_SETTINGS_MAX_AGE = 45 * 60e3; // runner 每 15min 写一次；超 45min 视为 runner 异常

// GET /api/hot/events — 跨源事件聚合
async function handleHotEvents(req) {
  const domain = req.query.domain || 'all';
  if (!_eventsCache.events || Date.now() - _eventsCache.at > EVENTS_CACHE_MS) {
    let events = null;
    let stale = false;
    try {
      const cached = await getSetting('hot.eventsCache', null);
      if (cached && Array.isArray(cached.events) && cached.events.length > 0) {
        const age = Date.now() - Number(cached.at || 0);
        if (age < EVENTS_SETTINGS_MAX_AGE) {
          events = cached.events;
        } else {
          // 2026-09-16: 缓存过期仍返回旧数据（好过 504 超时白屏），标记 stale 让前端提示
          events = cached.events;
          stale = true;
        }
      }
    } catch { /* 读不到走兜底 */ }
    if (!events) {
      // 完全无缓存时才尝试内联聚合（极小窗口，避免超时）
      try {
        const cutoff = new Date(Date.now() - 24 * 3600e3).toISOString(); // 仅 24h 兜底
        const rows = await qAll(EVENTS_SAMPLE_SQL, [cutoff]);
        events = aggregateEventRows(rows);
        stale = true;
      } catch {
        events = [];
      }
    }
    _eventsCache = { at: Date.now(), events, stale };
  }

  let result = _eventsCache.events || [];
  if (domain && domain !== 'all') {
    result = result.filter(e => e.domain === domain);
    // 重新编号
    result = result.map((e, idx) => ({ ...e, rank: idx + 1 }));
  }

  // 领域清单（从全量事件提取）
  const domains = [...new Set((_eventsCache.events || []).map(e => e.domain))].filter(Boolean).sort();
  // 列表瘦身（2026-09-14：全量 items 曾使列表响应 246KB、页面长时间「加载中」）——
  // 列表只带报道摘要 digest + 信源/趋势，明细留给 /api/hot/events/:rank
  const list = result.map(({ items, ...e }) => ({ ...e, digest: (items?.[0]?.summary || '').slice(0, 200) }));
  return jsonOk({ events: list, domains, stale: _eventsCache.stale || false });
}

// GET /api/hot/events/:rank — 事件详情
async function handleHotEventDetail(req, rank) {
  const domain = req.query.domain || 'all';
  // 确保缓存已填充
  if (!_eventsCache.events || Date.now() - _eventsCache.at > EVENTS_CACHE_MS) {
    // 触发聚合
    const fakeReq = { query: { domain: 'all' } };
    await handleHotEvents(fakeReq);
  }
  let events = _eventsCache.events || [];
  if (domain && domain !== 'all') {
    events = events.filter(e => e.domain === domain);
    events = events.map((e, idx) => ({ ...e, rank: idx + 1 }));
  }
  const ev = events.find(e => e.rank === rank);
  if (!ev) return { status: 404, body: jsonErr('Event not found') };
  return jsonOk({ event: ev });
}

// ─── 日报生成核心（供 handleDaily getOrGenerate 复用） ───
// 栏目表与入报源类型的**唯一实现**在 lib/daily-columns.js（B10）。
// 本文件此前有两份副本：这里的生成用列 + 下面设置段的"默认列"（后者会被 :2277 的
// 「恢复默认栏目」写进 settings，副本一漂，脏默认值就能进生产库）。
const {
  DEFAULT_COLUMNS: DAILY_COLUMNS,
  ARTICLE_SOURCE_TYPES: DAILY_SOURCE_TYPES,
  DEFAULT_COLUMNS: DAILY_DEFAULT_COLUMNS,
  ARTICLE_SOURCE_TYPES: DAILY_ARTICLE_TYPES,
  VIDEO_SOURCE_TYPES: DAILY_VIDEO_TYPES,
} = require('../lib/daily-columns');

function dailyTitleTokens(title) {
  return String(title || '').replace(/[^\w\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(t => t.length >= 2);
}
function dailyJaccard(a, b) {
  const sa = new Set(a), sb = new Set(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}
function dailyDedup(items) {
  const result = [];
  for (const item of items) {
    const tokens = dailyTitleTokens(item.title);
    let isDup = false;
    for (const e of result) { if (dailyJaccard(tokens, dailyTitleTokens(e.title)) > 0.5) { isDup = true; break; } }
    if (!isDup) result.push(item);
  }
  return result;
}
function dailyFormatItem(a) {
  return { id: a.id, title: a.translated_title || a.title, original_title: a.translated_title ? a.title : undefined, url: a.url, source: a.source_name, published_at: a.published_at, score: a.score, summary: (a.summary || '').slice(0, 200), cover: a.cover };
}

async function generateDailyInline() {
  // 采集窗口＝北京昨日 00:00 → 今日 06:00（口径与 api/daily-generate.js、runner 共用一份）
  const { startIso: cutoff, endIso: cutoffEnd } = dailyReportWindowIso();

  const columns = await getSetting('daily.columns', null) || DAILY_COLUMNS;
  const cfg = await getSetting('daily', {});
  const selectedIds = Array.isArray(cfg.articleSourceIds) ? cfg.articleSourceIds.map(Number) : null;

  let sql = `SELECT a.*, s.name AS source_name, s.spotlight AS source_spotlight
             FROM articles a LEFT JOIN sources s ON s.id = a.source_id
             WHERE a.published_at >= ? AND a.published_at <= ? AND s.enabled = 1
               AND s.type IN (${DAILY_SOURCE_TYPES.map(() => '?').join(',')})`;
  const args = [cutoff, cutoffEnd, ...DAILY_SOURCE_TYPES];
  if (selectedIds && selectedIds.length) {
    sql += ` AND a.source_id IN (${selectedIds.map(() => '?').join(',')})`;
    args.push(...selectedIds);
  }
  sql += ` AND ${notNoiseSql('s')}`;
  sql += ' ORDER BY a.published_at DESC LIMIT 500';

  const candidates = await qAll(sql, args);
  // 简单安检
  let valid = candidates.filter(a => {
    const t = String(a.title || '');
    return t.length >= 6 && !/参数错误|环境异常|访问过于频繁/.test(t);
  });
  // B20（2026-09-19 第二次对抗审查补漏）：全库其实有 5 个日报写入点，线上出问题的这一份（读层内联兜底）
  // 最晚接上门槛 → id=103 的 stats 形状 {candidates,articles,sections,totalItems} 正是本函数的指纹，
  // 实测带进 2 条 <30 分（29/22）。门槛口径与其余四份共用同一条 lib/brief-guards 实现。
  let gateDropped = 0; // stats.candidates 的口径统一为"进门槛前的候选数"（五份写入器同一条口径，见 CLOUD_PIPELINE_GUIDE §12）
  try {
    const aiCfg = (await getSetting('ai', {})) || {};
    const g = briefGuards.applyDailyQualityGate(valid, aiCfg.dailyMinScore, (m) => console.log(`[日报内联] ${m}`));
    valid = g.kept; gateDropped = g.dropped;
  } catch (e) {
    // 门槛没跑成必须出声：静默 catch 会让"这一期没门槛"看不出来（W14 只看代码接线，看不到运行时没执行）
    console.log('[日报内联] 门槛检查失败（不阻断出报，但本期等于无门槛）:', e.message);
  }

  const sections = [];
  const used = new Set();
  for (const col of columns) {
    const items = [];
    // 27b：special 兼容旧值 'focus'（daily.columns 存量配置未迁移时仍能工作）
    if (col.special === 'spotlight' || col.special === 'focus') {
      for (const a of valid) { if (!used.has(a.id) && a.source_spotlight) { items.push(dailyFormatItem(a)); used.add(a.id); } }
    } else if (col.special === 'fallback') {
      const remaining = valid.filter(a => !used.has(a.id)).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10);
      for (const a of remaining) { items.push(dailyFormatItem(a)); used.add(a.id); }
    } else if (col.keywords && col.keywords.length) {
      for (const a of valid) {
        if (used.has(a.id)) continue;
        if (col.keywords.some(kw => `${a.title} ${a.summary || ''}`.includes(kw))) { items.push(dailyFormatItem(a)); used.add(a.id); }
      }
    }
    const deduped = dailyDedup(items);
    if (deduped.length) sections.push({ column: col.name, desc: col.desc || '', items: deduped.slice(0, 15) });
  }

  // 2026-09-14：日报纳入「视频与播客」栏（窗口内新视频 + 播客音频条目，用户拍板；免 AI，直接列窗内最新）
  try {
    const mediaItems = [];
    const mediaVids = await qAll(
      `SELECT v.id, v.title, v.url, v.cover, v.published_at, v.intro, v.duration, s.name AS source_name, s.avatar AS source_avatar
       FROM videos v JOIN sources s ON s.id=v.source_id
       WHERE v.published_at >= ? AND v.published_at <= ? AND s.enabled = 1
       ORDER BY v.published_at DESC LIMIT 6`,
      [cutoff, cutoffEnd]
    );
    for (const v of mediaVids) {
      mediaItems.push({ id: 'v' + v.id, ref_id: v.id, kind: 'video', title: v.title, url: v.url, source: v.source_name, source_name: v.source_name, published_at: v.published_at, cover: v.cover, summary: v.intro || undefined, duration: v.duration || null, source_avatar: cleanNull(v.source_avatar) });
    }
    // B61：这里曾是第四份「音频封面」判定，且比别处少一个 .opus —— opus 单集进不了日报「视频与播客」栏
    const mediaPods = await qAll(
      `SELECT a.id, a.title, a.translated_title, a.url, a.cover, a.published_at, s.name AS source_name, s.avatar AS source_avatar
       FROM articles a JOIN sources s ON s.id=a.source_id
       WHERE a.published_at >= ? AND a.published_at <= ? AND s.enabled = 1
         AND ${audioCoverSql('a.cover')}
       ORDER BY a.published_at DESC LIMIT 4`,
      [cutoff, cutoffEnd]
    );
    for (const a of mediaPods) {
      mediaItems.push({ id: a.id, ref_id: a.id, kind: 'podcast', title: a.translated_title || a.title, original_title: a.translated_title ? a.title : undefined, url: a.url, source: a.source_name, source_name: a.source_name, published_at: a.published_at, audio_url: a.cover, cover: null, source_avatar: cleanNull(a.source_avatar) });
    }
    if (mediaItems.length) {
      sections.push({ column: '视频与播客', desc: '窗口内新视频/播客，点开即可播放收听', items: mediaItems });
    }
  } catch { /* 媒体栏失败不阻断日报 */ }

  const stats = { schemaVersion: briefGuards.DAILY_SCHEMA_VERSION.KEYWORD, candidates: valid.length + gateDropped, articles: valid.length, gateDropped, sections: sections.length, totalItems: sections.reduce((n, s) => n + s.items.length, 0) };
  const windowH = Math.round((Date.parse(cutoffEnd) - Date.parse(cutoff)) / 3600e3);
  await qRun('INSERT INTO daily_reports(generated_at, window_hours, stats, sections) VALUES(?, ?, ?, ?)',
    [nowIso(), windowH, JSON.stringify(stats), JSON.stringify(sections)]);
  return { generated_at: nowIso(), stats, sections };
}

// GET /api/daily（含 getOrGenerate：当日无日报且已过 9:00 北京时间则自动生成）
// 2026-09-14：读出时实时回填译文标题——日报是生成时快照，生成后才翻好的标题之前永远显示英文；
// 现在读层批量查 translated_title，命中即换成中文标题并把原英文标题放 original_title（前端中英对照）
async function enrichDailyTranslated(sections) {
  if (!Array.isArray(sections) || !sections.length) return sections;
  const ids = [];
  for (const s of sections) for (const it of s.items || []) {
    if (Number.isFinite(Number(it.id)) && !String(it.id).startsWith('v')) ids.push(Number(it.id));
  }
  if (!ids.length) return sections;
  const map = new Map();
  // IN 分批（单批 ≤500 防 SQL 变量上限）
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const rows = await qAll(
      `SELECT id, translated_title, source_id FROM articles WHERE id IN (${batch.map(() => '?').join(',')}) AND translated_title IS NOT NULL AND translated_title != ''`,
      batch
    );
    for (const r of rows) map.set(r.id, cleanTranslatedTitle(r.translated_title));
  }
  for (const s of sections) {
    for (const it of s.items || []) {
      const t = map.get(Number(it.id));
      if (t && t !== it.title) { it.original_title = it.title; it.title = t; }
      // 顺手修来源字段名：日报条目是 source，弹窗用 source_name——双写兼容（2026-09-14「未知来源」修复）
      if (!it.source_name && it.source) it.source_name = it.source;
    }
  }
  return sections;
}

async function handleDaily(req) {
  // 2026-09-18 修复：不再只取最新一行。collect.yml 的 daily-report（非 AI，09:03 北京）与下面的
  // 内联兜底都会插入 window_hours=30、无 theme/themes/六维 的裸报告，一旦它比 daily-ai 产物更晚，
  // `ORDER BY generated_at DESC LIMIT 1` 就让每日早报整天退化成裸版（线上实测 id100 遮蔽 id99）。
  const rows = await qAll('SELECT * FROM daily_reports ORDER BY generated_at DESC LIMIT 20');
  const row = briefGuards.pickDailyReport(rows);

  // 检查是否需要自动生成
  if (row) {
    const genDate = new Date(row.generated_at);
    // 「同一天」＝**同一个北京日**。原来写的是 `genDate.toDateString() === now.toDateString()`，
    // 而 toDateString() 用的是容器时区：Vercel 是 UTC，于是北京 08:00 之后再看昨天生成的报告，
    // 会被判成"不是今天"→ 走补生成分支，同一天多插一份日报（B97，与 B90 同根）。
    const freshAi = briefGuards.isAiDailyReport(row)
      && briefGuards.ageHours(row, Date.now()) <= briefGuards.DAILY_AI_MAX_AGE_HOURS;
    if (beijingDateStr(genDate.getTime()) === beijingDateStr() || freshAi) {
      let sections = [];
      try { sections = JSON.parse(row.sections || '[]'); } catch { /* 无效 JSON */ }
      let stats = {};
      try { stats = JSON.parse(row.stats || '{}'); } catch { /* 无效 JSON */ }
      sections = await enrichDailyTranslated(sections);
      return jsonOk({
        report: {
          id: row.id, generated_at: row.generated_at, window_hours: row.window_hours, sections, stats,
          // 18-daily-ai-v2：透出 v2 字段
          theme: stats.theme || null,
          schemaVersion: stats.schemaVersion || 1,
          degraded: !!stats.degraded,
        },
        stale: false,
      });
    }
  }

  // 判断是否已过生成时间：读的是**北京墙上时钟的小时数**（B90 收口径，不再各自 +8h）
  // ⚠️ 本行注释历史上写「北京时间 9:00」，而条件 `hour >= 1` 读的是北京小时 → 实际门槛是北京 01:00。
  //    本轮只统一时区口径、**不改触发点**（改了会挪动云端补生成时间），差异记为 B98 等裁决。
  const hour = beijingNow().getUTCHours();
  if (hour >= 1) {
    try {
      const report = await generateDailyInline();
      return jsonOk({ report: { generated_at: report.generated_at, sections: await enrichDailyTranslated(report.sections), stats: report.stats }, stale: false, autoGenerated: true });
    } catch (err) {
      console.error('[daily] auto-generate failed:', err.message);
    }
  }

  // 无日报且未到生成时间
  if (!row) return jsonOk({ report: null, stale: false });

  // 返回旧日报但标记过期
  let sections = [];
  try { sections = JSON.parse(row.sections || '[]'); } catch { /* 无效 JSON */ }
  let stats = {};
  try { stats = JSON.parse(row.stats || '{}'); } catch { /* 无效 JSON */ }
  sections = await enrichDailyTranslated(sections);
  return jsonOk({
    report: { id: row.id, generated_at: row.generated_at, window_hours: row.window_hours, sections, stats },
    stale: true,
  });
}

// GET /api/groups
async function handleGroups(req) {
  const rows = await qAll(
    `SELECT g.*, COUNT(s.id) AS source_count,
     SUM(CASE WHEN s.enabled=1 THEN 1 ELSE 0 END) AS enabled_count
     FROM groups g LEFT JOIN sources s ON s.group_id=g.id
     GROUP BY g.id ORDER BY g.sort, g.id`
  );
  return jsonOk({ groups: rows });
}

// GET /api/sources（27b：透出四轴列；未读口径=近 3 天，与本地 sources.js 一致；尊重 ?type=&enabled= 过滤）
async function handleSources(req) {
  const conds = [];
  const args = [];
  if (req.query.type) { conds.push('type=?'); args.push(req.query.type); }
  if (req.query.enabled !== undefined) { conds.push('enabled=?'); args.push(Number(req.query.enabled)); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await qAll(
    `SELECT id, type, name, url, avatar, uid, group_id, spotlight, muted, reader_visible, enabled, status,
     last_fetched_at, next_fetch_at, fail_count, created_at
     FROM sources ${where} ORDER BY enabled DESC, name`, args
  );
  // 未读=近 3 天（27-reader-today：历史未读自动归档，焦虑数字消失）；视频源保持总条数
  const threeDaysAgo = new Date(Date.now() - 3 * 86400e3).toISOString();
  const unreadRows = await qAll(
    'SELECT source_id, COUNT(*) c FROM articles WHERE read_at IS NULL AND COALESCE(published_at, created_at) >= ? GROUP BY source_id',
    [threeDaysAgo]
  );
  const videoRows = await qAll('SELECT source_id, COUNT(*) c FROM videos GROUP BY source_id');
  const unreadMap = new Map(unreadRows.map((r) => [r.source_id, r.c]));
  const videoMap = new Map(videoRows.map((r) => [r.source_id, r.c]));
  const VIDEO_TYPES = new Set(['bilibili', 'douyin', 'youtube']);
  const items = rows.map((r) => ({
    ...r,
    unread: VIDEO_TYPES.has(r.type) ? (videoMap.get(r.id) || 0) : (unreadMap.get(r.id) || 0),
  }));
  return jsonOk({ sources: items });
}

// GET /api/status（带 30s 进程内缓存）
const _statusCache = { val: null, ts: 0 };
const STATUS_CACHE_TTL = 30000;
async function handleStatus(req) {
  if (_statusCache.val && Date.now() - _statusCache.ts < STATUS_CACHE_TTL) return _statusCache.val;

  const intervals = { opml: 12, rss: 8, bilibili: 60, ...(await getSetting('intervals', {})) };

  // P1-5 修复：libsql client 在无数据时可能返回字符串 "null" 而非 JS null，显式归一化
  // B93（2026-09-19 独立对抗审查查出）：库里有 1 行 last_fetched_at 是**字面字符串 'null'**
  // （B15 同族的迁移期污染），而文本序 `'null' > '2026-…'` → MAX() 取到它，
  // 归一化后变成 null → 后台「RSS 最后同步」自上线起恒显示"从未同步"。NULLIF 在 SQL 层就排掉。
  const rssLastRaw = (await qOne("SELECT MAX(NULLIF(last_fetched_at,'null')) t FROM sources WHERE type IN ('wechat','rss','wemp','x','youtube')")).t;
  const biliLastRaw = (await qOne("SELECT MAX(NULLIF(last_fetched_at,'null')) t FROM sources WHERE type='bilibili'")).t;
  const rssLast = (rssLastRaw === 'null' || rssLastRaw === undefined) ? null : rssLastRaw;
  const biliLast = (biliLastRaw === 'null' || biliLastRaw === undefined) ? null : biliLastRaw;

  // 抗过载优化（T3-3，Turso 实测）：噪声过滤用正连接（104ms），弃 NOT IN(1500 字面量)（12.8s/次——
  // 逐行评估巨型 IN 列表）。下面三条计数共用同一段 JOIN/WHERE 前缀，口径必须一致。
  const notNoiseJoin = notNoiseJoinSql({ item: 'a' });
  const now = Date.now();
  const dayStartIso = beijingDayStartIso(now);
  const weekAgo = weekAgoIso(now);

  let overview;
  {
    // B26（2026-09-19 实测）：这原先是**一条无 WHERE 的合并 CASE 扫描**——三组计数一次扫完，
    // 79.8k 行 × 平均 15.2KB TEXT 全部落进读层，idx_articles_read_sk/idx_articles_created 都被
    // CASE 合并打掉，单这一步 11.8s，整个端点冷态 12~30s（Hobby 预算 30s → 504）。
    // 拆成三条各自走索引的查询后实测合计 ≈1.8s（未读 1,116ms / 今日 147ms / 本周 455ms，线上只读取数）。
    // 语义必须逐字不变：判据、噪声过滤、时间字段口径都与合并版一致（本轮以修前线上读数做对账）。
    const threeDaysAgo = new Date(now - 3 * 86400e3).toISOString();
    const unread = await qOne(`SELECT COUNT(*) c FROM articles a ${notNoiseJoin} AND a.read_at IS NULL AND COALESCE(a.published_at, a.created_at) >= ?`, [threeDaysAgo]);
    const today = await qOne(`SELECT COUNT(*) c FROM articles a ${notNoiseJoin} AND a.created_at >= ?`, [dayStartIso]);
    const week = await qOne(`SELECT COUNT(*) c FROM articles a ${notNoiseJoin} AND a.created_at >= ?`, [weekAgo]);
    overview = {
      unreadArticles: unread?.c || 0,
      todayNew: today?.c || 0,
      weekNew: week?.c || 0,
    };
  }
  overview.enabledSources = (await qOne(`SELECT COUNT(*) c FROM sources WHERE enabled=1 AND ${notNoiseSql('')}`)).c;

  // B26：入报统计（近 7 天 daily_reports 的 sections 聚合 + 头像补全）**移出首屏**。
  // 移出而不是删：① 它要读 daily_reports 的 BLOB——实测一次传输 214KB、耗时 2.0s，
  // 而原查询连从未被消费的 stats 列一起 SELECT（H11 同型：全量取回只用几个投影字段）；
  // ② 消费方只有阅读器右侧概览栏，可懒加载。改走 GET /api/status/daily-sources。
  const pausedCount = (await qOne('SELECT COUNT(*) c FROM sources WHERE enabled=0 AND COALESCE(fail_count,0)>=3')).c;

  const result = jsonOk({
    intervals, lastSync: { rss: rssLast, bilibili: biliLast },
    overview, pausedSources: { count: pausedCount },
  });
  _statusCache.val = result;
  _statusCache.ts = Date.now();
  return result;
}

// GET /api/status/daily-sources —— B26 拆出的重统计，按需加载（阅读器概览栏懒挂载）
// 只 SELECT sections（stats 列历史上被取回后从未消费，见坑 H11），并独立缓存 60s：
// 它比首屏字段更贵，但比 status 更可以旧。
const _dailySourcesCache = { val: null, ts: 0 };
const DAILY_SOURCES_TTL = 60000;
async function handleStatusDailySources() {
  if (_dailySourcesCache.val && Date.now() - _dailySourcesCache.ts < DAILY_SOURCES_TTL) return _dailySourcesCache.val;
  const overview = { dailyItemCount: 0, dailyTopSources: [] };
  try {
    const since = new Date(Date.now() - 7 * 86400e3).toISOString();
    const reports = await qAll('SELECT sections FROM daily_reports WHERE generated_at >= ? ORDER BY id DESC LIMIT 7', [since]);
    // B26 对账（2026-09-19 独立对抗审查查出）：本地端 computeDailySources 会排掉
    // 「N 源」合成条目与噪声源名，云端此前不排 → 两端同一句话两个算法（近 7 天线上数据恰好
    // 没有这类条目，所以是潜伏差异而非已显现）。现在云端补齐同一规则，契约才真叫一致。
    const noiseNames = new Set((await qAll(`SELECT name FROM sources WHERE ${isNoiseSql('')}`)).map((r) => r.name));
    const srcCount = {};
    let itemCount = 0;
    for (const rep of reports) {
      let sections = [];
      try { sections = JSON.parse(rep.sections || '[]'); } catch { /* 忽略坏行 */ }
      for (const col of sections) {
        for (const it of (col.items || [])) {
          itemCount++;
          const nm = it.source || it.source_name;
          if (!nm || /^\d+ 源$/.test(nm) || noiseNames.has(nm)) continue; // 破茧合成条目与聚合源不进榜
          srcCount[nm] = (srcCount[nm] || 0) + 1;
        }
      }
    }
    overview.dailyItemCount = itemCount;
    overview.dailyTopSources = Object.entries(srcCount)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, count]) => ({ name, count }));
    // 用户期望「头像+xx源+入榜次数」：按名字补源头像（一次小查询）
    const topNames = overview.dailyTopSources.map((t) => t.name);
    if (topNames.length) {
      const avRows = await qAll(`SELECT name, avatar FROM sources WHERE name IN (${topNames.map(() => '?').join(',')})`, topNames);
      const avMap = new Map(avRows.map((r) => [r.name, r.avatar]));
      for (const t of overview.dailyTopSources) t.avatar = avMap.get(t.name) || null;
    }
  } catch { /* 统计失败不阻断本端点 */ }
  const result = jsonOk({ overview, since: new Date(Date.now() - 7 * 86400e3).toISOString() });
  _dailySourcesCache.val = result;
  _dailySourcesCache.ts = Date.now();
  return result;
}

// GET /api/settings
async function handleSettings(req) {
  const daily = await getSetting('daily', {});
  const intervals = await getSetting('intervals', {});
  const queue = await getSetting('queue', {});
  const data = await getSetting('data', {});
  const mybriefCfg = await getSetting('mybrief', {});
  const weeklyCfg = await getSetting('weekly', {});
  const hot = await getSetting('hot', {});
  const views = await getSetting('reader.views', []);
  const aiCfg = await getSetting('ai', {});
  // 凭据存在性（不落值）
  const creds = await qAll('SELECT platform, cookie FROM credentials');
  const credSet = new Set(creds.filter((c) => c.cookie).map((c) => c.platform));
  // queue.token 脱敏：只回是否已配置（与本地 maskSection 一致）
  const queueOut = { intervalMin: 10, enabled: false, ...queue };
  if ('token' in queueOut) { queueOut.tokenConfigured = !!queueOut.token; delete queueOut.token; }
  // 27b：订阅轴透出（早报中心对照卡「订阅源数」用）
  const subIds = await getSetting('subscription.ids', []);
  return jsonOk({
    subscription: { ids: Array.isArray(subIds) ? subIds : [], count: Array.isArray(subIds) ? subIds.length : 0 },
    intervals: { opml: 12, rss: 0.5, bilibili: 60, douyin: 360, queue: 10, ...intervals },
    opml: { url: await getSetting('opml.url', ''), enabled: await getSetting('opml.enabled', true) },
    queue: queueOut,
    daily: { time: '08:00', windowHours: 48, ...daily },
    data: { retentionDays: 7, ...data },
    mybrief: { pushEnabled: true, ...mybriefCfg },
    weekly: { ...weeklyCfg },
    hot: { enabled: hot.enabled !== false },
    views,
    bilibili: { cookieConfigured: credSet.has('bilibili') },
    douyin: { cookieConfigured: credSet.has('douyin') },
    wechat: {
      lastSyncAt: await getSetting('wechat.lastSyncAt', null),
      lastResult: await getSetting('wechat.lastResult', null),
    },
    ai: {
      enabled: !!aiCfg.enabled,
      apiKeyConfigured: !!process.env.AGNES_API_KEY,
      model: process.env.AGNES_MODEL || 'agnes-2.5-flash',
      envSource: process.env.AGNES_API_KEY ? 'env' : 'settings',
      locked: 'env', // 13-settings-write：云端 AI 配置锁定 env-only
    },
  });
}

// GET /api/reading — 聚合列表（tab / type / q / cursor 分页）
async function handleReading(req) {
  const q = req.query;
  // tab 白名单（对抗性审查 2026-09-13：未知 tab 值原会落入快路径被当 all 处理）
  const tab = ['all', 'favorited', 'read'].includes(q.tab) ? q.tab : 'all';
  const type = ['all', 'article', 'video', 'podcast'].includes(q.type) ? q.type : 'all';
  const searchQ = (q.q || '').trim();
  const PAGE_SIZE = 30;
  // B107（与本地 server/routes/reading.js 同口径）：足迹默认排掉热榜/聚合噪声，`include_hot=1` 才带回来。
  // 用 NOT EXISTS 而不是 JOIN：源已被删除的孤儿条目要留在足迹里（足迹是历史事实），正连接会把它们丢掉。
  const includeNoisy = q.include_hot === '1';
  const noiseExists = notNoiseExistsSql({ item: 'a', alias: 'sn' });
  const noiseCond = includeNoisy ? '' : `AND ${noiseExists}`;

  // 文章侧条件（tab=all 的 OR 条件单独抽出——SQLite 无法对 OR 走索引，2026-09-13 实测 44k 宽行全扫 9.2s；
  // 拆成 read/later 两个索引分支 UNION ALL 后走 idx_articles_read / idx_articles_later）
  const aConds = [];
  const aArgs = [];
  let aTabOr = '';
  if (tab === 'all') aTabOr = 'a.read_at IS NOT NULL OR a.later = 1';
  else if (tab === 'favorited') aConds.push('a.later = 1');
  else if (tab === 'read') aConds.push('a.read_at IS NOT NULL');
  // B60：type 口径与计数、与本地端同源（此前四处各写一份 → 公众号不计入、播客计数恒 0）
  const T = readingTypeFilter(type);
  if (T.articleCond) aConds.push(T.articleCond);
  if (searchQ) {
    aConds.push('(a.title LIKE ? OR s.name LIKE ?)');
    aArgs.push(`%${searchQ}%`, `%${searchQ}%`);
  }
  // 「无用户筛选」必须在挂噪声口径**之前**判：默认排除是口径不是筛选，
  // 挂在后面会让 T3-3 快路径在默认态永远进不去（实测首屏 350ms → 9~13s）。
  const noUserFilter = !aConds.length;
  if (!includeNoisy) aConds.push(noiseExists);

  // 视频侧条件
  const vConds = [];
  const vArgs = [];
  if (tab === 'all') vConds.push('v.favorite = 1');
  else if (tab === 'favorited') vConds.push('v.favorite = 1');
  if (!T.includeVideos) vConds.push('0');
  if (searchQ && T.includeVideos) {
    vConds.push('(v.title LIKE ? OR s.name LIKE ?)');
    vArgs.push(`%${searchQ}%`, `%${searchQ}%`);
  }

  const aExtra = aConds.length ? ` AND ${aConds.join(' AND ')}` : '';
  const vWhere = vConds.length ? `WHERE ${vConds.join(' AND ')}` : 'WHERE 0';

  // 计数（受 type/q 影响）
  const counts = { all: 0, favorited: 0, read: 0 };
  const qLike = searchQ ? `%${searchQ}%` : null;

  // 文章侧计数（B60：与列表同一个表达式，此前这里是手写的第二份副本）
  const aTypeCond = readingTypeCondSql(type);
  const aQCond = qLike ? ' AND (a.title LIKE ? OR s.name LIKE ?)' : '';
  if (aTypeCond !== 'AND 0') {
    const countArgs = qLike ? [qLike, qLike] : [];
    if (!qLike && aTypeCond === '') {
      // T3-3 快路径（2026-09-13 实测 1953ms→120ms）：无 q/type 过滤时计数走索引子查询，不 join 不扫宽行
      const row = await qOne(`
        SELECT
          (SELECT COUNT(*) FROM articles a WHERE a.read_at IS NOT NULL ${noiseCond})
            + (SELECT COUNT(*) FROM articles a WHERE a.later=1 AND a.read_at IS NULL ${noiseCond}) AS total,
          (SELECT COUNT(*) FROM articles a WHERE a.later=1 ${noiseCond}) AS fav,
          (SELECT COUNT(*) FROM articles a WHERE a.read_at IS NOT NULL ${noiseCond}) AS rd
      `);
      counts.all += (row?.total || 0);
      counts.favorited += (row?.fav || 0);
      counts.read += (row?.rd || 0);
    } else {
      const row = await qOne(`
        SELECT
          SUM(CASE WHEN a.read_at IS NOT NULL OR a.later = 1 THEN 1 ELSE 0 END) AS total,
          SUM(CASE WHEN a.later = 1 THEN 1 ELSE 0 END) AS fav,
          SUM(CASE WHEN a.read_at IS NOT NULL THEN 1 ELSE 0 END) AS rd
      FROM articles a LEFT JOIN sources s ON s.id = a.source_id
      WHERE 1=1 ${aTypeCond} ${aQCond} ${noiseCond}
    `, countArgs);
      counts.all += (row?.total || 0);
      counts.favorited += (row?.fav || 0);
      counts.read += (row?.rd || 0);
    }
  }

  // 视频侧计数
  if (T.includeVideos) {
    const vQCond = qLike ? ' AND (v.title LIKE ? OR s.name LIKE ?)' : '';
    const vCountArgs = qLike ? [qLike, qLike] : [];
    const vRow = await qOne(`
      SELECT COUNT(*) AS c FROM videos v LEFT JOIN sources s ON s.id = v.source_id
      WHERE v.favorite = 1 ${vQCond}
    `, vCountArgs);
    const c = vRow?.c || 0;
    counts.all += c;
    counts.favorited += c;
  }

  // T3-3 快路径（2026-09-13 实测 9-13s→~350ms）：无筛选时两段式——
  // ①窄查询只取 id/sort_key（表达式覆盖索引 idx_*_sk，不触碰宽行）②按 id 取 31 条全列
  // ⚠️ 仅 tab=all 且 type=all（对抗性审查：type=video 时快路径曾泄漏文章——快路径不解析 type）
  if (noUserFilter && tab === 'all' && type === 'all') {
    const narrowConds = [];
    const narrowArgs = [];
    if (q.cursor) { narrowConds.push('sort_key < ?'); narrowArgs.push(String(q.cursor)); }
    const narrowWhere = narrowConds.length ? 'WHERE ' + narrowConds.join(' AND ') : '';
    const narrow = await qAll(`
      SELECT id, sort_key, item_type FROM (
        SELECT a.id, COALESCE(a.published_at, a.created_at) AS sort_key, 'article' AS item_type
        FROM articles a WHERE a.read_at IS NOT NULL ${noiseCond}
        UNION ALL
        SELECT a.id, COALESCE(a.published_at, a.created_at) AS sort_key, 'article'
        FROM articles a WHERE a.later = 1 AND a.read_at IS NULL ${noiseCond}
        UNION ALL
        SELECT v.id, v.published_at AS sort_key, 'video'
        FROM videos v WHERE v.favorite = 1
      ) ${narrowWhere}
      ORDER BY sort_key DESC, id DESC
      LIMIT ${PAGE_SIZE + 1}
    `, narrowArgs);

    const rowsFull = [];
    const aIds = narrow.filter((r) => r.item_type === 'article').map((r) => Number(r.id));
    const vIds = narrow.filter((r) => r.item_type === 'video').map((r) => Number(r.id));
    if (aIds.length) {
      const artRows = await qAll(`
        SELECT a.id, a.title, a.url, a.cover, a.summary, a.published_at, a.created_at,
               COALESCE(a.published_at, a.created_at) AS date,
               a.read_at, a.later, a.tags,
               s.name AS source_name, s.type AS source_type, s.avatar AS source_avatar
        FROM articles a LEFT JOIN sources s ON s.id = a.source_id
        WHERE a.id IN (${aIds.join(',')})
      `);
      for (const r of artRows) rowsFull.push({ ...r, item_type: 'article', sort_key: r.published_at || r.created_at, favorite: 0 });
    }
    if (vIds.length) {
      const vidRows = await qAll(`
        SELECT v.id, v.title, v.url, v.cover, v.intro AS summary, v.published_at AS date,
               v.published_at, v.favorite,
               s.name AS source_name, s.type AS source_type, s.avatar AS source_avatar
        FROM videos v LEFT JOIN sources s ON s.id = v.source_id
        WHERE v.id IN (${vIds.join(',')})
      `);
      for (const r of vidRows) rowsFull.push({ ...r, item_type: 'video', sort_key: r.published_at, read_at: null, later: 0, tags: null });
    }
    const orderMap = new Map(narrow.map((r, i) => [r.item_type + ':' + r.id, i]));
    rowsFull.sort((x, y) => (orderMap.get(x.item_type + ':' + x.id) ?? 0) - (orderMap.get(y.item_type + ':' + y.id) ?? 0));
    const items = rowsFull.slice(0, PAGE_SIZE);
    const last = narrow[narrow.length - 1];
    const nextCursor = narrow.length > PAGE_SIZE && last ? last.sort_key : null;
    return jsonOk({ items: withReadingKinds(items), nextCursor, counts });
  }

  // 带筛选（type/q）：回退单条宽查询（低频路径，可接受）
  // 对抗性审查修正：①type=video 强制无文章分支；②OR 拆分的每个分支必须重复绑定自己的 LIKE 参数
  //（libsql 参数数不匹配直接抛错——曾致 q=AI 搜索返回空）
  const includeArticles = T.includeArticles;
  const aBranch = (tabCond) => `
      SELECT
        a.id, 'article' AS item_type, a.title, a.url, a.cover, a.summary,
        COALESCE(a.published_at, a.created_at) AS date,
        s.name AS source_name, s.type AS source_type, s.avatar AS source_avatar,
        a.read_at, a.later, 0 AS favorite, a.tags,
        COALESCE(a.published_at, a.created_at) AS sort_key
      FROM articles a LEFT JOIN sources s ON s.id = a.source_id
      WHERE (${tabCond})${aExtra}`;
  const aBranchDefs = [];
  if (includeArticles) {
    if (aTabOr) {
      // B135（2026-09-21，由 N9 跨端对账抓到）：分支一原来直接复用 `aTabOr`
      // （`read_at IS NOT NULL OR later = 1`），于是**已稍后读又未读**的条目在分支一与分支二各出现一次
      // → 云端「我的阅读」带筛选（type=文章/播客、或搜索）时每条稍后读重复两行；本地端单分支不受影响。
      // 两条分支必须互斥：读侧只认 read_at，稍后读侧再排除已读。
      aBranchDefs.push({ cond: 'a.read_at IS NOT NULL', args: aArgs });
      aBranchDefs.push({ cond: 'a.later = 1 AND a.read_at IS NULL', args: aArgs });
    } else {
      aBranchDefs.push({ cond: '1=1', args: aArgs });
    }
  }
  const articleSql = aBranchDefs.length ? aBranchDefs.map((b) => aBranch(b.cond)).join('\n      UNION ALL\n') : '';
  const branchArgs = aBranchDefs.flatMap((b) => b.args);
  const videoSql = vConds.length ? `
      SELECT
        v.id, 'video' AS item_type, v.title, v.url, v.cover, v.intro AS summary,
        v.published_at AS date,
        s.name AS source_name, s.type AS source_type, s.avatar AS source_avatar,
        NULL AS read_at, 0 AS later, v.favorite, NULL AS tags,
        v.published_at AS sort_key
      FROM videos v LEFT JOIN sources s ON s.id = v.source_id
      ${vWhere}` : '';
  const branches = [articleSql, videoSql].filter(Boolean).join('\n      UNION ALL\n');
  if (!branches) return jsonOk({ items: [], nextCursor: null, counts });

  // 游标分页
  let cursorCond = '';
  const cursorArgs = [];
  if (q.cursor) {
    cursorCond = ' AND sort_key < ?';
    cursorArgs.push(String(q.cursor));
  }

  const rows = await qAll(`
    SELECT * FROM (
${branches}
    ) combined
    WHERE 1=1 ${cursorCond}
    ORDER BY sort_key DESC, id DESC
    LIMIT ?
  `, [...branchArgs, ...vArgs, ...cursorArgs, PAGE_SIZE + 1]);

  let nextCursor = null;
  let items = rows;
  if (rows.length > PAGE_SIZE) {
    items = rows.slice(0, PAGE_SIZE);
    const last = items[items.length - 1];
    if (last && last.sort_key) nextCursor = last.sort_key;
  }

  return jsonOk({ items: withReadingKinds(items), nextCursor, counts });
}

// POST /api/articles/read-all — 按当前过滤条件全部标为已读
async function handleArticlesReadAll(req) {
  const body = req.body || {};
  const conds = [];
  const args = [];

  conds.push(NOT_NOISE_READER);

  if (body.tab === 'later') { conds.push('a.later=1'); }
  else if (body.tab === 'history') { conds.push('a.read_at IS NOT NULL'); }
  if (body.source_id) { conds.push('a.source_id=?'); args.push(Number(body.source_id)); }
  if (body.group_id) { conds.push('s.group_id=?'); args.push(Number(body.group_id)); }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const now = nowIso();

  const r = await qRun(
    `UPDATE articles SET read_at=? WHERE read_at IS NULL AND id IN (
      SELECT a.id FROM articles a LEFT JOIN sources s ON s.id=a.source_id ${where}
    )`,
    [now, ...args]
  );
  return jsonOk({ ok: true, updated: r.changes || 0 });
}

// POST /api/reading/batch — 批量操作（取消稍后读/取消收藏/清除已读标记）
// body: { action: 'unlater'|'unfavorite'|'clear_read', items: [{type,id}, ...] }
async function handleReadingBatch(req) {
  const { action, items } = req.body || {};
  if (!action || !Array.isArray(items) || !items.length) {
    return { status: 400, body: jsonErr('缺少 action 或 items') };
  }
  const validActions = ['unlater', 'unfavorite', 'clear_read'];
  if (!validActions.includes(action)) {
    return { status: 400, body: jsonErr(`无效操作: ${action}`) };
  }

  const articleIds = items.filter((i) => i.type === 'article').map((i) => Number(i.id)).filter(Boolean);
  const videoIds = items.filter((i) => i.type === 'video').map((i) => Number(i.id)).filter(Boolean);
  let updated = 0;

  if (action === 'unlater' && articleIds.length) {
    const ph = articleIds.map(() => '?').join(',');
    const r = await qRun(`UPDATE articles SET later = 0 WHERE id IN (${ph})`, articleIds);
    updated += r.changes || 0;
  } else if (action === 'unfavorite' && videoIds.length) {
    const ph = videoIds.map(() => '?').join(',');
    const r = await qRun(`UPDATE videos SET favorite = 0 WHERE id IN (${ph})`, videoIds);
    updated += r.changes || 0;
  } else if (action === 'clear_read' && articleIds.length) {
    const ph = articleIds.map(() => '?').join(',');
    const r = await qRun(`UPDATE articles SET read_at = NULL WHERE id IN (${ph}) AND read_at IS NOT NULL`, articleIds);
    updated += r.changes || 0;
  }

  return jsonOk({ ok: true, updated });
}

// POST /api/reading/export — 导出选中条目为 Markdown
// body: { items: [{type,id}, ...] }
async function handleReadingExport(req) {
  const { items } = req.body || {};
  if (!Array.isArray(items) || !items.length) {
    return { status: 400, body: jsonErr('缺少 items') };
  }

  const articleIds = items.filter((i) => i.type === 'article').map((i) => Number(i.id)).filter(Boolean);
  const videoIds = items.filter((i) => i.type === 'video').map((i) => Number(i.id)).filter(Boolean);

  const rows = [];
  if (articleIds.length) {
    const ph = articleIds.map(() => '?').join(',');
    const arts = await qAll(`
      SELECT a.id, 'article' AS item_type, a.title, a.url, a.summary,
             COALESCE(a.published_at, a.created_at) AS date,
             s.name AS source_name, s.type AS source_type
      FROM articles a LEFT JOIN sources s ON s.id = a.source_id
      WHERE a.id IN (${ph})
    `, articleIds);
    rows.push(...arts);
  }
  if (videoIds.length) {
    const ph = videoIds.map(() => '?').join(',');
    const vids = await qAll(`
      SELECT v.id, 'video' AS item_type, v.title, v.url, v.intro AS summary,
             v.published_at AS date,
             s.name AS source_name, s.type AS source_type
      FROM videos v LEFT JOIN sources s ON s.id = v.source_id
      WHERE v.id IN (${ph})
    `, videoIds);
    rows.push(...vids);
  }

  // 按日期降序排列
  rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const typeLabel = (t) => {
    if (t === 'video') return '视频';
    if (t === 'podcast') return '播客';
    return '文章';
  };
  const lines = ['# 我的阅读导出', '', `> 导出时间：${nowIso()}`, ''];
  for (const r of rows) {
    const date = r.date ? r.date.slice(0, 10) : '未知日期';
    lines.push(`## ${r.title || '无标题'}`);
    lines.push('');
    lines.push(`- **类型**：${typeLabel(r.item_type)}`);
    lines.push(`- **来源**：${r.source_name || '未知'}`);
    lines.push(`- **日期**：${date}`);
    lines.push(`- **链接**：${r.url || ''}`);
    if (r.summary) lines.push(`- **摘要**：${String(r.summary).slice(0, 200)}`);
    lines.push('');
  }

  return jsonOk({ ok: true, markdown: lines.join('\n'), count: rows.length });
}

// POST /api/auth/login
async function handleLogin(req) {
  const body = req.body || {};
  const user = body.username || '';
  const pass = body.password || '';
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';

  if (user !== adminUser || pass !== adminPass) {
    return { status: 401, body: jsonErr('用户名或密码错误') };
  }

  const token = jwt.sign(
    { sub: user, role: 'admin', iat: Math.floor(Date.now() / 1000) },
    process.env.AUTH_SECRET || 'dev-secret',
    { expiresIn: '7d' }
  );
  return jsonOk({ token, user });
}

// POST /api/articles/:id/read
async function handleArticleRead(req, id) {
  const body = req.body || {};
  if (body.read) {
    await qRun('UPDATE articles SET read_at=? WHERE id=?', [nowIso(), id]);
  } else {
    await qRun('UPDATE articles SET read_at=NULL WHERE id=?', [id]);
  }
  return jsonOk({ ok: true });
}

// POST /api/articles/:id/later
async function handleArticleLater(req, id) {
  const body = req.body || {};
  // P1-13 修复：返回 later 字段，与本地 Express 保持一致
  const laterVal = body.later ? 1 : 0;
  await qRun('UPDATE articles SET later=? WHERE id=?', [laterVal, id]);
  return jsonOk({ ok: true, later: laterVal });
}

// POST /api/sources/:id/toggle
async function handleSourceToggle(req, id) {
  const row = await qOne('SELECT enabled FROM sources WHERE id=?', [id]);
  if (!row) return { status: 404, body: jsonErr('源不存在') };
  const newEnabled = row.enabled ? 0 : 1;
  if (newEnabled) {
    // 解冻
    let extra = '{}';
    const src = await qOne('SELECT extra FROM sources WHERE id=?', [id]);
    try {
      const e = JSON.parse(src.extra || '{}');
      delete e.lastError; delete e.lastErrorAt;
      extra = JSON.stringify(e);
    } catch { /* 保持原 extra */ }
    await qRun("UPDATE sources SET enabled=1, fail_count=0, status='ok', extra=? WHERE id=?", [extra, id]);
  } else {
    await qRun('UPDATE sources SET enabled=0 WHERE id=?', [id]);
  }
  return jsonOk({ enabled: newEnabled });
}

// ─── GET /api/meta — 系统元数据（公开） ───
async function handleMeta(req) {
  const articles = (await qOne('SELECT COUNT(*) c FROM articles')).c;
  const videos = (await qOne('SELECT COUNT(*) c FROM videos')).c;
  const sources = (await qOne('SELECT COUNT(*) c FROM sources WHERE enabled=1')).c;
  const lastArticle = await qOne('SELECT MAX(NULLIF(created_at,\'null\')) t FROM articles');
  // 把"线上正跑着哪个 commit"变成一次 curl 就能查到的事实：
  // 本项目最大的历史故障就是"以为推上去了，其实线上没变"（AGENTS §2.1），
  // 光比对 git 与 origin 不够——还要比对 origin 与**正在服务的那个 deployment**。
  return jsonOk({
    articles, videos, sources, lastUpdated: lastArticle.t,
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    commitRef: process.env.VERCEL_GIT_COMMIT_REF || null,
    deployedAt: process.env.VERCEL_READY_AT || null,
  });
}

// ─── AI 设置路由（Vercel 端） ───
const AI_DEFAULT_BASE = 'https://apihub.agnes-ai.com/v1';
const AI_DEFAULT_MODEL = 'agnes-2.5-flash';

async function handleAiConfig(req) {
  if (req.method === 'GET') {
    const cfg = await getSetting('ai', {});
    const apiKey = cfg.apiKey || process.env.AGNES_API_KEY || '';
    return jsonOk({
      apiKeyConfigured: !!apiKey,
      apiBase: cfg.apiBase || process.env.AGNES_API_BASE || AI_DEFAULT_BASE,
      model: cfg.model || process.env.AGNES_MODEL || AI_DEFAULT_MODEL,
    });
  }
  if (req.method === 'PUT') {
    const body = req.body || {};
    const cur = await getSetting('ai', {});
    const next = { ...cur };
    if (body.model !== undefined) next.model = String(body.model).trim();
    if (body.apiBase !== undefined) next.apiBase = String(body.apiBase).trim();
    if (body.apiKey && body.apiKey.trim()) next.apiKey = body.apiKey.trim();
    // B51：ai.features 曾在这里被写、又在 GET 里回显给同一个界面，全库没有任何行为读它——假开关已随 39-2 摘除
    await setSetting('ai', next);
    return jsonOk({ ok: true });
  }
  return { status: 405, body: jsonErr('Method Not Allowed') };
}

// POST /api/ai/ping — 连通性测试
// [2026-09-11] AI 供应商链：settings.ai → AGNES_* env → DEEPSEEK_* env
// 根因订正：云端 401 并非"绑 IP"（实测家庭/代理/机房 IP 均可用），而是 settings.ai 里
// 残留的 apiBase 污染指向了 deepseek 域名；settings 覆盖优先级高于 env，改 key 永远修不好。
async function aiProviderChain(cfg) {
  const chain = [];
  const normBase = (b) => String(b || '').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  if (cfg.apiKey || process.env.AGNES_API_KEY) {
    chain.push({
      name: 'agnes',
      key: cfg.apiKey || process.env.AGNES_API_KEY,
      base: normBase(cfg.apiBase || process.env.AGNES_API_BASE || AI_DEFAULT_BASE),
      model: cfg.model || process.env.AGNES_MODEL || AI_DEFAULT_MODEL,
    });
  }
  if (process.env.DEEPSEEK_API_KEY) {
    chain.push({ name: 'deepseek', key: process.env.DEEPSEEK_API_KEY, base: 'https://api.deepseek.com', model: process.env.DEEPSEEK_MODEL || 'deepseek-chat' });
  }
  return chain;
}

async function aiChatCloud(messages, { temperature = 0.7, timeoutMs = 30000, modelOverride } = {}) {
  // 16-ai-infra：收敛到统一通道 _ai.aiChat（限流串行/重试/统计/报警联动）
  const r = await _ai.aiChat(messages, { kind: 'chat', temperature, timeoutMs, model: modelOverride });
  return r;
}

async function handleAiPing(req) {
  const r = await aiChatCloud([{ role: 'user', content: '请回复"连通成功"四个字。' }], { timeoutMs: 15000 });
  if (!r.ok) return jsonOk({ ok: false, error: r.error });
  return jsonOk({ ok: true, provider: r.provider, model: r.model, reply: r.reply });
}

// POST /api/ai/chat — 通用 AI 对话（调试用）
async function handleAiChat(req) {
  const body = req.body || {};
  const { messages, model, temperature } = body;
  if (!Array.isArray(messages) || !messages.length) return jsonOk({ ok: false, error: 'messages 必须是非空数组' });
  const r = await aiChatCloud(messages, { temperature: temperature || 0.7, timeoutMs: 25000, modelOverride: model });
  if (!r.ok) return jsonOk({ ok: false, error: r.error });
  return jsonOk({ ok: true, reply: r.reply, provider: r.provider });
}

// ─── P1-1: GET /api/sources/library — 源库列表（含 itemCount + contentKind + extra 脱敏） ───
const EXTRA_PUBLIC_KEYS = ['intervalMin', 'lastError', 'lastErrorAt', 'marksFeatured', 'aggregator', 'domain', 'etag', 'lastModified', 'categoryLocked', 'origin', 'failoverGroup'];
const VIDEO_TYPES_SET = new Set(['bilibili', 'douyin', 'youtube']);

async function handleSourcesLibrary(req) {
  const sources = await qAll('SELECT * FROM sources ORDER BY id');
  // 聚合计数
  const articleCounts = {};
  const videoCounts = {};
  for (const row of await qAll('SELECT source_id, COUNT(*) c FROM articles GROUP BY source_id')) {
    articleCounts[row.source_id] = row.c;
  }
  for (const row of await qAll('SELECT source_id, COUNT(*) c FROM videos GROUP BY source_id')) {
    videoCounts[row.source_id] = row.c;
  }
  const items = sources.map(s => {
    const kind = VIDEO_TYPES_SET.has(s.type) ? 'video' : 'article';
    const itemCount = kind === 'video' ? (videoCounts[s.id] || 0) : (articleCounts[s.id] || 0);
    // extra 白名单脱敏
    let extra = {};
    try { extra = JSON.parse(s.extra || '{}'); } catch { /* ignore */ }
    const safeExtra = {};
    for (const k of EXTRA_PUBLIC_KEYS) {
      if (extra[k] !== undefined) safeExtra[k] = extra[k];
    }
    return { ...s, extra: JSON.stringify(safeExtra), contentKind: kind, itemCount };
  });
  return jsonOk({ items });
}

// ─── P1-2: GET /api/alerts/config — 报警配置（渠道密钥脱敏） ───
const SENSITIVE_KEYS = ['url', 'secret', 'sendKey', 'deviceKey', 'token', 'botToken'];

async function handleAlertsConfig(req) {
  const cfg = await getSetting('alerts', {});
  // 2026-09-12 修复：密钥在 c.config 嵌套层，原先只在渠道顶层打码等于没打（webhook URL 明文外泄）
  const channels = _alerts.maskChannels(Array.isArray(cfg.channels) ? cfg.channels : []);
  return jsonOk({
    channels,
    events: eventsState(cfg.events),
    cooldownMin: cfg.cooldownMin || 120,
    recentLog: Array.isArray(cfg.recentLog) ? cfg.recentLog : [], // B5：管理台报警记录直接随 config 返回
    // B45 的硬根因（09-21 修）：这里原来硬写 `{fuse:'源熔断', stall:'采集停滞', queue:'队列异常', error:'系统错误'}`
    // —— 四个键在任何事件表里都不存在，既不读落库、也不含真事件，于是云端管理台显示四个假开关、
    // 真事件的勾选根本看不见。现在键集恒等于 lib/alert-events.js，落库有同名覆盖值才优先。
    eventMeta: eventMetaTable(cfg.eventMeta),
  });
}

// ─── P1-2: GET /api/alerts/log — 最近报警记录 ───
async function handleAlertsLog(req) {
  const cfg = await getSetting('alerts', {});
  return jsonOk({ log: Array.isArray(cfg.recentLog) ? cfg.recentLog : [] });
}

// ─── P1-11: POST /api/daily/regenerate — 手动重新生成日报 ───
async function handleDailyRegenerate(req) {
  // 删除"今日"已有日报。B96：原来写的是 `todayStr = 北京日期串`，再拼成 `T00:00:00.000Z`
  // 当边界用 —— 日期串是**标签**不是时刻，拼出来的区间其实是"上一个 UTC 日"，
  // 于是北京 00:00~08:00 之间生成的日报（落在前一个 UTC 日）删不掉，手动重新生成会插出第二份。
  const dayStart = beijingDayStartMs();
  try {
    await qRun(
      "DELETE FROM daily_reports WHERE generated_at >= ? AND generated_at < ?",
      [new Date(dayStart).toISOString(), new Date(dayStart + 86400e3).toISOString()]
    );
  } catch { /* 无今日日报，忽略 */ }
  const report = await generateDailyInline();
  return jsonOk({
    report: { generated_at: report.generated_at, sections: report.sections, stats: report.stats },
    autoGenerated: false,
  });
}

// ─── 图片代理 GET /api/img ───
async function handleImg(req) {
  // 2026-09-14 修：前端 imgUrl() 发的是 ?u=（与本地 server/routes/img.js 一致），
  // 云端此前只认 ?url= → 全部代理图 400（视频/公众号封面大片破图的根因）
  const url = req.query.u || req.query.url;
  if (!url) return { status: 400, body: jsonErr('Missing url') };
  try {
    // H3/P2-5 收口（2026-09-19）：云端此前直接 fetch 任意 URL，无 SSRF 防护。
    // 现与本地 server/util/safeimg.js 同语义：DNS 解析后校验、逐跳校验重定向目标、
    // 只允许 image/*、流式累计字节上限（api/_safeimg.js）。
    const { contentType, body } = await require('./_safeimg').fetchImageSafe(url);
    return { raw: true, body, headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400' } };
  } catch (err) {
    const msg = String(err.message || '');
    if (/forbidden host|bad url|not an image/.test(msg)) return { status: 400, body: jsonErr(msg) };
    return { status: 502, body: jsonErr(msg || 'image proxy failed') };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 管理功能 serverless 移植（2026-09-11，与本地 server/routes/* 语义对齐）
// 覆盖：restore-all / health / queue / opml / rss-refresh / backup / data / audit
// 不适用的云端化裁剪：文件型快照（无持久 FS）→ 配置备份改存 Turso settings；
// 任务队列统计（job_queue 为本地调度器概念）→ 返回 pending_items 概览 + 零值占位。
// ═══════════════════════════════════════════════════════════════════

async function auditRecord(action, opts = {}) {
  try {
    await qRun('INSERT INTO audit_log(at, user, action, target, detail, ip) VALUES(?,?,?,?,?,?)', [
      nowIso(), opts.user || 'admin', action, opts.target || null,
      opts.detail ? JSON.stringify(opts.detail).slice(0, 2000) : null, opts.ip || null,
    ]);
  } catch { /* 审计失败不阻断业务 */ }
}

// 解冻单源（与本地 store.unfreezeSource 同语义：清计数+启用+清错误字段，保留 extra 其它配置）
function unfreezeStmt(source) {
  let extra = {};
  try { extra = JSON.parse(source.extra || '{}'); } catch { /* 忽略 */ }
  delete extra.lastError; delete extra.lastErrorAt;
  return {
    sql: "UPDATE sources SET enabled=1, fail_count=0, status='ok', next_fetch_at=NULL, extra=? WHERE id=?",
    args: [JSON.stringify(extra), source.id],
  };
}

// POST /api/sources/restore-all — 批量恢复熔断源（P3 移植）
async function handleRestoreAll(req) {
  const body = req.body || {};
  let sql = 'SELECT id, name, type, fail_count, extra FROM sources WHERE fail_count >= 3 AND enabled=0';
  const args = [];
  if (body.type) { sql += ' AND type=?'; args.push(String(body.type)); }
  const frozen = await qAll(sql + ' ORDER BY fail_count DESC', args);
  if (!frozen.length) return jsonOk({ message: '无熔断源需要恢复', restored: 0 });
  // 分批事务写入
  for (let i = 0; i < frozen.length; i += 200) {
    await getDb().batch(frozen.slice(i, i + 200).map(unfreezeStmt), 'write');
  }
  await auditRecord('sources.restore-all', { detail: { restored: frozen.length, type: body.type || null } });
  return jsonOk({
    message: `成功解冻 ${frozen.length} 个熔断源（已排入下一轮采集，≤15 分钟内由 runner 补抓）`,
    restored: frozen.length,
    refreshed: null, // serverless 不支持 refreshImmediately，交 runner 自然补抓
    failed: null,
    results: frozen.map((s) => ({ id: s.id, name: s.name, type: s.type, failCount: s.fail_count, restored: true })),
  });
}

// GET /api/health/status — 综合健康快照
async function handleHealthStatus(req) {
  const total = (await qOne('SELECT COUNT(*) c FROM sources')).c;
  const enabled = (await qOne('SELECT COUNT(*) c FROM sources WHERE enabled=1')).c;
  const errorSources = (await qOne("SELECT COUNT(*) c FROM sources WHERE status='error' AND enabled=1")).c;
  const frozen = (await qOne('SELECT COUNT(*) c FROM sources WHERE fail_count >= 3 AND enabled=0')).c;
  const frozenRows = await qAll(
    'SELECT id, name, type, fail_count, extra FROM sources WHERE fail_count >= 3 AND enabled=0 ORDER BY fail_count DESC LIMIT 20'
  );
  const frozenList = frozenRows.map((r) => {
    let extra = {};
    try { extra = JSON.parse(r.extra || '{}'); } catch { /* 忽略 */ }
    return {
      id: r.id, name: r.name, type: r.type, failCount: r.fail_count,
      lastError: extra.lastError ? String(extra.lastError).slice(0, 200) : null,
      lastErrorAt: extra.lastErrorAt || null,
    };
  });
  const errRows = await qAll("SELECT id, name, type, extra FROM sources WHERE status='error' AND extra LIKE '%lastError%'");
  const cookieIssues = errRows.filter((r) => {
    let extra = {};
    try { extra = JSON.parse(r.extra || '{}'); } catch { return false; }
    return /-2012|cookie.*(过期|失效)|登录态失效|401|-101|SESSDATA/i.test(extra.lastError || '');
  }).map((r) => ({ id: r.id, name: r.name, type: r.type }));
  // 云端特有：采集心跳（方案A runner 直采每轮写入）
  const collect = await getSetting('cloud.collect', null);
  return jsonOk({
    sources: { total, enabled, error: errorSources, frozen },
    frozenList, cookieIssues, collect, checkedAt: nowIso(),
  });
}

// GET /api/health/collect-history — 采集心跳历史（T3-2 监控折线图数据源）
async function handleCollectHistory(req) {
  const hb = await getSetting('cloud.collect', {});
  const history = Array.isArray(hb.history) ? hb.history : [];
  return jsonOk({ lastRunAt: hb.lastRunAt || null, mode: hb.mode || null, history });
}

// GET /api/brief/history — 早报中心生成历史（T3-2 R1）
// B39：原来 `ORDER BY id DESC LIMIT 7` 冒充「近 7 天」——线上近 7 天实有 59 行，只露 7 行，
// 且 42 行是无 schemaVersion 的裸关键词版，UI 上跟 AI 增强版长得一样，看不出哪期能用。
async function handleBriefHistory(req) {
  const reports = await qAll(briefGuards.DAILY_HISTORY_SQL, [briefGuards.historySinceIso()]);
  const daily = reports.map((r) => {
    let st = {};
    try { st = JSON.parse(r.stats || '{}'); } catch { /* 坏行 */ }
    const ai = briefGuards.isAiDailyReport(r);
    return { id: r.id, generatedAt: r.generated_at, windowHours: r.window_hours,
             theme: st.theme || null, degraded: !!st.degraded, totalItems: st.totalItems || 0, elapsedMin: st.elapsedMin || null,
             aiEnhanced: ai, tier: st.degraded ? 'degraded' : (ai ? 'ai' : 'keyword') };
  });
  const archive = (await getSetting('weekly.archive', [])) || [];
  const weekly = archive.map((a) => ({ issue: a.issue, dateStart: a.dateStart, dateEnd: a.dateEnd, theme: a.theme || null, count: a.count, degraded: !!(a.report && a.report.degraded) })).reverse();
  const mb = await getSetting('mybrief.latest', null);
  const digest = await getSetting('reading.digest', null);
  const profile = await getSetting('mybrief.interestProfile', null);
  return jsonOk({
    windowDays: briefGuards.HISTORY_WINDOW_DAYS,
    dailyCount: daily.length,
    dailyAiCount: daily.filter((d) => d.aiEnhanced).length,
    daily,
    weekly,
    mybrief: mb ? { date: mb.date || null, generatedAt: mb.generatedAt || null, empty: mb.empty || null,
                    counts: mb.sections ? { top: mb.sections.top?.length || 0, featured: mb.sections.featured?.length || 0, rest: mb.sections.rest?.length || 0 } : null } : null,
    digest: digest ? { date: digest.date, readCount: digest.readCount, laterCount: digest.laterCount } : null,
    profile: profile || { tags: [], updatedAt: null },
    domainQuotas: (await getSetting('mybrief', {})).domainQuotas || {},
  });
}

// GET /api/health/source-stats — 云端无 job_queue 历史，用 sources 当前状态近似
async function handleHealthSourceStats(req) {
  const rows = await qAll(
    'SELECT id, name, type, status, fail_count FROM sources ORDER BY fail_count DESC LIMIT 500'
  );
  const items = rows.map((r) => ({
    source_id: r.id, name: r.name, type: r.type,
    total: null, success: null, failed: r.fail_count || 0,
    rate: r.status === 'ok' ? 100 : 0,
  }));
  return jsonOk({ items, days: Number(req.query.days) || 7 });
}

// POST /api/health/unfreeze-all — 批量解冻（restore-all 别名，保持本地前端兼容）
async function handleUnfreezeAll(req) {
  return handleRestoreAll(req);
}

// POST /api/health/unfreeze/:id — 单源解冻
async function handleUnfreezeOne(req, id) {
  const rows = await qAll('SELECT * FROM sources WHERE id=?', [id]);
  if (!rows[0]) return { status: 404, body: jsonErr('not found') };
  await getDb().batch([unfreezeStmt(rows[0])], 'write');
  return jsonOk({ id, name: rows[0].name });
}

// ─── 队列 ───
const QUEUE_DEFS = [
  { name: 'wechat', endpoint: 'wechat-rss-queue.php' },
  { name: 'bilibili', endpoint: 'bilibili-video-queue.php' },
  { name: 'douyin', endpoint: 'douyin-video-queue.php' },
];

// GET /api/queue/pending?type=
async function handleQueuePending(req) {
  const conds = [];
  const args = [];
  if (req.query.type) { conds.push('type=?'); args.push(String(req.query.type)); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const items = await qAll(`SELECT * FROM pending_items ${where} ORDER BY id DESC`, args);
  return jsonOk({ items });
}

// GET /api/queue/stats — 云端概览（job_queue 为本地调度器概念，云端返回 pending_items 统计 + 零值占位）
async function handleQueueStats(req) {
  const byType = await qAll(
    `SELECT type, COUNT(*) total,
       SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending,
       SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,
       SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) resolved
     FROM pending_items GROUP BY type`
  );
  const totalPending = byType.reduce((n, r) => n + (r.pending || 0), 0);
  return jsonOk({
    overall: { pending: totalPending, running: 0, completed: 0, failed: byType.reduce((n, r) => n + (r.failed || 0), 0), dead: 0 },
    byType,
  });
}

// GET /api/queue/failed /dead — 云端无本地任务队列，返回 pending_items 中 failed 项
async function handleQueueFailed(req) {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const items = await qAll("SELECT * FROM pending_items WHERE status='failed' ORDER BY id DESC LIMIT ?", [limit]);
  return jsonOk({ items });
}

// POST /api/queue/sync {name?} — 拉取 PHP 云端队列 → pending_items → 清空云端
async function handleQueueSync(req) {
  const name = req.body && req.body.name ? String(req.body.name) : null;
  const defs = name ? QUEUE_DEFS.filter((d) => d.name === name) : QUEUE_DEFS;
  if (name && !defs.length) return { status: 400, body: jsonErr(`未知队列: ${name}`) };
  const q = await getSetting('queue', {});
  const baseUrl = String(q.baseUrl || '').replace(/\/+$/, '');
  const token = q.token || '';
  if (!baseUrl || !token) return { status: 400, body: jsonErr('未配置队列地址或 Token（settings.queue）') };

  let imported = 0, updated = 0, cleared = 0;
  const errors = [];
  for (const def of defs) {
    try {
      const res = await fetch(`${baseUrl}/${def.endpoint}?token=${encodeURIComponent(token)}&action=pull`, {
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '云端返回失败');
      const items = Array.isArray(data.items) ? data.items : [];
      const count = Number(data.count) || 0;
      for (const it of items) {
        const url = String((it && it.url) || '').trim();
        if (!url) continue;
        const itemName = String((it && it.name) || '').trim();
        const existing = await qOne('SELECT * FROM pending_items WHERE type=? AND url=?', [def.name, url]);
        if (existing) {
          if (existing.status === 'failed') {
            await qRun("UPDATE pending_items SET name=?, imported_at=?, status='pending', error=NULL WHERE id=?",
              [itemName || existing.name, nowIso(), existing.id]);
          } else {
            await qRun('UPDATE pending_items SET name=?, imported_at=? WHERE id=?',
              [itemName || existing.name, nowIso(), existing.id]);
          }
          updated++;
        } else {
          await qRun("INSERT INTO pending_items(type, url, name, status, imported_at) VALUES(?,?,?,'pending',?)",
            [def.name, url, itemName, nowIso()]);
          imported++;
        }
      }
      if (count > 0) {
        await fetch(`${baseUrl}/${def.endpoint}?token=${encodeURIComponent(token)}&action=clear`, {
          signal: AbortSignal.timeout(8000),
        });
        cleared += count;
      }
    } catch (err) {
      errors.push(`${def.name}: ${err.message}`);
    }
  }
  await setSetting('queue.lastSyncAt', nowIso());
  await auditRecord('queue.sync', { detail: { imported, updated, cleared } });
  if (errors.length && imported + updated === 0 && errors.length === defs.length) {
    return { status: 500, body: jsonErr(errors.join('；')) };
  }
  return jsonOk({
    imported, updated, cleared,
    errors: errors.length ? errors : undefined,
    message: `导入 ${imported} 个，更新 ${updated} 个，清空云端 ${cleared} 个（视频类解析订阅在本地端执行）`,
  });
}

// ─── OPML / RSS ───
function parseOpml(xml) {
  const outlines = [];
  const re = /<outline\b[^>]*>/gi;
  let m;
  const attr = (tag, name) => {
    const mm = tag.match(new RegExp(`${name}=["']([^"']*)["']`, 'i'));
    return mm ? decodeXmlEntities(mm[1]) : ''; // B94：解码统一走 lib/text-clean（原来这里自己写了半张映射表，漏了 &apos;/数字实体）
  };
  while ((m = re.exec(xml))) {
    const xmlUrl = attr(m[0], 'xmlUrl');
    if (xmlUrl) outlines.push({ name: attr(m[0], 'text') || attr(m[0], 'title') || xmlUrl, url: xmlUrl });
  }
  return outlines;
}

// GET /api/opml/export — 全量启用源导出标准 OPML 2.0（T4-1 Q2，其他阅读器可直接导入）
async function handleOpmlExport(req) {
  const groups = await qAll('SELECT id, name, kind FROM groups ORDER BY kind, sort, id');
  const sources = await qAll("SELECT name, url, group_id FROM sources WHERE enabled=1 ORDER BY group_id, name");
  const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const byGroup = {};
  const loose = [];
  for (const sRow of sources) {
    if (sRow.group_id && groups.some((g) => g.id === sRow.group_id)) {
      const key = sRow.group_id;
      (byGroup[key] = byGroup[key] || []).push(sRow);
    } else loose.push(sRow);
  }
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">', '  <head>',
    '    <title>qwis-intel sources</title>', `    <dateCreated>${new Date().toISOString()}</dateCreated>`,
    '  </head>', '  <body>'];
  for (const g of groups) {
    const list = byGroup[g.id] || [];
    if (!list.length) continue;
    lines.push(`    <outline text="${esc(g.name)}" title="${esc(g.name)}">`);
    for (const sRow of list) lines.push(`      <outline type="rss" text="${esc(sRow.name)}" title="${esc(sRow.name)}" xmlUrl="${esc(sRow.url)}"/>`);
    lines.push('    </outline>');
  }
  for (const sRow of loose) lines.push(`    <outline type="rss" text="${esc(sRow.name)}" title="${esc(sRow.name)}" xmlUrl="${esc(sRow.url)}"/>`);
  lines.push('  </body>', '</opml>');
  const xml = lines.join('\n');
  // raw 约定：顶层仅对 raw 结果套用 headers 并原样发 body（否则会被 res.json 序列化成 JSON 字符串）
  return {
    raw: true,
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': 'attachment; filename="qwis-sources.opml"' },
    body: xml,
  };
}

// POST /api/opml/sync {url?} — 拉取 OPML → 新增 rss 源（已存在按 url 跳过）
async function handleOpmlSync(req) {
  const url = (req.body && req.body.url) || (await getSetting('opml.url', null));
  if (!url) return { status: 400, body: jsonErr('未配置 OPML 地址') };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const outlines = parseOpml(xml);
    if (!outlines.length) throw new Error('OPML 中未发现任何订阅源');
    const existing = new Set((await qAll('SELECT url FROM sources')).map((r) => r.url));
    const fresh = outlines.filter((o) => !existing.has(o.url));
    const stmts = fresh.map((o) => ({
      sql: "INSERT INTO sources(type, name, url, enabled, status, fail_count, created_at) VALUES('rss', ?, ?, 1, 'pending', 0, ?)",
      args: [o.name, o.url, nowIso()],
    }));
    for (let i = 0; i < stmts.length; i += 200) {
      await getDb().batch(stmts.slice(i, i + 200), 'write');
    }
    const result = { added: fresh.length, restored: 0, updated: 0, total: outlines.length };
    await setSetting('wechat.lastSyncAt', nowIso());
    await setSetting('opml.lastResult', result);
    await auditRecord('opml.sync', { target: url, detail: result });
    return jsonOk({ ...result, lastSyncAt: nowIso(), message: `新增 ${result.added} 个源（共解析 ${result.total} 个）` });
  } catch (err) {
    await setSetting('wechat.lastError', err.message);
    return { status: 500, body: jsonErr(err.message) };
  }
}

// POST /api/rss/refresh — 云端语义：全部可采源立即到期，runner 下轮（≤15min）全量补抓
async function handleRssRefresh(req) {
  const r = await qRun(
    "UPDATE sources SET next_fetch_at=NULL WHERE enabled=1 AND type IN ('wechat','rss','x','youtube','hotlist')"
  );
  await auditRecord('rss.refresh', { detail: { sources: r.changes } });
  return jsonOk({ sources: r.changes, articles: null, errors: 0, message: `已将 ${r.changes} 个源标记为立即到期，最迟 15 分钟内由云端 runner 采集` });
}

// ─── 配置备份（云端适配：无文件系统，备份 JSON 存 Turso settings） ───
// POST /api/backup — 导出 sources/groups/settings
async function handleBackup(req) {
  const sources = await qAll('SELECT * FROM sources');
  const groups = await qAll('SELECT * FROM groups');
  const settings = await qAll('SELECT * FROM settings');
  const counts = { sources: sources.length, groups: groups.length, settings: settings.length };
  const name = `qwis-config-${nowIso().slice(0, 10).replace(/-/g, '')}.json`;
  const payload = { version: 1, at: nowIso(), sources, groups, settings };
  await setSetting('backup.latest', { name, at: nowIso(), counts, data: payload });
  await auditRecord('backup.create', { target: name, detail: counts });
  return jsonOk({ file: name, sizeBytes: JSON.stringify(payload).length, counts });
}

// GET /api/backup/latest
async function handleBackupLatest(req) {
  const b = await getSetting('backup.latest', null);
  return jsonOk({ backup: b ? { name: b.name, at: b.at, counts: b.counts } : null });
}

// POST /api/backup/restore — 用最近一次云端备份覆盖 sources/groups/settings（upsert 语义）
async function handleBackupRestore(req) {
  const b = await getSetting('backup.latest', null);
  if (!b || !b.data) return { status: 404, body: jsonErr('云端无可用备份（先执行一次备份）') };
  const { sources = [], groups = [], settings = [] } = b.data;
  const upsert = (table, rows) => rows.map((row) => {
    const keys = Object.keys(row);
    return { sql: `INSERT OR REPLACE INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, args: keys.map((k) => row[k]) };
  });
  const stmts = [...upsert('groups', groups), ...upsert('sources', sources), ...upsert('settings', settings)];
  for (let i = 0; i < stmts.length; i += 200) {
    await getDb().batch(stmts.slice(i, i + 200), 'write');
  }
  await auditRecord('backup.restore', { target: b.name, detail: b.counts });
  return jsonOk({ restored: b.counts, from: b.name, message: `已从 ${b.name} 恢复配置` });
}

// ─── 数据管理 ───
const DATA_TABLES = ['groups', 'sources', 'settings', 'credentials', 'articles', 'videos', 'pending_items', 'daily_reports', 'job_queue', 'audit_log'];
const CLEAN_TABLES = [
  // articles 走专门函数（豁免已读/稍后读/精选；T4-1 Q4 与 runner cleanup 同语义）
  { table: 'videos', col: 'COALESCE(published_at, created_at)', skip: true }, // 视频/播客永不自动清理（用户决策 2026-09-13）
  { table: 'pending_items', col: 'imported_at' },
  { table: 'daily_reports', col: 'generated_at' },
];

// 文章保留清理：**09-21 起本文件不再自带一份谓词**（⑥a / B102 残余 / W17 的整文件豁免同日摘掉）。
// 条件与豁免全部来自 `lib/retention` 的 `cloudManual` 作用域，与 runner 逐字同源；
// 时间列本来这里就是 `COALESCE(published_at, created_at)`，是 runner 那份只认 `published_at` ——
// 所以并口径之后**本端点行为一字未变**，变的是一次实测差（见 lib/retention 注释与 ISSUES B101/B102）。
const { countSql: retainCountSql, deleteSql: retainDeleteSql } = require('../lib/retention');
const { credentialGate, CREDENTIAL_KEY, GATE_MAX_AGE_H } = require('../lib/content-dump');
async function cleanupArticles(cutoff, { preview = false } = {}) {
  return preview
    ? qOne(retainCountSql('cloudManual', 'retention'), [cutoff])
    : qRun(retainDeleteSql('cloudManual', 'retention'), [cutoff]);
}

function cutoffIso(days) {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) throw new Error('保留天数必须为正数');
  return new Date(Date.now() - d * 86400e3).toISOString();
}

// GET /api/data/stats
async function handleDataStats(req) {
  const tables = {};
  for (const t of DATA_TABLES) {
    tables[t] = (await qOne(`SELECT COUNT(*) c FROM ${t}`)).c;
  }
  return jsonOk({ sizeBytes: null, sizeNote: 'Turso 云端库无文件体积概念', tables });
}

// GET /api/data/list — 云端无文件快照，返回配置备份信息
async function handleDataList(req) {
  // B56：这里原本只写一句给人看的 note，前端把它丢了 → 云端显示「暂无快照」，
  // 暗示"功能在、只是还没快照"。能力位必须是机器可读的布尔，不能靠读文案。
  const b = await getSetting('backup.latest', null);
  return jsonOk({ backups: [], fileSnapshots: false, note: '云端 Turso 不支持文件型快照；配置备份请用「配置备份/恢复」' });
}

// POST /api/data/cleanup/preview {days}
async function handleDataCleanupPreview(req) {
  try {
    const cutoff = cutoffIso((req.body || {}).days);
    const willDelete = {};
    let total = 0;
    const art = await cleanupArticles(cutoff, { preview: true });
    willDelete.articles = art?.c || 0;
    total += willDelete.articles;
    for (const { table, col, skip } of CLEAN_TABLES) {
      if (skip) { willDelete[table] = 0; continue; }
      const n = (await qOne(`SELECT COUNT(*) c FROM ${table} WHERE ${col} < ?`, [cutoff])).c;
      willDelete[table] = n;
      total += n;
    }
    return jsonOk({ days: Number((req.body || {}).days), cutoff, willDelete, total, note: '视频/播客不清理；已读/稍后读/精选豁免' });
  } catch (err) {
    return { status: 400, body: jsonErr(err.message) };
  }
}

// POST /api/data/cleanup {days, confirm:true}
async function handleDataCleanup(req) {
  const body = req.body || {};
  if (body.confirm !== true) return { status: 400, body: jsonErr('需 confirm:true 确认执行') };
  // 删除闸（⑥b/B103）：Vercel 没有本地转储目录，改判库里的转储凭证
  //（只能由"本地校验全过的转储"写入）。不过闸 = 一条都不删 + 409 带原因 + 审计行。
  const gate = credentialGate(await getSetting(CREDENTIAL_KEY, null), { maxAgeHours: GATE_MAX_AGE_H });
  if (!gate.allowed) {
    await auditRecord('data.cleanup.blocked', { detail: { reason: gate.reason } });
    return { status: 409, body: jsonErr(`删除闸挡下：${gate.reason}`) };
  }
  try {
    const cutoff = cutoffIso(body.days);
    const deleted = {};
    let total = 0;
    const art = await cleanupArticles(cutoff);
    deleted.articles = art.changes || 0;
    total += deleted.articles;
    for (const { table, col, skip } of CLEAN_TABLES) {
      if (skip) { deleted[table] = 0; continue; }
      const n = (await qRun(`DELETE FROM ${table} WHERE ${col} < ?`, [cutoff])).changes;
      deleted[table] = n;
      total += n;
    }
    await auditRecord('data.cleanup', { detail: { days: body.days, deleted } });
    return jsonOk({ days: Number(body.days), cutoff, deleted, total });
  } catch (err) {
    return { status: 400, body: jsonErr(err.message) };
  }
}

// POST /api/data/snapshot|restore|upload — 文件型整库快照在云端不可用
async function handleDataUnsupported(req) {
  return {
    status: 501,
    body: jsonErr('云端 Turso 无文件系统，整库 .db 快照/恢复不可用；请使用配置备份（POST /api/backup），或在本地端做整库快照'),
  };
}

// ─── 审计日志 ───
// GET /api/audit?limit=50&action=
async function handleAuditList(req) {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const action = req.query.action;
  const items = action
    ? await qAll('SELECT * FROM audit_log WHERE action = ? ORDER BY at DESC LIMIT ?', [String(action), limit])
    : await qAll('SELECT * FROM audit_log ORDER BY at DESC LIMIT ?', [limit]);
  const total = (await qOne('SELECT COUNT(*) c FROM audit_log')).c;
  return jsonOk({ items, total });
}

// DELETE /api/audit?days=30
async function handleAuditCleanup(req) {
  const days = Number(req.query.days) || 30;
  const cutoff = new Date(Date.now() - days * 86400e3).toISOString();
  const r = await qRun('DELETE FROM audit_log WHERE at < ?', [cutoff]);
  return jsonOk({ deleted: r.changes });
}

// ═══ 设置写（13-settings-write, 2026-09-11） ═══
// 与本地 server/routes/settings.js + routes/daily.js settingsRouter 语义对齐
const SETTINGS_BLOCKLIST = ['auth.secret', 'admin.passwordHash', 'backup.latest', 'cloud.collect'];

// 栏目表/入报源类型：见文件上方对 lib/daily-columns.js 的唯一引用（B10，此处曾另抄一份）

// 对象型 setting 合并写；敏感键留空（undefined/''）不覆盖
async function mergeSetting(key, patch, sensitiveKeys = []) {
  const cur = (await getSetting(key, {})) || {};
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch || {})) {
    if (sensitiveKeys.includes(k) && (v === undefined || v === '')) continue;
    if (v !== undefined) next[k] = v;
  }
  await setSetting(key, next);
}

// 与本地 routes/daily.js validateDailyPatch 同强度
function validateDailyPatch(patch) {
  const out = {};
  if (patch.windowHours !== undefined) {
    const n = Number(patch.windowHours);
    if (!Number.isFinite(n) || n <= 0) throw new Error('windowHours 必须是正数');
    out.windowHours = n;
  }
  if (patch.time !== undefined) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(patch.time));
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error('time 格式必须是 HH:MM');
    out.time = `${m[1].padStart(2, '0')}:${m[2]}`;
  }
  return out;
}

// 与本地 routes/daily.js sanitizeColumns 同语义（keywords 支持 AND 数组组合）
// 27b：special/id 的旧值 'focus' 读入即归一为 'spotlight'
function sanitizeColumns(cols) {
  if (!Array.isArray(cols) || !cols.length) throw new Error('columns 必须是非空数组');
  return cols.map((c, i) => {
    const out = { id: c.id === 'focus' ? 'spotlight' : (c.id || `c${Date.now()}_${i}`), name: String(c.name || '').trim() };
    if (!out.name) throw new Error('栏目名称不能为空');
    const special = c.special === 'focus' ? 'spotlight' : c.special;
    if (special === 'spotlight' || special === 'fallback') {
      out.special = special;
    } else {
      if (c.desc !== undefined) out.desc = String(c.desc);
      out.keywords = Array.isArray(c.keywords)
        ? c.keywords.map((k) => {
            if (Array.isArray(k)) return k.map((s) => String(s).trim()).filter(Boolean);
            return String(k).trim();
          }).filter((k) => (Array.isArray(k) ? k.length > 0 : k))
        : [];
    }
    return out;
  });
}

// PUT /api/settings — 分区合并写（F1/F3/F4/F5/F6）
async function handleSettingsPut(req) {
  const body = req.body || {};
  // F3：黑名单系统键永不可写（顶层或任一区内）
  for (const [k, v] of Object.entries(body)) {
    if (SETTINGS_BLOCKLIST.includes(k)) return { status: 400, body: jsonErr(`含系统保留键 ${k}，禁止写入`) };
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const kk of Object.keys(v)) {
        if (SETTINGS_BLOCKLIST.includes(kk)) return { status: 400, body: jsonErr(`含系统保留键 ${kk}，禁止写入`) };
      }
    }
  }
  // F4：AI 区云端锁定 env-only（2026-09-11 settings.ai 污染事故决策）
  if (body.ai !== undefined) {
    return { status: 400, body: jsonErr('云端 AI 配置锁定为环境变量（AGNES_*），请在 Vercel 环境变量中修改') };
  }
  // F6：全部校验先于任何写入
  let dailyPatch = null;
  try {
    if (body.daily) dailyPatch = { ...body.daily, ...validateDailyPatch(body.daily) };
  } catch (err) {
    return { status: 400, body: jsonErr(err.message) };
  }
  if (body.views !== undefined) {
    const views = body.views;
    if (!Array.isArray(views) || views.length > 20) {
      return { status: 400, body: jsonErr('views 必须为数组且不超过 20 个') };
    }
    for (const v of views) {
      if (!v || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 20) {
        return { status: 400, body: jsonErr('视图名称须为非空且不超过 20 字') };
      }
      if (!v.filter || typeof v.filter !== 'object') {
        return { status: 400, body: jsonErr('视图 filter 须为对象') };
      }
    }
  }
  if (body.data && body.data.retentionDays !== undefined) {
    const n = Number(body.data.retentionDays);
    if (!Number.isInteger(n) || n < 1 || n > 90) {
      return { status: 400, body: jsonErr('retentionDays 必须是 1-90 的整数') };
    }
  }
  // 分区写入
  const sections = [];
  if (body.intervals) { await mergeSetting('intervals', body.intervals); sections.push('intervals'); }
  if (body.opml) {
    if (body.opml.url !== undefined) await setSetting('opml.url', String(body.opml.url));
    if (body.opml.enabled !== undefined) await setSetting('opml.enabled', !!body.opml.enabled);
    sections.push('opml');
  }
  if (body.queue) { await mergeSetting('queue', body.queue, ['token']); sections.push('queue'); }
  if (dailyPatch) { await mergeSetting('daily', dailyPatch); sections.push('daily'); }
  if (body.hot) { await mergeSetting('hot', body.hot); sections.push('hot'); }
  if (body.data) { await mergeSetting('data', body.data); sections.push('data'); }
  if (body.mybrief) { await mergeSetting('mybrief', body.mybrief); sections.push('mybrief'); }
  if (body.weekly) { await mergeSetting('weekly', body.weekly); sections.push('weekly'); }
  if (body.views !== undefined) { await setSetting('reader.views', body.views); sections.push('views'); }
  if (body.bilibili && body.bilibili.cookie) {
    await qRun(
      'INSERT INTO credentials(platform, cookie, updated_at) VALUES(?,?,?) ON CONFLICT(platform) DO UPDATE SET cookie=excluded.cookie, updated_at=excluded.updated_at',
      ['bilibili', String(body.bilibili.cookie), nowIso()]
    );
    sections.push('bilibili');
  }
  await auditRecord('settings.update', { detail: { sections } });
  return jsonOk({ sections });
}

// GET /api/settings/daily — 日报设置页数据源
async function handleDailySettingsGet(req) {
  const cfg = (await getSetting('daily', {})) || {};
  const columns = (await getSetting('daily.columns', null)) || DAILY_DEFAULT_COLUMNS;
  const sourceList = async (types, selectedIds) => {
    const rows = await qAll(
      `SELECT id, type, name, spotlight FROM sources WHERE type IN (${types.map(() => '?').join(',')}) ORDER BY id`, types);
    return rows.map((s) => ({
      id: s.id, type: s.type, name: s.name, spotlight: !!s.spotlight, // 27b：原 focus 字段
      selected: selectedIds ? selectedIds.includes(s.id) : true,
    }));
  };
  const articleSourceIds = Array.isArray(cfg.articleSourceIds) ? cfg.articleSourceIds : null;
  const videoSourceIds = Array.isArray(cfg.videoSourceIds) ? cfg.videoSourceIds : null;
  return jsonOk({
    windowHours: Number(cfg.windowHours) || 48,
    time: cfg.time || '08:00',
    articleSourceIds,
    videoSourceIds,
    articleSources: await sourceList(DAILY_ARTICLE_TYPES, articleSourceIds),
    videoSources: await sourceList(DAILY_VIDEO_TYPES, videoSourceIds),
    columns,
    defaultColumns: DAILY_DEFAULT_COLUMNS,
  });
}

// PUT /api/settings/daily — 窗口/时间/来源勾选/spotlight/栏目
async function handleDailySettingsPut(req) {
  const body = req.body || {};
  // 预校验（零写入）
  let patch;
  try {
    patch = validateDailyPatch(body);
  } catch (err) {
    return { status: 400, body: jsonErr(err.message) };
  }
  if (body.articleSourceIds !== undefined && !Array.isArray(body.articleSourceIds)) {
    return { status: 400, body: jsonErr('articleSourceIds 必须是数组') };
  }
  if (body.videoSourceIds !== undefined && !Array.isArray(body.videoSourceIds)) {
    return { status: 400, body: jsonErr('videoSourceIds 必须是数组') };
  }
  let columns;
  try {
    if (body.columns !== undefined && !body.restoreDefaultColumns) columns = sanitizeColumns(body.columns);
  } catch (err) {
    return { status: 400, body: jsonErr(err.message) };
  }
  // 写入 daily 区
  if (body.articleSourceIds !== undefined) patch.articleSourceIds = body.articleSourceIds.map(Number);
  if (body.videoSourceIds !== undefined) patch.videoSourceIds = body.videoSourceIds.map(Number);
  if (Object.keys(patch).length) await mergeSetting('daily', patch);
  // spotlight 两种写法（27b：spotlightSourceIds 全量替换 / spotlight 对象局部增量；旧键 focusSourceIds/focus 兼容落 spotlight）
  const fullIds = body.spotlightSourceIds !== undefined ? body.spotlightSourceIds : body.focusSourceIds;
  if (fullIds !== undefined) {
    if (!Array.isArray(fullIds)) return { status: 400, body: jsonErr('spotlightSourceIds 必须是数组') };
    const ids = fullIds.map(Number);
    await qRun(
      'UPDATE sources SET spotlight = CASE WHEN id IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END',
      [JSON.stringify(ids)]
    );
  } else {
    const inc = (body.spotlight && typeof body.spotlight === 'object') ? body.spotlight
      : (body.focus && typeof body.focus === 'object') ? body.focus : null;
    if (inc) {
      const stmts = Object.entries(inc).map(([id, v]) => ({
        sql: 'UPDATE sources SET spotlight=? WHERE id=?', args: [v ? 1 : 0, Number(id)],
      }));
      if (stmts.length) await getDb().batch(stmts, 'write');
    }
  }
  // 栏目管理
  if (body.restoreDefaultColumns) await setSetting('daily.columns', DAILY_DEFAULT_COLUMNS);
  else if (columns) await setSetting('daily.columns', columns);
  await auditRecord('daily.settings', { detail: { keys: Object.keys(body) } });
  return jsonOk({});
}

// ═══ 源写（14-sources-write, 2026-09-12） ═══
// 与本地 server/routes/sources.js / sourcelib.js / groups.js 语义对齐
const _classify = require('./_classify');

const SOURCE_TYPES = ['rss', 'wechat', 'x', 'youtube', 'hotlist', 'bilibili', 'douyin'];

// 云端简化 URL 类型识别（本地走适配器 registry 全量探测；10s 限制下用启发式）
function detectTypeByUrl(url) {
  const u = String(url || '').toLowerCase();
  if (u.startsWith('hotlist://') || u.startsWith('hotlist60s://')) return 'hotlist';
  if (u.includes('bilibili.com')) return 'bilibili';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('mp.weixin.qq.com')) return 'wechat';
  if (u.includes('douyin.com')) return 'douyin';
  if (u.includes('x.com') || u.includes('twitter.com')) return 'x';
  return 'rss';
}

// POST /api/sources {url, name?, type?} — F1

// POST /api/sources/dedupe {apply?:bool} — 源查重合并（T4-2 R1）
// 组1=归一化 URL 相同；组2=同名+同域名。保留策略：启用>停用、fail_count 低者优先、id 老者优先；
// 其余 enabled=0 且 extra.mergedInto=保留项 id（cleanup 自动恢复会跳过 mergedInto 源）
async function handleSourcesDedupe(req) {
  const apply = !!(req.body || {}).apply;
  const rows = await qAll('SELECT id, name, type, url, enabled, fail_count, created_at, extra FROM sources');
  const normUrl = (u) => String(u || '').trim().toLowerCase().replace(/^http:\/\//, 'https://').replace(/\/+$/, '');
  const normName = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, '');
  const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const groups = [];
  const byKey = new Map();
  for (const r of rows) {
    const k1 = 'u:' + normUrl(r.url);
    const k2 = r.name ? 'n:' + normName(r.name) + '@' + domainOf(r.url) : null;
    let g = byKey.get(k1) || (k2 && byKey.get(k2)) || null;
    if (!g) { g = { members: [] }; groups.push(g); }
    if (!byKey.has(k1)) byKey.set(k1, g);
    if (k2 && !byKey.has(k2)) byKey.set(k2, g);
    g.members.push(r);
  }
  const dupGroups = groups
    .filter((g) => g.members.length > 1)
    .map((g) => {
      const sorted = [...g.members].sort((a, b) => (b.enabled - a.enabled) || ((a.fail_count || 0) - (b.fail_count || 0)) || (a.id - b.id));
      const keep = sorted[0];
      return {
        keep: { id: keep.id, name: keep.name, enabled: !!keep.enabled },
        merged: sorted.slice(1).map((m) => ({ id: m.id, name: m.name, url: m.url, enabled: !!m.enabled })),
      };
    });
  if (!apply) return jsonOk({ groups: dupGroups.length, plan: dupGroups, note: 'apply:true 执行合并' });
  let mergedCount = 0;
  for (const g of dupGroups) {
    for (const m of g.merged) {
      let extra = {};
      try { extra = JSON.parse((rows.find((r) => r.id === m.id) || {}).extra || '{}'); } catch { /* 无 extra */ }
      extra.mergedInto = g.keep.id;
      await qRun('UPDATE sources SET enabled=0, extra=? WHERE id=?', [JSON.stringify(extra), m.id]);
      mergedCount++;
    }
  }
  await auditRecord('sources.dedupe', { detail: { groups: dupGroups.length, merged: mergedCount } });
  return jsonOk({ groups: dupGroups.length, merged: mergedCount });
}

async function handleSourceCreate(req) {
  const { url, name, type } = req.body || {};
  if (!url || !String(url).trim()) return { status: 400, body: jsonErr('缺少 url') };
  const input = String(url).trim();
  if (type && !SOURCE_TYPES.includes(type)) return { status: 400, body: jsonErr(`未知订阅源类型: ${type}`) };
  // N4 幂等：url 查重
  const dup = await qOne('SELECT * FROM sources WHERE url=?', [input]);
  if (dup) return jsonOk({ item: dup, duplicated: true });
  const finalType = type || detectTypeByUrl(input);
  const finalName = (name && String(name).trim()) || (() => { try { return new URL(input).hostname; } catch { return input; } })();
  const r = await qRun(
    "INSERT INTO sources(type, name, url, enabled, status, fail_count, created_at) VALUES(?,?,?,1,'pending',0,?)",
    [finalType, finalName, input, nowIso()]
  );
  const newId = Number((await qOne('SELECT MAX(id) m FROM sources')).m);
  try { await _classify.autoClassifySourceId(newId); } catch { /* 降级为未分组 */ }
  const item = await qOne('SELECT * FROM sources WHERE id=?', [newId]);
  await auditRecord('source.create', { target: finalName, detail: { id: newId, type: finalType, url: input } });
  return jsonOk({ item });
}

// DELETE /api/sources/:id — F2 级联删除
async function handleSourceDelete(req, id) {
  const s = await qOne('SELECT * FROM sources WHERE id=?', [id]);
  if (!s) return { status: 404, body: jsonErr('not found') };
  await getDb().batch([
    { sql: 'DELETE FROM articles WHERE source_id=?', args: [id] },
    { sql: 'DELETE FROM videos WHERE source_id=?', args: [id] },
    { sql: 'DELETE FROM sources WHERE id=?', args: [id] },
  ], 'write');
  await auditRecord('source.delete', { target: s.name, detail: { id, type: s.type } });
  return jsonOk({});
}

// POST /api/sources/:id/refresh — F3 云端语义：标记立即到期（runner ≤15min 补抓）
async function handleSourceRefresh(req, id) {
  const s = await qOne('SELECT * FROM sources WHERE id=?', [id]);
  if (!s) return { status: 404, body: jsonErr('not found') };
  await qRun('UPDATE sources SET next_fetch_at=NULL WHERE id=?', [id]);
  await auditRecord('source.refresh', { target: s.name, detail: { id } });
  return jsonOk({ id, deferred: true, message: '已标记立即到期，最迟 15 分钟内由云端 runner 采集' });
}

// POST /api/sources/refresh-all?type= — F4
async function handleSourceRefreshAll(req) {
  const filterType = req.query.type;
  const conds = ['enabled=1'];
  const args = [];
  if (filterType) { conds.push('type=?'); args.push(filterType); }
  const r = await qRun(`UPDATE sources SET next_fetch_at=NULL WHERE ${conds.join(' AND ')}`, args);
  await auditRecord('source.refresh-all', { detail: { affected: r.changes, filterType: filterType || null } });
  return jsonOk({ affected: r.changes, deferred: true, message: `已将 ${r.changes} 个源标记为立即到期，最迟 15 分钟内由云端 runner 采集` });
}

// PUT /api/sources/:id/interval — F5
async function handleSourceInterval(req, id) {
  const s = await qOne('SELECT * FROM sources WHERE id=?', [id]);
  if (!s) return { status: 404, body: jsonErr('not found') };
  const { intervalMin } = req.body || {};
  let extra = {};
  try { extra = JSON.parse(s.extra || '{}'); } catch { /* 重置 */ }
  if (intervalMin === null || intervalMin === undefined) {
    delete extra.intervalMin;
  } else {
    const n = Number(intervalMin);
    if (!Number.isFinite(n) || n <= 0) return { status: 400, body: jsonErr('intervalMin 必须是正数分钟数或 null') };
    extra.intervalMin = n;
  }
  await qRun('UPDATE sources SET extra=? WHERE id=?', [JSON.stringify(extra), id]);
  await auditRecord('source.interval', { target: s.name, detail: { intervalMin: extra.intervalMin ?? null } });
  return jsonOk({ intervalMin: extra.intervalMin ?? null });
}

// POST /api/sources/batch — F6
// 27b（2026-09-15）：四轴 action（spotlight/mute/visible/subscribe…）+ 组级 groupScopeId（单条 SQL 防 serverless 超时）
async function handleSourcesBatch(req) {
  const { ids, action, groupId, groupScopeId, intervalMin, failoverGroup } = req.body || {};
  const validActions = axes.AXIS_ALL_ACTIONS;
  if (!validActions.includes(action)) return { status: 400, body: jsonErr(`action 须为 ${validActions.join('|')}`) };
  if (action === 'move' && groupId === undefined) return { status: 400, body: jsonErr('move 需要 groupId') };

  // ── 组级快路径：整组成员单条 SQL ──
  if (groupScopeId !== undefined && groupScopeId !== null) {
    const gid = Number(groupScopeId);
    if (!Number.isFinite(gid)) return { status: 400, body: jsonErr('groupScopeId 无效') };
    const g = await qOne('SELECT * FROM groups WHERE id=?', [gid]);
    if (!g) return { status: 404, body: jsonErr('分组不存在') };
    try {
      if (action === 'subscribe' || action === 'unsubscribe') {
        const members = (await qAll('SELECT id FROM sources WHERE group_id=?', [gid])).map((r) => r.id);
        const total = await axes.setSubscribed({ getSetting, setSetting }, members, action === 'subscribe');
        await auditRecord('source.batch', { detail: { action, group: g.name, succeeded: members.length } });
        return jsonOk({ succeeded: members.length, failed: 0, group: g.name, subscriptionTotal: total });
      }
      if (action === 'move') return { status: 400, body: jsonErr('组级操作不支持 move（请用 ids 逐个移动）') };
      const stmt = axes.groupAxisStmt(action, gid, { intervalMin, failoverGroup });
      if (!stmt) return { status: 400, body: jsonErr(`组级不支持 action=${action}`) };
      const r = await qRun(stmt.sql, stmt.args);
      await auditRecord('source.batch', { detail: { action, group: g.name, succeeded: r.changes } });
      return jsonOk({ succeeded: r.changes, failed: 0, group: g.name });
    } catch (err) {
      return { status: 400, body: jsonErr(err.message) };
    }
  }

  if (!Array.isArray(ids) || !ids.length) return { status: 400, body: jsonErr('缺少 ids') };

  // 订阅轴（读改写 settings 一次）
  if (action === 'subscribe' || action === 'unsubscribe') {
    const total = await axes.setSubscribed({ getSetting, setSetting }, ids, action === 'subscribe');
    await auditRecord('source.batch', { detail: { action, succeeded: ids.length } });
    return jsonOk({ succeeded: ids.length, failed: 0, subscriptionTotal: total });
  }

  const truncated = ids.length > 200;
  const workIds = ids.slice(0, 200);

  let succeeded = 0;
  const errors = [];
  for (const rawId of workIds) {
    const sid = Number(rawId);
    if (!Number.isFinite(sid)) { errors.push({ id: rawId, error: '无效 id' }); continue; }
    const source = await qOne('SELECT * FROM sources WHERE id=?', [sid]);
    if (!source) { errors.push({ id: sid, error: 'not found' }); continue; }
    try {
      if (action === 'enable') {
        // 解冻语义 + 0-6h 随机错峰（与本地一致）
        let extra = {};
        try { extra = JSON.parse(source.extra || '{}'); } catch { /* ignore */ }
        delete extra.lastError; delete extra.lastErrorAt;
        const next = new Date(Date.now() + Math.floor(Math.random() * 6 * 3600e3)).toISOString();
        await qRun("UPDATE sources SET enabled=1, fail_count=0, status='ok', extra=?, next_fetch_at=? WHERE id=?",
          [JSON.stringify(extra), next, sid]);
      } else if (action === 'disable') {
        await qRun('UPDATE sources SET enabled=0 WHERE id=?', [sid]);
      } else if (axes.AXIS_COL_ACTIONS[action]) {
        const [col, val] = axes.AXIS_COL_ACTIONS[action];
        await qRun(`UPDATE sources SET ${col}=? WHERE id=?`, [val, sid]);
      } else if (action === 'interval') {
        if (intervalMin === null || intervalMin === undefined) {
          await qRun("UPDATE sources SET extra=json_remove(COALESCE(extra,'{}'),'$.intervalMin') WHERE id=?", [sid]);
        } else {
          const n = Number(intervalMin);
          if (!Number.isFinite(n) || n <= 0) { errors.push({ id: sid, error: 'intervalMin 必须是正数分钟数或 null' }); continue; }
          await qRun("UPDATE sources SET extra=json_set(COALESCE(extra,'{}'),'$.intervalMin', ?) WHERE id=?", [n, sid]);
        }
      } else if (action === 'failover') {
        const fg = String(failoverGroup || '').trim();
        if (fg) await qRun("UPDATE sources SET extra=json_set(COALESCE(extra,'{}'),'$.failoverGroup', ?) WHERE id=?", [fg, sid]);
        else await qRun("UPDATE sources SET extra=json_remove(COALESCE(extra,'{}'),'$.failoverGroup') WHERE id=?", [sid]);
      } else if (action === 'move') {
        if (groupId !== null) {
          const g = await qOne('SELECT * FROM groups WHERE id=?', [groupId]);
          if (!g) { errors.push({ id: sid, error: '分组不存在' }); continue; }
          if (_classify.kindOfType(source.type) !== g.kind) { errors.push({ id: sid, error: '文件夹类型不匹配' }); continue; }
        }
        await qRun('UPDATE sources SET group_id=? WHERE id=?', [groupId ?? null, sid]);
        let extra = {};
        try { extra = JSON.parse(source.extra || '{}'); } catch { /* ignore */ }
        extra.categoryLocked = 1;
        await qRun('UPDATE sources SET extra=? WHERE id=?', [JSON.stringify(extra), sid]);
      }
      succeeded++;
    } catch (err) {
      errors.push({ id: sid, error: err.message });
    }
  }
  await auditRecord('source.batch', { detail: { action, succeeded, failed: errors.length } });
  return jsonOk({ succeeded, failed: errors.length, errors: errors.length ? errors : undefined, truncated: truncated || undefined });
}

// POST /api/sources/autoclassify — F7
async function handleAutoclassify(req) {
  const { dryRun, apply, ids, includeLocked, showAll } = req.body || {};
  if (dryRun) {
    const result = await _classify.previewReclassify({ includeLocked: !!includeLocked, showAll: !!showAll });
    return jsonOk(result);
  }
  if (apply) {
    if (!Array.isArray(ids) || !ids.length) return { status: 400, body: jsonErr('apply 需要 ids 数组') };
    const result = await _classify.applyReclassify(ids.map(Number));
    await auditRecord('source.autoclassify', { detail: { applied: result.applied, skippedLocked: result.skippedLocked } });
    return jsonOk(result);
  }
  return { status: 400, body: jsonErr('需要 dryRun:true 或 apply:true') };
}

// /api/groups 写 — F8
async function handleGroupCreate(req) {
  const { kind, name } = req.body || {};
  if (!kind || !name) return { status: 400, body: jsonErr('缺少 kind/name') };
  if (!['article', 'video'].includes(kind)) return { status: 400, body: jsonErr('kind 须为 article|video') };
  const maxSort = (await qOne('SELECT COALESCE(MAX(sort),0) m FROM groups WHERE kind=?', [kind])).m;
  await qRun('INSERT INTO groups(kind, name, sort) VALUES(?,?,?)', [kind, String(name).trim(), maxSort + 1]);
  const item = await qOne('SELECT * FROM groups ORDER BY id DESC LIMIT 1');
  await auditRecord('group.create', { target: item.name, detail: { id: item.id, kind } });
  return jsonOk({ item });
}

async function handleGroupUpdate(req, id) {
  const g = await qOne('SELECT * FROM groups WHERE id=?', [id]);
  if (!g) return { status: 404, body: jsonErr('not found') };
  const { name, sort } = req.body || {};
  await qRun('UPDATE groups SET name=?, sort=? WHERE id=?',
    [name !== undefined ? String(name) : g.name, sort !== undefined ? Number(sort) : g.sort, id]);
  await auditRecord('group.update', { target: name !== undefined ? String(name) : g.name, detail: { id } });
  return jsonOk({});
}

async function handleGroupDelete(req, id) {
  const g = await qOne('SELECT * FROM groups WHERE id=?', [id]);
  if (!g) return { status: 404, body: jsonErr('not found') };
  await getDb().batch([
    { sql: 'UPDATE sources SET group_id=NULL WHERE group_id=?', args: [id] },
    { sql: 'DELETE FROM groups WHERE id=?', args: [id] },
  ], 'write');
  await auditRecord('group.delete', { target: g.name, detail: { id } });
  return jsonOk({});
}

async function handleGroupMove(req) {
  const { source_id, group_id } = req.body || {};
  if (!source_id) return { status: 400, body: jsonErr('缺少 source_id') };
  const s = await qOne('SELECT * FROM sources WHERE id=?', [source_id]);
  if (!s) return { status: 404, body: jsonErr('not found') };
  if (group_id !== null && group_id !== undefined) {
    const g = await qOne('SELECT * FROM groups WHERE id=?', [group_id]);
    if (!g) return { status: 404, body: jsonErr('分组不存在') };
    if (_classify.kindOfType(s.type) !== g.kind) return { status: 400, body: jsonErr('文件夹类型不匹配') };
  }
  await qRun('UPDATE sources SET group_id=? WHERE id=?', [group_id ?? null, source_id]);
  let extra = {};
  try { extra = JSON.parse(s.extra || '{}'); } catch { /* ignore */ }
  extra.categoryLocked = 1;
  await qRun('UPDATE sources SET extra=? WHERE id=?', [JSON.stringify(extra), source_id]);
  await auditRecord('group.move', { target: s.name, detail: { source_id, group_id: group_id ?? null } });
  return jsonOk({});
}

// ═══ 报警配置写（15-cloud-alerts, 2026-09-12） ═══
const _alerts = require('./_alerts');
const _ai = require('./_ai'); // 16-ai-infra：统一 AI 通道

// PUT /api/alerts/config — 整体写（掩码合并：掩码/空值保留旧密钥）
async function handleAlertsConfigPut(req) {
  const body = req.body || {};
  const cur = await _alerts.getConfig();
  const next = { ...cur, ...(body.alerts || body) };
  if (next.channels) next.channels = _alerts.mergeChannelSecrets(cur.channels, next.channels);
  delete next.recentLog; // 日志不随配置回写
  await _alerts.saveConfig(next);
  await auditRecord('alerts.config', { detail: { channels: (next.channels || []).length } });
  return jsonOk({});
}

// POST /api/alerts/test — 向全部启用渠道发测试消息
async function handleAlertsTest(req) {
  const r = await _alerts.testAll();
  await auditRecord('alerts.test', { detail: { sent: r.sent } });
  return jsonOk(r);
}

// POST /api/alerts/clear-cooldowns
async function handleAlertsClearCooldowns(req) {
  await setSetting('alerts.cooldowns', {});
  await auditRecord('alerts.clear-cooldowns', {});
  return jsonOk({});
}

// POST /api/articles/:id/translate — 手动翻译入队（17-translate；Hobby 10s 限制→异步入队，runner 拾取）
async function handleArticleTranslate(req, id) {
  const row = await qOne('SELECT id, title, translated_title, translated_content FROM articles WHERE id=?', [id]);
  if (!row) return { status: 404, body: jsonErr('not found') };
  if (row.translated_title || row.translated_content) return jsonOk({ queued: false, already: true });
  const q = (await getSetting('translate.queue', { ids: [] })) || { ids: [] };
  if (!Array.isArray(q.ids)) q.ids = [];
  if (!q.ids.includes(id)) {
    q.ids.push(id);
    await setSetting('translate.queue', q);
    await auditRecord('article.translate', { target: row.title, detail: { id } });
  }
  return jsonOk({ queued: true, etaMin: 20, message: '已加入翻译队列，runner 每 15 分钟处理' });
}

// 读层译文标题回填（与 daily 的 enrichDailyTranslated 同机制）：早报/周刊报告是生成时快照，
// 生成后才翻好的标题应实时换中文（2026-09-15：「评论：0」快照污染暴露此缺口——快照要等 21:30 重生成才刷新）
async function enrichBriefTitles(report) {
  if (!report || typeof report !== 'object') return report;
  const buckets = [];
  if (report.sections) for (const k of ['top', 'featured', 'rest']) {
    if (Array.isArray(report.sections[k])) buckets.push(report.sections[k]);
  }
  if (Array.isArray(report.storylines)) for (const sl of report.storylines) {
    if (sl && Array.isArray(sl.items)) buckets.push(sl.items);
  }
  // 2026-09-17 审查补漏：周刊结构是 report.items（非 sections）
  if (Array.isArray(report.items)) buckets.push(report.items);
  const ids = [];
  for (const arr of buckets) for (const it of arr) {
    if (it && Number.isFinite(Number(it.id)) && !String(it.id).startsWith('v')) ids.push(Number(it.id));
  }
  if (!ids.length) return report;
  const map = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const batchIds = ids.slice(i, i + 500);
    // original_title 取库里真正的原文标题，而非快照值（快照可能是污染译文——2026-09-15「评论：0」事故）
    const rows = await qAll(
      `SELECT id, title, translated_title FROM articles WHERE id IN (${batchIds.map(() => '?').join(',')}) AND translated_title IS NOT NULL AND translated_title != ''`,
      batchIds
    );
    for (const r of rows) map.set(r.id, { zh: cleanTranslatedTitle(r.translated_title), orig: r.title });
  }
  if (!map.size) return report;
  for (const arr of buckets) for (const it of arr) {
    const hit = it && map.get(Number(it.id));
    if (hit && hit.zh !== it.title) { it.original_title = hit.orig || it.title; it.title = hit.zh; }
  }
  return report;
}

// GET /api/mybrief — 我的早报（19-my-brief；公开读，三态响应）
async function handleMyBrief(req) {
  // 27b：订阅集合 = settings subscription.ids（原 focus=1 语义已迁移；键缺失时兜底 spotlight 集合）
  const subIds = await axes.resolveSubscriptionIds({ qAll, getSetting });
  if (!subIds.length) return jsonOk({ empty: 'no-subscription' });
  const report = await getSetting('mybrief.latest', null);
  if (!report) return jsonOk({ empty: 'no-content' });
  // B76：runner 会把空态**当成报告写进行**（tools/collect-turso.js:1308 无订阅 / :1372 今日无精选），
  // 只判 `!report` 就会回 `{report:{empty:'no-content'}}` —— 三态契约在 API 层断裂。
  // 前台 MyBriefPage 用 `data?.empty || report?.empty` 兜住了，但只看 data.empty 的客户端
  // （门户、飞书推送、脚本）会把"今日无更新"读成"有内容"。在读层归一，两种存储形态收敛成一个响应。
  if (typeof report.empty === 'string') {
    return jsonOk({ empty: report.empty, ...(report.message ? { message: report.message } : {}) });
  }
  // T3-1 R7：阅读足迹小结（晚间批生成；读不到不给键）
  const digest = await getSetting('reading.digest', null);
  return jsonOk({ report: await enrichBriefTitles(report), ...(digest ? { digest } : {}) });
}


// DELETE /api/weekly/archive/:issue — 删除单期周刊归档（T3-2 R1；latest 若指向该期则清空 latest）
async function handleWeeklyArchiveDelete(req, issue) {
  const archive = (await getSetting('weekly.archive', [])) || [];
  const next = archive.filter((a) => a.issue !== Number(issue));
  if (next.length === archive.length) return { status: 404, body: jsonErr(`第 ${issue} 期不存在`) };
  await setSetting('weekly.archive', next);
  const latest = await getSetting('weekly.latest', null);
  if (latest && Number(latest.issue) === Number(issue)) await setSetting('weekly.latest', next[next.length - 1] ? next[next.length - 1].report : null);
  await auditRecord('weekly.archiveDelete', { detail: { issue } });
  return jsonOk({ removed: Number(issue), remaining: next.length });
}

// GET /api/weekly — 精选周刊（20-weekly-picks；公开读，?issue=N 归档查询）
async function handleWeekly(req) {
  const issue = Number(req.query.issue) || 0;
  if (issue > 0) {
    const archive = (await getSetting('weekly.archive', [])) || [];
    const hit = archive.find((a) => a.issue === issue);
    if (!hit) return { status: 404, body: jsonErr('期号不存在') };
    return jsonOk({ report: await enrichBriefTitles(hit.report) });
  }
  const report = await getSetting('weekly.latest', null);
  if (!report) return jsonOk({ empty: 'no-content' });
  const archive = (await getSetting('weekly.archive', [])) || [];
  return jsonOk({ report: await enrichBriefTitles(report), archive: archive.map((a) => ({ issue: a.issue, dateStart: a.dateStart, dateEnd: a.dateEnd, theme: a.theme, count: a.count })) });
}

// GET /api/sources/bilibili-diagnose — B站 Cookie/wbi/登录态诊断（21-bilibili-runner）
async function handleBilibiliDiagnose(req) {
  const r = await require('./_bilibili').diagnose();
  return jsonOk(r);
}

// ─── 路由分发 ───
async function dispatch(req) {
  const path = req.url.split('?')[0];
  const method = req.method;

  // POST /api/auth/login
  if (path === '/api/auth/login' && method === 'POST') return handleLogin(req);

  // GET /api/auth/me —— 会话回显（B59：本地 server/routes/auth.js 早有此路由，云端漏移植，
  // 前端 checkAuth() 恒拿 404 → 带有效 token 也被判为未登录，管理台门槛反复要求重登）
  if (path === '/api/auth/me' && method === 'GET') {
    const user = verifyAuth(req);
    if (!user) return { status: 401, body: jsonErr('Unauthorized') };
    return jsonOk({ ok: true, user: user.name || 'admin', exp: user.exp || null });
  }

  // POST /api/articles/read-all（必须在 /:id 之前匹配）
  if (path === '/api/articles/read-all' && method === 'POST') return handleArticlesReadAll(req);

  // POST /api/reading/batch + /api/reading/export（P0-8 修复）
  if (path === '/api/reading/batch' && method === 'POST') return handleReadingBatch(req);
  if (path === '/api/reading/export' && method === 'POST') return handleReadingExport(req);

  // POST /api/articles/:id/read
  const readMatch = path.match(/^\/api\/articles\/(\d+)\/read$/);
  if (readMatch && method === 'POST') return handleArticleRead(req, Number(readMatch[1]));

  // POST /api/articles/:id/later
  const laterMatch = path.match(/^\/api\/articles\/(\d+)\/later$/);
  if (laterMatch && method === 'POST') return handleArticleLater(req, Number(laterMatch[1]));

  // POST /api/articles/:id/translate（17-translate 手动翻译入队）
  const translateMatch = path.match(/^\/api\/articles\/(\d+)\/translate$/);
  if (translateMatch && method === 'POST') return handleArticleTranslate(req, Number(translateMatch[1]));

  // POST /api/daily/regenerate（P1-11 修复，必须在 /daily GET 之前）
  if (path === '/api/daily/regenerate' && method === 'POST') return handleDailyRegenerate(req);

  // POST /api/sources/:id/toggle
  const toggleMatch = path.match(/^\/api\/sources\/(\d+)\/toggle$/);
  if (toggleMatch && method === 'POST') return handleSourceToggle(req, Number(toggleMatch[1]));

  // ─── 管理功能移植路由（2026-09-11，全部需鉴权） ───
  if (path === '/api/sources/restore-all' && method === 'POST') return handleRestoreAll(req);
  if (path === '/api/health/unfreeze-all' && method === 'POST') return handleUnfreezeAll(req);
  const unfreezeMatch = path.match(/^\/api\/health\/unfreeze\/(\d+)$/);
  if (unfreezeMatch && method === 'POST') return handleUnfreezeOne(req, Number(unfreezeMatch[1]));
  if (path === '/api/queue/sync' && method === 'POST') return handleQueueSync(req);
  if ((path === '/api/opml/sync' || path === '/api/rss/sync') && method === 'POST') return handleOpmlSync(req);
  if (path === '/api/opml/export' && method === 'GET') return handleOpmlExport(req);
  if ((path === '/api/rss/refresh' || path === '/api/opml/refresh') && method === 'POST') return handleRssRefresh(req);
  if (path === '/api/backup' && method === 'POST') return handleBackup(req);
  if (path === '/api/backup/restore' && method === 'POST') return handleBackupRestore(req);
  if (path === '/api/data/cleanup/preview' && method === 'POST') return handleDataCleanupPreview(req);
  if (path === '/api/data/cleanup' && method === 'POST') return handleDataCleanup(req);
  if ((path === '/api/data/snapshot' || path === '/api/data/restore' || path === '/api/data/upload') && method === 'POST') return handleDataUnsupported(req);
  if (path === '/api/audit' && method === 'DELETE') return handleAuditCleanup(req);
  // 设置写（13-settings-write）
  if (path === '/api/settings' && method === 'PUT') return handleSettingsPut(req);
  if (path === '/api/settings/daily' && method === 'PUT') return handleDailySettingsPut(req);

  // ─── 源写（14-sources-write）静态路径必须先于 /:id 正则（防截胡） ───
  if (path === '/api/sources' && method === 'POST') return handleSourceCreate(req);
  if (path === '/api/sources/dedupe' && method === 'POST') return handleSourcesDedupe(req);
  if (path === '/api/sources/batch' && method === 'POST') return handleSourcesBatch(req);
  if (path === '/api/sources/autoclassify' && method === 'POST') return handleAutoclassify(req);
  if (path === '/api/sources/refresh-all' && method === 'POST') return handleSourceRefreshAll(req);
  const srcRefreshMatch = path.match(/^\/api\/sources\/(\d+)\/refresh$/);
  if (srcRefreshMatch && method === 'POST') return handleSourceRefresh(req, Number(srcRefreshMatch[1]));
  const srcIntervalMatch = path.match(/^\/api\/sources\/(\d+)\/interval$/);
  if (srcIntervalMatch && method === 'PUT') return handleSourceInterval(req, Number(srcIntervalMatch[1]));
  const srcDeleteMatch = path.match(/^\/api\/sources\/(\d+)$/);
  if (srcDeleteMatch && method === 'DELETE') return handleSourceDelete(req, Number(srcDeleteMatch[1]));
  if (path === '/api/groups' && method === 'POST') return handleGroupCreate(req);
  if (path === '/api/groups/move' && method === 'POST') return handleGroupMove(req);
  const groupMatch = path.match(/^\/api\/groups\/(\d+)$/);
  if (groupMatch && method === 'PUT') return handleGroupUpdate(req, Number(groupMatch[1]));
  if (groupMatch && method === 'DELETE') return handleGroupDelete(req, Number(groupMatch[1]));
  // 报警配置写（15-cloud-alerts）
  if (path === '/api/alerts/config' && method === 'PUT') return handleAlertsConfigPut(req);
  if (path === '/api/alerts/test' && method === 'POST') return handleAlertsTest(req);
  if (path === '/api/alerts/clear-cooldowns' && method === 'POST') return handleAlertsClearCooldowns(req);

  // DELETE /api/weekly/archive/:issue（T3-2 R1）
  // 2026-09-18 修复：这条原先被误写在下方 `if (method === 'GET')` 块内，块内 method==='DELETE'
  // 恒不成立 → 请求一路掉到末尾 404 Not Found，「归档删除」从未真正上线（后台按钮必 404）。
  // 写路由与上面 POST 族同区，勿再放回 GET 块。
  const weeklyDelMatch = path.match(/^\/api\/weekly\/archive\/(\d+)$/);
  if (weeklyDelMatch && method === 'DELETE') return handleWeeklyArchiveDelete(req, Number(weeklyDelMatch[1]));

  // ─── AI 路由（需鉴权） ───
  if (path === '/api/ai/config') return handleAiConfig(req);
  if (path === '/api/ai/ping' && method === 'POST') return handleAiPing(req);
  if (path === '/api/ai/chat' && method === 'POST') return handleAiChat(req);

  // GET 路由
  if (method === 'GET') {
    // GET /api/articles/:id 必须在 /api/articles 之前匹配
    const articleIdMatch = path.match(/^\/api\/articles\/(\d+)$/);
    if (articleIdMatch) return handleArticleById(req, Number(articleIdMatch[1]));
    if (path === '/api/articles/since') return handleArticlesSince(req);
    if (path === '/api/articles') return handleArticles(req);
    if (path === '/api/health/status') return handleHealthStatus(req);
    if (path === '/api/health/source-stats') return handleHealthSourceStats(req);
    if (path === '/api/health/collect-history') return handleCollectHistory(req);
    if (path === '/api/brief/history') return handleBriefHistory(req);
    if (path === '/api/queue/pending') return handleQueuePending(req);
    if (path === '/api/queue/stats') return handleQueueStats(req);
    if (path === '/api/queue/failed' || path === '/api/queue/dead') return handleQueueFailed(req);
    if (path === '/api/backup/latest') return handleBackupLatest(req);
    if (path === '/api/data/list') return handleDataList(req);
    if (path === '/api/data/stats') return handleDataStats(req);
    if (path === '/api/audit' || path === '/api/audit/count') return handleAuditList(req);
    if (path === '/api/videos') return handleVideos(req);
    // GET /api/videos/:id 与 /:id/play（2026-09-14 云端补齐，此前 404 视频不能看）
    const videoPlayMatch = path.match(/^\/api\/videos\/(\d+)\/play$/);
    if (videoPlayMatch && method === 'GET') return handleVideoPlay(req, Number(videoPlayMatch[1]));
    const videoFavMatch = path.match(/^\/api\/videos\/(\d+)\/favorite$/);
    if (videoFavMatch && method === 'POST') return handleVideoFavorite(req, Number(videoFavMatch[1]));
    const videoIdMatch = path.match(/^\/api\/videos\/(\d+)$/);
    if (videoIdMatch && method === 'GET') return handleVideoById(req, Number(videoIdMatch[1]));
    if (path === '/api/hot') return handleHot(req);
    if (path === '/api/hot/events') return handleHotEvents(req);
    if (path === '/api/hot/categories') return handleHotCategories(req);
    if (path === '/api/hot/sources') return handleHotSources(req);
    if (path === '/api/hot/groups') return handleHotGroups(req);
    // GET /api/hot/events/:rank
    const hotEventRankMatch = path.match(/^\/api\/hot\/events\/(\d+)$/);
    if (hotEventRankMatch) return handleHotEventDetail(req, Number(hotEventRankMatch[1]));
    if (path === '/api/daily') return handleDaily(req);
    if (path === '/api/groups') return handleGroups(req);
    // P1-1 修复：源库列表（须先于 /api/sources 匹配，防被截胡）
    if (path === '/api/sources/library') return handleSourcesLibrary(req);
    if (path === '/api/sources') return handleSources(req);
    if (path === '/api/status') return handleStatus(req);
    if (path === '/api/status/daily-sources') return handleStatusDailySources();
    if (path === '/api/settings/daily') return handleDailySettingsGet(req);
    if (path === '/api/mybrief') return handleMyBrief(req);
    if (path === '/api/weekly/archive' && method === 'GET') return jsonOk({ archive: (await getSetting('weekly.archive', [])) || [] });
    if (path === '/api/weekly') return handleWeekly(req);
    if (path === '/api/sources/bilibili-diagnose') return handleBilibiliDiagnose(req);
    if (path === '/api/settings') return handleSettings(req);
    if (path === '/api/reading') return handleReading(req);
    if (path === '/api/meta') return handleMeta(req);
    if (path === '/api/img') return handleImg(req);
    // P1-2 修复：报警配置 + 日志（需鉴权）
    if (path === '/api/alerts/config') return handleAlertsConfig(req);
    if (path === '/api/alerts/log') return handleAlertsLog(req);
  }

  return { status: 404, body: jsonErr('Not Found') };
}

// ─── Serverless 入口 ───
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // 解析 query string（Vercel 已提供 req.query）
  // 解析 body（Vercel 自动解析 JSON body）

  // 鉴权检查
  const authErr = requireAuth(req);
  if (authErr) return res.status(authErr.status).json(authErr.body);

  try {
    const result = await dispatch(req);
    if (result && result.raw) {
      // 二进制响应（图片代理）
      for (const [k, v] of Object.entries(result.headers || {})) res.setHeader(k, v);
      return res.status(200).send(result.body);
    }
    if (result && result.status) {
      return res.status(result.status).json(result.body);
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error(`[api] ${err.message}`, err.stack);
    return res.status(500).json(jsonErr(err.message));
  }
};
