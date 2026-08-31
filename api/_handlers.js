// 全部 API 处理器(_ 前缀不计为 Serverless Function)
// 由 api/[...slug].js 单一入口路由分发;契约对齐主系统 server/routes/*
// 十一期 M3:读取路径优先 Turso(_cloud.js),无数据/出错回退 public/data 静态快照;响应结构不变
// 十一期 M4:/api/admin/* 管理后台(口令 cookie 鉴权) + 日报/事件榜云端化
const cloud = require('./_cloud');

const PAGE = 30;
const { titleTokens, jaccard, sortKey } = cloud;

// ---------- 工具 ----------
function sourceIndex(srcs) {
  const byName = new Map();
  for (const s of srcs) if (s.name && !byName.has(s.name)) byName.set(s.name, s);
  return byName;
}

function strip(r) {
  const { content_html, ...rest } = r;
  return rest;
}

function spanOf(list) {
  let min = null;
  let max = null;
  for (const r of list) {
    const k = sortKey(r);
    if (!k) continue;
    if (min === null || k < min) min = k;
    if (max === null || k > max) max = k;
  }
  return { min, max };
}

// sortKey|id 复合游标定位(与主系统同序:sortKey 方向 + id 方向)
function cursorStart(sorted, cursor, desc) {
  if (!cursor) return 0;
  const sep = String(cursor).lastIndexOf('|');
  if (sep > 0) {
    const k = String(cursor).slice(0, sep);
    const id = Number(String(cursor).slice(sep + 1));
    const i = sorted.findIndex((r) =>
      desc
        ? sortKey(r) < k || (sortKey(r) === k && r.id < id)
        : sortKey(r) > k || (sortKey(r) === k && r.id > id)
    );
    return i < 0 ? sorted.length : i;
  }
  const id = Number(cursor);
  const i = sorted.findIndex((r) => (desc ? r.id < id : r.id > id));
  return i < 0 ? sorted.length : i;
}

// ---------- /api/meta ----------
async function meta() {
  return { body: { ok: true, ...(await cloud.meta()) } };
}

// ---------- /api/daily ----------
async function daily() {
  if (cloud.IS_CLOUD) {
    try {
      const { report, fresh } = await require('./_daily').getOrGenerate();
      return { body: { ok: true, report, fresh } };
    } catch (e) {
      // 生成失败回退最近一次报告
      const latest = await require('./_daily').getLatest().catch(() => null);
      if (latest) return { body: { ok: true, report: latest, stale: true, error: e.message } };
      return { code: 500, body: { ok: false, error: e.message } };
    }
  }
  return { body: { ok: true, report: require('./_data').daily() } };
}
async function dailyRegenerate(method) {
  if (!cloud.IS_CLOUD) {
    return { code: 400, body: { ok: false, error: '云端为只读快照,请在主系统重新生成日报' } };
  }
  if (method !== 'POST') return { code: 405, body: { ok: false, error: 'method not allowed' } };
  try {
    const report = await require('./_daily').generate();
    return { body: { ok: true, report } };
  } catch (e) {
    return { code: 500, body: { ok: false, error: e.message } };
  }
}

