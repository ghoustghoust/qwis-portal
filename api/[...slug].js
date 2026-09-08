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
  '/api/articles', '/api/videos', '/api/hot', '/api/daily',
  '/api/groups', '/api/sources', '/api/status', '/api/settings',
  '/api/reading', '/api/img',
  '/api/hot/events', '/api/hot/categories', '/api/hot/sources',
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
  // 公开 GET 请求不需要鉴权（含 /api/articles/:id）
  if (req.method === 'GET') {
    if (PUBLIC_GET_PATHS.has(path)) return null;
    if (/^\/api\/articles\/\d+$/.test(path)) return null;
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

  // 阅读器降噪：排除热榜/聚合源
  const NOISE = "s.type != 'hotlist' AND COALESCE(json_extract(COALESCE(s.extra,'{}'),'$.aggregator'),0) != 1";

  if (tab === 'later') conds.push('a.later=1');
  else if (tab === 'history') conds.push('a.read_at IS NOT NULL');

  if (q.source_id) { conds.push('a.source_id=?'); args.push(Number(q.source_id)); }
  else if (q.include_hot !== '1') conds.push(NOISE);

  if (q.group_id) { conds.push('s.group_id=?'); args.push(Number(q.group_id)); }
  if (q.q) { conds.push('(a.title LIKE ? OR a.content_html LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) { conds.push('COALESCE(a.published_at, a.created_at) >= ?'); args.push(`${q.from}T00:00:00.000Z`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) { conds.push('COALESCE(a.published_at, a.created_at) <= ?'); args.push(`${q.to}T23:59:59.999Z`); }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const orderExpr = sort === 'smart'
    ? '(unixepoch(COALESCE(a.published_at,a.created_at)) + COALESCE(s.focus,0)*259200)'
    : 'COALESCE(a.published_at, a.created_at)';

  // 游标分页
  let cursorCond = '';
  if (q.cursor) {
    const [cursorVal, cursorId] = q.cursor.split('|');
    if (cursorVal && cursorId) {
      const op = dir === 'DESC' ? '<' : '>';
      cursorCond = ` AND (${orderExpr} ${op} ? OR (${orderExpr} = ? AND a.id ${op} ?))`;
      args.push(cursorVal, cursorVal, Number(cursorId));
    }
  }

  const fields = `a.id, a.source_id, a.title, a.url, a.author, a.cover, a.summary,
    a.published_at, a.read_at, a.later, a.created_at, s.name AS source_name,
    s.focus AS source_focus, a.score, a.tags, a.reason, a.word_count`;

  const rows = await qAll(
    `SELECT ${fields} FROM articles a JOIN sources s ON s.id=a.source_id ${where}${cursorCond} ORDER BY ${orderExpr} ${dir}, a.id ${dir} LIMIT ?`,
    [...args, PAGE_SIZE + 1]
  );

  let nextCursor = null;
  if (rows.length > PAGE_SIZE) {
    rows.pop();
    const last = rows[rows.length - 1];
    const sortVal = sort === 'smart'
      ? (new Date(last.published_at || last.created_at).getTime() / 1000 + (last.source_focus || 0) * 259200)
      : new Date(last.published_at || last.created_at).getTime() / 1000;
    nextCursor = `${sortVal}|${last.id}`;
  }

  // 计数（轻量级：只查 later/history 总数，不做 NOT EXISTS 子查询）
  const laterCount = (await qOne('SELECT COUNT(*) c FROM articles WHERE later=1')).c;
  const historyCount = (await qOne('SELECT COUNT(*) c FROM articles WHERE read_at IS NOT NULL')).c;

  return jsonOk({ items: rows, nextCursor, counts: { later: laterCount, history: historyCount } });
}

// GET /api/articles/:id — 单篇文章详情（含 content_html）
async function handleArticleById(req, id) {
  const row = await qOne(
    `SELECT a.*, s.name AS source_name, s.focus AS source_focus, s.avatar AS source_avatar
     FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.id=?`,
    [id]
  );
  if (!row) return { status: 404, body: jsonErr('Article not found') };
  // 顺手标记已读
  await qRun('UPDATE articles SET read_at=COALESCE(read_at, ?) WHERE id=? AND read_at IS NULL', [nowIso(), id]);
  return jsonOk({ item: row });
}

// GET /api/videos
async function handleVideos(req) {
  const q = req.query;
  const PAGE_SIZE = 30;
  const conds = [];
  const args = [];
  if (q.source_id) { conds.push('v.source_id=?'); args.push(Number(q.source_id)); }
  if (q.platform) { conds.push('v.platform=?'); args.push(q.platform); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await qAll(
    `SELECT v.*, s.name AS source_name FROM videos v JOIN sources s ON s.id=v.source_id ${where} ORDER BY COALESCE(v.published_at, v.created_at) DESC LIMIT ?`,
    [...args, PAGE_SIZE]
  );
  return jsonOk({ items: rows });
}

// GET /api/hot
async function handleHot(req) {
  // 返回热榜源的最新条目
  const rows = await qAll(
    `SELECT a.id, a.title, a.url, a.author, a.cover, a.summary, a.score, a.published_at, a.category, s.name AS source_name
     FROM articles a JOIN sources s ON s.id=a.source_id
     WHERE s.type='hotlist' AND a.published_at >= datetime('now', '-3 days')
     ORDER BY a.score DESC NULLS LAST, a.published_at DESC LIMIT 200`
  );
  // 格式化热度值
  const items = rows.map(r => ({ ...r, scoreFormatted: formatHeat(r.score) }));
  return jsonOk({ items });
}

// GET /api/hot/categories — 分类清单
async function handleHotCategories(req) {
  const CATEGORIES = ['模型', '产品', '行业', '论文', '教程', '观点'];
  // 先尝试从 settings 读自定义分类
  const custom = await getSetting('hot.categories', null);
  if (custom && typeof custom === 'object' && !Array.isArray(custom)) {
    return jsonOk({ categories: Object.keys(custom) });
  }
  return jsonOk({ categories: CATEGORIES });
}

// GET /api/hot/sources — 聚合源计数
async function handleHotSources(req) {
  const rows = await qAll(
    `SELECT a.author, COUNT(*) AS count
     FROM articles a JOIN sources s ON s.id=a.source_id
     WHERE json_extract(COALESCE(s.extra,'{}'),'$.aggregator')=1
     GROUP BY a.author ORDER BY count DESC`
  );
  const sources = rows.map(r => {
    const s = String(r.author || '').trim();
    const m = s.match(/\(([^()]*)\)\s*$/);
    const feedName = m ? m[1].trim() : s;
    return { author: r.author, feedName, count: r.count };
  });
  return jsonOk({ sources });
}

// ─── 事件聚合引擎（从 server/services/events.js 移植） ───
const EVENTS_WINDOW_H = 72;
const EVENTS_HALF_LIFE_H = 24;
const EVENTS_SIM_THRESHOLD = 0.4;
let _eventsCache = { at: 0, events: null };
const EVENTS_CACHE_MS = 5 * 60e3;

function titleTokens(title) {
  const set = new Set();
  const t = String(title || '').toLowerCase();
  // 中文：逐字 unigram + bigram
  const cjk = t.match(/[\u4e00-\u9fff]+/g) || [];
  for (const seg of cjk) {
    for (const ch of seg) { if (ch.trim()) set.add(ch); }
    for (let i = 0; i < seg.length - 1; i++) set.add(seg.slice(i, i + 2));
  }
  // 英文：按空格分词
  const eng = t.match(/[a-z0-9]+/g) || [];
  for (const w of eng) { if (w.length >= 2) set.add(w); }
  return set;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) { if (b.has(t)) inter++; }
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

function aggregateEvents() {
  const nowMs = Date.now();
  const cutoff = new Date(nowMs - EVENTS_WINDOW_H * 3600e3).toISOString();
  // 这里用同步风格但实际是 async（在 handleHotEvents 中调用）
  return { cutoff, nowMs };
}

// GET /api/hot/events — 跨源事件聚合
async function handleHotEvents(req) {
  const domain = req.query.domain || 'all';
  // 缓存
  if (!_eventsCache.events || Date.now() - _eventsCache.at > EVENTS_CACHE_MS) {
    const nowMs = Date.now();
    const cutoff = new Date(nowMs - EVENTS_WINDOW_H * 3600e3).toISOString();
    const rows = await qAll(
      `SELECT a.id, a.title, a.url, a.summary, a.cover, a.published_at, a.score,
              a.category, a.source_id, s.name AS source_name, s.type AS source_type, g.name AS domain
       FROM articles a
       JOIN sources s ON s.id = a.source_id AND s.enabled = 1
       LEFT JOIN groups g ON g.id = s.group_id
       WHERE a.published_at >= ?
       ORDER BY a.published_at DESC`,
      [cutoff]
    );
    const items = rows.filter(r => (r.title || '').trim().length >= 6);

    // Jaccard 聚类
    const clusters = [];
    for (const item of items) {
      const tokens = titleTokens(item.title);
      if (!tokens.size) continue;
      let hit = null;
      for (const c of clusters) {
        if (jaccard(tokens, c.tokens) >= EVENTS_SIM_THRESHOLD) { hit = c; break; }
      }
      if (!hit) {
        clusters.push({ tokens, items: [item], sourceIds: new Set([item.source_id]) });
      } else {
        hit.items.push(item);
        hit.sourceIds.add(item.source_id);
        for (const t of tokens) hit.tokens.add(t);
      }
    }

    const events = [];
    for (const c of clusters) {
      if (c.items.length < 2) continue;
      const times = c.items.map(i => Date.parse(String(i.published_at || ''))).filter(t => Number.isFinite(t) && t > 0);
      const firstAt = times.length ? Math.min(...times) : nowMs;
      const latestAt = times.length ? Math.max(...times) : nowMs;
      // 领域归属
      const domainCount = new Map();
      for (const i of c.items) {
        const d = i.domain || i.category || '其它';
        domainCount.set(d, (domainCount.get(d) || 0) + 1);
      }
      const evDomain = [...domainCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
      // 热度计算
      let heat = 0;
      for (const i of c.items) {
        const t = Date.parse(String(i.published_at || '')) || nowMs;
        const decay = Math.pow(0.5, Math.max(0, nowMs - t) / 3600e3 / EVENTS_HALF_LIFE_H);
        const scoreVal = Number(i.score);
        const w = 1 + Math.min(1, (Number.isFinite(scoreVal) ? scoreVal : 0) / 1e6);
        heat += w * decay;
      }
      heat *= Math.pow(1.5, c.sourceIds.size - 1);
      heat = Number.isFinite(heat) ? Math.round(heat * 10) / 10 : 0;
      // 状态
      const ageH = (nowMs - firstAt) / 3600e3;
      const freshH = (nowMs - latestAt) / 3600e3;
      let status = '收尾';
      if (ageH < 6) status = '新';
      else if (c.sourceIds.size >= 5 && freshH < 3) status = '爆';
      else if (ageH > 12 && freshH < 12) status = '发酵中';

      const rep = c.items.slice().sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''))[0];
      events.push({
        title: rep.title,
        domain: evDomain,
        heat: Math.round(heat * 10) / 10,
        heatFormatted: formatHeat(Math.round(heat * 10) / 10),
        sourceCount: c.sourceIds.size,
        reportCount: c.items.length,
        firstAt: new Date(firstAt).toISOString(),
        latestAt: new Date(latestAt).toISOString(),
        status,
        items: c.items
          .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''))
          .map(i => ({
            id: i.id, title: i.title, url: i.url,
            summary: (i.summary || '').slice(0, 200),
            cover: i.cover, published_at: i.published_at,
            score: i.score, scoreFormatted: formatHeat(i.score),
            source_name: i.source_name, source_type: i.source_type,
          })),
      });
    }
    events.sort((a, b) => b.heat - a.heat);
    // 添加 rank
    events.forEach((ev, idx) => { ev.rank = idx + 1; });
    _eventsCache = { at: Date.now(), events };
  }

  let result = _eventsCache.events;
  if (domain && domain !== 'all') {
    result = result.filter(e => e.domain === domain);
    // 重新编号
    result = result.map((e, idx) => ({ ...e, rank: idx + 1 }));
  }

  // 领域清单（从全量事件提取）
  const domains = [...new Set(_eventsCache.events.map(e => e.domain))].filter(Boolean).sort();
  return jsonOk({ events: result, domains });
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

// GET /api/daily
async function handleDaily(req) {
  const row = await qOne('SELECT * FROM daily_reports ORDER BY generated_at DESC LIMIT 1');
  if (!row) return jsonOk({ report: null, stale: false });
  let sections = [];
  try { sections = JSON.parse(row.sections || '[]'); } catch { /* 无效 JSON */ }
  let stats = {};
  try { stats = JSON.parse(row.stats || '{}'); } catch { /* 无效 JSON */ }
  return jsonOk({
    report: { id: row.id, generated_at: row.generated_at, window_hours: row.window_hours, sections, stats },
    stale: false,
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

// GET /api/sources
async function handleSources(req) {
  const rows = await qAll(
    `SELECT id, type, name, url, avatar, uid, group_id, focus, enabled, status,
     last_fetched_at, next_fetch_at, fail_count, created_at
     FROM sources ORDER BY enabled DESC, name`
  );
  return jsonOk({ sources: rows });
}

// GET /api/status（带 30s 进程内缓存）
const _statusCache = { val: null, ts: 0 };
const STATUS_CACHE_TTL = 30000;
async function handleStatus(req) {
  if (_statusCache.val && Date.now() - _statusCache.ts < STATUS_CACHE_TTL) return _statusCache.val;

  const intervals = { opml: 12, rss: 8, bilibili: 60, ...(await getSetting('intervals', {})) };

  const rssLast = (await qOne("SELECT MAX(last_fetched_at) t FROM sources WHERE type IN ('wechat','rss','x')")).t;
  const biliLast = (await qOne("SELECT MAX(last_fetched_at) t FROM sources WHERE type='bilibili'")).t;

  const NOISE = "(s.type='hotlist' OR COALESCE(json_extract(COALESCE(s.extra,'{}'),'$.aggregator'),0)=1)";
  const now = Date.now();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const weekAgo = new Date(now - 7 * 86400e3).toISOString();

  const overview = {
    enabledSources: (await qOne(`SELECT COUNT(*) c FROM sources s WHERE s.enabled=1 AND NOT ${NOISE}`)).c,
    unreadArticles: (await qOne(`SELECT COUNT(*) c FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.read_at IS NULL AND NOT ${NOISE}`)).c,
    todayNew: (await qOne(`SELECT COUNT(*) c FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.created_at >= ? AND NOT ${NOISE}`, [dayStart.toISOString()])).c,
    weekNew: (await qOne(`SELECT COUNT(*) c FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.created_at >= ? AND NOT ${NOISE}`, [weekAgo])).c,
  };

  const pausedCount = (await qOne('SELECT COUNT(*) c FROM sources WHERE enabled=0 AND COALESCE(fail_count,0)>=3')).c;

  const result = jsonOk({
    intervals, lastSync: { rss: rssLast, bilibili: biliLast },
    overview, pausedSources: { count: pausedCount },
  });
  _statusCache.val = result;
  _statusCache.ts = Date.now();
  return result;
}

// GET /api/settings
async function handleSettings(req) {
  const daily = await getSetting('daily', {});
  const intervals = await getSetting('intervals', {});
  return jsonOk({
    daily: {
      time: daily.time || '08:00',
      windowHours: daily.windowHours || 24,
      cocoonFamiliar: daily.cocoonFamiliar || [],
    },
    intervals,
  });
}

// GET /api/reading
async function handleReading(req) {
  const noise = "NOT EXISTS (SELECT 1 FROM sources s2 WHERE s2.id=articles.source_id AND (s2.type='hotlist' OR COALESCE(json_extract(COALESCE(s2.extra,'{}'),'$.aggregator'),0)=1))";
  const readCount = (await qOne(`SELECT COUNT(*) c FROM articles WHERE read_at IS NOT NULL AND ${noise}`)).c;
  const laterCount = (await qOne(`SELECT COUNT(*) c FROM articles WHERE later=1 AND ${noise}`)).c;
  return jsonOk({ counts: { read: readCount, later: laterCount, all: readCount + laterCount } });
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
  await qRun('UPDATE articles SET later=? WHERE id=?', [body.later ? 1 : 0, id]);
  return jsonOk({ ok: true });
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

// ─── 图片代理 GET /api/img ───
async function handleImg(req) {
  const url = req.query.url;
  if (!url) return { status: 400, body: jsonErr('Missing url') };
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { status: res.status, body: jsonErr(`Upstream ${res.status}`) };
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') || 'image/jpeg';
    return { raw: true, body: buf, headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' } };
  } catch (err) {
    return { status: 502, body: jsonErr(err.message) };
  }
}

// ─── 路由分发 ───
async function dispatch(req) {
  const path = req.url.split('?')[0];
  const method = req.method;

  // POST /api/auth/login
  if (path === '/api/auth/login' && method === 'POST') return handleLogin(req);

  // POST /api/articles/:id/read
  const readMatch = path.match(/^\/api\/articles\/(\d+)\/read$/);
  if (readMatch && method === 'POST') return handleArticleRead(req, Number(readMatch[1]));

  // POST /api/articles/:id/later
  const laterMatch = path.match(/^\/api\/articles\/(\d+)\/later$/);
  if (laterMatch && method === 'POST') return handleArticleLater(req, Number(laterMatch[1]));

  // POST /api/sources/:id/toggle
  const toggleMatch = path.match(/^\/api\/sources\/(\d+)\/toggle$/);
  if (toggleMatch && method === 'POST') return handleSourceToggle(req, Number(toggleMatch[1]));

  // GET 路由
  if (method === 'GET') {
    // GET /api/articles/:id 必须在 /api/articles 之前匹配
    const articleIdMatch = path.match(/^\/api\/articles\/(\d+)$/);
    if (articleIdMatch) return handleArticleById(req, Number(articleIdMatch[1]));
    if (path === '/api/articles') return handleArticles(req);
    if (path === '/api/videos') return handleVideos(req);
    if (path === '/api/hot') return handleHot(req);
    if (path === '/api/hot/events') return handleHotEvents(req);
    if (path === '/api/hot/categories') return handleHotCategories(req);
    if (path === '/api/hot/sources') return handleHotSources(req);
    // GET /api/hot/events/:rank
    const hotEventRankMatch = path.match(/^\/api\/hot\/events\/(\d+)$/);
    if (hotEventRankMatch) return handleHotEventDetail(req, Number(hotEventRankMatch[1]));
    if (path === '/api/daily') return handleDaily(req);
    if (path === '/api/groups') return handleGroups(req);
    if (path === '/api/sources') return handleSources(req);
    if (path === '/api/status') return handleStatus(req);
    if (path === '/api/settings') return handleSettings(req);
    if (path === '/api/reading') return handleReading(req);
    if (path === '/api/img') return handleImg(req);
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
