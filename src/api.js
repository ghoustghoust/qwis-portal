// 门户数据层：优先调 Vercel serverless（/api/*）；404/失败时回退静态快照（public/data/*.json）
// 两种部署（serverless / 纯静态）都能跑

const PAGE_SIZE = 30;

async function tryJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// 静态 JSON 缓存（fallback 模式复用，避免重复下载）
const staticCache = {};
async function staticJson(name) {
  if (!staticCache[name]) {
    const res = await fetch(`data/${name}`);
    if (!res.ok) throw new Error(`${name} 加载失败`);
    staticCache[name] = await res.json();
  }
  return staticCache[name];
}

export async function getMeta() {
  try {
    const d = await tryJson('api/meta');
    if (d?.ok) return d;
    throw new Error('bad payload');
  } catch {
    return staticJson('meta.json');
  }
}

export async function getDaily() {
  try {
    const d = await tryJson('api/daily');
    if (d?.ok && d.report) return d.report;
    throw new Error('bad payload');
  } catch {
    return staticJson('daily-latest.json');
  }
}

// 事件榜：API 支持 domain 过滤；静态回退时前端自己过滤 + 补 rank
export async function getEvents(domain = 'all') {
  try {
    const d = await tryJson(`api/events?domain=${encodeURIComponent(domain)}`);
    if (d?.ok && Array.isArray(d.events)) return d;
    throw new Error('bad payload');
  } catch {
    const all = await staticJson('events.json');
    const filtered = !domain || domain === 'all' ? all : all.filter((e) => e.domain === domain);
    return {
      ok: true,
      events: filtered.map((e, i) => ({ rank: i + 1, ...e })),
      domains: [...new Set(all.map((e) => e.domain))],
    };
  }
}

// 文章分页：API 模式用 nextCursor；静态回退时整数组切片（cursor=起始下标）
// 静态数据无 dedup 能力，回退模式忽略 dedup（无 relatedCount 徽章，界面自动降级）
export async function getArticles({ cursor = null, domain = '', q = '', dedup = true } = {}) {
  try {
    const sp = new URLSearchParams();
    if (cursor) sp.set('cursor', cursor);
    if (domain) sp.set('domain', domain);
    if (q) sp.set('q', q);
    if (dedup) sp.set('dedup', '1');
    const d = await tryJson(`api/articles?${sp}`);
    if (d?.ok && Array.isArray(d.items)) return { items: d.items, nextCursor: d.nextCursor ?? null, total: d.total };
    throw new Error('bad payload');
  } catch {
    const all = await staticJson('articles.json');
    let list = all;
    if (domain) list = list.filter((a) => (a.domain || '其它') === domain);
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter(
        (a) => (a.title || '').toLowerCase().includes(needle) || (a.summary || '').toLowerCase().includes(needle)
      );
    }
    const start = Number(cursor) || 0;
    const items = list.slice(start, start + PAGE_SIZE);
    const end = start + items.length;
    return { items, nextCursor: end < list.length ? String(end) : null, total: list.length };
  }
}

// 文章全文：API 按 id 取；静态回退从整数组里找
export async function getArticle(id) {
  try {
    const d = await tryJson(`api/articles/${id}`);
    if (d?.ok && d.item) return d.item;
    throw new Error('bad payload');
  } catch {
    const all = await staticJson('articles.json');
    const it = all.find((a) => String(a.id) === String(id));
    if (!it) throw new Error('文章不存在');
    return it;
  }
}