// ---------- /api/articles ----------
async function articles(query) {
  const tab = query.tab || 'all';
  let list = await cloud.articles();
  // 阅读状态筛选(云端行带 read_at/later;快照行无此字段,tab 过滤自然为空)
  if (tab === 'later') list = list.filter((r) => !!r.later);
  else if (tab === 'history' || tab === 'read') list = list.filter((r) => !!r.read_at);
  else if (tab === 'unread') list = list.filter((r) => !r.read_at);
  const srcs = await cloud.sources();
  const byName = sourceIndex(srcs);
  if (query.source_id) {
    const sid = Number(query.source_id);
    list = list.filter((r) => (r.source_id != null ? Number(r.source_id) === sid : byName.get(r.source_name)?.id === sid));
  }
  if (query.group_id) {
    const gid = Number(query.group_id);
    list = list.filter((r) => {
      const s = r.source_id != null ? srcs.find((x) => Number(x.id) === Number(r.source_id)) : byName.get(r.source_name);
      return s && Number(s.group_id) === gid;
    });
  }
  if (query.domain) list = list.filter((r) => r.domain === query.domain);
  if (query.q) {
    const kw = String(query.q).toLowerCase();
    list = list.filter(
      (r) =>
        (r.title || '').toLowerCase().includes(kw) ||
        (r.summary || '').toLowerCase().includes(kw) ||
        (r.content_html || '').toLowerCase().includes(kw)
    );
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.from || '')) {
    list = list.filter((r) => sortKey(r) >= `${query.from}T00:00:00.000Z`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.to || '')) {
    list = list.filter((r) => sortKey(r) <= `${query.to}T23:59:59.999Z`);
  }
  const span = spanOf(list);
  const desc = query.sort !== 'old';
  const sorted = list.slice().sort((a, b) => {
    const c = sortKey(a).localeCompare(sortKey(b));
    if (c !== 0) return desc ? -c : c;
    return desc ? b.id - a.id : a.id - b.id;
  });

  // dedup=1:同事件合并(簇序号游标)
  if (query.dedup === '1') {
    const clusters = [];
    for (const r of sorted.slice(0, 500)) {
      const tokens = titleTokens(r.title);
      let hit = null;
      if (tokens.size) {
        for (const c of clusters) {
          if (jaccard(tokens, c.tokens) >= 0.5) { hit = c; break; }
        }
      }
      if (!hit) clusters.push({ rep: r, related: [], tokens });
      else {
        hit.related.push({ source_name: r.source_name, url: r.url, id: r.id });
        for (const t of tokens) hit.tokens.add(t);
        if (sortKey(r) > sortKey(hit.rep)) {
          hit.related.push({ source_name: hit.rep.source_name, url: hit.rep.url, id: hit.rep.id });
          hit.rep = r;
        }
      }
    }
    const offset = Number(query.cursor) || 0;
    const page = clusters.slice(offset, offset + PAGE).map((c) => ({
      ...strip(c.rep),
      sort_key: sortKey(c.rep),
      relatedCount: c.related.length,
      related: c.related,
    }));
    return {
      body: {
        ok: true,
        items: page,
        nextCursor: offset + PAGE < clusters.length ? String(offset + PAGE) : null,
        span,
        deduped: true,
        totalClusters: clusters.length,
      },
    };
  }

  const start = cursorStart(sorted, query.cursor, desc);
  const pageRows = sorted.slice(start, start + PAGE);
  const last = pageRows[pageRows.length - 1];
  return {
    body: {
      ok: true,
      items: pageRows.map((r) => ({ ...strip(r), sort_key: sortKey(r) })),
      nextCursor: start + PAGE < sorted.length && last ? `${sortKey(last)}|${last.id}` : null,
      span,
    },
  };
}

async function articleDetail(id) {
  const it = (await cloud.articles()).find((a) => String(a.id) === String(id));
  if (!it) return { code: 404, body: { ok: false, error: 'not found' } };
  // 与主系统一致:打开详情顺手置 read_at(入历史存档)
  if (cloud.IS_CLOUD && !it.read_at) {
    const turso = require('./_turso');
    await turso.dbRun('UPDATE articles SET read_at=? WHERE id=? AND read_at IS NULL', turso.nowIso(), Number(id)).catch(() => {});
    it.read_at = turso.nowIso();
    cloud.invalidate('articles');
  }
  return { body: { ok: true, item: it } };
}

// ---------- 已读/稍后读云端持久化(P0,读者端公开,与主系统语义一致) ----------
// POST /api/articles/:id/read
async function articleMarkRead(id) {
  if (!cloud.IS_CLOUD) return { body: { ok: true, read: 1 } };
  const turso = require('./_turso');
  const r = await turso.dbRun('UPDATE articles SET read_at=COALESCE(read_at, ?) WHERE id=?', turso.nowIso(), Number(id));
  if (!r.changes) return { code: 404, body: { ok: false, error: 'not found' } };
  cloud.invalidate('articles');
  return { body: { ok: true, read: 1 } };
}

// POST /api/articles/:id/later —— 切换稍后阅读(收藏)
async function articleToggleLater(id) {
  if (!cloud.IS_CLOUD) return { body: { ok: true, later: 1 } };
  const turso = require('./_turso');
  const row = await turso.dbGet('SELECT id, later FROM articles WHERE id=?', Number(id));
  if (!row) return { code: 404, body: { ok: false, error: 'not found' } };
  const later = row.later ? 0 : 1;
  await turso.dbRun('UPDATE articles SET later=? WHERE id=?', later, row.id);
  cloud.invalidate('articles');
  return { body: { ok: true, later } };
}

