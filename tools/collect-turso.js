#!/usr/bin/env node
// 云端直采器：在 GitHub Actions runner（或任何常驻 Node 环境）直接采集并写入 Turso
// 用法:
//   node tools/collect-turso.js [collect|daily|cleanup] [--limit=N]
//
// 设计背景（2026-09-11 方案A）：
//   Vercel Hobby 函数 10s 硬限制 → api/collect.js 单次只能采 2 个源，638 源要 11 天轮完。
//   本脚本跑在 GH Actions runner：无 10s 限制、无冷启动、海外网络直连（YouTube/X/RSSHub 无需代理），
//   并发 6 路全量清到期源，每 30 分钟一轮，实现真正的准实时更新。
//   Vercel 端 api/collect.js / api/daily-generate.js 保留为手动触发备份。
//
// 环境变量:
//   TURSO_DATABASE_URL / TURSO_AUTH_TOKEN  必填（CI 由 Secrets 注入，本地从 .env 读取）
//   HTTPS_PROXY                            可选（本地跑海外源时用，runner 上不需要）
//   COLLECT_LIMIT                          单次最多处理源数（默认 500）
//   COLLECT_CONCURRENCY                    并发数（默认 6）

const path = require('path');
const fs = require('fs');

// 手动加载 .env（CI 无此文件则跳过）
try {
  const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  for (const line of envTxt.split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch { /* CI 环境 */ }

const { createClient } = require('@libsql/client');
const Parser = require('rss-parser');
const { cleanTitle, decodeXmlEntities } = require('../lib/text-clean'); // B94：标题/源名/属性实体解码唯一实现
// B90：北京日界/日报窗口/北京日期串的唯一口径（原来这个文件里手搓了 4 遍 +8h 换算）
const { beijingNow, beijingDateStr, beijingDayStartMs, dailyReportWindowIso } = require('../lib/time-window');
// B107：噪声（热榜/聚合）判定的轴只有一份实现，runner 侧不再手写第 N 份
const { notNoiseSql, notHotlistSql } = require('../lib/noise');

// ─── 配置 ───
const MODE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'collect';
const LIMIT = Number(process.env.COLLECT_LIMIT) || 500;
const CONCURRENCY = Number(process.env.COLLECT_CONCURRENCY) || 6;
const FETCH_TIMEOUT = 10000;   // 单源抓取超时（无 serverless 限制，给足 10s）
// 必须用浏览器 UA：newsnow 等热榜 API 对自定义 UA 直接 403（ARCHITECTURE 已知坑 #4 链路）
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
// serverless/云端不可采类型：wemp 已退役、douyin 需 Playwright 登录态
// bilibili 已于 2026-09-12 移植 runner（api/_bilibili.js，wbi 纯 crypto + 合集/搜索兜底）
const UNSUPPORTED_TYPES = "type NOT IN ('wemp', 'douyin')";

const rssParser = new Parser({
  timeout: FETCH_TIMEOUT,
  customFields: { item: ['content:encoded', 'content'] },
});

// ─── 代理（仅本地跑海外源时需要；runner 直连） ───
// 注意：外部 undici 包的 ProxyAgent 与 Node 内置 fetch 的 dispatcher 符号不兼容，
// 走代理时必须配套使用 undici 包自带的 fetch。
let proxyFetch = null;
let proxyAgent = null;
if (process.env.HTTPS_PROXY) {
  try {
    const { fetch: uFetch, ProxyAgent } = require('undici');
    proxyAgent = new ProxyAgent(process.env.HTTPS_PROXY);
    proxyFetch = (url, opts) => uFetch(url, { ...opts, dispatcher: proxyAgent });
    log(`使用代理: ${process.env.HTTPS_PROXY}`);
  } catch { /* undici 不可用时直连 */ }
}

// ─── 数据库 ───
let _db = null;
function getDb() {
  if (!_db) {
    const url = process.env.TURSO_DATABASE_URL;
    // file: 本地文件库不需要 authToken——隔离测试的驱动正是靠"清空 token"证明不碰生产
    // （此前要求两者都在：本地有 .env 时测试靠 .env 回填真 token 才过，CI 无 .env 必红）
    if (!url || (!url.startsWith('file:') && !process.env.TURSO_AUTH_TOKEN)) {
      throw new Error('缺少 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN');
    }
    _db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return _db;
}
async function qAll(sql, args = []) { return Array.from((await getDb().execute({ sql, args })).rows); }
// 2026-09-18：本函数此前根本不存在，却被 6 处调用（buildReadingDigest/停滞检测/逐条报警/
// 视频计数/cleanup 计数）→ 每处都是 ReferenceError，且全部落在 try/catch 里被吞成一行日志，
// 表现为「阅读足迹永久缺失」「collectStalled 停滞检测在少量失败分支下整体不执行」。
async function qOne(sql, args = []) { return (await getDb().execute({ sql, args })).rows[0] || null; }
async function qRun(sql, args = []) { const r = await getDb().execute({ sql, args }); return { changes: r.rowsAffected }; }

// ─── 工具 ───
function log(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }
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
    return decodeXmlEntities(src);
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

// 正文清洗（与 api/collect.js / server rss 适配器对齐）
function cleanContent(html) {
  let c = String(html || '');
  c = c.replace(/<script[\s\S]*?<\/script>/gi, '');
  c = c.replace(/<style[\s\S]*?<\/style>/gi, '');
  c = c.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  c = c.replace(/<img\b([^>]*?)\sdata-src=(["'])([^"']+)\2([^>]*)>/gi, (_, pre, q, src, post) => {
    const rest = (pre + ' ' + post).replace(/\ssrc=(["']).*?\1/gi, '');
    return `<img${rest} src=${q}${src}${q}>`;
  });
  c = c.replace(/<img\b(?![^>]*\breferrerpolicy\b)([^>]*?src=["']https?:\/\/mmbiz\.qpic\.cn[^>]*?)>/gi, '<img$1 referrerpolicy="no-referrer">');
  return c;
}

function summarize(html, limit = 200) {
  const c = String(html || '');
  const ps = c.match(/<p[\s>][\s\S]*?<\/p>/gi) || [];
  for (const p of ps) {
    const t = stripTags(p).replace(/\s+/g, ' ').trim();
    if (t.length >= 40) return t.slice(0, limit);
  }
  return stripTags(c).replace(/\s+/g, ' ').trim().slice(0, limit);
}

// ─── HTTP ───
async function fetchWithTimeout(url, opts = {}) {
  const { timeout = FETCH_TIMEOUT, headers = {}, ...rest } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const doFetch = proxyFetch || fetch;
    return await doFetch(url, {
      ...rest,
      headers: { 'User-Agent': UA, ...headers },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, opts = {}) {
  const res = await fetchWithTimeout(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── 适配器：RSS（公众号 wechat2rss / YouTube / X / 通用 RSS 共用） ───
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

  // 头像自愈（2026-09-14：feed 已抓到就零成本取 channel image；源头像此前 676 个空缺全是单字母占位）
  let feedImage = (feed.image && feed.image.url) || (feed.itunes && feed.itunes.image) || null;
  if (feedImage && !/^https?:\/\//.test(feedImage)) {
    try { feedImage = new URL(feedImage, url).href; } catch { feedImage = null; }
  }
  if (feedImage && (/[<>]/.test(feedImage) || /%3C|%3E/i.test(feedImage))) feedImage = null; // 模板占位符防呆

  // YouTube 频道 feed → videos 表（2026-09-14 修：runner 的 fetchRss 此前只产 articles，
  // 又被 B6 的 YouTube 链接过滤全部丢弃——视频板块自 09-07 起断更。语义移植自本地
  // server/services/collectors/rss/index.js 的 mapYoutubeItem；三份采集实现同步义务见坑 #9）
  const isYtFeed = source.type === 'youtube'
    || /youtube\.com\/feeds\/videos\.xml/i.test(url)
    || (feed.items || []).some((it) => String(it.id || '').startsWith('yt:video:'));
  if (isYtFeed) {
    const videos = (feed.items || []).slice(0, 30).map((item) => {
      const m = String(item.id || '').match(/yt:video:([\w-]+)/);
      const vid = m ? m[1] : (String(item.link || '').match(/[?&]v=([\w-]+)/) || [])[1];
      if (!vid) return null;
      const authorRaw = typeof item.author === 'string' ? item.author : (item.author && item.author.name) || '';
      return {
        platform: 'youtube',
        title: cleanTitle(item.title),
        url: `https://www.youtube.com/watch?v=${vid}`,
        vid,
        cover: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
        duration: null,
        author: authorRaw || String(source.name || '').trim(),
        intro: String(item.contentSnippet || item.content || '').slice(0, 500),
        published_at: item.isoDate || (item.pubDate ? new Date(item.pubDate).toISOString() : null),
      };
    }).filter((v) => v && v.title);
    return { videos, etag, lastModified };
  }

  const articles = (feed.items || []).slice(0, 30).map(item => {
    const contentRaw = item['content:encoded'] || item['content'] || item.content || '';
    const content = cleanContent(contentRaw);
    const cover = firstImg(content) || (item.enclosure && item.enclosure.url) || null;
    return {
      title: cleanTitle(item.title),
      url: item.link || item.guid || '',
      author: item.creator || item.author || '',
      cover,
      summary: summarize(content),
      content_html: content,
      published_at: item.isoDate || item.pubDate || null,
      category: item.category || null,
    };
  }).filter(a => a.title && a.url);

  return { articles, etag, lastModified, feedImage };
}

// ─── 热榜解析 ───
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
  // newsnow 整个 feed 只给一个 updatedTime → 同源 30 条 published_at 全同 → 前端时间序并列时按 id 兜底成块。
  // 修复（2026-09-11）：按榜内名次每条递减 60s，热榜在时间轴上自然摊开。
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

function getAdapter(type) {
  switch (type) {
    case 'rss':
    case 'wechat':
    case 'wemp':
    case 'x':
    case 'youtube':
      return { fetch: fetchRss };
    case 'hotlist':
      return { fetch: fetchHotlist };
    case 'bilibili':
      return { fetch: (source) => require('../api/_bilibili').fetchBiliVideos(source) };
    default:
      return null;
  }
}


// B6（2026-09-14）：RSS 条目链接为 YouTube（含 shorts）时跳过——官方博客混推视频、
// 无正文，被当文章抓会导致"点开没内容"。三处采集实现同步（坑 #9）。
function isYouTubeLink(url) {
  return /(?:youtube\.com\/(?:shorts|watch|embed)|youtu\.be\/)/i.test(String(url || ''));
}

// ─── 落库（按源聚合 batch，减少 Turso 往返） ───
// 未来时间钳制（2026-09-13 F2）：openrss 等网页转 RSS 桥接会解析出未来 pubDate（实测 2026-09-14
// 整点合成值），入库前晚于当前 5min 以上一律钳为 now，避免排序霸榜+前端显示未来日期
function clampPubDate(iso, now) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  if (t > Date.parse(now) + 5 * 60e3) return now;
  return new Date(t).toISOString();
}

async function saveArticles(sourceId, articles, { marksFeatured = false } = {}) {
  const db = getDb();
  const now = nowIso();
  const stmts = [];
  for (const a of articles.filter((x) => !isYouTubeLink(x.url))) { // B6：YouTube 链接不入文章流
    const score = Number(a.score);
    const wc = textLen(a.content_html);
    stmts.push({
      sql: `INSERT OR IGNORE INTO articles(source_id, title, url, author, cover, summary, content_html, published_at, created_at, category, original_url, score, word_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        sourceId, a.title || '', a.url, a.author || '', a.cover || null,
        a.summary || '', a.content_html || '', clampPubDate(a.published_at, now), now,
        a.category || null, a.original_url || null,
        Number.isFinite(score) ? score : null, wc,
      ],
    });
    if (Number.isFinite(score)) {
      stmts.push({ sql: 'UPDATE articles SET score = ? WHERE url = ?', args: [score, a.url] });
    }
    if (marksFeatured) {
      stmts.push({ sql: 'UPDATE articles SET featured = 1 WHERE url = ?', args: [a.url] });
    }
  }
  if (!stmts.length) return 0;
  const results = await db.batch(stmts, 'write');
  let added = 0;
  for (let i = 0; i < results.length; i++) {
    // INSERT 语句的结果（每个源的第一类语句）
    added += results[i].rowsAffected || 0;
  }
  // 注意：UPDATE 行数也计入，仅作统计口径偏宽松，不影响正确性
  return added;
}

// ─── 视频落库（21-bilibili-runner：vid 去重） ───
async function saveVideos(sourceId, videos) {
  if (!videos.length) return 0;
  const db = getDb();
  const now = nowIso();
  const stmts = videos.map((v) => ({
    // 2026-09-14 修：补 platform 列（此前丢列，云端产生 11 行 platform=NULL；播放路由按 platform 分流）
    sql: `INSERT OR IGNORE INTO videos(source_id, platform, title, url, vid, cover, duration, author, intro, published_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [sourceId, v.platform || (String(v.vid || '').startsWith('BV') ? 'bilibili' : null),
      v.title || '', v.url, v.vid || '', v.cover || null, v.duration || null,
      v.author || '', v.intro || '', v.published_at || null, now],
  }));
  const results = await db.batch(stmts, 'write');
  return results.reduce((n, r) => n + (r.rowsAffected || 0), 0);
}

// ─── 源状态 ───
// 35B：每次「真抓了」都在 extra.health 里记一笔三态（n/e/f），成功率的真分母（B23/B24）
async function updateSourceOk(sourceId, extra, intervalMin, outcome) {
  const { recordAttempt } = require('../lib/source-health');
  extra = recordAttempt(extra, outcome === 'e' ? 'e' : 'n', null, Date.now());
  const now = nowIso();
  const next = new Date(Date.now() + intervalMin * 60000).toISOString();
  await qRun(
    "UPDATE sources SET extra=?, last_fetched_at=?, next_fetch_at=?, status='ok', fail_count=0 WHERE id=?",
    [JSON.stringify(extra), now, next, sourceId]
  );
}

async function updateSourceError(sourceId, extra, errMsg, sourceType, systemic) {
  extra.lastError = String(errMsg || '').slice(0, 300);
  extra.lastErrorAt = nowIso();
  // 35B：系统性故障（出口/代理挂）不是源的错，不进窗口；其余失败记 f + 粗类
  if (!systemic) {
    const { recordAttempt, classifyErr } = require('../lib/source-health');
    extra = recordAttempt(extra, 'f', classifyErr(errMsg), Date.now());
  }
  // F6 系统性故障抑制（lib/source-breaker.js 判）：一轮里大批源同时报同一个网络/环境类错误，
  // 说明是我们出不去，不是这些源死了 → 只记 status/lastError 供排障，
  // **不累加 fail_count、不熔断**。否则一次代理故障就把几百个活源集体关进牢房（坑 #35 的 458 源事故）。
  if (systemic) {
    await qRun("UPDATE sources SET status='error', extra=? WHERE id=?", [JSON.stringify(extra), sourceId]);
    return { autoPaused: false, suppressed: true };
  }
  await qRun(
    "UPDATE sources SET status='error', fail_count=COALESCE(fail_count,0)+1, extra=? WHERE id=?",
    [JSON.stringify(extra), sourceId]
  );
  const rows = await qAll('SELECT fail_count, enabled FROM sources WHERE id=?', [sourceId]);
  const r = rows[0];
  // YouTube 对数据中心 IP 反爬会返回假 404/500（间歇性、按 IP 掷骰），
  // 阈值放宽到 10，避免把活源误杀；真死频道 10 连跪后也照停。
  // 阈值唯一实现在 lib/source-breaker.js（三端一致，坑 #35 / ISSUES H14）
  const threshold = require('../lib/source-breaker').breakerThreshold(sourceType);
  if (r && r.fail_count >= threshold && r.enabled !== 0) {
    // Q7 自动恢复依赖：熔断时刻落 frozenAt（历史冻结源由 cleanup 用 lastErrorAt 兜底）
    if (!extra.frozenAt) extra.frozenAt = nowIso();
    await qRun('UPDATE sources SET enabled=0, extra=? WHERE id=?', [JSON.stringify(extra), sourceId]);
    return { autoPaused: true };
  }
  return { autoPaused: false };
}

// ─── 单源采集 ───
async function collectOne(source, stats) {
  const adapter = getAdapter(source.type);
  if (!adapter) { stats.skipped++; return; }
  // 本地自建源（127.0.0.1/localhost）在云端 runner 永远不可达，直接跳过不计失败（防熔断误伤）
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(source.url || '')) {
    stats.skipped++;
    return;
  }

  let extra = {};
  try { extra = JSON.parse(source.extra || '{}'); } catch { /* 无 extra */ }

  try {
    const result = await adapter.fetch(source);
    if (result.skipped) { stats.skipped++; return; }

    // 21-bilibili-runner：视频走 videos 表（vid 去重），文章走 articles 表
    let vAdded = 0;
    if (Array.isArray(result.videos)) {
      vAdded = await saveVideos(source.id, result.videos);
      stats.videos = (stats.videos || 0) + vAdded;
    }
    const added = await saveArticles(source.id, result.articles || [], { marksFeatured: !!extra.marksFeatured });
    stats.articles += added;

    if (result.etag) extra.etag = result.etag;
    if (result.lastModified) extra.lastModified = result.lastModified;
    if (extra.lastError) { delete extra.lastError; delete extra.lastErrorAt; }

    // 头像自愈：源无头像且本次 feed 带 channel image → 回填（零额外请求）
    if (!source.avatar && result.feedImage) {
      try {
        await qRun('UPDATE sources SET avatar=? WHERE id=?', [result.feedImage, source.id]);
        log(`  头像回填: ${source.name}`);
      } catch { /* 不阻断 */ }
    }

    // 2026-09-11：RSS 默认间隔 480→60min。runner 容量充足（全量一轮几分钟），
    // ETag 304 使重复拉取几乎免费；8h 间隔会导致公众号新文章延迟大半天才入流。
    const intervalMin = Number(extra.intervalMin) || (source.type === 'hotlist' ? 30 : 60);
    await updateSourceOk(source.id, extra, intervalMin, (added + vAdded) > 0 ? 'n' : 'e');
    stats.success++;
    (stats.outcomes || (stats.outcomes = [])).push({ ok: true });
  } catch (err) {
    (stats.outcomes || (stats.outcomes = [])).push({ ok: false, error: err.message });
    const systemic = require('../lib/source-breaker').detectSystemicFailure(stats.outcomes).systemic;
    const { autoPaused, suppressed } = await updateSourceError(source.id, extra, err.message, source.type, systemic);
    stats.failed++;
    if (suppressed) stats.systemicSuppressed = (stats.systemicSuppressed || 0) + 1;
    log(`  ✗ ${source.type}:${source.name} — ${err.message}${autoPaused ? ' (已自动暂停)' : suppressed ? ' (系统性故障，本轮不熔断不计数)' : ''}`);
    // 15-cloud-alerts：收集失败源供批次尾部报警
    stats.failures.push({ source, errMsg: err.message, suppressed: !!suppressed });
  }
}

// ─── 并发池 ───
async function runPool(items, worker, concurrency) {
  let idx = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const item = items[idx++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

// ─── 心跳（/api/status 可读，监控用） ───
async function writeHeartbeat(mode, stats) {
  try {
    // T3-2：追加式历史（保留最近 168 条 ≈ 7 天×24），供监控折线图（成功率/入库量趋势）
    let history = [];
    try {
      const prev = await getSetting('cloud.collect', {});
      if (Array.isArray(prev.history)) history = prev.history.slice(-167);
    } catch { /* 首次无历史 */ }
    // 对抗性瘦身：failures 内嵌完整 source 行（含 avatar/extra），168 条会膨胀数 MB —— 只留定位所需字段
    const slim = { ...stats, failures: (stats.failures || []).slice(-20).map((f) => ({ id: f.source?.id, name: f.source?.name, type: f.source?.type, errMsg: String(f.errMsg || '').slice(0, 120) })) };
    history.push({ mode, at: nowIso(), stats: slim });
    await qRun(
      'INSERT OR REPLACE INTO settings(key, value) VALUES(?, ?)',
      ['cloud.collect', JSON.stringify({ mode, lastRunAt: nowIso(), stats, history })]
    );
  } catch (err) { log(`心跳写入失败（忽略）: ${err.message}`); }
}

// ─── 模式：collect ───
async function runCollect() {
  const now = nowIso();
  const stats = { total: 0, success: 0, failed: 0, skipped: 0, articles: 0, failures: [] };

  const sources = await qAll(
    `SELECT * FROM sources WHERE enabled=1 AND ${UNSUPPORTED_TYPES} AND (next_fetch_at IS NULL OR next_fetch_at <= ?) ORDER BY next_fetch_at ASC LIMIT ?`,
    [now, LIMIT]
  );

  // T4-2 R2 failover：同 failoverGroup 只采主源（fail_count 最少者，备源本轮跳过省重复抓取）
  const extraOf = (s) => { try { return JSON.parse(s.extra || '{}'); } catch { return {}; } };
  const byGroup = {};
  const due = [];
  let groupSkipped = 0;
  for (const s of sources) {
    const fg = extraOf(s).failoverGroup;
    if (!fg) { due.push(s); continue; }
    (byGroup[fg] = byGroup[fg] || []).push(s);
  }
  for (const members of Object.values(byGroup)) {
    members.sort((a, b) => (a.fail_count || 0) - (b.fail_count || 0) || String(b.last_fetched_at || '').localeCompare(String(a.last_fetched_at || '')));
    due.push(members[0]);
    groupSkipped += members.length - 1;
  }
  stats.total = due.length;
  log(`到期源 ${sources.length} 个（failover 组 ${Object.keys(byGroup).length}，备源跳过 ${groupSkipped}），并发 ${CONCURRENCY} 开始采集`);

  const t0 = Date.now();
  await runPool(due, (s) => collectOne(s, stats), CONCURRENCY);

  // 主源失败 → 顺序尝试同组备源（上限 10 组防雪崩；备源失败如实计入 stats）
  const failedGroupPrimaries = (stats.failures || []).map((f) => f.source).filter((s) => s && extraOf(s).failoverGroup);
  for (const p of failedGroupPrimaries.slice(0, 10)) {
    const siblings = (byGroup[extraOf(p).failoverGroup] || []).filter((m) => m.id !== p.id);
    for (const sb of siblings) {
      log(`failover: ${String(p.name).slice(0, 24)} 失败 → 尝试备源 ${String(sb.name).slice(0, 24)}`);
      const before = stats.failed;
      await collectOne(sb, stats);
      if (stats.failed === before) { log(`failover 生效: ${String(sb.name).slice(0, 24)} 成功`); break; }
    }
  }

  const sec = ((Date.now() - t0) / 1000).toFixed(1);

  log(`采集完成: 成功 ${stats.success} / 失败 ${stats.failed} / 跳过 ${stats.skipped} / 新增 ${stats.articles} 篇 / 耗时 ${sec}s`);
  await runHotEventsCache(); // 热搜事件预聚合（云端读层主路径；失败不阻断采集退出码）
  await runQuickScore(); // 精选即时补分（六维评分原来只有早晚报批次才跑，白天精选无今日内容——用户 2026-09-14 验收发现）
  await writeHeartbeat('collect', stats);
  await postRunAlerts(stats); // 15-cloud-alerts：批次尾部报警（失败隔离，绝不影响退出码）
  return stats;
}

// 2026-09-14：精选即时补分（轻量六维评分）
// 起因：六维评分此前只跑在 daily-ai 早报批次（21:30/00:32/09:03），白天新文章 score 全空，
//       热点榜「AI 精选」（口径=自有源六维≥60 且 AI 相关）白天无今日内容。
// 策略：每轮采集尾部补分「近 24h、自有源、未评分、AI 相关」的新文章，上限 QUICKSCORE_LIMIT（默认 8 篇/轮，
//       15min 一轮 ≈ 32 篇/小时增量，Agnes 15RPM 配额可承受）；生成保护窗内让路（同翻译 R0b 语义）。
async function runQuickScore() {
  if (inGenerationGuard()) { log('quickscore: 生成保护窗内，本轮让路'); return { skipped: 'generation-window' }; }
  const _ai = require('../api/_ai');
  const { aiRelevanceCond } = require('../lib/ai-relevance');
  const LIMIT_QS = Number(process.env.QUICKSCORE_LIMIT) || 8;
  const args = [new Date(Date.now() - 24 * 3600e3).toISOString()];
  const aiCond = aiRelevanceCond(args);
  const rows = await qAll(
    `SELECT a.id, a.title, a.summary, a.published_at, s.name AS source_name
     FROM articles a JOIN sources s ON s.id = a.source_id
     LEFT JOIN groups g ON g.id = s.group_id
     WHERE a.published_at >= ? AND s.enabled = 1
       AND ${notNoiseSql('s')}
       AND (a.score IS NULL OR a.score = '' OR CAST(a.score AS REAL) = 0)
       AND ${aiCond}
     ORDER BY a.published_at DESC LIMIT 60`,
    args
  );
  const candidates = rows.filter((a) => !hasMojibake(a.title) && !isErrorPageItem(a)).slice(0, LIMIT_QS);
  if (!candidates.length) { log('quickscore: 无待补分候选'); return { scored: 0 }; }
  let scored = 0;
  for (const a of candidates) {
    try {
      const f = await _ai.filterArticle({ title: a.title, source: a.source_name, summary: a.summary });
      if (f.ignore) {
        // 初筛即垃圾：写低分占位（免每轮重扫；低于精选门槛 60 不会入精选）
        await qRun('UPDATE articles SET score=? WHERE id=?', [Math.min(Number(f.score) || 20, 40), a.id]);
        continue;
      }
      const full = await qAll('SELECT content_html FROM articles WHERE id=?', [a.id]);
      const r = await _ai.analyzeArticle({ ...a, content_html: full[0] ? full[0].content_html : null });
      if (r && Number.isFinite(r.totalScore)) {
        await qRun('UPDATE articles SET score=?, reason=? WHERE id=?', [Math.round(r.totalScore), r.reason || null, a.id]);
        scored++;
        log(`  ✓ [补分] #${a.id} ${Math.round(r.totalScore)}分 ${String(a.title).slice(0, 36)}`);
      }
    } catch (e) {
      log(`  ✗ [补分] #${a.id} ${e.message.slice(0, 100)}`);
    }
    await new Promise((r2) => setTimeout(r2, 1200)); // 限速护配额
  }
  log(`quickscore: 候选 ${rows.length}，本轮补分 ${scored}/${candidates.length}`);
  return { scored };
}



// 2026-09-14：热搜事件预聚合写 settings['hot.eventsCache']
// 起因：云端 serverless 内联聚合（3000 行窗口查询 + Jaccard 聚类）冷启动超 30s 上限 504，用户实测事件榜长时间「加载中」
// 架构：聚合逻辑在 lib/hot-events.js（与 api/[...slug].js 兜底共用同一份纯函数）；云端读层直接读本缓存
async function runHotEventsCache() {
  try {
    const { aggregateEventRows, EVENTS_SAMPLE_SQL, EVENTS_WINDOW_H } = require('../lib/hot-events');
    const t0 = Date.now();
    const cutoff = new Date(Date.now() - EVENTS_WINDOW_H * 3600e3).toISOString();
    const rows = await qAll(EVENTS_SAMPLE_SQL, [cutoff]);
    const events = aggregateEventRows(rows);
    await getDb().execute({
      sql: "INSERT OR REPLACE INTO settings(key, value) VALUES('hot.eventsCache', ?)",
      args: [JSON.stringify({ at: Date.now(), events })],
    });
    log(`热搜事件预聚合完成: ${events.length} 事件（采样 ${rows.length} 条，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  } catch (e) {
    log(`热搜事件预聚合失败（不阻断采集）: ${e.message}`);
  }
}

// 15-cloud-alerts：批次尾部报警检测（源失败/熔断/停滞）
async function postRunAlerts(stats) {
  try {
    const alerts = require('../api/_alerts');
    const failures = stats.failures || [];
    // 2026-09-13：批量失败聚合——单轮 >5 个源失败时发一条汇总，不逐条轰炸（93 源/轮实证）
    if (failures.length > 5) {
      const byCat = {};
      for (const f of failures) {
        const { category } = alerts.classifyError(f.errMsg, f.source.type);
        byCat[category] = (byCat[category] || 0) + 1;
      }
      const breakdown = Object.entries(byCat).map(([c, n]) => `${c} ${n} 个`).join('，');
      await alerts.dispatch('source_error', {
        title: `⚠️ 本轮采集 ${failures.length} 个源失败`,
        text: `分类统计：${breakdown}\n反爬类（YouTube 假 404/500）会随 IP 轮换自愈，无需逐条处理；真死源见每日熔断汇总。`,
      });
    } else {
      // 少量失败逐条报（反爬类在 sourceAlert 内部已抑制）
      for (const f of failures) {
        const row = await qOne('SELECT fail_count FROM sources WHERE id=?', [f.source.id]);
        const failCount = row ? row.fail_count : 1;
        if (failCount >= 2) await alerts.sourceAlert({ ...f.source }, failCount, f.errMsg);
      }
    }
    // 停滞检测：本轮有到期源但 0 成功，且近 1h 无任何成功采集
    if (stats.total > 0 && stats.success === 0) {
      const recent = await qOne(
        "SELECT COUNT(*) c FROM sources WHERE enabled=1 AND last_fetched_at > datetime('now','-1 hour')"
      );
      if (recent.c === 0) {
        await alerts.collectStalled(`本轮到期 ${stats.total} 源全部失败（runner 批次 ${nowIso()}）`);
      }
    }
  } catch (err) {
    console.log(`[alerts] 报警检测自身失败（已隔离）: ${err.message}`);
  }
}

// ─── B101 观测：删除触发口**未**点亮，先把"今天有多少条满足删除谓词"落成每日读数 ───
// 用户 09-21 裁定「先只接观测，不动触发口」。背景读数（现役库，不是旧库那个已作废的 10,733）：
// 7 天窗口 + 现有豁免一次会删 50,636 条 = 全库 59,832 篇的 84.6%（热榜 26,361 / 普通 24,275，
// 普通那批带 667MB 正文），取法 `lib/retention#whereFor('runner',…)` 原样谓词 + `cutoffIso(7)`，
// 逐条记在 `docs/eval/bl10-null-audit-20260921.md` §三。所以本函数**只做两件事，都不删数据**：
//   ① 把待删量与删除闸状态写进 `settings['retention.pending']`（带最近 14 条），给人看趋势；
//   ② 把 B103 的删除闸从"可用工具"变成**强制路径**：拿不到可用转储就一条都不删，并且出声。
// 计数 SQL 来自 `lib/retention#pendingPlan` —— 与删除用的是同一份 WHERE，
// 否则"看着会删多少"与"真删多少"又是两件事（坑 #58/#62）。
// 闸的两条腿（⑥b 已接）：本地有转储目录走磁盘全量校验；runner 上没有目录 → 改判库里的
//    转储凭证（settings['retention.dumpCredential']，只能由"本地校验全过的转储"写入，见
//    tools/dump-content.cjs）。两腿都没有 = 挡下。
//    2026-09-20T22:27Z 那一次清理就是在**没有这道闸**的情况下跑掉的（心跳：删 26,532 + 24,291 条，
//    恰好等于当时实测的待删量），所以这道闸是强制路径不是可选工具。
const RETENTION_READOUT_KEY = 'retention.pending';
const RETENTION_HISTORY_MAX = 14;
// 转储目录必须与 `tools/dump-content.cjs` 的默认产出同一处：它按 scope 分子目录
// （`data/content-dump/cloud` / `.../local`）。指到父目录会永远判"没有转储"= 闸恒挡（假安全）。
const contentDumpDir = () => process.env.CONTENT_DUMP_DIR || path.join(__dirname, '..', 'data', 'content-dump', 'cloud');
async function retentionReadout() {
  const { pendingPlan } = require('../lib/retention');
  const retentionDays = Number((await getSetting('data', {})).retentionDays ?? 7);
  const plan = pendingPlan('runner', retentionDays);
  const counts = {};
  for (const p of plan) counts[p.key] = Number(((await qOne(p.sql, [p.cutoff])) || {}).c || 0);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const cd = require('../lib/content-dump');
  const cred = await getSetting(cd.CREDENTIAL_KEY, null);
  const gate = cd.deleteGateAny(contentDumpDir(), cred, { maxAgeHours: cd.GATE_MAX_AGE_H });
  let history = [];
  try {
    const prev = await getSetting(RETENTION_READOUT_KEY, {});
    if (Array.isArray(prev.history)) history = prev.history.slice(-(RETENTION_HISTORY_MAX - 1));
  } catch { /* 首次无历史 */ }
  const today = nowIso().slice(0, 10);
  // 历史按**天**去重（顶层 `at/total/counts` 每次都刷新，所以"今天有多少条待删"始终是当前值）。
  // 不去重的话：collect 每 15 分钟跑一次读数，14 条历史只覆盖 3.5 小时 —— 那是抖动，不是趋势。
  const last = history[history.length - 1];
  if (!last || String(last.at).slice(0, 10) !== today) history.push({ at: nowIso(), retentionDays, total, counts, gateAllowed: !!gate.allowed });
  else history[history.length - 1] = { at: nowIso(), retentionDays, total, counts, gateAllowed: !!gate.allowed };
  const row = {
    at: nowIso(), scope: 'runner', retentionDays, total, counts,
    plan: plan.map((p) => ({ key: p.key, table: p.table, days: p.days, reason: p.reason })),
    gate: { allowed: !!gate.allowed, reason: gate.reason, via: gate.via || 'disk', dir: contentDumpDir() },
    history,
  };
  await putSetting(RETENTION_READOUT_KEY, row);
  return row;
}

// 每个批次结束后再刷一次读数，让 `retention.pending` 始终是**当前值**：
// cleanup 也在内 —— 删除前那次读数留在 `gate`/心跳里，删除后再刷一次才是"现在还有多少条待删"。
async function refreshRetentionReadout() {
  try { await retentionReadout(); } catch (e) { log(`保留读数失败（不阻断）: ${e.message}`); }
}

// ─── 模式：cleanup（数据清理；09-20T22:27Z 已实跑过一轮，删 50,823 条 —— 见 docs/ISSUES.md B101） ───
async function runCleanup() {
  // 删除谓词的**唯一实现**在 `lib/retention.js`（spec43 D1/B102）：本文件与 `api/collect.js`、
  // `server/services/datamgr.js` 三端共用同一份条件，改一处即改三处，不再各抄一遍。
  const { cutoffIso, deleteSql, HOTLIST_DAYS } = require('../lib/retention');
  const readout = await retentionReadout();
  log(`保留读数: ${readout.retentionDays} 天窗口下待删 ${readout.total} 条（${JSON.stringify(readout.counts)}）｜删除闸 ${readout.gate.allowed ? '放行' : '挡下'}：${readout.gate.reason}`);

  let deleted = 0;
  let retentionDeleted = 0;
  if (!readout.gate.allowed) {
    // 前置条件没满足 = 什么都不删，但**不许静默**：日志 + 心跳都带 blocked 原因
    log(`保留清理被删除闸挡下（本轮一条都不删）：${readout.gate.reason}`);
  } else {
    // 1) 热榜旧数据：固定 7 天（热榜是时效性内容，无保留价值），天数与读数同源（HOTLIST_DAYS）
    const r = await qRun(deleteSql('runner', 'hotlist'), [cutoffIso(HOTLIST_DAYS)]);
    deleted = r.changes;
    log(`清理完成: 删除 ${deleted} 条热榜旧数据（转储证据：${readout.gate.reason}）`);
    // 2) 普通文章按保留天数（T4-1 Q4，用户决策 2026-09-13：默认 7 天）
    //    豁免：已读/稍后读/精选标记（入过报与用户交互过的都不删）；视频/播客永不清理
    if (readout.retentionDays > 0) {
      const rr = await qRun(deleteSql('runner', 'retention'), [cutoffIso(readout.retentionDays)]);
      retentionDeleted = rr.changes;
      log(`保留天数清理: ${readout.retentionDays} 天前未读未标记文章删除 ${retentionDeleted} 条`);
    }
  }

  // 3) 熔断源自动恢复（T4-1 Q7）：冻结超 48h 自动重新启用（错峰），连续自动恢复 3 次仍熔断则冷却延长到 7 天
  let resumed = 0;
  try {
    const frozen = await qAll(`SELECT id, name, type, extra, last_fetched_at FROM sources WHERE enabled=0 AND status='error'`);
    const now = Date.now();
    for (const s of frozen) {
      let extra = {};
      try { extra = JSON.parse(s.extra || '{}'); } catch { /* 无 extra */ }
      if (extra.mergedInto || extra.retired) continue; // 合并/退役源不自动恢复
      const frozenAt = Date.parse(extra.frozenAt || extra.lastErrorAt || s.last_fetched_at || '') || 0;
      if (!frozenAt) continue;
      const resumeCount = Number(extra.resumeCount || 0);
      const waitMs = resumeCount >= 3 ? 7 * 86400e3 : 48 * 3600e3;
      if (now - frozenAt < waitMs) continue;
      extra.resumeCount = resumeCount + 1;
      extra.frozenAt = nowIso(); // 重置计时起点（下次若再熔断从新时刻算）
      await qRun(
        `UPDATE sources SET enabled=1, status='ok', fail_count=0, extra=?, next_fetch_at=? WHERE id=?`,
        [JSON.stringify(extra), new Date(now + Math.floor(Math.random() * 6 * 3600e3)).toISOString(), s.id]
      );
      resumed++;
      log(`自动恢复熔断源 #${s.id} ${String(s.name).slice(0, 24)}（第 ${extra.resumeCount} 次）`);
    }
  } catch (e) { log(`自动恢复失败（不阻断）: ${e.message}`); }

  // 4) 频率自适应（T4-2 R3）：仅 extra.autoInterval===true 的源，按近 14 天实测出文频率调 intervalMin
  //    （≥10 篇/天→60min；3-10→120；1-3→240；<1→720）。批量导入源将 autoInterval 打开即自动分层
  let autoAdj = 0;
  try {
    const autos = await qAll(`SELECT id, extra FROM sources WHERE enabled=1 AND type IN ('rss','x') AND COALESCE(json_extract(COALESCE(extra,'{}'),'$.autoInterval'),0)=1`);
    const since14 = new Date(Date.now() - 14 * 86400e3).toISOString();
    for (const s2 of autos) {
      const cnt = (await qOne('SELECT COUNT(*) c FROM articles WHERE source_id=? AND published_at >= ?', [s2.id, since14])).c;
      const perDay = cnt / 14;
      const suggested = perDay >= 10 ? 60 : perDay >= 3 ? 120 : perDay >= 1 ? 240 : 720;
      let ex = {};
      try { ex = JSON.parse(s2.extra || '{}'); } catch { /* 无 extra */ }
      if (ex.intervalMin === suggested) continue;
      ex.intervalMin = suggested;
      await qRun('UPDATE sources SET extra=? WHERE id=?', [JSON.stringify(ex), s2.id]);
      autoAdj++;
    }
    if (autoAdj) log(`频率自适应: 调整 ${autoAdj} 个源的 intervalMin`);
  } catch (e) { log(`频率自适应失败（不阻断）: ${e.message}`); }

  await writeHeartbeat('cleanup', {
    deleted, retentionDeleted, resumed, autoAdj,
    // 读数与"为什么没删"进心跳：监控面看一眼就知道触发口是暗的、挡在哪一步
    blocked: readout.gate.allowed ? null : 'delete-gate',
    pendingDeleted: readout.total,
    gateReason: readout.gate.allowed ? null : readout.gate.reason,
  });
  // 15-cloud-alerts F5：熔断不沉默——每日清理批次附带熔断待办汇总
  try { await require('../api/_alerts').frozenDigest(); } catch { /* 报警失败不阻断 */ }
  return { blocked: !readout.gate.allowed, deleted, retentionDeleted, resumed, pendingDeleted: readout.total };
}

// ─── 模式：weekly（20-weekly-picks：精选周刊，周五 18:03 北京，窗口=前7天） ───
const WEEKLY_THEMES = [
  { key: '行业大变化', weight: 1.2, kws: ['发布', '上线', '推出', '开源', '收购', '融资', '上市', '政策', '监管', '法案', '离职', '裁员', '合并'] },
  { key: '重大影响', weight: 1.15, kws: ['安全', '漏洞', '泄露', '下架', '事故', '宕机', '成本', '涨价', '降价', '禁令', '诉讼'] },
  { key: '教学课程', weight: 1.1, kws: ['教程', '指南', '实战', '课程', '训练营', '入门', '手册', '手把手', '从 0 到 1', '从0到1', '万字'] },
  { key: '新理解', weight: 1.05, kws: ['观点', '思考', '复盘', '范式', '趋势', '方法论', '本质', '洞察', '认知'] },
];
function classifyWeeklyTheme(item) {
  const text = `${item.title || ''} ${item.summary || ''} ${(item.tags || []).join(' ')}`;
  for (const t of WEEKLY_THEMES) {
    if (t.kws.some((k) => text.includes(k))) return t.key;
  }
  return '其它';
}
const WEEKLY_WEIGHT = { 行业大变化: 1.2, 重大影响: 1.15, 教学课程: 1.1, 新理解: 1.05, 其它: 0.9 };

async function runWeekly() {
  const _ai = require('../api/_ai');
  const BUDGET_MS = 60 * 60e3;
  const t0 = Date.now();

  const endUtc = nowIso();
  const startUtc = new Date(Date.now() - 7 * 86400e3).toISOString();
  log(`weekly 窗口: ${startUtc} ~ ${endUtc}（前 7 天）`);

  // 候选不拉 content_html：7 天窗口 × 2000 行全文一次取会被 libsql HTTP 链路掐断（Fatal: terminated），
  // 深析阶段按 id 单取（与 runTranslate 两步走同范式）
  const candidates = await qAll(
    `SELECT a.id, a.source_id, a.title, a.url, a.author, a.summary, a.published_at, a.score, a.cover, a.translated_title, s.name AS source_name
     FROM articles a LEFT JOIN sources s ON s.id = a.source_id
     WHERE a.published_at >= ? AND a.published_at < ? AND s.enabled = 1
       AND ${notNoiseSql('s')}
     ORDER BY a.published_at DESC LIMIT 2000`,
    [startUtc, endUtc]
  );
  const valid = candidates.filter((a) => !hasMojibake(a.title) && !isErrorPageItem(a));
  // T4-3 周报视频入报：窗口内视频取最近 15 条并入候选（跳过初筛直接深析段，kind=video + id v 前缀）
  try {
    const wVideos = await qAll(
      `SELECT v.id, v.source_id, v.title, v.url, v.intro, v.cover, v.published_at, s.name AS source_name
       FROM videos v LEFT JOIN sources s ON s.id = v.source_id
       WHERE v.created_at >= ? AND v.created_at < ? AND s.enabled = 1
       ORDER BY v.published_at DESC LIMIT 15`,
      [startUtc, endUtc]
    );
    for (const v of wVideos) {
      valid.push({ ...v, id: 'v' + v.id, kind: 'video', summary: v.intro || '', content_html: v.intro || '' });
    }
    if (wVideos.length) log(`周刊视频候选 +${wVideos.length}`);
  } catch { /* 不阻断 */ }
  // B17 预筛降量（lib/weekly-prefilter 唯一实现）：初筛预算只够 ~maxFilter 次调用，
  // 全部候选按时间倒序跑 = 只策展最新前缀（09-21 实测病根）。规则：≥60 分与视频全收，
  // 其余槽位按时间倒序补满预算——让预算覆盖「全周的高分内容」而不是「最新几小时」。
  const { prefilterWeekly } = require('../lib/weekly-prefilter');
  const maxFilter = Math.max(50, Math.floor((BUDGET_MS * 0.4) / ((Number(process.env.AI_MIN_INTERVAL_MS) || 4000) + 1500)));
  const pre = prefilterWeekly(valid, { maxFilter });
  if (pre.droppedCount > 0) {
    log(`预筛降量: 候选 ${valid.length} → ${pre.scoped.length}（≥60 分与视频保收 ${pre.keptCount} 条，裁掉 ${pre.droppedCount} 条低分且非最新；预算上限 ${maxFilter} 次调用）`);
  }
  log(`周刊候选 ${pre.scoped.length} 篇（原 ${valid.length}），开始初筛`);

  const passed = [];
  let filterFailed = 0;
  for (const a of pre.scoped) {
    if (Date.now() - t0 > BUDGET_MS * 0.4) { log('初筛预算截断'); break; }
    const f = await _ai.filterArticle({ title: a.title, source: a.source_name, summary: a.summary });
    if (f.failed) filterFailed++;
    if (!f.ignore) passed.push(a);
  }
  // 2026-09-23（P0-2 配套）：周刊与日报共用 filterArticle——失败数必须出现在日志里，
  // 否则 B16/B121 复验读本周日志时仍分不清"0 剔除"和"初筛没工作"
  log(`初筛通过 ${passed.length}（失败 ${filterFailed}），开始深析（预算 ≤150 篇）`);

  const analyzed = [];
  let consecFail = 0;
  for (const a of passed.slice(0, 150)) {
    if (Date.now() - t0 > BUDGET_MS) { log('深析预算耗尽，截断'); break; }
    const full = await qAll('SELECT content_html FROM articles WHERE id=?', [a.id]);
    const r = await _ai.analyzeArticle({ ...a, content_html: full[0] ? full[0].content_html : null });
    if (!r) {
      consecFail++;
      if (consecFail >= 3 && analyzed.length === 0) {
        // 降级：热度排序产出
        log('AI 连败 3 次，周刊降级为热度排序');
        const degraded = passed
          .sort((x, y) => (y.score || 0) - (x.score || 0))
          .slice(0, 20)
          .map((a, i) => ({ rank: i + 1, id: a.id, title: a.translated_title || a.title, original_title: a.translated_title ? a.title : undefined, url: a.url, source: a.source_name, cover: a.cover || null, totalScore: null, weeklyTheme: classifyWeeklyTheme(a) }));
        const pubDegraded = await saveWeekly(null, degraded, true, t0);
        return { degraded: true, count: degraded.length, published: !!pubDegraded };
      }
      continue;
    }
    consecFail = 0;
    analyzed.push({ ...a, ...r });
    if (typeof a.id === 'number' && Number.isFinite(r.totalScore)) {
      try { await qRun('UPDATE articles SET score=? WHERE id=?', [Math.round(r.totalScore), a.id]); } catch { /* 回写失败不阻断 */ }
    }
  }
  log(`深析完成 ${analyzed.length} 篇，终选 top 20`);

  const items = analyzed
    .map((a) => {
      const weeklyTheme = classifyWeeklyTheme(a);
      return {
        rank: 0, id: a.id, title: a.translated_title || a.title, original_title: a.translated_title ? a.title : undefined, url: a.url, source: a.source_name,
        cover: a.cover || null, published_at: a.published_at,
        totalScore: a.totalScore, scores: a.scores, reason: a.reason, summary: a.summary,
        quote: a.quote, points: a.points, tags: a.tags, translated: !!a.translated_title,
        weeklyTheme, impactScore: Math.round(a.totalScore * (WEEKLY_WEIGHT[weeklyTheme] || 1)),
      };
    })
    .sort((x, y) => y.impactScore - x.impactScore)
    .slice(0, 20)
    .map((it, i) => ({ ...it, rank: i + 1 }));

  // 2026-09-18：条数不足先放弃——别为一期注定不发布的内容花导语/周总结/杂志结构三笔 AI 开销。
  // 落库守卫在 saveWeekly 里（同一份 lib/brief-guards 口径），这里只是前置省配额。
  let theme = null; let weeklySummary = null; let magazine = null;
  if (require('../lib/brief-guards').canPublishWeekly(items)) {
    theme = await _ai.generateTheme(items.map((it) => ({ title: it.title, reason: it.reason }))).catch((e) => { log(`周刊导语生成失败: ${e.message}`); return null; });
    // T3-1 R8：周报 AI 总结注脚（页脚每周一份；降级版不出）
    weeklySummary = await _ai.generateWeeklySummary(items).catch((e) => { log(`周刊周总结失败: ${e.message}`); return null; });
    // 周刊 v2 杂志结构（specs/24）：封面主题词 + 主线策展 + 编辑长综述；失败回退旧版视图
    if (items.length >= 4) {
      // B121②：`agnes 仅含 reasoning 无 content` 是已知形态（B19/W6 同根），一次退避重试的代价
      // 远小于"整期深析齐全但主线骨架全丢"——上一期就是这么发出去还报 `degraded=false`。
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let attempt = 1; attempt <= 2 && !magazine; attempt++) {
        try { magazine = await _ai.generateWeeklyMagazine(items); }
        catch (e) {
          log(`周刊杂志结构第 ${attempt} 次失败${attempt < 2 ? '，退避 15s 后重试一次' : '（回退旧版）'}: ${e.message}`);
          if (attempt < 2) await sleep(15000);
        }
      }
    }
  }
  const published = await saveWeekly(theme, items, false, t0, weeklySummary, magazine);
  return { count: items.length, theme, weeklySummary, magazine: !!magazine, published };
}

async function saveWeekly(theme, items, degraded, t0, weeklySummary = null, magazine = null) {
  // 2026-09-18 发布守卫：条目不足一律不写库。saveWeekly 是无条件 INSERT OR REPLACE，
  // 一次候选为 0 / AI 全灭的跑批会把上一期好内容整体抹掉（线上实测当前唯一一期即 09-17 手工降级产物），
  // 且降级分支只在深析连败时触发，items=[] 时连 degraded 都写 false → 空白周刊且无任何报警。
  const guards = require('../lib/brief-guards');
  if (!guards.canPublishWeekly(items)) {
    const n = Array.isArray(items) ? items.length : 0;
    log(`周刊放弃发布：本期仅 ${n} 条（< ${guards.WEEKLY_MIN_ITEMS}），保留上一期 weekly.latest 不被覆盖`);
    await writeHeartbeat('weekly', { published: false, count: n, reason: 'below-min-items', degraded: !!degraded });
    return false;
  }
  // 对抗性审查补丁（2026-09-13）：周报引用的文章打 featured=1——cleanup 的保留清理豁免 featured，
  // 否则大清理会把「周刊永久归档」引用的文章删掉（详情断链，违背周刊长久存储决策）
  const itemIds = (items || []).map((it) => Number(it.id)).filter(Number.isFinite);
  if (itemIds.length) {
    await qRun(`UPDATE articles SET featured=1 WHERE id IN (${itemIds.join(',')}) AND COALESCE(featured,0)=0`);
  }
  // 期号与归档（B121①③）：先算窗口，再按窗口定期号；骨架缺失如实进状态
  const archive = (await getSetting('weekly.archive', [])) || [];
  const dateEnd = beijingDateStr();
  const dateStart = beijingDateStr(Date.now() - 7 * 86400e3);
  const spine = guards.weeklySpine({ theme, magazine });
  // 状态灯与端到端剧本同源：E6 断言的是"页面上有没有主线/故事线"，那 `degraded` 就必须为真，
  // 不能像上一期那样"深析 20 条 + 骨架全丢 + degraded=false"（B121 的正是这一格）
  const degradedFlag = !!degraded || spine.spineMissing;
  const { issue, replaceIndex } = guards.resolveWeeklyIssue(archive, { dateStart, dateEnd });
  const report = {
    issue, dateStart, dateEnd, theme, degraded: degradedFlag,
    spineMissing: spine.spineMissing, spineMissingParts: spine.missing, weeklySummary,
    ...(magazine ? { coverTheme: magazine.coverTheme, editorNote: magazine.editorNote || null, storylines: magazine.storylines } : {}),
    generatedAt: nowIso(), elapsedMin: Math.round((Date.now() - t0) / 600e2) / 10,
    items,
  };
  await getDb().execute({ sql: "INSERT OR REPLACE INTO settings(key, value) VALUES('weekly.latest', ?)", args: [JSON.stringify(report)] });
  // 长久存储（2026-09-13 F5 用户决策）：一周才一份，归档不再截断保留全部期号
  const entry = { issue, dateStart, dateEnd, theme, count: items.length, report };
  if (replaceIndex >= 0) {
    // 同一内容窗口重跑（换库后手动补跑、失败重试都算）→ 原地替换，不另起一期
    log(`周刊第 ${issue} 期同窗口重跑 → 原地替换归档第 ${replaceIndex + 1} 条，不另算新期`);
    archive[replaceIndex] = entry;
  } else {
    archive.push(entry);
  }
  await getDb().execute({ sql: "INSERT OR REPLACE INTO settings(key, value) VALUES('weekly.archive', ?)", args: [JSON.stringify(archive)] });
  log(`周刊第 ${issue} 期生成完成: ${items.length} 条${degradedFlag ? `（降级${spine.spineMissing ? `·骨架缺 ${spine.missing.join('/')}` : ''}）` : ''}, 主题: ${theme || '(无)'}`);
  await writeHeartbeat('weekly', { issue, count: items.length, degraded: degradedFlag, spineMissing: spine.spineMissing, published: true });
  return true;
}

// ─── T3-1 R0c 主题全景（2026-09-13）───
// 把碎片聚合成主题全景：标题 Jaccard 聚类 → 每簇 AI 命名 + 四类视角 + 跨源综述。
// 用户需求原文：把碎片聚合成主题全景，事件/领域/人物/产品对比四类视角。
async function buildThemePanorama(items) {
  const _ai = require('../api/_ai');
  if (!items || items.length < 2) return [];
  const clusters = [];
  for (const it of items) {
    const tok = titleTokens(it.translated_title || it.title || '');
    if (!tok.length) continue;
    let hit = null;
    for (const c of clusters) {
      if (jaccard(tok, c.tokens) >= 0.45) { hit = c; break; }
    }
    if (hit) { hit.items.push(it); for (const t of tok) hit.tokens.add(t); }
    else clusters.push({ tokens: new Set(tok), items: [it] });
  }
  const rated = clusters
    .filter((c) => c.items.length >= 2)
    .map((c) => ({ items: c.items, score: c.items.reduce((n, i) => n + (i.totalScore || 0), 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4); // 最多 4 个主题，控 AI 配额
  const VIEWS = ['事件', '领域', '人物', '产品对比'];
  const themes = [];
  for (const c of rated) {
    // 2026-09-14 修复：输入不再带「评语」——AI 曾把综述写成对评语的元评论（"分歧在于评语高度相似…"），
    // 综述应总结事件/主题本身的事实与各源侧重（用户验收：「这个地方不是总结吗？」）
    const list = c.items.map((i) => `- ${i.translated_title || i.title}（来源：${i.source_name || ''}）${i.summary ? `｜摘要：${String(i.summary).slice(0, 80)}` : ''}`).join('\n');
    const prompt = `你是科技媒体主编。下面多条报道属于同一主题。只输出严格 JSON（不要解释）：{"name":"主题名（不超过12字）","viewpoint":"事件、领域、人物、产品对比 四选一","summary":"不超过100字的跨源综述：概括这件事/这个主题本身的事实与各源侧重；禁止评论文章质量、评分或'评语'，禁止出现'评语'二字"}\n\n${list}`;
    const r = await _ai.aiChat([{ role: 'user', content: prompt }], { kind: 'theme', maxTokens: 300, timeoutMs: 60000 });
    if (!r.ok) continue;
    const m = String(r.reply || '').match(/\{[\s\S]*\}/);
    if (!m) continue;
    try {
      const j = JSON.parse(m[0]);
      if (!j.name || !j.summary) continue;
      themes.push({
        name: String(j.name).slice(0, 20),
        viewpoint: VIEWS.includes(j.viewpoint) ? j.viewpoint : '事件',
        summary: String(j.summary).slice(0, 160),
        items: c.items.map((i) => ({ id: i.id, title: i.translated_title || i.title, url: i.url, source: i.source_name, kind: i.kind || 'article' })),
      });
    } catch { /* 跳过坏簇 */ }
  }
  return themes;
}

// ─── 模式：daily-ai（18-daily-ai-v2：AI 策展早报） ───
// 窗口二态（T3-1 R0）：默认北京自然日 [昨00:00, 今00:00)；--rolling24 时取滚动 24h [now-24h, now)
// ——晚间 21:30 的 cron 用 rolling24，实现「晚间整理刚过去的一天，次日早上呈现」
const ROLLING24 = process.argv.includes('--rolling24');

function briefWindow() {
  if (ROLLING24) {
    const end = Date.now();
    return { startUtc: new Date(end - 24 * 3600e3).toISOString(), endUtc: new Date(end).toISOString(), label: '滚动24h' };
  }
  const dayStart = beijingDayStartMs();
  return {
    startUtc: new Date(dayStart - 86400e3).toISOString(),
    endUtc: new Date(dayStart).toISOString(),
    label: '北京自然日',
  };
}


// ─── T3-1 R7 阅读足迹（2026-09-13）：晚间生成当日阅读小结（reading 表聚合，规则版零 AI 消耗）───
async function buildReadingDigest() {
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const readCount = (await qOne('SELECT COUNT(*) c FROM articles WHERE read_at >= ?', [since])).c;
  const laterCount = (await qOne('SELECT COUNT(*) c FROM articles WHERE later=1')).c;
  const topSources = await qAll(
    `SELECT s.name AS name, s.avatar AS avatar, COUNT(*) c
     FROM articles a LEFT JOIN sources s ON s.id = a.source_id
     WHERE a.read_at >= ? AND s.id IS NOT NULL
     GROUP BY s.name ORDER BY c DESC LIMIT 5`,
    [since]
  );
  const digest = {
    date: nowIso().slice(0, 10), generatedAt: nowIso(),
    readCount, laterCount,
    topSources: topSources.map((r) => ({ name: r.name, avatar: r.avatar, count: r.c })),
  };
  await getDb().execute({ sql: "INSERT OR REPLACE INTO settings(key, value) VALUES('reading.digest', ?)", args: [JSON.stringify(digest)] });
  log(`阅读足迹: 今日读 ${readCount} 篇，稍后读 ${laterCount} 条`);
  return digest;
}


// T4-2 R4 配套（2026-09-14）：六维评分回写 articles.score——此前评分只存快照 JSON，
// 热点榜精选/权威加权/score_min 全部无米下锅。视频条目（'v' 前缀）跳过。
async function persistScores(analyzed) {
  return require('../lib/score-persist').persistScores(analyzed, qRun);
}

async function runDailyAi() {
  const _ai = require('../api/_ai');
  const BUDGET_MS = 90 * 60e3;
  const t0 = Date.now();

  const { startUtc, endUtc, label } = briefWindow();
  log(`daily-ai 窗口: ${startUtc} ~ ${endUtc}（${label}）`);

  // 候选（沿用关键词版排除规则）
  const cfg = await getSetting('daily', {});
  const selectedIds = Array.isArray(cfg.articleSourceIds) ? cfg.articleSourceIds.map(Number) : null;
  let sql = `SELECT a.id, a.source_id, a.title, a.url, a.author, a.summary, a.content_html, a.published_at, a.score, a.cover, a.translated_title, s.name AS source_name, s.spotlight AS source_spotlight
             FROM articles a LEFT JOIN sources s ON s.id = a.source_id
             WHERE a.published_at >= ? AND a.published_at < ? AND s.enabled = 1
               AND ${notNoiseSql('s')}`;
  const args = [startUtc, endUtc];
  if (selectedIds && selectedIds.length) {
    sql += ` AND a.source_id IN (${selectedIds.map(() => '?').join(',')})`;
    args.push(...selectedIds);
  }
  sql += ' ORDER BY a.published_at DESC LIMIT 500';
  const candidates = await qAll(sql, args);
  const AI_LIMIT = Number(process.env.DAILY_AI_LIMIT) || Infinity; // 调试用：限制候选数
  const valid = candidates.filter((a) => !hasMojibake(a.title) && !isErrorPageItem(a)).slice(0, AI_LIMIT);
  log(`候选 ${valid.length} 篇，开始两阶段初筛`);

  // 阶段 1：初筛（2026-09-23 P0-2 配套：失败/截断计数落 filterStats，异常发报警——判据唯一实现 lib/filter-observe.js）
  const passed = [];
  let filterFailed = 0, filterRejected = 0, filterTruncated = false;
  for (const a of valid) {
    if (Date.now() - t0 > BUDGET_MS * 0.5) { filterTruncated = true; log('初筛预算过半，截断'); break; }
    const f = await _ai.filterArticle({ title: a.title, source: a.source_name, category: null, summary: a.summary });
    if (f.failed) filterFailed++;
    if (!f.ignore) passed.push({ ...a, filterScore: f.score, filterReason: f.reason });
    else filterRejected++;
  }
  log(`初筛通过 ${passed.length}/${valid.length}（失败 ${filterFailed}、剔除 ${filterRejected}），开始深析`);
  // "失败但没全挂"此前是盲区：全挂有 _ai 的 consecFail≥3 报警，部分失败谁都不说——
  // 用户 2026-09-23 裁定：这类异常发报警渠道给管理者（飞书），不上前台页面
  try {
    const fa = require('../lib/filter-observe').filterAlert({ attempted: passed.length + filterRejected, failed: filterFailed, truncated: filterTruncated });
    if (fa.alert) {
      log(`初筛异常：${fa.text}`);
      await require('../api/_alerts').aiFailed(`早报初筛异常：${fa.text}。候选 ${valid.length} 篇，本期评分偏松`);
    }
  } catch (e) { log(`初筛异常报警失败（不阻断）: ${e.message}`); }

  // 降级判定：首批深析连败 3 次 → AI 链路全挂
  const analyzed = [];
  let consecFail = 0;
  for (const a of passed) {
    if (Date.now() - t0 > BUDGET_MS) { log('深析预算耗尽，截断'); break; }
    const r = await _ai.analyzeArticle(a);
    if (!r) {
      consecFail++;
      if (consecFail >= 3 && analyzed.length === 0) {
        log('AI 链路连败 3 次，降级关键词版');
        const stats = await runDaily();
        // B112：原来这里写的是字符串 '1'（json_set 第三个实参带引号）→ 落库成 JSON 文本 "1"。
        // 只把常量当**绑定参数**传进来还不够：JS number 经驱动绑进 SQLite 是 double，
        // json_set 会存成 `1.0`（json_type = real）—— 实测过，所以必须 CAST AS INTEGER。
        await qRun("UPDATE daily_reports SET stats = json_set(stats, '$.degraded', json('true'), '$.schemaVersion', CAST(? AS INTEGER)) WHERE id = (SELECT MAX(id) FROM daily_reports)", [require('../lib/brief-guards').DAILY_SCHEMA_VERSION.KEYWORD]);
        return { degraded: true, fallback: stats };
      }
      continue;
    }
    consecFail = 0;
    analyzed.push({ ...a, ...r });
  }
  log(`深析完成 ${analyzed.length} 篇，组装栏目`);

  // T4-3 视频入报（2026-09-13）：窗口内视频取最近 20 条直接深析并入同池；
  // id 加 v 前缀防与文章 id 冲突（report 条目 kind='video'，前端点开走外链）
  try {
    const videoRows = await qAll(
      `SELECT v.id, v.source_id, v.title, v.url, v.intro, v.cover, v.published_at, s.name AS source_name, s.spotlight AS source_spotlight
       FROM videos v LEFT JOIN sources s ON s.id = v.source_id
       WHERE v.created_at >= ? AND v.created_at < ? AND s.enabled = 1
       ORDER BY v.published_at DESC LIMIT 20`,
      [startUtc, endUtc]
    );
    let vCount = 0;
    for (const v of videoRows) {
      if (Date.now() - t0 > BUDGET_MS) { log('视频深析预算耗尽，截断'); break; }
      const text = { ...v, content_html: v.intro || '', summary: v.intro || '' };
      const r = await _ai.analyzeArticle(text);
      if (!r) continue;
      analyzed.push({ ...text, ...r, id: 'v' + v.id, kind: 'video', vid: v.id });
      vCount++;
    }
    if (vCount) log(`视频入报: 深析 ${vCount}/${videoRows.length} 条`);
  } catch (e) { log(`视频入报失败（不阻断）: ${e.message}`); }

  // T3-1 R0c 主题全景：深析条目按标题聚类（Jaccard≥0.45，簇≥2），每簇 1 次 AI 调用出
  // 主题名 + 四类视角（事件/领域/人物/产品对比）+ ≤100 字跨源综述；按簇总分取前 4
  let themes = [];
  try { themes = await buildThemePanorama(analyzed); } catch (e) { log(`主题全景失败（不阻断）: ${e.message}`); }

  // ── T4-2 R4 七层防御入报 ──
  // L5a 权威加权：近 30 天源级高分率 → authority ∈ [0.8,1.2] 乘入 totalScore（权威大事件排前）
  try {
    const since30 = new Date(Date.now() - 30 * 86400e3).toISOString();
    const authRows = await qAll(
      `SELECT s.name AS name, COUNT(*) total, SUM(CASE WHEN a.score >= 70 THEN 1 ELSE 0 END) good
       FROM articles a LEFT JOIN sources s ON s.id = a.source_id
       WHERE a.published_at >= ? AND a.score IS NOT NULL AND s.id IS NOT NULL
       GROUP BY s.name HAVING total >= 5`,
      [since30]
    );
    const authMap = new Map(authRows.map((r) => [r.name, Math.max(0.8, Math.min(1.2, 0.8 + 0.4 * (r.good / r.total)))]));
    for (const a of analyzed) {
      const k = authMap.get(a.source_name);
      if (k !== undefined) a.totalScore = Math.max(0, Math.min(100, Math.round((a.totalScore || 0) * k)));
    }
    if (authMap.size) log(`L5 权威加权: ${authMap.size} 源有系数`);
  } catch (e) { log(`L5 权威加权失败（不阻断）: ${e.message}`); }

  // ─── 分析后质量门槛（2026-09-18，坑 #34）───
  // 此前深析完全没有否决权：analyzeArticle 的返回契约里没有 ignore/veto 字段，模型只能把
  // 「不适合收录」写进 reason 散文，而组装阶段从不读 reason。线上实测 score=10 的二手硬件交易帖
  // 坐进最显眼的「重点更新」栏（该栏只看"源"有没有被标 spotlight，完全不看分），score=22 的
  // 志愿者招募提醒进「培训课程发布」头条位。门槛放在 L5 加权之后，保证"用户看到的星数"
  // 就是"被判定过的那个分"，不会出现加权前 31→加权后 26 还留在报里的错位。
  let gateDropped = 0; // 与其它四份写入器同一口径：stats.gateDropped = 门槛剔掉的条数
  try {
    const guards = require('../lib/brief-guards');
    const aiCfg = await getSetting('ai', {});
    const g = guards.applyDailyQualityGate(analyzed, aiCfg?.dailyMinScore, log);
    gateDropped = g.dropped;
    analyzed.length = 0;
    analyzed.push(...g.kept);
  } catch (e) { log(`分析后门槛失败（不阻断出报，但本期等于无门槛）: ${e.message}`); }

  // L5b 低曝光保护位：近 14 天从未入报且六维 ≥75 的源，保底 2 个名额（防小众行业级内容被淹没）
  let protectedItems = [];
  try {
    const exposed = new Set();
    const reps = await qAll('SELECT sections FROM daily_reports WHERE generated_at >= ? ORDER BY id DESC LIMIT 14', [new Date(Date.now() - 14 * 86400e3).toISOString()]);
    for (const rep of reps) {
      try { for (const col of JSON.parse(rep.sections || '[]')) for (const it of (col.items || [])) if (it.source) exposed.add(it.source); } catch { /* 坏行 */ }
    }
    protectedItems = analyzed
      .filter((a) => a.source_name && !exposed.has(a.source_name) && (a.totalScore || 0) >= 75)
      .sort((x, y) => y.totalScore - x.totalScore)
      .slice(0, 2);
    if (protectedItems.length) log(`L5b 低曝光保护位: ${protectedItems.map((p) => p.source_name).join('/')}`);
  } catch (e) { log(`L5b 保护位失败（不阻断）: ${e.message}`); }

  // 栏目组装（沿用 columns 语义：spotlight 优先 → 关键词 → fallback 按总分；27b 兼容旧 special 值 'focus'）
  // L3 单源配额：同源单日入报 ≤3（跨栏计数，防单源刷屏）；全局总条数 ≤36
  const columns = await getSetting('daily.columns', null) || DEFAULT_COLUMNS;
  const used = new Set();
  const perSource = {};
  const sections = [];
  const fmt = (a) => ({
    id: a.id, title: a.translated_title || a.title, original_title: a.translated_title ? a.title : undefined, url: a.url, source: a.source_name,
    source_name: a.source_name, published_at: a.published_at, cover: a.cover || null,
    totalScore: a.totalScore, score: a.totalScore, // score 兼容现有 Stars 组件
    scores: a.scores, kind: a.kind || 'article',
    reason: a.reason, summary: a.summary, quote: a.quote, points: a.points, tags: a.tags,
    translated: !!a.translated_title,
  });
  const take = (a) => {
    const nm = a.source_name || '?';
    if ((perSource[nm] || 0) >= 3) return false;
    perSource[nm] = (perSource[nm] || 0) + 1;
    used.add(a.id);
    return true;
  };
  for (const col of columns) {
    const items = [];
    if (col.special === 'spotlight' || col.special === 'focus') {
      for (const a of analyzed) {
        if (used.has(a.id)) continue;
        if (a.source_spotlight && take(a)) items.push(fmt(a));
      }
    } else if (col.special === 'fallback') {
      const rest = analyzed.filter((a) => !used.has(a.id)).sort((x, y) => y.totalScore - x.totalScore).slice(0, 10);
      for (const a of rest) { if (take(a)) items.push(fmt(a)); }
    } else if (col.keywords && col.keywords.length) {
      for (const a of analyzed) {
        if (used.has(a.id)) continue;
        const text = `${a.title} ${a.summary || ''} ${(a.tags || []).join(' ')}`;
        if (col.keywords.some((kw) => text.includes(kw))) { if (take(a)) items.push(fmt(a)); }
      }
    }
    const deduped = dedupItems(items);
    if (deduped.length) sections.push({ column: col.name, desc: col.desc || '', items: deduped.slice(0, 15) });
  }
  // L5b 保底注入：保护位条目若未被任何栏收纳，插入第一个栏目第 2 位
  if (sections.length && protectedItems.length) {
    const placed = new Set(sections.flatMap((sec) => sec.items.map((i) => i.id)));
    const first = sections[0];
    let pos = 1;
    for (const p of protectedItems) {
      if (placed.has(p.id) || first.items.length >= 15) continue;
      if (first.items.some((i) => i.id === p.id)) continue;
      first.items.splice(pos, 0, fmt(p));
      pos++;
    }
  }
  // L3 全局上限 36
  {
    let n = 0;
    for (const sec of sections) {
      if (n + sec.items.length > 36) sec.items = sec.items.slice(0, Math.max(0, 36 - n));
      n += sec.items.length;
    }
  }
  // 2026-09-14：日报纳入「视频与播客」栏（窗口内新视频 + 播客音频条目；免 AI 直接列，点开可播放收听）
  try {
    const mediaItems = [];
    const mediaVids = await qAll(
      `SELECT v.id, v.title, v.url, v.cover, v.published_at, v.intro, v.duration, s.name AS source_name, s.avatar AS source_avatar
       FROM videos v JOIN sources s ON s.id=v.source_id
       WHERE v.published_at >= ? AND v.published_at < ? AND s.enabled = 1
       ORDER BY v.published_at DESC LIMIT 6`,
      [startUtc, endUtc]
    );
    for (const v of mediaVids) {
      // intro/duration 此前根本没查出来：视频卡只能显示一个光标题，前端没有摘要可渲染
      mediaItems.push({ id: 'v' + v.id, ref_id: v.id, kind: 'video', title: v.title, url: v.url, source: v.source_name, source_name: v.source_name, published_at: v.published_at, cover: v.cover, summary: v.intro || undefined, duration: v.duration || null, source_avatar: v.source_avatar || null });
    }
    const mediaPods = await qAll(
      `SELECT a.id, a.title, a.translated_title, a.url, a.cover, a.published_at, s.name AS source_name, s.avatar AS source_avatar
       FROM articles a JOIN sources s ON s.id=a.source_id
       WHERE a.published_at >= ? AND a.published_at < ? AND s.enabled = 1
         AND ${require('../lib/media').audioCoverSql('a.cover')}
       ORDER BY a.published_at DESC LIMIT 4`,
      [startUtc, endUtc]
    );
    for (const a of mediaPods) {
      mediaItems.push({ id: a.id, ref_id: a.id, kind: 'podcast', title: a.translated_title || a.title, original_title: a.translated_title ? a.title : undefined, url: a.url, source: a.source_name, source_name: a.source_name, published_at: a.published_at, audio_url: a.cover, cover: null, source_avatar: a.source_avatar || null });
    }
    if (mediaItems.length) {
      sections.push({ column: '视频与播客', desc: '窗口内新视频/播客，点开即可播放收听', items: mediaItems });
      log(`日报媒体栏: 视频 ${mediaVids.length} + 播客 ${mediaPods.length}`);
    }
  } catch (e) { log(`日报媒体栏失败（不阻断）: ${e.message}`); }

  // 主题导语
  const allItems = sections.flatMap((s) => s.items);
  const theme = await _ai.generateTheme(allItems).catch((e) => { log(`每日早报导语生成失败（本期无导语）: ${e.message}`); return null; });

  // 统计卡契约（B2 修复）：StatCards 读 candidates/articles/videos——daily-ai 候选全是文章，
  // 视频数取窗口内 videos 表新增（T4-3 视频入报后此处口径随之升级）
  let windowVideos = 0;
  try {
    windowVideos = (await qOne('SELECT COUNT(*) c FROM videos WHERE created_at >= ?', [startUtc])).c || 0;
  } catch { /* 统计失败不阻断 */ }
  const stats = {
    schemaVersion: require('../lib/brief-guards').DAILY_SCHEMA_VERSION.AI, theme, degraded: false, themes,
    candidates: valid.length, articles: valid.length, videos: windowVideos, gateDropped,
    filterStats: { candidates: valid.length, passed: passed.length, analyzed: analyzed.length, failed: filterFailed, truncated: filterTruncated },
    sections: sections.length, totalItems: allItems.length,
    elapsedMin: Math.round((Date.now() - t0) / 600e2) / 10,
  };
  await qRun(
    'INSERT INTO daily_reports(generated_at, window_hours, stats, sections) VALUES(?, ?, ?, ?)',
    [nowIso(), 24, JSON.stringify(stats), JSON.stringify(sections)]
  );
  log(`daily-ai 早报生成完成: ${sections.length} 栏 ${allItems.length} 条, 耗时 ${stats.elapsedMin}min, 主题: ${theme || '(无)'}`);
  await writeHeartbeat('daily-ai', stats);
  // 六维评分回写 articles.score（热点榜精选/权威加权的数据源）
  try { const n = await persistScores(analyzed); if (n) log(`六维评分回写 ${n} 条 → articles.score`); } catch (e) { log(`评分回写失败（不阻断）: ${e.message}`); }
  // 19-my-brief：复用深析池生成「我的早报」（零额外深析调用）
  try { await runMyBrief(analyzed); } catch (err) { log(`mybrief 生成失败（已隔离）: ${err.message}`); }
  // T3-1 R7：阅读足迹小结
  try { await buildReadingDigest(); } catch (err) { log(`阅读足迹失败（已隔离）: ${err.message}`); }
  return stats;
}

// ─── 我的早报（19-my-brief）：订阅源专属策展，复用 daily-ai 深析池 ───

// ─── T3-1 R5 行为画像（2026-09-14）：显式行为驱动（阅读/稍后读 → 标签权重）───
async function buildInterestProfile() {
  const since = new Date(Date.now() - 30 * 86400e3).toISOString();
  const rows = await qAll(
    `SELECT a.tags,
            SUM((CASE WHEN a.read_at >= ? THEN 2 ELSE 0 END) + (CASE WHEN a.later = 1 THEN 1 ELSE 0 END)) AS w
     FROM articles a
     WHERE (a.read_at >= ? OR a.later = 1) AND a.tags IS NOT NULL AND a.tags != ''
     GROUP BY a.tags HAVING w > 0 LIMIT 800`,
    [since, since]
  );
  const freq = {};
  for (const r of rows) {
    let tags = [];
    try { tags = JSON.parse(r.tags); } catch { continue; }
    if (!Array.isArray(tags)) continue;
    for (const t of tags) if (t) freq[t] = (freq[t] || 0) + Number(r.w || 0);
  }
  const tags = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([tag, weight]) => ({ tag, weight: Math.round(weight * 10) / 10 }));
  const profile = { tags, updatedAt: nowIso() };
  await getDb().execute({ sql: "INSERT OR REPLACE INTO settings(key, value) VALUES('mybrief.interestProfile', ?)", args: [JSON.stringify(profile)] });
  log(`行为画像: ${tags.length} 个标签（Top: ${tags.slice(0, 3).map((t) => t.tag + ':' + t.weight).join(', ')}）`);
  return profile;
}

async function runMyBrief(analyzed) {
  const _ai = require('../api/_ai');
  // 27b（2026-09-15）：订阅集合 = settings subscription.ids（源四轴之「订阅」轴；键缺失时兜底 spotlight 集合）
  const subIdsArr = await require('../lib/source-axes').resolveSubscriptionIds({ qAll, getSetting });
  const subs = subIdsArr.map((id) => ({ id }));
  if (!subs.length) {
    await getDb().execute({ sql: "INSERT OR REPLACE INTO settings(key, value) VALUES('mybrief.latest', ?)", args: [JSON.stringify({ empty: 'no-subscription', date: nowIso().slice(0, 10) })] });
    log('mybrief: 无订阅源（subscription.ids 为空），写引导态');
    return { empty: 'no-subscription' };
  }
  const subIds = new Set(subs.map((s) => s.id));
  const mbCfg = await getSetting('mybrief', {}); // T3-1 R5：exploreStrength/domainQuotas 读取前提
  const dateStr = beijingDateStr();
  // 设计修正：早报不能依赖 daily 的 top-N 切片共享池（订阅源可能不在内）——
  // 订阅源在窗口内的文章单独补齐分析；已在池中的复用，零重复调用
  const analyzedIds = new Set((analyzed || []).map((a) => a.id));
  const { startUtc, endUtc } = briefWindow(); // T3-1 R0：与 daily-ai 同窗口二态（晚间 rolling24）
  const profile = await buildInterestProfile().catch(() => null);
  const subArticles = await qAll(
    `SELECT a.id, a.source_id, a.title, a.url, a.summary, a.content_html, a.published_at, a.cover, a.translated_title, s.name AS source_name
     FROM articles a JOIN sources s ON s.id = a.source_id
     WHERE a.source_id IN (${subs.map(() => '?').join(',')})
       AND a.published_at >= ? AND a.published_at < ?
     ORDER BY a.published_at DESC LIMIT 60`,
    [...subs.map((s) => s.id), startUtc, endUtc]
  );
  const minePool = (analyzed || []).filter((a) => subIds.has(a.source_id));
  const toAnalyze = subArticles.filter((a) => !analyzedIds.has(a.id)).slice(0, 30);
  log(`mybrief: 订阅源窗口内 ${subArticles.length} 篇（复用池 ${minePool.length} / 待补析 ${toAnalyze.length}）`);
  for (const a of toAnalyze) {
    const r = await _ai.analyzeArticle({ ...a, source_name: a.source_name });
    if (r) {
      minePool.push({ ...a, ...r });
      if (typeof a.id === 'number' && Number.isFinite(r.totalScore)) {
        try { await qRun('UPDATE articles SET score=?, reason=? WHERE id=?', [Math.round(r.totalScore), r.reason || null, a.id]); } catch { /* 回写失败不阻断 */ }
      }
    }
  }
  // R5 行为画像加权：条目标签命中画像 Top5 → 每命中 +8（上限 +24，显式行为驱动个性化排序）
  let boostN = 0;
  const profMap = new Map((profile?.tags || []).slice(0, 5).map((t) => [t.tag, t.weight]));
  for (const a of minePool) {
    let hit = 0;
    let tags = [];
    try { tags = typeof a.tags === 'string' ? JSON.parse(a.tags) : (a.tags || []); } catch { tags = []; }
    for (const t of tags) if (profMap.has(t)) hit++;
    if (hit) { a.totalScore = Math.min(100, (a.totalScore || 0) + Math.min(24, hit * 8)); boostN++; }
  }
  const mine = minePool.sort((x, y) => y.totalScore - x.totalScore);
  if (boostN) log(`mybrief: 行为画像加权 ${boostN} 条`);

  // Domain 篇数配额（T3-1 R5）：主标签（tags[0]）超配额的条目移出本日早报
  const quotas = (mbCfg.domainQuotas && typeof mbCfg.domainQuotas === 'object') ? mbCfg.domainQuotas : null;
  if (quotas) {
    const usedQ = {};
    const kept = [];
    for (const a of mine) {
      let tags = [];
      try { tags = typeof a.tags === 'string' ? JSON.parse(a.tags) : (a.tags || []); } catch { tags = []; }
      const pt = tags[0];
      const cap = pt ? quotas[pt] : undefined;
      if (cap !== undefined && cap !== null && (usedQ[pt] || 0) >= Number(cap)) { continue; }
      if (pt) usedQ[pt] = (usedQ[pt] || 0) + 1;
      kept.push(a);
    }
    if (kept.length !== mine.length) log(`mybrief: Domain 配额移出 ${mine.length - kept.length} 条`);
    mine.length = 0;
    mine.push(...kept);
  }
  if (!mine.length) {
    await getDb().execute({ sql: "INSERT OR REPLACE INTO settings(key, value) VALUES('mybrief.latest', ?)", args: [JSON.stringify({ empty: 'no-content', date: dateStr, message: '今天你的订阅源没有新的精选内容' })] });
    log('mybrief: 订阅源今日无深析内容，写空态');
    return { empty: 'no-content' };
  }
  const fmt = (a) => ({
    id: a.id, source_id: a.source_id, title: a.translated_title || a.title, original_title: a.translated_title ? a.title : undefined, url: a.url,
    source: a.source_name, cover: a.cover || null, published_at: a.published_at,
    totalScore: a.totalScore, scores: a.scores, reason: a.reason, summary: a.summary,
    quote: a.quote, points: a.points, tags: a.tags, translated: !!a.translated_title,
  });
  // 补充阅读固定 10 条（T3-1 R4）：订阅源条目不足时，从共享深析池的**非订阅源**高分内容补足，
  // 标记 explore=true（破茧/探索语义）；补足仅为展示层，不改订阅集合
  // L6 补充阅读精确 10 条（T4-2 R4）：订阅余量优先 + 探索位按 MMR（0.7·相关性 − 0.3·最大相似）
  // 探索强度（settings mybrief.exploreStrength）：low=2 / mid=4 / high=6 条来自未订阅源
  const strength = ({ low: 2, mid: 4, high: 6 })[String(mbCfg.exploreStrength || 'mid')] ?? 4;
  const subRest = mine.slice(10, 10 + (10 - strength)).map(fmt);
  const chosen = new Set(mine.slice(0, 10 + subRest.length).map((m) => m.id));
  const pool = (analyzed || [])
    .filter((a) => !subIds.has(a.source_id) && !chosen.has(a.id) && (a.totalScore || 0) >= 70)
    .sort((x, y) => y.totalScore - x.totalScore)
    .slice(0, 30)
    .map((a) => ({ a, tok: titleTokens(a.translated_title || a.title || '') }));
  const selected = [];
  const selToks = [];
  while (selected.length < strength && pool.length) {
    let best = -1, bestVal = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const rel = (pool[i].a.totalScore || 0) / 100;
      let maxSim = 0;
      for (const tk of selToks) {
        const sim = jaccard(pool[i].tok, tk);
        if (sim > maxSim) maxSim = sim;
      }
      const val = 0.7 * rel - 0.3 * maxSim;
      if (val > bestVal) { bestVal = val; best = i; }
    }
    const [pick] = pool.splice(best, 1);
    selToks.push(pick.tok);
    selected.push(pick.a);
  }
  if (selected.length) log(`mybrief: 探索位 MMR 选 ${selected.length} 条（强度 ${strength}）`);
  const restBase = [...subRest, ...selected.map((a) => ({ ...fmt(a), explore: true }))];
  const sections = {
    top: mine.slice(0, 3).map(fmt),
    featured: mine.slice(3, 10).map(fmt),
    rest: restBase,
  };
  // 2026-09-14：我的早报纳入「视频与播客」（窗口内新视频+播客，免 AI 直接列；用户拍板三类早报都要可播放媒体）
  try {
    const mediaItems = [];
    const mediaVids = await qAll(
      `SELECT v.id, v.title, v.url, v.cover, v.published_at, v.intro, v.duration, s.name AS source_name, s.avatar AS source_avatar
       FROM videos v JOIN sources s ON s.id=v.source_id
       WHERE v.published_at >= ? AND v.published_at < ? AND s.enabled = 1
       ORDER BY v.published_at DESC LIMIT 6`,
      [startUtc, endUtc]
    );
    for (const v of mediaVids) {
      // intro/duration 此前根本没查出来：视频卡只能显示一个光标题，前端没有摘要可渲染
      mediaItems.push({ id: 'v' + v.id, ref_id: v.id, kind: 'video', title: v.title, url: v.url, source: v.source_name, source_name: v.source_name, published_at: v.published_at, cover: v.cover, summary: v.intro || undefined, duration: v.duration || null, source_avatar: v.source_avatar || null });
    }
    const mediaPods = await qAll(
      `SELECT a.id, a.title, a.translated_title, a.url, a.cover, a.published_at, s.name AS source_name, s.avatar AS source_avatar
       FROM articles a JOIN sources s ON s.id=a.source_id
       WHERE a.published_at >= ? AND a.published_at < ? AND s.enabled = 1
         AND ${require('../lib/media').audioCoverSql('a.cover')}
       ORDER BY a.published_at DESC LIMIT 4`,
      [startUtc, endUtc]
    );
    for (const a of mediaPods) {
      mediaItems.push({ id: a.id, ref_id: a.id, kind: 'podcast', title: a.translated_title || a.title, original_title: a.translated_title ? a.title : undefined, url: a.url, source: a.source_name, source_name: a.source_name, published_at: a.published_at, audio_url: a.cover, cover: null, source_avatar: a.source_avatar || null });
    }
    if (mediaItems.length) sections.media = mediaItems;
  } catch (e) { log(`mybrief 媒体栏失败（不阻断）: ${e.message}`); }
  // 编辑导语 + 关键词标签行
  const theme = await _ai.generateTheme(mine.map((m) => ({ title: m.translated_title || m.title, reason: m.reason })).slice(0, 25)).catch((e) => { log(`我的早报导语生成失败（本期无今日聚焦）: ${e.message}`); return null; });
  const tagFreq = {};
  for (const m of mine) for (const t of m.tags || []) tagFreq[t] = (tagFreq[t] || 0) + 1;
  const keywords = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
  // 主题全景（订阅视角）：与 daily-ai 同管线，簇取自 mine
  let themes = [];
  try {
    themes = await buildThemePanorama(mine);
    // 2026-09-18：此处原先是空 catch——主题全景线上长期为空却无任何归因日志。
    // 空簇（Jaccard≥0.45 的 ≥2 条簇不足）与 AI 命名失败是两种不同病因，必须能区分。
    if (!themes.length) log(`我的早报主题全景: 0 簇（候选 ${mine.length} 条，标题相似度聚不到 ≥2 条的簇或 AI 命名全失败）`);
  } catch (e) { log(`我的早报主题全景失败（不阻断）: ${e.message}`); }
  // H13/B21：期号与归档——单键覆盖写让历史期直接丢失（用户 09-18 标注）。
  // 同北京日重跑原地替换（修码重跑不另算新期）；空态不占期号（那是状态不是期）。
  const { resolveMyBriefIssue } = require('../lib/brief-guards');
  const prevArch = (await getSetting('mybrief.archive', [])) || [];
  const issueInfo = resolveMyBriefIssue(prevArch, dateStr);
  const report = { date: dateStr, theme, keywords, degraded: false, generatedAt: nowIso(), sections, themes, issue: issueInfo.issue };
  await getDb().execute({ sql: "INSERT OR REPLACE INTO settings(key, value) VALUES('mybrief.latest', ?)", args: [JSON.stringify(report)] });
  const entry = { issue: issueInfo.issue, date: dateStr, generatedAt: report.generatedAt, theme: report.theme, keywords, degraded: false, sections, themes };
  const nextArch = prevArch.slice();
  if (issueInfo.replaceIndex >= 0) nextArch[issueInfo.replaceIndex] = entry;
  else nextArch.push(entry);
  await getDb().execute({ sql: "INSERT OR REPLACE INTO settings(key, value) VALUES('mybrief.archive', ?)", args: [JSON.stringify(nextArch.slice(-30))] });
  log(`mybrief 生成完成: top ${sections.top.length} / featured ${sections.featured.length} / rest ${sections.rest.length}, 主题: ${theme || '(无)'}`);
  // 飞书推送（导语 + 头条 3 条；pushEnabled 默认 true）
  const pushCfg = await getSetting('mybrief', {});
  if (pushCfg.pushEnabled !== false) {
    try {
      const d = beijingNow();
      await require('../api/_alerts').dispatch('mybrief', {
        title: `☀️ 我的早报 · ${d.getUTCMonth() + 1}月${d.getUTCDate()}日`,
        text: `${theme || '今日精选'}\n\n${sections.top.map((it, i) => `${i + 1}. ${it.title}（${it.source}）`).join('\n')}`,
      });
    } catch { /* 推送失败不阻断 */ }
  }
  return report;
}

// ─── 模式：daily（日报生成，逻辑与 api/daily-generate.js 对齐） ───
// B10：栏目表与入报源类型不再各抄一份，三端共用 lib/daily-columns.js
const { DEFAULT_COLUMNS, ARTICLE_SOURCE_TYPES } = require('../lib/daily-columns');

async function getSetting(key, def = null) {
  const rows = await qAll('SELECT value FROM settings WHERE key = ?', [key]);
  if (!rows[0]) return def;
  try { return JSON.parse(rows[0].value); } catch { return def; }
}

async function putSetting(key, val) {
  await getDb().execute({ sql: 'INSERT OR REPLACE INTO settings(key, value) VALUES(?, ?)', args: [key, JSON.stringify(val)] });
}

function hasMojibake(text) {
  const s = String(text || '');
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x0400 && cp <= 0x04ff) n++;
    else if (cp >= 0x02b0 && cp <= 0x02ff) n++;
    else if (cp === 0xfffd) n += 2;
    else if (ch === '锟' || ch === '锛' || ch === '銆') n++;
  }
  return n >= 2;
}

function isErrorPageItem(item) {
  const t = String(item.title || '');
  return t.length < 30 && /参数错误|环境异常|访问过于频繁|操作频繁/.test(t);
}

function titleTokens(title) {
  return String(title || '').replace(/[^\w一-鿿]/g, ' ').split(/\s+/).filter(t => t.length >= 2);
}

function jaccard(a, b) {
  const sa = new Set(a), sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function formatItem(a) {
  return {
    id: a.id, title: a.title, url: a.url, source: a.source_name,
    published_at: a.published_at, score: a.score,
    summary: (a.summary || '').slice(0, 200), cover: a.cover,
  };
}

function dedupItems(items) {
  const result = [];
  for (const item of items) {
    const tokens = titleTokens(item.title);
    let isDup = false;
    for (const existing of result) {
      if (jaccard(tokens, titleTokens(existing.title)) > 0.5) { isDup = true; break; }
    }
    if (!isDup) result.push(item);
  }
  return result;
}

async function runDaily() {
  const cfg = await getSetting('daily', {});
  // 采集窗口＝北京昨日 00:00 → 今日 06:00（与两份云端实现共用 lib/time-window 那一份算术）
  const { startIso: cutoff, endIso: cutoffEnd } = dailyReportWindowIso();
  const columns = await getSetting('daily.columns', null) || DEFAULT_COLUMNS;
  const selectedIds = Array.isArray(cfg.articleSourceIds) ? cfg.articleSourceIds.map(Number) : null;

  let sql = `SELECT a.*, s.name AS source_name, s.spotlight AS source_spotlight
             FROM articles a LEFT JOIN sources s ON s.id = a.source_id
             WHERE a.published_at >= ? AND a.published_at <= ? AND s.enabled = 1
               AND s.type IN (${ARTICLE_SOURCE_TYPES.map(() => '?').join(',')})`;
  const args = [cutoff, cutoffEnd, ...ARTICLE_SOURCE_TYPES];
  if (selectedIds && selectedIds.length) {
    sql += ` AND a.source_id IN (${selectedIds.map(() => '?').join(',')})`;
    args.push(...selectedIds);
  }
  sql += ' AND ' + notNoiseSql('s');
  sql += ' ORDER BY a.published_at DESC LIMIT 500';

  const candidates = await qAll(sql, args);
  let valid = candidates.filter(a => !hasMojibake(a.title) && !isErrorPageItem(a));
  // B20（2026-09-19 第二次对抗审查补漏）：门槛此前只接在 runDailyAi（AI 深析版）那一份，
  // 本函数产出的"裸报告"（degraded/关键词兜底）没有 → 一旦读层选中裸报告，低质条目照样入报。
  // 未评分条目一律不误杀（passesDailyQualityGate 对 score 非数放行），口径共用 lib/brief-guards。
  let gateDropped = 0; // stats.candidates 统一口径 = 进门槛前的候选数（与其余四份写入器一致）
  try {
    const guards = require('../lib/brief-guards');
    const aiCfg = await getSetting('ai', {});
    const g = guards.applyDailyQualityGate(valid, aiCfg?.dailyMinScore, log);
    valid = g.kept; gateDropped = g.dropped;
  } catch (e) { log(`裸日报门槛检查失败（不阻断出报，但本期等于无门槛）: ${e.message}`); }

  const sections = [];
  const used = new Set();
  for (const col of columns) {
    const items = [];
    if (col.special === 'spotlight' || col.special === 'focus') {
      for (const a of valid) {
        if (used.has(a.id)) continue;
        if (a.source_spotlight) { items.push(formatItem(a)); used.add(a.id); }
      }
    } else if (col.special === 'fallback') {
      const remaining = valid
        .filter(a => !used.has(a.id))
        .sort((a, b) => (b.score || 0) - (a.score || 0) || new Date(b.published_at || 0) - new Date(a.published_at || 0))
        .slice(0, 10);
      for (const a of remaining) { items.push(formatItem(a)); used.add(a.id); }
    } else if (col.keywords && col.keywords.length) {
      for (const a of valid) {
        if (used.has(a.id)) continue;
        const text = `${a.title} ${a.summary || ''}`;
        if (col.keywords.some(kw => text.includes(kw))) { items.push(formatItem(a)); used.add(a.id); }
      }
    }
    const deduped = dedupItems(items);
    if (deduped.length > 0) {
      sections.push({ column: col.name, desc: col.desc || '', items: deduped.slice(0, 15) });
    }
  }

  const stats = {
    // B112：关键词版也必须显式带档位 —— 原来只有降级分支用 json_set 补，正常跑出来的行是 `(无)`
    schemaVersion: require('../lib/brief-guards').DAILY_SCHEMA_VERSION.KEYWORD,
    candidates: valid.length, articles: valid.length, sections: sections.length,
    totalItems: sections.reduce((n, s) => n + s.items.length, 0),
  };
  const windowH = Math.round((Date.parse(cutoffEnd) - Date.parse(cutoff)) / 3600e3);
  await qRun(
    'INSERT INTO daily_reports(generated_at, window_hours, stats, sections) VALUES(?, ?, ?, ?)',
    [nowIso(), windowH, JSON.stringify(stats), JSON.stringify(sections)]
  );
  log(`日报生成完成: ${JSON.stringify(stats)}`);
  await writeHeartbeat('daily', stats);
  return stats;
}

// ─── 模式：translate（AI 翻译，移植自 server/services/ai/translate-skill.js） ───
// 语义对齐本地：同一 isEnglish 判定、同一写入列（translated_title/translated_content）。
// prompt 不在这里写：本模式的翻译走 `_ai.translateText` → `lib/ai-prompts.js` 的 `translate`
// （收口前这里另有一份 `TRANSLATE_DEFAULT_PROMPT`，与精翻模块那份**字对字相同**且**全文件无人引用**，
//  实测读数记在 docs/ISSUES.md B111 行 —— 删掉它不改变任何行为，因为从来没有代码读过它）。

function isEnglish(text) {
  if (!text) return false;
  const s = String(text).replace(/<[^>]+>/g, '').replace(/\s+/g, '');
  if (s.length < 20) return false;
  let cjk = 0, latin = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x4e00 && cp <= 0x9fff) cjk++;
    else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) latin++;
  }
  const total = cjk + latin || 1;
  return (latin / total) > 0.5 && (cjk / total) < 0.2;
}

// 16-ai-infra：翻译改走统一通道（串行限流 + Agnes→Bing→Google 降级链 + 术语库注入）
// 17-translate：多轮管线 轮1初翻 → 轮2词库对照 → 轮3精翻（长文）
async function translatePipeline(article) {
  const _ai = require('../api/_ai');
  const title = String(article.title || '').trim();
  const plainText = String(article.content_html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&[a-zA-Z#0-9]+;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 6000);
  if (!plainText && !title) return null;

  // 2026-09-15 阻塞修复：薄正文（<400 字符纯文本，桥接源如 hnrss 只有 Article/Comments 链接列表）
  // 走「仅标题」通道——单轮直译标题，不进多轮精翻/术语生长。
  // 根因：薄正文 + 推理模型多轮精翻 = 复述指令（"用户要求我作为术语校对专家…"25 篇）/胡编标题（"评论：0"）入库。
  if (title && plainText.length < 400) {
    const r = await _ai.translateText(title, { kind: 'translate' });
    if (!r.ok) throw new Error(r.error || '标题翻译失败');
    let t = _ai.sanitizeTranslationReply(r.text, '').split('\n')[0].trim();
    t = require('../lib/text-clean').cleanTranslatedTitle(t);
    // 入库前终极闸：思维链起手式/超长/空 一律拒收（下轮重试）
    if (!t || t.length > 120 || _ai.isThinkingLikeReply(t)) {
      log(`  ✗ 标题译文被拒收（污染防御）：${String(t).slice(0, 50)}`);
      return null;
    }
    return { title: t, content: null, provider: r.provider, rounds: 1, titleOnly: true };
  }

  const input = title ? `Title: ${title}\n\nArticle:\n${plainText}` : plainText;
  // 轮 1：初翻（含降级链）
  const r = await _ai.translateText(input, { kind: 'translate' });
  if (!r.ok) throw new Error(r.error || '翻译失败');
  let reply = _ai.sanitizeTranslationReply(r.text, '');
  const provider = r.provider;
  let rounds = 1;

  // 轮 2/3 只对 Agnes 精翻路径打磨（机翻降级结果不再加工）
  if (provider === 'agnes') {
    const refined = await _ai.refineWithGlossary(input, reply);
    if (refined !== reply) rounds = 2;
    reply = refined;
    if (plainText.length >= 1500) {
      reply = await _ai.refinePass(input, reply);
      rounds = 3;
    }
  }

  let translatedTitle = '';
  let translatedContent = reply;
  if (title && reply.includes('\n')) {
    const firstLine = reply.split('\n')[0].trim();
    // 首行做标题前先过思维链检测（2026-09-13 F3：「Here's a thinking process:」曾被当标题入库）
    if (firstLine.length < 100 && firstLine.length > 2 && !_ai.isThinkingLikeReply(firstLine)) {
      // 2026-09-14：剥掉「标题：」/「# 」等标注残留（曾以脏前缀入库）
      translatedTitle = require('../lib/text-clean').cleanTranslatedTitle(firstLine);
      translatedContent = reply.slice(firstLine.length).replace(/^\n+/, '');
    }
  }
  // 术语自动生长（仅 Agnes 译文做提取——降级机翻不喂库）
  if (provider === 'agnes') {
    try {
      const tpl = await _ai.loadPrompt('term-extract');
      const tr = await _ai.aiChat([{ role: 'user', content: `${tpl}\n\n## 原文\n${input.slice(0, 2000)}\n\n## 译文\n${reply.slice(0, 2000)}` }], { kind: 'term-extract', maxTokens: 384 });
      if (tr.ok) {
        const m = tr.reply.match(/\[[\s\S]*\]/);
        if (m) {
          const g = await _ai.growGlossary(JSON.parse(m[0]));
          if (g.added || g.updated) log(`  术语库 +${g.added} 新 / ${g.updated} 累计`);
        }
      }
    } catch { /* 术语生长失败不阻断翻译主流程 */ }
  }
  return { title: translatedTitle, content: translatedContent, provider, rounds };
}

// T3-1 R0b 生成 > 翻译：早报/周报生成窗口内 translate 批次让路（配额让给深析/导语/综述）
// 保护窗（北京时）：每日 18:30~次日 03:30（晚间 21:30 rolling24 生成 + 00:32 备份批）；周五另加 15:00~21:00（周刊 18:03）
function inGenerationGuard() {
  const bj = beijingNow();
  const h = bj.getUTCHours() + bj.getUTCMinutes() / 60;
  if (h >= 18.5 || h < 3.5) return true;
  if (bj.getUTCDay() === 5 && h >= 15 && h < 21) return true; // 周五
  return false;
}

// ─── 翻译优先级（2026-09-15 用户口径修正）：每日早报 P1 > 我的早报 P2 > 精选周刊 P3 > 热点榜 P4 > 阅读器（兜底 P7） ───
// （2026-09-14 初版把热点榜放 P1——用户口径是"优先翻译每日早报、我的早报和精选周刊"，策展内容优先于热搜）
// 会员面内容先翻：早报/周刊从已生成报告提取文章 id（精确命中用户所见）；热点榜按 /api/hot featured 同口径 SQL
// 手动队列（POST /api/articles/:id/translate）仍最优先，不受此排序影响
function _collectIdsDeep(obj, out) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) { for (const v of obj) _collectIdsDeep(v, out); return; }
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'id' && Number.isFinite(v) && v > 0) out.add(v);
    else if (v && typeof v === 'object') _collectIdsDeep(v, out);
  }
}

async function translatePriorityMap() {
  const pri = new Map(); // articleId -> 1|2|3|4
  // P1 每日早报：daily_reports 最新一期 sections（用户口径 2026-09-15：早报类最先翻）
  try {
    const rows = await qAll('SELECT sections FROM daily_reports ORDER BY generated_at DESC LIMIT 1');
    const ids = new Set();
    if (rows[0]) _collectIdsDeep(JSON.parse(rows[0].sections || '[]'), ids);
    for (const id of ids) if (!pri.has(id)) pri.set(id, 1);
  } catch { /* 读不到按无优先级继续 */ }
  // P2 我的早报 / P3 精选周刊：读已生成报告的文章 id
  for (const [key, p] of [['mybrief.latest', 2], ['weekly.latest', 3]]) {
    try {
      const report = await getSetting(key, null);
      const ids = new Set();
      _collectIdsDeep(report, ids);
      for (const id of ids) if (!pri.has(id)) pri.set(id, p);
    } catch { /* 读不到按无优先级继续 */ }
  }
  // P4 热点榜精选：与 /api/hot tab=featured 同口径（自有源六维≥60 且 AI 相关，7 天窗；热榜源不入精选）
  // AI 词表与云端读层共享 lib/ai-relevance.js（同一份，勿分叉）
  try {
    const { aiRelevanceCond } = require('../lib/ai-relevance');
    const args = [new Date(Date.now() - 7 * 86400e3).toISOString()];
    const aiCond = aiRelevanceCond(args);
    const rows = await qAll(
      `SELECT a.id FROM articles a JOIN sources s ON s.id=a.source_id
       LEFT JOIN groups g ON g.id = s.group_id
       WHERE a.published_at >= ?
         AND ${notHotlistSql('s')} AND COALESCE(CAST(a.score AS REAL), 0) >= 60
         AND ${aiCond}`,
      args
    );
    for (const r of rows) if (!pri.has(r.id)) pri.set(r.id, 4);
  } catch (e) { log(`  翻译优先级 P4 热点榜查询失败（按无优先级继续）: ${e.message}`); }
  return pri;
}

async function runTranslate() {
  if (inGenerationGuard()) {
    log('translate: 处于早报/周报生成保护窗（T3-1 R0b），本轮让路跳过');
    return { skipped: 'generation-window' };
  }
  const cfg = await getSetting('translate', {});
  if (cfg.enabled === false) { log('翻译功能已停用（settings translate.enabled=false），跳过'); return { skipped: true }; }
  const limit = Number(process.env.TRANSLATE_LIMIT) || 10;
  const stats = { total: 0, success: 0, failed: 0 };

  // 17-translate：手动队列优先（POST /api/articles/:id/translate 入队的）
  const queue = (await getSetting('translate.queue', { ids: [] })) || { ids: [] };
  if (Array.isArray(queue.ids) && queue.ids.length) {
    log(`手动翻译队列 ${queue.ids.length} 篇，优先处理`);
    const remain = [];
    for (const id of queue.ids) {
      try {
        const rows = await qAll('SELECT id, title, content_html, translated_title, translated_content FROM articles WHERE id=?', [id]);
        const art = rows[0];
        if (!art || art.translated_title || art.translated_content) continue; // 已翻译/不存在 → 出队
        const r = await translatePipeline(art);
        if (r) {
          await qRun('UPDATE articles SET translated_title=?, translated_content=?, translation_provider=? WHERE id=?',
            [r.title || null, r.content || null, r.provider, id]);
          stats.success++;
          log(`  ✓ [手动] #${id} ${String(art.title).slice(0, 40)}（${r.provider}，${r.rounds} 轮）`);
        } else { remain.push(id); }
      } catch (err) {
        stats.failed++;
        remain.push(id); // 失败保留下轮重试
        log(`  ✗ [手动] #${id} ${err.message}`);
      }
    }
    stats.total += queue.ids.length;
    await getDb().execute({ sql: "INSERT OR REPLACE INTO settings(key, value) VALUES('translate.queue', ?)", args: [JSON.stringify({ ids: remain })] });
  }

  // 自动增量：两步走（先拉轻量标题过滤英文，再按 id 取正文）
  const titleRows = await qAll(
    `SELECT id, title FROM articles
     WHERE translated_title IS NULL AND translated_content IS NULL
       AND content_html IS NOT NULL AND content_html != ''
     ORDER BY created_at DESC LIMIT 5000`
  );
  // 2026-09-15：板块优先级排序（每日早报>我的早报>精选周刊>热点榜>阅读器兜底，用户口径修正）；
  // titleRows 已按 created_at DESC，sort 稳定 → 同优先级内仍是新到旧
  const priMap = await translatePriorityMap();
  // 2026-09-15 阻塞修复：优先级条目必须直接补入候选池——日报条目可能已跌出「最近 5000 条」扫描窗
  // （实测：日报 40 条 id 全在扫描窗外 → P1=0，优先级排序形同虚设，用户口径"早报优先"未真正生效）
  const scannedIds = new Set(titleRows.map((r) => r.id));
  const missingPri = [...priMap.keys()].filter((id) => !scannedIds.has(id));
  if (missingPri.length) {
    const extra = await qAll(
      `SELECT id, title FROM articles
       WHERE id IN (${missingPri.map(() => '?').join(',')})
         AND translated_title IS NULL AND translated_content IS NULL
         AND content_html IS NOT NULL AND content_html != ''`,
      missingPri
    );
    if (extra.length) titleRows.push(...extra);
    log(`优先级补扫：${extra.length}/${missingPri.length} 条早报/周刊/热点条目在 5000 扫描窗外，已直接补入候选池`);
  }
  const priCount = { 1: 0, 2: 0, 3: 0, 4: 0, 7: 0 };
  const sorted = titleRows
    .filter(a => isEnglish(a.title))
    .map(a => ({ ...a, _p: priMap.get(a.id) ?? 7 }))
    .sort((a, b) => a._p - b._p);
  for (const c of sorted) priCount[c._p]++;
  const candidates = sorted.slice(0, limit);
  log(`英文候选池 ${sorted.length} 篇（扫描最近 ${titleRows.length} 条标题）；优先级分布 每日早报P1=${priCount[1]} 我的早报P2=${priCount[2]} 精选周刊P3=${priCount[3]} 热点榜P4=${priCount[4]} 阅读器P7=${priCount[7]}，本轮取前 ${candidates.length} 篇`);

  stats.total += candidates.length;
  for (const c of candidates) {
    try {
      const full = await qAll('SELECT id, title, content_html FROM articles WHERE id=?', [c.id]);
      if (!full[0]) { stats.failed++; continue; }
      const r = await translatePipeline(full[0]);
      if (r) {
        await qRun('UPDATE articles SET translated_title=?, translated_content=?, translation_provider=? WHERE id=?',
          [r.title || null, r.content || null, r.provider, c.id]);
        stats.success++;
        log(`  ✓ #${c.id} ${String(c.title).slice(0, 40)}（${r.provider}，${r.rounds} 轮）`);
      } else { stats.failed++; }
    } catch (err) {
      stats.failed++;
      log(`  ✗ #${c.id} ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 800)); // 限流保护
  }
  log(`翻译完成: 成功 ${stats.success} / 失败 ${stats.failed}`);
  await writeHeartbeat('translate', stats);
  // 15-cloud-alerts：翻译批次有失败 → AI 链路报警
  if (stats.failed > 0) {
    try { await require('../api/_alerts').aiFailed(`翻译批次 ${stats.failed}/${stats.success + stats.failed} 篇失败`); } catch { /* 隔离 */ }
  }
  return stats;
}

// ─── 主流程 ───
(async () => {
  log(`=== collect-turso 模式=${MODE} ===`);
  // 17-translate：translation_provider 列迁移（已存在则忽略）
  try { await getDb().execute('ALTER TABLE articles ADD COLUMN translation_provider TEXT'); } catch { /* 已存在 */ }
  // B18：videos.score 列迁移（已存在则忽略）
  try { await getDb().execute('ALTER TABLE videos ADD COLUMN score INTEGER'); } catch { /* 已存在 */ }
  // 21-bilibili-runner：videos.vid 唯一索引（INSERT OR IGNORE 去重依赖）
  try { await getDb().execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_vid ON videos(vid)'); } catch { /* 已存在/空表兼容 */ }
  // T3-3 读层性能索引（与 Turso/server/db.js 三处同步，2026-09-13）
  for (const ddl of [
    'CREATE INDEX IF NOT EXISTS idx_articles_read ON articles(read_at)',
    'CREATE INDEX IF NOT EXISTS idx_articles_later ON articles(later)',
    'CREATE INDEX IF NOT EXISTS idx_articles_score ON articles(score)',
    'CREATE INDEX IF NOT EXISTS idx_videos_favorite ON videos(favorite)',
    'CREATE INDEX IF NOT EXISTS idx_articles_read_sk ON articles(read_at, COALESCE(published_at, created_at) DESC, id DESC)',
    'CREATE INDEX IF NOT EXISTS idx_articles_later_sk ON articles(later, COALESCE(published_at, created_at) DESC, id DESC)',
    'CREATE INDEX IF NOT EXISTS idx_videos_fav_sk ON videos(favorite, published_at DESC, id DESC)',
    // 27b 对抗审查补齐：列表排序/计数表达式索引（生产库 09-11 已外带执行，此处保 fresh 环境 parity）
    'CREATE INDEX IF NOT EXISTS idx_articles_pubco ON articles(COALESCE(published_at, created_at))',
    'CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at)',
  ]) { try { await getDb().execute(ddl); } catch { /* 已存在 */ } }
  // 27b 源四轴（2026-09-15）：补列 + 一次性迁移（focus→spotlight + subscription.ids）
  // runner 也要跑：Vercel ensureSchema 只在读层首请求触发，runner 若先跑会因缺列/未迁移读空
  const axes = require('../lib/source-axes');
  for (const alter of axes.AXES_ALTERS) { try { await getDb().execute(alter); } catch { /* 已存在 */ } }
  try {
    const migrated = await axes.migrateAxes({ qAll, qRun, getSetting, setSetting: putSetting });
    if (migrated) log('四轴迁移完成：focus→spotlight + subscription.ids 初始化');
  } catch (e) { log(`四轴迁移失败（不阻断采集）: ${e.message}`); }
  try {
    if (MODE === 'collect') await runCollect();
    else if (MODE === 'cleanup') await runCleanup();
    else if (MODE === 'daily') await runDaily();
    else if (MODE === 'daily-ai') await runDailyAi();
    else if (MODE === 'weekly') await runWeekly();
    else if (MODE === 'mybrief') {
      // 手动重生成我的早报（独立分析订阅源窗口，不跑全量深析）
      await runMyBrief([]);
      // 2026-09-18：阅读足迹此前只挂在 daily-ai 分支（runDailyAi 尾部），单独跑 mybrief 时
      // reading.digest 永不刷新 → 我的早报「阅读足迹」卡整块消失（线上实测该键根本不存在）。
      // 独立 try/catch：足迹是附属卡，失败不该让早报重生成算失败。
      try { await buildReadingDigest(); } catch (e) { log(`阅读足迹失败（已隔离）: ${e.message}`); }
    }
    else if (MODE === 'translate') await runTranslate();
    else { console.error(`未知模式: ${MODE}`); process.exit(1); }
  } catch (err) {
    console.error(`Fatal: ${err.message}`);
    // 15-cloud-alerts：早报/周刊批次失败发报警后再退出。
    // 2026-09-18 扩覆盖面：此前只认 'daily'（非 AI 兜底批），真正产 AI 内容的
    // daily-ai 与 weekly 跑批失败时一条报警都没有——周刊整周静默断更就是这么来的。
    if (MODE === 'daily' || MODE === 'daily-ai' || MODE === 'weekly' || MODE === 'mybrief') {
      try { await require('../api/_alerts').dailyFailed(`${MODE}: ${err.message}`); } catch { /* 隔离 */ }
    }
    // B101 观测：批次**失败时更要**留下这条读数（连着失败的那几天正是最需要看待删量的时候）。
    // 放在 process.exit 之前 —— exit 会立刻终止进程，finally 不会跑。
    await refreshRetentionReadout();
    process.exit(1);
  }
  await refreshRetentionReadout();
  // 有序收尾：关连接后自然退出（process.exit 会触发 libuv UV_HANDLE_CLOSING 断言，exit 127）
  try { if (_db) _db.close(); } catch { /* 忽略 */ }
  try { if (proxyAgent) await proxyAgent.close(); } catch { /* 忽略 */ }
  process.exitCode = 0;
})();
