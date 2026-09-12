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
  '/api/groups', '/api/sources', '/api/status', '/api/settings', '/api/settings/daily',
  '/api/reading', '/api/img', '/api/meta',
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
  // 登录端点必须豁免：否则没有 token 永远拿不到 token（鸡生蛋死锁）
  // [2026-09-11 P1-10 真根因] 此前登录 401 报 "Unauthorized" 来自本中间件而非 handleLogin，
  // 与 ADMIN_PASSWORD 值无关——改密码永远修不好
  if (path === '/api/auth/login' && req.method === 'POST') return null;
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

// GET /api/articles/since?ts=<ISO> — 增量计数（无感刷新轮询专用，返回极小）
// ts 为空 = 建立基线（只回当前最新 sortKey，不计数）
async function handleArticlesSince(req) {
  const q = req.query;
  const NOISE = "s.type != 'hotlist' AND COALESCE(json_extract(COALESCE(s.extra,'{}'),'$.aggregator'),0) != 1";
  const conds = [];
  const args = [];
  const ts = String(q.ts || '');
  if (ts) { conds.push('COALESCE(a.published_at, a.created_at) > ?'); args.push(ts); }
  if (q.include_hot !== '1') conds.push(NOISE);
  if (q.source_id) { conds.push('a.source_id=?'); args.push(Number(q.source_id)); }
  if (q.group_id) { conds.push('s.group_id=?'); args.push(Number(q.group_id)); }
  if (q.tab === 'later') conds.push('a.later=1');
  else if (q.tab === 'history') conds.push('a.read_at IS NOT NULL');
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const row = await qOne(
    `SELECT COUNT(*) c, MAX(COALESCE(a.published_at, a.created_at)) latest
     FROM articles a JOIN sources s ON s.id=a.source_id ${where}`, args);
  return jsonOk({ newCount: ts ? (row.c || 0) : 0, latest: row.latest || null });
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

// GET /api/hot — 支持 tab/category/q/source 筛选 + 游标分页
async function handleHot(req) {
  const q = req.query;
  const tab = q.tab || 'all';
  const category = q.category || '';
  const searchQ = (q.q || '').trim();
  const source = q.source || '';
  const PAGE_SIZE = 200;

  const conds = [];
  const args = [];

  if (tab === 'featured') {
    // 精选：高分热榜条目（score > 10000 或标记 focus）
    conds.push("s.type='hotlist'");
    conds.push('(a.score > 10000 OR COALESCE(s.focus,0)=1)');
    if (category) {
      conds.push('a.category=?');
      args.push(category);
    }
  } else {
    // 全部动态：所有热榜源条目
    conds.push("s.type='hotlist'");
  }

  // 全部动态 Tab 筛选
  if (searchQ) {
    conds.push('(a.title LIKE ? OR a.summary LIKE ?)');
    args.push(`%${searchQ}%`, `%${searchQ}%`);
  }
  if (source) {
    conds.push('s.name=?');
    args.push(source);
  }

  // 时间窗口：近 3 天
  conds.push("a.published_at >= datetime('now', '-3 days')");

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

  // 排序：精选按热度；全部动态按全局时间序（2026-09-11 修复：原来按 score 排导致同源成块）
  const orderBy = tab === 'featured'
    ? 'a.score DESC NULLS LAST, a.published_at DESC, a.id DESC'
    : 'a.published_at DESC, a.id DESC';
  const rows = await qAll(
    `SELECT a.id, a.title, a.url, a.author, a.cover, a.summary, a.score, a.published_at, a.category, a.later, s.name AS source_name
     FROM articles a JOIN sources s ON s.id=a.source_id
     ${where}${cursorCond}
     ORDER BY ${orderBy} LIMIT ?`,
    [...args, ...cursorArgs, PAGE_SIZE + 1]
  );

  let nextCursor = null;
  if (rows.length > PAGE_SIZE) {
    rows.pop();
    const last = rows[rows.length - 1];
    const sortVal = new Date(last.published_at || last.created_at).getTime() / 1000;
    nextCursor = `${sortVal}|${last.id}`;
  }

  // 格式化热度值
  const items = rows.map(r => ({ ...r, scoreFormatted: formatHeat(r.score) }));
  return jsonOk({ items, nextCursor });
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
const EVENTS_CACHE_MS = 10 * 60e3; // 10 分钟缓存

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
       ORDER BY a.published_at DESC
       LIMIT 500`,
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

// ─── 日报生成核心（供 handleDaily getOrGenerate 复用） ───
const DAILY_COLUMNS = [
  { id: 'c1', name: '培训课程发布', desc: '课程/训练营/社群招募', keywords: ['课程', '训练营', '社群', '招募', '培训'] },
  { id: 'focus', name: '重点更新', special: 'focus' },
  { id: 'c2', name: 'AI技术', desc: 'Codex/Claude/Agent/模型等', keywords: ['Codex', 'Claude', '豆包', 'Agent', '模型', '自动化', 'RAG', 'MCP'] },
  { id: 'fallback', name: '其它重要', special: 'fallback' },
];
const DAILY_SOURCE_TYPES = ['wechat', 'rss', 'x'];

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
  return { id: a.id, title: a.title, url: a.url, source: a.source_name, published_at: a.published_at, score: a.score, summary: (a.summary || '').slice(0, 200), cover: a.cover };
}

async function generateDailyInline() {
  const now = new Date();
  const bjOffset = 8 * 3600e3;
  const bjNow = new Date(now.getTime() + bjOffset);
  const todayStart = new Date(bjNow); todayStart.setUTCHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 3600e3);
  const todaySixAM = new Date(todayStart.getTime() + 6 * 3600e3);
  const cutoff = new Date(yesterdayStart.getTime() - bjOffset).toISOString();
  const cutoffEnd = new Date(todaySixAM.getTime() - bjOffset).toISOString();

  const columns = await getSetting('daily.columns', null) || DAILY_COLUMNS;
  const cfg = await getSetting('daily', {});
  const selectedIds = Array.isArray(cfg.articleSourceIds) ? cfg.articleSourceIds.map(Number) : null;

  let sql = `SELECT a.*, s.name AS source_name, s.focus AS source_focus
             FROM articles a LEFT JOIN sources s ON s.id = a.source_id
             WHERE a.published_at >= ? AND a.published_at <= ? AND s.enabled = 1
               AND s.type IN (${DAILY_SOURCE_TYPES.map(() => '?').join(',')})`;
  const args = [cutoff, cutoffEnd, ...DAILY_SOURCE_TYPES];
  if (selectedIds && selectedIds.length) {
    sql += ` AND a.source_id IN (${selectedIds.map(() => '?').join(',')})`;
    args.push(...selectedIds);
  }
  sql += " AND s.type != 'hotlist' AND COALESCE(json_extract(COALESCE(s.extra,'{}'),'$.aggregator'),0) != 1";
  sql += ' ORDER BY a.published_at DESC LIMIT 500';

  const candidates = await qAll(sql, args);
  // 简单安检
  const valid = candidates.filter(a => {
    const t = String(a.title || '');
    return t.length >= 6 && !/参数错误|环境异常|访问过于频繁/.test(t);
  });

  const sections = [];
  const used = new Set();
  for (const col of columns) {
    const items = [];
    if (col.special === 'focus') {
      for (const a of valid) { if (!used.has(a.id) && a.source_focus) { items.push(dailyFormatItem(a)); used.add(a.id); } }
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

  const stats = { candidates: valid.length, articles: valid.length, sections: sections.length, totalItems: sections.reduce((n, s) => n + s.items.length, 0) };
  const windowH = Math.round((Date.parse(cutoffEnd) - Date.parse(cutoff)) / 3600e3);
  await qRun('INSERT INTO daily_reports(generated_at, window_hours, stats, sections) VALUES(?, ?, ?, ?)',
    [nowIso(), windowH, JSON.stringify(stats), JSON.stringify(sections)]);
  return { generated_at: nowIso(), stats, sections };
}

// GET /api/daily（含 getOrGenerate：当日无日报且已过 9:00 北京时间则自动生成）
async function handleDaily(req) {
  const row = await qOne('SELECT * FROM daily_reports ORDER BY generated_at DESC LIMIT 1');

  // 检查是否需要自动生成
  if (row) {
    const genDate = new Date(row.generated_at);
    const now = new Date();
    // 同一天（UTC）则直接返回
    if (genDate.toDateString() === now.toDateString()) {
      let sections = [];
      try { sections = JSON.parse(row.sections || '[]'); } catch { /* 无效 JSON */ }
      let stats = {};
      try { stats = JSON.parse(row.stats || '{}'); } catch { /* 无效 JSON */ }
      return jsonOk({
        report: { id: row.id, generated_at: row.generated_at, window_hours: row.window_hours, sections, stats },
        stale: false,
      });
    }
  }

  // 判断是否已过生成时间（北京时间 9:00）
  const now = new Date();
  const bjNow = new Date(now.getTime() + 8 * 3600e3);
  const hour = bjNow.getUTCHours();
  if (hour >= 1) { // UTC 1:00 = 北京 9:00
    try {
      const report = await generateDailyInline();
      return jsonOk({ report: { generated_at: report.generated_at, sections: report.sections, stats: report.stats }, stale: false, autoGenerated: true });
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

  // P1-5 修复：libsql client 在无数据时可能返回字符串 "null" 而非 JS null，显式归一化
  const rssLastRaw = (await qOne("SELECT MAX(last_fetched_at) t FROM sources WHERE type IN ('wechat','rss','wemp','x','youtube')")).t;
  const biliLastRaw = (await qOne("SELECT MAX(last_fetched_at) t FROM sources WHERE type='bilibili'")).t;
  const rssLast = (rssLastRaw === 'null' || rssLastRaw === undefined) ? null : rssLastRaw;
  const biliLast = (biliLastRaw === 'null' || biliLastRaw === undefined) ? null : biliLastRaw;

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
  const queue = await getSetting('queue', {});
  const data = await getSetting('data', {});
  const hot = await getSetting('hot', {});
  const views = await getSetting('reader.views', []);
  const aiCfg = await getSetting('ai', {});
  // 凭据存在性（不落值）
  const creds = await qAll('SELECT platform, cookie FROM credentials');
  const credSet = new Set(creds.filter((c) => c.cookie).map((c) => c.platform));
  // queue.token 脱敏：只回是否已配置（与本地 maskSection 一致）
  const queueOut = { intervalMin: 10, enabled: false, ...queue };
  if ('token' in queueOut) { queueOut.tokenConfigured = !!queueOut.token; delete queueOut.token; }
  return jsonOk({
    intervals: { opml: 12, rss: 0.5, bilibili: 60, douyin: 360, queue: 10, ...intervals },
    opml: { url: await getSetting('opml.url', ''), enabled: await getSetting('opml.enabled', true) },
    queue: queueOut,
    daily: { time: '08:00', windowHours: 48, ...daily },
    data: { retentionDays: 7, ...data },
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
  const tab = q.tab || 'all';
  const type = q.type || 'all';
  const searchQ = (q.q || '').trim();
  const PAGE_SIZE = 30;

  // 文章侧条件
  const aConds = [];
  const aArgs = [];
  if (tab === 'all') aConds.push('(a.read_at IS NOT NULL OR a.later = 1)');
  else if (tab === 'favorited') aConds.push('a.later = 1');
  else if (tab === 'read') aConds.push('a.read_at IS NOT NULL');
  if (type === 'article') aConds.push("s.type IN ('wechat','rss','x')");
  else if (type === 'podcast') aConds.push("s.type = 'douyin'");
  if (searchQ) {
    aConds.push('(a.title LIKE ? OR s.name LIKE ?)');
    aArgs.push(`%${searchQ}%`, `%${searchQ}%`);
  }

  // 视频侧条件
  const vConds = [];
  const vArgs = [];
  if (tab === 'all') vConds.push('v.favorite = 1');
  else if (tab === 'favorited') vConds.push('v.favorite = 1');
  if (type === 'article' || type === 'podcast') vConds.push('0');
  if (searchQ && type !== 'article' && type !== 'podcast') {
    vConds.push('(v.title LIKE ? OR s.name LIKE ?)');
    vArgs.push(`%${searchQ}%`, `%${searchQ}%`);
  }

  const aWhere = aConds.length ? `WHERE ${aConds.join(' AND ')}` : 'WHERE 0';
  const vWhere = vConds.length ? `WHERE ${vConds.join(' AND ')}` : 'WHERE 0';

  // 计数（受 type/q 影响）
  const counts = { all: 0, favorited: 0, read: 0 };
  const qLike = searchQ ? `%${searchQ}%` : null;

  // 文章侧计数
  const aTypeCond = type === 'article' ? "AND s.type IN ('wechat','rss','x')"
    : type === 'podcast' ? "AND s.type = 'douyin'"
    : type === 'video' ? 'AND 0'
    : '';
  const aQCond = qLike ? ' AND (a.title LIKE ? OR s.name LIKE ?)' : '';
  if (aTypeCond !== 'AND 0') {
    const countArgs = qLike ? [qLike, qLike] : [];
    const row = await qOne(`
      SELECT
        SUM(CASE WHEN a.read_at IS NOT NULL OR a.later = 1 THEN 1 ELSE 0 END) AS total,
        SUM(CASE WHEN a.later = 1 THEN 1 ELSE 0 END) AS fav,
        SUM(CASE WHEN a.read_at IS NOT NULL THEN 1 ELSE 0 END) AS rd
      FROM articles a LEFT JOIN sources s ON s.id = a.source_id
      WHERE 1=1 ${aTypeCond} ${aQCond}
    `, countArgs);
    counts.all += (row?.total || 0);
    counts.favorited += (row?.fav || 0);
    counts.read += (row?.rd || 0);
  }

  // 视频侧计数
  if (type === 'all' || type === 'video') {
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

  // 游标分页
  let cursorCond = '';
  const cursorArgs = [];
  if (q.cursor) {
    cursorCond = ' AND sort_key < ?';
    cursorArgs.push(String(q.cursor));
  }

  const rows = await qAll(`
    SELECT * FROM (
      SELECT
        a.id, 'article' AS item_type, a.title, a.url, a.cover, a.summary,
        COALESCE(a.published_at, a.created_at) AS date,
        s.name AS source_name, s.type AS source_type, s.avatar AS source_avatar,
        a.read_at, a.later, 0 AS favorite, a.tags,
        COALESCE(a.published_at, a.created_at) AS sort_key
      FROM articles a LEFT JOIN sources s ON s.id = a.source_id
      ${aWhere}
      UNION ALL
      SELECT
        v.id, 'video' AS item_type, v.title, v.url, v.cover, v.intro AS summary,
        v.published_at AS date,
        s.name AS source_name, s.type AS source_type, s.avatar AS source_avatar,
        NULL AS read_at, 0 AS later, v.favorite, NULL AS tags,
        v.published_at AS sort_key
      FROM videos v LEFT JOIN sources s ON s.id = v.source_id
      ${vWhere}
    ) combined
    WHERE 1=1 ${cursorCond}
    ORDER BY sort_key DESC, id DESC
    LIMIT ?
  `, [...aArgs, ...vArgs, ...cursorArgs, PAGE_SIZE + 1]);

  let nextCursor = null;
  let items = rows;
  if (rows.length > PAGE_SIZE) {
    items = rows.slice(0, PAGE_SIZE);
    const last = items[items.length - 1];
    if (last && last.sort_key) nextCursor = last.sort_key;
  }

  return jsonOk({ items, nextCursor, counts });
}

// POST /api/articles/read-all — 按当前过滤条件全部标为已读
async function handleArticlesReadAll(req) {
  const body = req.body || {};
  const conds = [];
  const args = [];

  const NOISE = "s.type != 'hotlist' AND COALESCE(json_extract(COALESCE(s.extra,'{}'),'$.aggregator'),0) != 1";
  conds.push(NOISE);

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
  const lastArticle = await qOne('SELECT MAX(created_at) t FROM articles');
  return jsonOk({ articles, videos, sources, lastUpdated: lastArticle.t });
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
      features: await getSetting('ai.features', { translate: true, summary: true, classify: false, analyze: false }),
    });
  }
  if (req.method === 'PUT') {
    const body = req.body || {};
    const cur = await getSetting('ai', {});
    const next = { ...cur };
    if (body.model !== undefined) next.model = String(body.model).trim();
    if (body.apiBase !== undefined) next.apiBase = String(body.apiBase).trim();
    if (body.apiKey && body.apiKey.trim()) next.apiKey = body.apiKey.trim();
    if (body.features && typeof body.features === 'object') {
      await setSetting('ai.features', body.features);
    }
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
  const cfg = await getSetting('ai', {});
  const chain = await aiProviderChain(cfg);
  if (!chain.length) return { ok: false, error: '未配置 API Key' };
  let lastErr = '';
  for (const p of chain) {
    try {
      const resp = await fetch(`${p.base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p.key}` },
        // agnes-2.5-flash 是推理模型：max_tokens 太小会被 reasoning 烧光导致 content 为空
        body: JSON.stringify({ model: modelOverride || p.model, messages, temperature, max_tokens: timeoutMs <= 20000 ? 64 : 512 }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!resp.ok) { lastErr = `${p.name} HTTP ${resp.status}`; continue; }
      const data = await resp.json();
      const msg = data?.choices?.[0]?.message || {};
      // 推理模型兜底：content 为空时回退 reasoning_content / 检查 finish_reason
      const content = msg.content || msg.reasoning_content || '';
      if (!content.trim()) { lastErr = `${p.name} 返回空内容(finish=${data?.choices?.[0]?.finish_reason || '?'})`; continue; }
      return { ok: true, reply: content, provider: p.name, model: modelOverride || p.model };
    } catch (err) {
      lastErr = `${p.name}: ${err.message}`;
    }
  }
  return { ok: false, error: lastErr };
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
const EXTRA_PUBLIC_KEYS = ['intervalMin', 'lastError', 'lastErrorAt', 'marksFeatured', 'aggregator', 'domain', 'etag', 'lastModified', 'categoryLocked', 'origin'];
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
  const channels = Array.isArray(cfg.channels) ? cfg.channels.map(c => {
    const masked = { ...c };
    for (const k of SENSITIVE_KEYS) {
      if (masked[k]) masked[k] = masked[k].slice(0, 4) + '****';
    }
    return masked;
  }) : [];
  return jsonOk({
    channels,
    events: cfg.events || {},
    cooldownMin: cfg.cooldownMin || 120,
    eventMeta: {
      fuse: '源熔断', stall: '采集停滞', queue: '队列异常', error: '系统错误'
    },
  });
}

// ─── P1-2: GET /api/alerts/log — 最近报警记录 ───
async function handleAlertsLog(req) {
  const cfg = await getSetting('alerts', {});
  return jsonOk({ log: Array.isArray(cfg.recentLog) ? cfg.recentLog : [] });
}

// ─── P1-11: POST /api/daily/regenerate — 手动重新生成日报 ───
async function handleDailyRegenerate(req) {
  // 删除今日已有日报（北京时间判断）
  const now = new Date();
  const bjNow = new Date(now.getTime() + 8 * 3600e3);
  const todayStr = bjNow.toISOString().slice(0, 10);
  try {
    await qRun(
      "DELETE FROM daily_reports WHERE generated_at >= ? AND generated_at < ?",
      [`${todayStr}T00:00:00.000Z`, `${todayStr}T23:59:59.999Z`]
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
    return mm ? mm[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '';
  };
  while ((m = re.exec(xml))) {
    const xmlUrl = attr(m[0], 'xmlUrl');
    if (xmlUrl) outlines.push({ name: attr(m[0], 'text') || attr(m[0], 'title') || xmlUrl, url: xmlUrl });
  }
  return outlines;
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
  { table: 'articles', col: 'COALESCE(published_at, created_at)' },
  { table: 'videos', col: 'COALESCE(published_at, created_at)' },
  { table: 'pending_items', col: 'imported_at' },
  { table: 'daily_reports', col: 'generated_at' },
];

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
  const b = await getSetting('backup.latest', null);
  return jsonOk({ backups: [], note: '云端 Turso 不支持文件型快照；配置备份见 /api/backup', configBackup: b ? { name: b.name, at: b.at } : null });
}

// POST /api/data/cleanup/preview {days}
async function handleDataCleanupPreview(req) {
  try {
    const cutoff = cutoffIso((req.body || {}).days);
    const willDelete = {};
    let total = 0;
    for (const { table, col } of CLEAN_TABLES) {
      const n = (await qOne(`SELECT COUNT(*) c FROM ${table} WHERE ${col} < ?`, [cutoff])).c;
      willDelete[table] = n;
      total += n;
    }
    return jsonOk({ days: Number((req.body || {}).days), cutoff, willDelete, total });
  } catch (err) {
    return { status: 400, body: jsonErr(err.message) };
  }
}

// POST /api/data/cleanup {days, confirm:true}
async function handleDataCleanup(req) {
  const body = req.body || {};
  if (body.confirm !== true) return { status: 400, body: jsonErr('需 confirm:true 确认执行') };
  try {
    const cutoff = cutoffIso(body.days);
    const deleted = {};
    let total = 0;
    for (const { table, col } of CLEAN_TABLES) {
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

const DAILY_DEFAULT_COLUMNS = [
  { id: 'c1', name: '培训课程发布', desc: '课程/训练营/社群招募', keywords: ['课程', '训练营', '社群', '招募', '培训'] },
  { id: 'focus', name: '重点更新', special: 'focus' },
  { id: 'c2', name: 'AI技术', desc: 'Codex/Claude/Agent/模型等', keywords: ['Codex', 'Claude', '豆包', 'Agent', '模型', '自动化', 'RAG', 'MCP'] },
  { id: 'fallback', name: '其它重要', special: 'fallback' },
];
const DAILY_ARTICLE_TYPES = ['wechat', 'rss', 'x'];
const DAILY_VIDEO_TYPES = ['bilibili', 'douyin', 'youtube'];

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
function sanitizeColumns(cols) {
  if (!Array.isArray(cols) || !cols.length) throw new Error('columns 必须是非空数组');
  return cols.map((c, i) => {
    const out = { id: c.id || `c${Date.now()}_${i}`, name: String(c.name || '').trim() };
    if (!out.name) throw new Error('栏目名称不能为空');
    if (c.special === 'focus' || c.special === 'fallback') {
      out.special = c.special;
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
      `SELECT id, type, name, focus FROM sources WHERE type IN (${types.map(() => '?').join(',')}) ORDER BY id`, types);
    return rows.map((s) => ({
      id: s.id, type: s.type, name: s.name, focus: !!s.focus,
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

// PUT /api/settings/daily — 窗口/时间/来源勾选/focus/栏目
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
  // focus 两种写法（与本地一致：focusSourceIds 全量替换；focus 对象局部增量）
  if (body.focusSourceIds !== undefined) {
    if (!Array.isArray(body.focusSourceIds)) return { status: 400, body: jsonErr('focusSourceIds 必须是数组') };
    const ids = body.focusSourceIds.map(Number);
    await qRun(
      'UPDATE sources SET focus = CASE WHEN id IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END',
      [JSON.stringify(ids)]
    );
  } else if (body.focus && typeof body.focus === 'object') {
    const stmts = Object.entries(body.focus).map(([id, v]) => ({
      sql: 'UPDATE sources SET focus=? WHERE id=?', args: [v ? 1 : 0, Number(id)],
    }));
    if (stmts.length) await getDb().batch(stmts, 'write');
  }
  // 栏目管理
  if (body.restoreDefaultColumns) await setSetting('daily.columns', DAILY_DEFAULT_COLUMNS);
  else if (columns) await setSetting('daily.columns', columns);
  await auditRecord('daily.settings', { detail: { keys: Object.keys(body) } });
  return jsonOk({});
}

// ─── 路由分发 ───
async function dispatch(req) {
  const path = req.url.split('?')[0];
  const method = req.method;

  // POST /api/auth/login
  if (path === '/api/auth/login' && method === 'POST') return handleLogin(req);

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
    if (path === '/api/queue/pending') return handleQueuePending(req);
    if (path === '/api/queue/stats') return handleQueueStats(req);
    if (path === '/api/queue/failed' || path === '/api/queue/dead') return handleQueueFailed(req);
    if (path === '/api/backup/latest') return handleBackupLatest(req);
    if (path === '/api/data/list') return handleDataList(req);
    if (path === '/api/data/stats') return handleDataStats(req);
    if (path === '/api/audit' || path === '/api/audit/count') return handleAuditList(req);
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
    // P1-1 修复：源库列表（须先于 /api/sources 匹配，防被截胡）
    if (path === '/api/sources/library') return handleSourcesLibrary(req);
    if (path === '/api/sources') return handleSources(req);
    if (path === '/api/status') return handleStatus(req);
    if (path === '/api/settings/daily') return handleDailySettingsGet(req);
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