// POST /api/articles/read-all —— 按当前过滤条件批量已读(参考主系统 buildWhere)
async function articlesReadAll(body) {
  if (!cloud.IS_CLOUD) return { body: { ok: true, updated: 0 } };
  const turso = require('./_turso');
  const q = body || {};
  const conds = [];
  const args = [];
  const tab = q.tab || 'all';
  if (tab === 'later') conds.push('a.later=1');
  else if (tab === 'history' || tab === 'read') conds.push('a.read_at IS NOT NULL');
  if (q.source_id) { conds.push('a.source_id=?'); args.push(Number(q.source_id)); }
  if (q.group_id) { conds.push('s.group_id=?'); args.push(Number(q.group_id)); }
  if (q.q) {
    conds.push('(a.title LIKE ? OR a.content_html LIKE ?)');
    args.push(`%${q.q}%`, `%${q.q}%`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) {
    conds.push('COALESCE(a.published_at, a.created_at) >= ?');
    args.push(`${q.from}T00:00:00.000Z`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) {
    conds.push('COALESCE(a.published_at, a.created_at) <= ?');
    args.push(`${q.to}T23:59:59.999Z`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const r = await turso.dbRun(
    `UPDATE articles SET read_at=? WHERE read_at IS NULL AND id IN (
       SELECT a.id FROM articles a LEFT JOIN sources s ON s.id=a.source_id ${where}
     )`,
    turso.nowIso(), ...args
  );
  cloud.invalidate('articles');
  return { body: { ok: true, updated: r.changes } };
}

// ---------- /api/sources ----------
async function sourcesList(query) {
  let items = await cloud.sources();
  if (query.type) items = items.filter((s) => s.type === query.type);
  return { body: { ok: true, items } };
}

// ---------- /api/groups ----------
async function groupsList(query) {
  const srcs = await cloud.sources();
  let items = (await cloud.groups()).map((g) => ({
    ...g,
    sourceCount: srcs.filter((s) => s.group_id === g.id).length,
  }));
  if (query.kind) items = items.filter((g) => !g.kind || g.kind === query.kind);
  return { body: { ok: true, items } };
}

// ---------- /api/videos ----------
async function videosList(query) {
  const tab = query.tab || 'all';
  if (tab === 'favorite' || tab === 'history') {
    return { body: { ok: true, items: [], nextCursor: null, span: { min: null, max: null } } };
  }
  let list = (await cloud.videos()).slice();
  if (query.source_id) list = list.filter((v) => Number(v.source_id) === Number(query.source_id));
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.from || '')) {
    list = list.filter((v) => sortKey(v) >= `${query.from}T00:00:00.000Z`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.to || '')) {
    list = list.filter((v) => sortKey(v) <= `${query.to}T23:59:59.999Z`);
  }
  const desc = query.sort !== 'old';
  list.sort((a, b) => {
    const c = sortKey(a).localeCompare(sortKey(b));
    if (c !== 0) return desc ? -c : c;
    return desc ? b.id - a.id : a.id - b.id;
  });
  const span = list.length ? { min: sortKey(list[list.length - 1]), max: sortKey(list[0]) } : { min: null, max: null };
  const start = cursorStart(list, query.cursor, desc);
  const page = list.slice(start, start + PAGE);
  const last = page[page.length - 1];
  return {
    body: {
      ok: true,
      items: page.map((v) => ({ ...v, sort_key: sortKey(v) })),
      nextCursor: start + PAGE < list.length && last ? `${sortKey(last)}|${last.id}` : null,
      span,
    },
  };
}

async function videoDetail(id) {
  const it = (await cloud.videos()).find((v) => String(v.id) === String(id));
  if (!it) return { code: 404, body: { ok: false, error: 'not found' } };
  return { body: { ok: true, item: it } };
}

async function videoPlay(id) {
  const v = (await cloud.videos()).find((x) => String(x.id) === String(id));
  if (!v) return { code: 404, body: { ok: false, error: 'not found' } };
  // 云端无法解析直链,回退官方 embed / 原平台外链
  if (v.platform === 'bilibili') {
    return { body: { ok: true, mode: 'official', url: `https://player.bilibili.com/player.html?bvid=${v.vid}&autoplay=0` } };
  }
  if (v.platform === 'youtube') {
    return { body: { ok: true, mode: 'official', url: `https://www.youtube.com/embed/${v.vid}` } };
  }
  return { body: { ok: true, mode: 'external', url: v.url || `https://www.douyin.com/video/${v.vid}` } };
}

// ---------- /api/hot ----------
async function hot(query) {
  let list = (await cloud.aihot()).slice();
  const { category, q, source } = query;
  if (query.tab === 'featured' && category) list = list.filter((r) => (r.category || '') === category);
  if (query.tab !== 'featured') {
    if (q) {
      const kw = String(q).toLowerCase();
      list = list.filter(
        (r) => (r.title || '').toLowerCase().includes(kw) || (r.summary || '').toLowerCase().includes(kw)
      );
    }
    if (source) list = list.filter((r) => (r.source_name || '') === source);
  }
  list.sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
  const offset = Number(query.cursor) || 0;
  return {
    body: {
      ok: true,
      items: list.slice(offset, offset + PAGE),
      nextCursor: offset + PAGE < list.length ? String(offset + PAGE) : null,
    },
  };
}

function hotCategories() {
  return { body: { ok: true, categories: ['模型', '产品', '行业', '论文', '教程', '观点'], map: {} } };
}

async function hotSources() {
  const counts = new Map();
  for (const r of await cloud.aihot()) {
    const name = r.source_name || '';
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return {
    body: {
      ok: true,
      sources: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    },
  };
}

// ---------- 事件榜(M3:Turso 实时聚合;失败/无数据回退静态快照) ----------
async function eventsData() {
  if (cloud.IS_CLOUD) {
    try {
      const list = await require('./_events').getEvents('all');
      if (list.length) return list;
    } catch { /* 回退快照 */ }
  }
  return require('./_data').events();
}

async function hotEvents(query) {
  const domain = query.domain;
  let list = await eventsData();
  if (domain && domain !== 'all') list = list.filter((e) => e.domain === domain);
  return {
    body: {
      ok: true,
      events: list.map((e, i) => ({ rank: i + 1, ...e, items: undefined })),
      domains: [...new Set(list.map((e) => e.domain))],
    },
  };
}

async function hotEventDetail(rank, query) {
  const domain = query.domain;
  let list = await eventsData();
  if (domain && domain !== 'all') list = list.filter((e) => e.domain === domain);
  const idx = Number(rank) - 1;
  if (!Number.isInteger(idx) || idx < 0 || !list[idx]) {
    return { code: 404, body: { ok: false, error: '事件不存在' } };
  }
  return { body: { ok: true, event: { rank: idx + 1, ...list[idx] } } };
}

// ---------- /api/admin/*(M4:全部需管理口令 cookie;login/session 除外) ----------
async function admin(method, parts, query, ctx) {
  const a = require('./_admin');
  const [b, c, d] = parts; // /api/admin/{b}/{c}/{d}
  if (b === 'login' && method === 'POST') return a.login(ctx.body);
  if (b === 'logout' && method === 'POST') return a.logout();
  if (b === 'session' && method === 'GET') return a.session(ctx);
  if (!(await a.isAuthed(ctx))) {
    return { code: 401, body: { ok: false, error: '未登录或会话已过期' } };
  }
  if (b === 'sources' && !c) {
    if (method === 'GET') return a.listSources();
    if (method === 'POST') return a.addSource(ctx.body);
  }
  if (b === 'sources' && c && !d) {
    if (method === 'DELETE') return a.deleteSource(c);
  }
  if (b === 'sources' && c && d === 'toggle' && (method === 'PUT' || method === 'POST')) {
    return a.toggleSource(c);
  }
  if (b === 'refresh-all' && method === 'POST') {
    try {
      const body = await require('./_collect').collect();
      return { body };
    } catch (e) {
      return { code: 500, body: { ok: false, error: e.message } };
    }
  }
  if (b === 'alerts' && !c) {
    const alerts = require('./_alerts');
    if (method === 'GET') return { body: { ok: true, config: await alerts.getConfig() } };
    if (method === 'PUT' || method === 'POST') {
      const cfg = ctx.body || {};
      await alerts.saveConfig({
        channels: Array.isArray(cfg.channels) ? cfg.channels : [],
        events: cfg.events && typeof cfg.events === 'object' ? cfg.events : {},
        cooldownMin: Number(cfg.cooldownMin) || 120,
        recentLog: Array.isArray(cfg.recentLog) ? cfg.recentLog : [],
      });
      return { body: { ok: true } };
    }
  }
  if (b === 'alerts' && c === 'test' && method === 'POST') {
    const alerts = require('./_alerts');
    const r = await alerts.dispatch('source_error', { title: '🔔 测试报警', text: '全网情报云端报警链路自检,收到即配置成功。' });
    return { body: { ok: true, ...r } };
  }
  if (b === 'weread' && c === 'qrcode' && method === 'GET') return a.wereadQrcode();
  if (b === 'weread' && c === 'status' && method === 'GET') return a.wereadStatus(query);
  if (b === 'opml' && method === 'POST') return a.importOpml(ctx.body);
  if (b === 'daily-settings' && !c) {
    if (method === 'GET') return a.getDailySettings();
    if (method === 'PUT' || method === 'POST') return a.saveDailySettings(ctx.body);
  }
  return null;
}

// ---------- 分发表:[方法, 段序列] → handler ----------
// slug 为 /api/ 之后的段数组,如 ['articles','123','later']
const noop = { body: { ok: true } };

async function route(method, slug, query, ctx = {}) {
  const [a, b, c] = slug;
  // 云端采集器(十一期 M2):密钥校验后跑一批到期源写 Turso(GET/POST 均可,GitHub Actions 定时触发)
  if (a === 'collect' && !b) {
    if (!process.env.COLLECT_KEY || query.key !== process.env.COLLECT_KEY) {
      return { code: 401, body: { ok: false, error: 'unauthorized' } };
    }
    try {
      return { body: await require('./_collect').collect() };
    } catch (e) {
      return { code: 500, body: { ok: false, error: e.message } };
    }
  }
  if (a === 'admin') return admin(method, slug.slice(1), query, ctx);
  if (a === 'meta' && !b) return meta();
  if (a === 'daily' && !b) return daily();
  if (a === 'daily' && b === 'regenerate') return dailyRegenerate(method);
  if (a === 'articles' && !b) return articles(query);
  if (a === 'articles' && b === 'read-all') {
    return method === 'POST' ? articlesReadAll(ctx.body || query) : noop;
  }
  if (a === 'articles' && b && !c) {
    if (method === 'GET') return articleDetail(b);
    if (method === 'POST') return articleMarkRead(b); // 标记已读
    return noop;
  }
  if (a === 'articles' && b && c === 'later') {
    return method === 'POST' ? articleToggleLater(b) : { body: { ok: true, later: 1 } };
  }
  if (a === 'sources' && !b) return method === 'GET' ? sourcesList(query) : noop;
  if (a === 'sources' && b === 'refresh-all') return { body: { ok: true, total: 0, succeeded: 0, failed: 0, results: [] } };
  if (a === 'sources' && b) return noop; // :id/refresh、:id/toggle 等写操作
  if (a === 'groups' && !b) return method === 'GET' ? groupsList(query) : noop;
  if (a === 'videos' && !b) return videosList(query);
  if (a === 'videos' && b && !c) return method === 'GET' ? videoDetail(b) : noop;
  if (a === 'videos' && b && c === 'play') return videoPlay(b);
  if (a === 'videos' && b && c === 'favorite') return { body: { ok: true, favorite: 1 } };
  if (a === 'hot' && !b) return hot(query);
  if (a === 'hot' && b === 'categories') return hotCategories();
  if (a === 'hot' && b === 'sources') return hotSources();
  if (a === 'hot' && b === 'events' && !c) return hotEvents(query);
  if (a === 'hot' && b === 'events' && c) return hotEventDetail(c, query);
  if (a === 'hot' && b === 'original') {
    return { code: 400, body: { ok: false, error: '云端只读快照不提供原文抓取,请点击「阅读原文」' } };
  }
  if (a === 'settings') return method === 'GET' ? { body: { ok: true, settings: {} } } : noop;
  return null; // 404
}

module.exports = { route };
