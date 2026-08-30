// 全部 API 处理器(_ 前缀不计为 Serverless Function)
// 由 api/[...slug].js 单一入口路由分发;契约对齐主系统 server/routes/*
const data = require('./_data');

const PAGE = 30;
const { titleTokens, jaccard, sortKey } = data;

// ---------- 工具 ----------
function sourceIndex() {
  const byName = new Map();
  for (const s of data.sources()) if (s.name && !byName.has(s.name)) byName.set(s.name, s);
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
function meta() {
  return { body: { ok: true, ...data.meta() } };
}

// ---------- /api/daily ----------
function daily() {
  return { body: { ok: true, report: data.daily() } };
}
function dailyRegenerate() {
  return { code: 400, body: { ok: false, error: '云端为只读快照,请在主系统重新生成日报' } };
}

// ---------- /api/articles ----------
function articles(query) {
  const tab = query.tab || 'all';
  if (tab === 'later' || tab === 'history' || tab === 'read') {
    return { body: { ok: true, items: [], nextCursor: null, span: { min: null, max: null } } };
  }
  const byName = sourceIndex();
  let list = data.articles();
  if (query.source_id) {
    const sid = Number(query.source_id);
    list = list.filter((r) => byName.get(r.source_name)?.id === sid);
  }
  if (query.group_id) {
    const gid = Number(query.group_id);
    list = list.filter((r) => byName.get(r.source_name)?.group_id === gid);
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

function articleDetail(id) {
  const it = data.articles().find((a) => String(a.id) === String(id));
  if (!it) return { code: 404, body: { ok: false, error: 'not found' } };
  return { body: { ok: true, item: it } };
}

// ---------- /api/sources ----------
function sourcesList(query) {
  let items = data.sources();
  if (query.type) items = items.filter((s) => s.type === query.type);
  return { body: { ok: true, items } };
}

// ---------- /api/groups ----------
function groupsList(query) {
  const srcs = data.sources();
  let items = data.groups().map((g) => ({
    ...g,
    sourceCount: srcs.filter((s) => s.group_id === g.id).length,
  }));
  if (query.kind) items = items.filter((g) => !g.kind || g.kind === query.kind);
  return { body: { ok: true, items } };
}

// ---------- /api/videos ----------
function videosList(query) {
  const tab = query.tab || 'all';
  if (tab === 'favorite' || tab === 'history') {
    return { body: { ok: true, items: [], nextCursor: null, span: { min: null, max: null } } };
  }
  let list = data.videos().slice();
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

function videoDetail(id) {
  const it = data.videos().find((v) => String(v.id) === String(id));
  if (!it) return { code: 404, body: { ok: false, error: 'not found' } };
  return { body: { ok: true, item: it } };
}

function videoPlay(id) {
  const v = data.videos().find((x) => String(x.id) === String(id));
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
function hot(query) {
  let list = data.aihot().slice();
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

function hotSources() {
  const counts = new Map();
  for (const r of data.aihot()) {
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

function hotEvents(query) {
  const domain = query.domain;
  let list = data.events();
  if (domain && domain !== 'all') list = list.filter((e) => e.domain === domain);
  return {
    body: {
      ok: true,
      events: list.map((e, i) => ({ rank: i + 1, ...e, items: undefined })),
      domains: [...new Set(data.events().map((e) => e.domain))],
    },
  };
}

function hotEventDetail(rank, query) {
  const domain = query.domain;
  let list = data.events();
  if (domain && domain !== 'all') list = list.filter((e) => e.domain === domain);
  const idx = Number(rank) - 1;
  if (!Number.isInteger(idx) || idx < 0 || !list[idx]) {
    return { code: 404, body: { ok: false, error: '事件不存在' } };
  }
  return { body: { ok: true, event: { rank: idx + 1, ...list[idx] } } };
}

// ---------- 分发表:[方法, 段序列] → handler ----------
// slug 为 /api/ 之后的段数组,如 ['articles','123','later']
const noop = { body: { ok: true } };

function route(method, slug, query) {
  const [a, b, c] = slug;
  if (a === 'meta' && !b) return meta();
  if (a === 'daily' && !b) return daily();
  if (a === 'daily' && b === 'regenerate') return dailyRegenerate();
  if (a === 'articles' && !b) return articles(query);
  if (a === 'articles' && b === 'read-all') return { body: { ok: true, updated: 0 } };
  if (a === 'articles' && b && !c) return method === 'GET' ? articleDetail(b) : noop;
  if (a === 'articles' && b && c === 'later') return { body: { ok: true, later: 1 } };
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
