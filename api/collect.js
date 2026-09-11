// Vercel Serverless Function: 采集触发器
// POST /api/collect?key=COLLECT_KEY[&mode=collect|backfill|cleanup&days=7]
//
// 由 GitHub Actions 定时调用（整点采集 / :30 backfill / 每日 cleanup）
// 查询 Turso 中到期源 → 调用适配器抓取 → 落库 → 返回统计
//
// 认证：COLLECT_KEY 环境变量（与 GH Actions Secrets 一致）
// 超时：Vercel Hobby 10s / Pro 60s，单次最多处理 MAX_SOURCES 个源

const { createClient } = require('@libsql/client');
const Parser = require('rss-parser');

// ─── 配置 ───
// [2026-09-10 修复] Vercel Hobby 10s 硬限制：冷启动 3-5s + 连接 Turso 2-3s = 仅剩 2-5s 给实际采集
// MAX_SOURCES=2 + FETCH_TIMEOUT=2000 → 最坏 5-7s → 安全在 10s 内完成
// 已排除 bilibili/douyin（serverless 无法采集），每次执行采 2 个真实 RSS/热榜源
const MAX_SOURCES = 2;           // 单次执行最多处理 2 个源（Hobby 10s 硬限制）
const FETCH_TIMEOUT = 2000;      // 单源抓取超时 ms（配合 10s 总限制）
// [2026-09-11] 必须浏览器 UA：newsnow 热榜 API 对自定义 UA 直接 403（此前云端热榜全灭的主因之一）
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// RSS parser 配置（与 server/services/collectors/rss/index.js 对齐）
const rssParser = new Parser({
  timeout: 10000,
  customFields: { item: ['content:encoded', 'content'] },
});

// ─── 数据库连接（模块级缓存，Serverless 冷启动时创建） ───
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

function stripTags(html) {
  return String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function firstImg(html) {
  const re = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const [tag, src] = m;
    if (/facebook\.com\/tr|doubleclick|analytics|pixel/i.test(src)) continue;
    if (/display\s*:\s*none/i.test(tag)) continue;
    if (/width=["']?1["'\s]/i.test(tag) && /height=["']?1["'\s]/i.test(tag)) continue;
    return src.replace(/&amp;/g, '&');
  }
  return null;
}

function textLen(html) {
  if (!html) return 0;
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-zA-Z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

// 正文清洗（从 rss/index.js cleanContent 精简）
function cleanContent(html) {
  let c = String(html || '');
  c = c.replace(/<script[\s\S]*?<\/script>/gi, '');
  c = c.replace(/<style[\s\S]*?<\/style>/gi, '');
  c = c.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  // 微信懒加载: data-src → src
  c = c.replace(/<img\b([^>]*?)\sdata-src=(["'])([^"']+)\2([^>]*)>/gi, (_, pre, q, src, post) => {
    const rest = (pre + ' ' + post).replace(/\ssrc=(["']).*?\1/gi, '');
    return `<img${rest} src=${q}${src}${q}>`;
  });
  // mmbiz 防盗链: 加 no-referrer
  c = c.replace(/<img\b(?![^>]*\breferrerpolicy\b)([^>]*?src=["']https?:\/\/mmbiz\.qpic\.cn[^>]*?)>/gi, '<img$1 referrerpolicy="no-referrer">');
  return c;
}

// 摘要提取
function summarize(html, limit = 200) {
  const c = String(html || '');
  const ps = c.match(/<p[\s>][\s\S]*?<\/p>/gi) || [];
  for (const p of ps) {
    const t = stripTags(p).replace(/\s+/g, ' ').trim();
    if (t.length >= 40) return t.slice(0, limit);
  }
  return stripTags(c).replace(/\s+/g, ' ').trim().slice(0, limit);
}

// ─── 热榜解析（从 hotlist/index.js 精简） ───
function parseHeat(info) {
  if (!info) return null;
  const m = String(info).match(/([\d.]+)\s*(万|亿)?/);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2] === '万') n *= 1e4;
  if (m[2] === '亿') n *= 1e8;
  return Math.round(n);
}

function mapNewsnow(data, platform, category) {
  // 按榜内名次每条递减 60s，避免同源同刻时间戳并列成块（与 tools/collect-turso.js 对齐）
  const updatedMs = data.updatedTime ? Number(data.updatedTime) : null;
  return (data.items || [])
    .filter(it => it && it.url && it.title)
    .map((it, idx) => {
      const title = String(it.title).trim();
      let hover = (it.extra && it.extra.hover) || '';
      if (/[Ѐ-ӿˈ-˿]/.test(hover)) hover = '';
      return {
        title,
        url: it.url,
        author: platform,
        summary: hover,
        content_html: hover
          ? `<p>${hover}</p><p><a href="${it.url}" target="_blank" rel="noopener">查看原文 →</a></p>`
          : `<p>${title}</p><p><a href="${it.url}" target="_blank" rel="noopener">查看原文 →</a></p>`,
        published_at: updatedMs ? new Date(updatedMs - idx * 60000).toISOString() : null,
        category,
        score: parseHeat(it.extra && it.extra.info),
      };
    });
}

// ─── HTTP 工具 ───
async function fetchWithTimeout(url, opts = {}) {
  const { timeout = FETCH_TIMEOUT, headers = {}, ...rest } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...rest,
      headers: { 'User-Agent': UA, ...headers },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function fetchJson(url, opts = {}) {
  const res = await fetchWithTimeout(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── 适配器：RSS ───
async function fetchRss(source) {
  const url = source.url;
  let extra = {};
  try { extra = JSON.parse(source.extra || '{}'); } catch { /* 无 extra */ }

  const headers = {};
  if (extra.etag) headers['If-None-Match'] = extra.etag;
  if (extra.lastModified) headers['If-Modified-Since'] = extra.lastModified;

  const res = await fetchWithTimeout(url, { headers });
  if (res.status === 304) {
    return { articles: [], notModified: true, etag: extra.etag, lastModified: extra.lastModified };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const etag = res.headers.get('etag') || undefined;
  const lastModified = res.headers.get('last-modified') || undefined;
  const xml = await res.text();
  const feed = await rssParser.parseString(xml);

  const articles = (feed.items || []).slice(0, 30).map(item => {
    const contentRaw = item['content:encoded'] || item['content'] || item.content || '';
    const content = cleanContent(contentRaw);
    const cover = firstImg(content) || (item.enclosure && item.enclosure.url) || null;
    return {
      title: (item.title || '').trim(),
      url: item.link || item.guid || '',
      author: item.creator || item.author || '',
      cover,
      summary: summarize(content),
      content_html: content,
      published_at: item.isoDate || item.pubDate || null,
      category: item.category || null,
    };
  }).filter(a => a.title && a.url);

  return { articles, etag, lastModified };
}

// ─── 适配器：热榜 ───
async function fetchHotlist(source) {
  const url = source.url || '';
  const HOTLIST_BASE = process.env.HOTLIST_BASE_URL || 'https://newsnow.busiyi.world';
  const D60S_BASE = process.env.D60S_BASE_URL || 'https://60s.viki.moe';

  if (url.startsWith('hotlist60s://')) {
    const data = await fetchJson(`${D60S_BASE}/v2/60s`);
    if (data.code !== 200) throw new Error(`60s 异常 code=${data.code}`);
    const d = data.data || {};
    const date = d.date ? new Date(d.date + 'T08:00:00+08:00').toISOString() : null;
    const articles = (d.news || [])
      .map((title, i) => ({
        title: String(title || '').trim(),
        url: `${D60S_BASE}/v2/60s#${d.date || 'today'}-${i + 1}`,
        author: '每天60秒读懂世界',
        summary: '',
        content_html: `<p>${String(title || '').trim()}</p>`,
        published_at: date,
        category: '综合',
        score: null,
      }))
      .filter(a => a.title);
    return { articles };
  }

  const id = url.replace(/^hotlist:\/\//, '');
  if (!id) throw new Error('热榜源缺少 newsnow id');
  let extra = {};
  try { extra = JSON.parse(source.extra || '{}'); } catch { /* 无 extra */ }

  const data = await fetchJson(`${HOTLIST_BASE}/api/s?id=${encodeURIComponent(id)}&latest`);
  const articles = mapNewsnow(data, extra.platform || id, extra.domain || null);
  return { articles };
}

// ─── 适配器：B站 ───
async function fetchBilibili(source) {
  // B站 wbi 签名较复杂，serverless 版本先走简单路径：
  // 如果有 RSS 链接（如 RSSHub 生成的），走 RSS 适配器
  if (source.url && (source.url.includes('rss') || source.url.includes('rsshub'))) {
    return fetchRss({ ...source, url: source.url });
  }
  // 否则跳过（需要 wbi 签名的走本地采集）
  return { articles: [], videos: [], skipped: true, reason: 'wbi-required' };
}

// ─── 适配器分发 ───
function getAdapter(type) {
  switch (type) {
    case 'rss':
    case 'wechat':
    case 'wemp':       // 微信公众号 RSS（与 rss 共用适配器）
    case 'x':
    case 'youtube':
      return { fetch: fetchRss };
    case 'hotlist':
      return { fetch: fetchHotlist };
    case 'bilibili':
      return { fetch: fetchBilibili };
    case 'douyin':
      // 抖音暂不支持 serverless 采集（需要签名），走 RSS 路径如果有 RSS 链接
      return { fetch: fetchRss };
    default:
      return null;
  }
}

// ─── 数据落库 ───
async function saveArticles(sourceId, articles, { marksFeatured = false } = {}) {
  const db = getDb();
  let added = 0;
  const now = nowIso();
  for (const a of articles) {
    const score = Number(a.score);
    const wc = textLen(a.content_html);
    try {
      const r = await db.execute({
        sql: `INSERT OR IGNORE INTO articles(source_id, title, url, author, cover, summary, content_html, published_at, created_at, category, original_url, score, word_count)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          sourceId, a.title || '', a.url, a.author || '', a.cover || null,
          a.summary || '', a.content_html || '', a.published_at || null, now,
          a.category || null, a.original_url || null,
          Number.isFinite(score) ? score : null, wc,
        ],
      });
      added += r.rowsAffected;
      // 冲突时更新热度（热榜场景）
      if (!r.rowsAffected && Number.isFinite(score)) {
        await db.execute({
          sql: 'UPDATE articles SET score = ? WHERE url = ? AND ? IS NOT NULL',
          args: [score, a.url, score],
        });
      }
      if (marksFeatured && !r.rowsAffected) {
        await db.execute({ sql: 'UPDATE articles SET featured = 1 WHERE url = ?', args: [a.url] });
      }
    } catch (err) {
      if (!err.message.includes('UNIQUE constraint')) throw err;
    }
  }
  return added;
}

async function saveVideos(sourceId, videos) {
  const db = getDb();
  let added = 0;
  const now = nowIso();
  for (const v of videos) {
    try {
      const r = await db.execute({
        sql: `INSERT INTO videos(source_id, platform, title, url, vid, cover, duration, author, intro, published_at, play_uri, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(url) DO UPDATE SET play_uri=COALESCE(excluded.play_uri, videos.play_uri)`,
        args: [
          sourceId, v.platform || '', v.title || '', v.url, v.vid || null,
          v.cover || null, v.duration || null, v.author || '', v.intro || '',
          v.published_at || null, v.play_uri || null, now,
        ],
      });
      added += r.rowsAffected;
    } catch (err) {
      if (!err.message.includes('UNIQUE constraint')) throw err;
    }
  }
  return added;
}

// ─── 源状态更新 ───
async function updateSourceOk(sourceId, extra, intervalMin) {
  const db = getDb();
  const now = nowIso();
  const next = new Date(Date.now() + intervalMin * 60000).toISOString();
  await db.execute({
    sql: "UPDATE sources SET extra=?, last_fetched_at=?, next_fetch_at=?, status='ok', fail_count=0 WHERE id=?",
    args: [JSON.stringify(extra), now, next, sourceId],
  });
}

async function updateSourceError(sourceId, extra, errMsg, sourceType) {
  const db = getDb();
  extra.lastError = String(errMsg || '').slice(0, 300);
  extra.lastErrorAt = nowIso();
  await db.execute({
    sql: "UPDATE sources SET status='error', fail_count=COALESCE(fail_count,0)+1, extra=? WHERE id=?",
    args: [JSON.stringify(extra), sourceId],
  });
  // YouTube 对数据中心 IP 反爬返回假 404/500，阈值放宽到 10 防误杀（与 tools/collect-turso.js 对齐）
  const threshold = sourceType === 'youtube' ? 10 : 3;
  // 连失 N 次自动暂停
  const row = await db.execute({ sql: 'SELECT fail_count, enabled FROM sources WHERE id=?', args: [sourceId] });
  const r = Array.from(row.rows)[0];
  if (r && r.fail_count >= threshold && r.enabled !== 0) {
    await db.execute({ sql: 'UPDATE sources SET enabled=0 WHERE id=?', args: [sourceId] });
    return { failCount: r.fail_count, autoPaused: true };
  }
  return { failCount: r ? r.fail_count : 1, autoPaused: false };
}

// ─── 主采集逻辑 ───
async function runCollect(mode = 'collect') {
  const db = getDb();
  const now = nowIso();
  const stats = { total: 0, success: 0, failed: 0, skipped: 0, articles: 0, videos: 0 };

  // [2026-09-10 修复] 排除 wemp/bilibili/douyin：这些类型依赖本地环境（微信 Cookie/wbi 签名/Playwright）
  // serverless 适配器对 bilibili 直接 return skipped=true → MAX_SOURCES=1 时永远 0 采集
  // 排除后确保每次执行都采到真实 RSS/热榜源
  const UNSUPPORTED_TYPES = "type NOT IN ('wemp', 'bilibili', 'douyin')";
  let sources;
  if (mode === 'collect' || mode === '' || mode === 'debug') {
    const result = await db.execute({
      sql: `SELECT * FROM sources WHERE enabled=1 AND ${UNSUPPORTED_TYPES} AND (next_fetch_at IS NULL OR next_fetch_at <= ?) ORDER BY next_fetch_at ASC LIMIT ?`,
      args: [now, MAX_SOURCES],
    });
    sources = Array.from(result.rows);
  } else if (mode === 'backfill') {
    // backfill: 补抓 thin content 条目（暂不实现，留给后续迭代）
    return { mode, stats: { ...stats, note: 'backfill not yet implemented in serverless' } };
  } else if (mode === 'cleanup') {
    // cleanup: 删除 7 天前的旧数据（热榜类）
    const days = 7;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const result = await db.execute({
      sql: `DELETE FROM articles WHERE source_id IN (SELECT id FROM sources WHERE type='hotlist') AND published_at < ? AND read_at IS NULL AND later=0`,
      args: [cutoff],
    });
    return { mode, stats: { ...stats, deleted: result.rowsAffected } };
  } else {
    return { mode, stats, error: `Unknown mode: ${mode}` };
  }

  stats.total = sources.length;

  // debug 模式：只返回源类型分布，不实际采集
  if (mode === 'debug') {
    const typeCount = {};
    sources.forEach(s => { typeCount[s.type] = (typeCount[s.type] || 0) + 1; });
    return { mode: 'debug', stats, sourceTypes: typeCount, sampleNextFetch: sources.slice(0, 3).map(s => ({ id: s.id, type: s.type, name: s.name, next: s.next_fetch_at })) };
  }

  // 逐源采集（串行，避免并发被封控）
  for (const source of sources) {
    const adapter = getAdapter(source.type);
    if (!adapter) {
      stats.skipped++;
      continue;
    }

    let extra = {};
    try { extra = JSON.parse(source.extra || '{}'); } catch { /* 无 extra */ }

    try {
      const result = await adapter.fetch(source);
      if (result.skipped) {
        stats.skipped++;
        continue;
      }

      const addedA = await saveArticles(source.id, result.articles || [], { marksFeatured: !!extra.marksFeatured });
      const addedV = await saveVideos(source.id, result.videos || []);
      stats.articles += addedA;
      stats.videos += addedV;

      // 更新源状态
      if (result.etag) extra.etag = result.etag;
      if (result.lastModified) extra.lastModified = result.lastModified;
      if (extra.lastError) { delete extra.lastError; delete extra.lastErrorAt; }

      const intervalMin = Number(extra.intervalMin) || (source.type === 'bilibili' ? 60 : (source.type === 'hotlist' ? 30 : 60));
      await updateSourceOk(source.id, extra, intervalMin);
      stats.success++;
    } catch (err) {
      const { autoPaused } = await updateSourceError(source.id, extra, err.message, source.type);
      stats.failed++;
      console.log(`[collect] ${source.type}:${source.name} 失败: ${err.message}${autoPaused ? ' (已自动暂停)' : ''}`);
    }
  }

  return { mode, stats };
}

// ─── Serverless 入口 ───
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // 认证
  const key = req.query.key || '';
  const expectedKey = process.env.COLLECT_KEY;
  if (!expectedKey || key !== expectedKey) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const mode = req.query.mode || 'collect';

  try {
    const result = await runCollect(mode);
    console.log(`[collect] ${JSON.stringify(result)}`);
    return res.status(200).json(result);
  } catch (err) {
    console.error(`[collect] Fatal: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
};
