// 云端采集引擎(十一期 M2):Vercel serverless 函数内跑完一批源并写 Turso
// 参考主系统 server/services/collectors/{rss,hotlist,store}.js 的语义移植:
//   - charset 嗅探解码(GBK/Big5)、#js_content 微信正文抽取、Readability 兜底
//   - cleanContent 图片修复(data-src→src、mmbiz no-referrer)、isJunkContent 风控页过滤
//   - newsnow 热榜适配(extra.info 热度、hover 摘要、GBK 乱码丢弃)
//   - 微信读书通道(wemp):/api/mp/cover 取最新一篇,reviewId → mp.weixin.qq.com 原文页抓正文
//   - INSERT OR IGNORE by url;next_fetch_at/intervalMin;连续 3 次失败 enabled=0
// 约束:Vercel Hobby 函数 60s 超时 —— 单批最多 8 源、每源正文补抓限 3 篇、源间隔 1s
const Parser = require('rss-parser');
const { dbAll, dbGet, dbRun, getSetting, nowIso } = require('./_turso');

const BATCH_MAX = 8;
const SOURCE_GAP_MS = 1000;
const FULLTEXT_PER_SOURCE = 3;
const TIME_BUDGET_MS = 50000; // 50s 后不再开新源,留 10s 余量返回
const NEWSNOW_DEFAULT_BASE = 'https://newsnow.busiyi.world';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const parser = new Parser({
  timeout: 15000,
  customFields: { item: ['content:encoded', 'content'] },
});

// ---------- 基础抓取 ----------
function fetchWithTimeout(url, { headers = {}, timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  return fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8', ...headers },
    signal: ctrl.signal,
    redirect: 'follow',
  }).finally(() => clearTimeout(t));
}

async function fetchText(url, headers) {
  const res = await fetchWithTimeout(url, { headers });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

async function fetchJson(url, headers) {
  const res = await fetchWithTimeout(url, {
    headers: { Accept: 'application/json, text/plain, */*', ...headers },
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// charset 嗅探解码(header 优先 → <meta charset>),移植自主系统 decodeHtmlBuffer
function decodeHtmlBuffer(buf, contentType) {
  let charset = /charset=([\w-]+)/i.exec(contentType || '')?.[1];
  if (!charset) {
    const head = buf.subarray(0, 4096).toString('latin1');
    charset = /<meta[^>]+charset=["']?\s*([\w-]+)/i.exec(head)?.[1];
  }
  let enc = 'utf-8';
  if (charset && /^(gbk|gb2312|gb18030)/i.test(charset)) enc = 'gb18030';
  else if (charset && /^big5/i.test(charset)) enc = 'big5';
  return new TextDecoder(enc).decode(buf);
}

async function fetchHtmlSmart(url) {
  const res = await fetchWithTimeout(url, { timeout: 15000 });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return decodeHtmlBuffer(buf, res.headers.get('content-type'));
}

// ---------- 正文清洗(移植自主系统 rss 适配器) ----------
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
    return src;
  }
  return null;
}

function cleanContent(html) {
  let c = String(html || '');
  c = c.replace(/<script[\s\S]*?<\/script>/gi, '');
  c = c.replace(/<style[\s\S]*?<\/style>/gi, '');
  c = c.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  c = c.replace(/<img[^>]*(?:facebook\.com\/tr|doubleclick)[^>]*>/gi, '');
  // 微信懒加载图:data-src → src
  c = c.replace(/<img\b([^>]*?)\sdata-src=(["'])([^"']+)\2([^>]*)>/gi, (m, pre, q, src, post) => {
    const rest = (pre + ' ' + post).replace(/\ssrc=(["']).*?\1/gi, '');
    return `<img${rest} src=${q}${src}${q}>`;
  });
  // mmbiz.qpic.cn 防盗链:no-referrer
  c = c.replace(/<img\b(?![^>]*\breferrerpolicy\b)([^>]*?src=["']https?:\/\/mmbiz\.qpic\.cn[^>]*?)>/gi, '<img$1 referrerpolicy="no-referrer">');
  const m = c.match(/<h[23][^>]*>(?:<[^>]+>)*\s*(Keep reading|Related|More from|继续阅读|相关阅读)/i);
  if (m && m.index > 1000) {
    const before = c.slice(0, m.index);
    const cut = Math.max(before.lastIndexOf('<div'), before.lastIndexOf('<section'));
    c = c.slice(0, cut > 0 ? cut : m.index);
  }
  const pm = /<p[\s>]/.exec(c);
  if (pm) {
    const head = c
      .slice(0, pm.index)
      .replace(/<(ul|ol|nav)[\s\S]*<\/\1>/gi, '')
      .replace(/<li[\s\S]*?<\/li>/gi, '');
    c = head + c.slice(pm.index);
    if (pm.index > 1500) {
      const pm2 = /<p[\s>]/.exec(c);
      const head2 = c.slice(0, pm2 ? pm2.index : 0);
      if ((head2.match(/<\/a>/g) || []).length >= 3 && !/<(h[1-4]|figure|table)[\s>]/i.test(head2)) {
        c = c.slice(pm2.index);
      }
    }
  }
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

// 风控/错误页、转义 JSON 污染检测
function isJunkContent(html) {
  const c = String(html || '');
  const junk = (c.match(/\\\\+"/g) || []).length;
  if (junk > 30 || /<meta[\s>]/i.test(c)) return true;
  const text = c.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
  if (text && text.length < 30 && /参数错误|环境异常|访问过于频繁|操作频繁/.test(text)) return true;
  return false;
}

// ---------- 全文补抓(微信 #js_content → Readability 兜底) ----------
function extractArticleContent(doc, url) {
  let host = '';
  try { host = new URL(url).hostname; } catch { /* 非法 url 按非微信处理 */ }
  if (/(^|\.)mp\.weixin\.qq\.com$/.test(host)) {
    const js = doc.querySelector('#js_content');
    if (js && js.innerHTML.trim().length > 100) return js.innerHTML;
  }
  const { Readability } = require('@mozilla/readability');
  const parsed = new Readability(doc).parse();
  return (parsed && parsed.content) || '';
}

async function fetchFulltext(url) {
  const html = await fetchHtmlSmart(url);
  const { JSDOM } = require('jsdom');
  const doc = new JSDOM(html, { url }).window.document;
  const content = extractArticleContent(doc, url);
  if (content.length <= 200) return null;
  const og = doc.querySelector('meta[property="og:image"], meta[name="og:image"]');
  return { content: cleanContent(content), cover: (og && og.content) || null };
}

// 薄内容条目(<1000 字符或污染)补抓原文页,每源每轮限 FULLTEXT_PER_SOURCE 篇
async function enrichFulltext(articles) {
  const need = articles
    .filter((a) => (a.content_html || '').length < 1000 || isJunkContent(a.content_html))
    .slice(0, FULLTEXT_PER_SOURCE);
  for (const a of need) {
    try {
      const full = await fetchFulltext(a.url);
      if (full) {
        const cur = a.content_html || '';
        if (isJunkContent(cur) || full.content.length > cur.length) {
          a.content_html = full.content;
          if (!a.summary || /^\s*[{\[]/.test(a.summary) || /"@context"|\\+"/.test(a.summary)) {
            a.summary = summarize(full.content);
          }
        }
        if (!a.cover && full.cover) a.cover = full.cover;
      }
    } catch { /* 单条失败保留摘要 */ }
  }
}

// ---------- RSS/Atom 通道 ----------
function textOf(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return v.name || v._ || '';
}

function mapFeedItem(item) {
  const rawContent = item['content:encoded'] || item.content || '';
  let contentHtml = rawContent.replace(/<(p|div|span)[^>]*>\s*Loading…?\s*<\/\1>/gi, '');
  contentHtml = cleanContent(contentHtml);
  let summary = summarize(contentHtml) || stripTags(item.contentSnippet || item.summary || '').replace(/\s+/g, ' ').trim();
  if (/^\s*[{\[]/.test(summary) || /"@context"|"@graph"|\\+"/.test(summary)) summary = '';
  return {
    title: (item.title || '').trim(),
    url: item.link || '',
    author: textOf(item.creator || item.author),
    cover: (item.enclosure && item.enclosure.url) || firstImg(contentHtml) || null,
    summary,
    content_html: contentHtml || `<p>${summary}</p>`,
    published_at: item.isoDate || (item.pubDate ? new Date(item.pubDate).toISOString() : null),
  };
}

async function fetchRss(source) {
  const xml = await fetchText(source.url);
  const feed = await parser.parseString(xml);
  const articles = (feed.items || []).map(mapFeedItem).filter((a) => a.url && a.title);
  await enrichFulltext(articles);
  return { articles: articles.filter((a) => !isJunkContent(a.content_html)) };
}

// ---------- newsnow 热榜通道 ----------
async function fetchHotlist(source) {
  const id = String(source.url || '').replace(/^hotlist:\/\//, '');
  if (!id) throw new Error('热榜源缺少 newsnow id');
  let extra = {};
  try { extra = JSON.parse(source.extra || '{}'); } catch { /* 无 extra */ }
  const base = await getSetting('hotlist.baseUrl', NEWSNOW_DEFAULT_BASE);
  const data = await fetchJson(`${base}/api/s?id=${encodeURIComponent(id)}&latest`);
  const updated = data.updatedTime ? new Date(Number(data.updatedTime)).toISOString() : null;
  const platform = extra.platform || id;
  const articles = (data.items || [])
    .filter((it) => it && it.url && it.title)
    .map((it) => {
      const title = String(it.title).trim();
      let hover = (it.extra && it.extra.hover) || '';
      // GBK 乱码 hover 丢弃(西里尔/修饰字母/锟斤拷特征)
      if (/[Ѐ-ӿˈ-˿锟锛銆]/.test(hover)) hover = '';
      return {
        title,
        url: it.url,
        author: platform,
        summary: hover,
        content_html: `<p>${hover || title}</p><p><a href="${it.url}" target="_blank" rel="noopener">查看原文 →</a></p>`,
        published_at: updated,
      };
    });
  await enrichFulltext(articles);
  return { articles };
}

// ---------- 微信读书公众号通道(wemp) ----------
// url 形如 http://127.0.0.1:8001/feed/MP_WXS_xxx.atom?limit=20(本地 we-mp-rss 身份,云端改用 weread cover 接口)
function bookIdOf(source) {
  const m = String(source.url || '').match(/MP_WXS_\w+/);
  return m ? m[0] : null;
}

// reviewId 末段 token → mp 原文短链;token 中 '~' 换回 '_'(2026-08 实测微信已反转行为)
function mpLinkFromReviewId(reviewId, bookId) {
  let token = String(reviewId || '').trim();
  if (!token) return '';
  const prefix = bookId ? `${bookId}_` : '';
  if (prefix && token.startsWith(prefix)) token = token.slice(prefix.length);
  else if (token.includes('_')) token = token.split('_').pop();
  token = token.replace(/~/g, '_');
  return `https://mp.weixin.qq.com/s/${encodeURIComponent(token)}`;
}

async function wereadCookie() {
  const row = await dbGet("SELECT data FROM credentials WHERE platform='weread'");
  if (!row) throw new Error('缺少微信读书凭据(credentials.weread)');
  let data = {};
  try { data = JSON.parse(row.data || '{}'); } catch { /* 非法 JSON */ }
  if (!data.cookie) throw new Error('微信读书凭据缺少 cookie');
  return data.cookie;
}

async function fetchWemp(source) {
  const bookId = bookIdOf(source);
  if (!bookId) throw new Error('wemp 源缺少 MP_WXS_ bookId');
  const cookie = await wereadCookie();
  const data = await fetchJson(`https://weread.qq.com/api/mp/cover?bookId=${encodeURIComponent(bookId)}`, {
    Cookie: cookie,
    Origin: 'https://weread.qq.com',
    Referer: 'https://weread.qq.com/',
  });
  if (!data.reviewId) {
    const code = data.errCode ?? data.errcode ?? 0;
    throw new Error(`weread cover 无最新文章(errCode=${code} ${data.errMsg || data.errmsg || ''})`.trim());
  }
  const link = mpLinkFromReviewId(data.reviewId, bookId);
  const publishInfo = data.publishInfo || {};
  const published = publishInfo.create_time
    ? new Date(Number(publishInfo.create_time) * 1000).toISOString()
    : null;
  const article = {
    title: String(data.title || '').trim(),
    url: link,
    author: source.name,
    cover: data.pic || null,
    summary: String(data.digest || '').trim(),
    content_html: '',
    published_at: published,
  };
  if (!article.title || !article.url) return { articles: [] };
  // 正文接口已死(2026-08 起返回空),正文走 mp.weixin.qq.com 原文页
  try {
    const full = await fetchFulltext(article.url);
    if (full) {
      article.content_html = full.content;
      if (!article.summary) article.summary = summarize(full.content);
      if (!article.cover && full.cover) article.cover = full.cover;
    }
  } catch { /* 正文抓取失败保留标题级条目 */ }
  if (!article.content_html) {
    article.content_html = `<p>${article.summary || article.title}</p><p><a href="${article.url}" target="_blank" rel="noopener">查看原文 →</a></p>`;
  }
  return { articles: [article] };
}

// ---------- 落库 + 源状态(沿用主系统语义;云端 sources 无 fail_count 列,计数存 extra.failCount) ----------
function parseExtra(source) {
  try { return JSON.parse(source.extra || '{}'); } catch { return {}; }
}

function intervalMinFor(source) {
  const per = Number(parseExtra(source).intervalMin);
  if (Number.isFinite(per) && per > 0) return per;
  return 60; // 云端默认 60 分钟
}

async function saveArticles(sourceId, articles) {
  let added = 0;
  for (const a of articles) {
    const r = await dbRun(
      `INSERT OR IGNORE INTO articles(source_id, title, url, author, cover, summary, content_html, published_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sourceId, a.title || '', a.url, a.author || '', a.cover || null,
      a.summary || '', a.content_html || '', a.published_at || null, nowIso()
    );
    added += r.changes;
  }
  return added;
}

async function saveVideos(sourceId, videos) {
  let added = 0;
  for (const v of videos) {
    const r = await dbRun(
      `INSERT OR IGNORE INTO videos(source_id, platform, title, url, vid, cover, duration, author, intro, published_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sourceId, v.platform || '', v.title || '', v.url, v.vid || null,
      v.cover || null, v.duration || null, v.author || '', v.intro || '',
      v.published_at || null, nowIso()
    );
    added += r.changes;
  }
  return added;
}

async function markOk(source) {
  const extra = parseExtra(source);
  delete extra.lastError;
  delete extra.lastErrorAt;
  delete extra.failCount;
  const now = nowIso();
  const next = new Date(Date.now() + intervalMinFor(source) * 60000).toISOString();
  await dbRun(
    "UPDATE sources SET last_fetched_at=?, next_fetch_at=?, status='ok', extra=? WHERE id=?",
    now, next, JSON.stringify(extra), source.id
  );
}

async function markError(source, errMsg) {
  const extra = parseExtra(source);
  extra.lastError = String(errMsg || '未知错误').slice(0, 300);
  extra.lastErrorAt = nowIso();
  const failCount = (Number(extra.failCount) || 0) + 1;
  extra.failCount = failCount;
  const autoPaused = failCount >= 3;
  await dbRun(
    `UPDATE sources SET status='error', extra=?, enabled=? WHERE id=?`,
    JSON.stringify(extra), autoPaused ? 0 : 1, source.id
  );
  // 报警:连续失败 ≥2 提醒,≥3 熔断通知(异步告警失败不影响采集主流程)
  if (failCount >= 2) {
    try {
      await require('./_alerts').sourceError(source, failCount, errMsg);
    } catch { /* 告警失败忽略 */ }
  }
  return { failCount, autoPaused };
}

// ---------- 主流程 ----------
function dispatch(source) {
  const url = String(source.url || '');
  if (source.type === 'bilibili') return require('./_bilibili').fetchBilibili(source);
  if (source.type === 'douyin') return { articles: [], videos: [] }; // 抖音保留本地采集(需无头浏览器+登录态)
  if (url.startsWith('hotlist://')) return fetchHotlist(source);
  if (/^https?:\/\//i.test(url) && url.includes('/feed/') && source.type === 'wemp') return fetchWemp(source);
  if (/^https?:\/\//i.test(url)) return fetchRss(source);
  throw new Error(`不支持的源: ${url.slice(0, 60)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function collect() {
  const startedAt = Date.now();
  const now = nowIso();
  const all = await dbAll(
    `SELECT id, type, name, url, extra FROM sources
     WHERE enabled=1 AND (next_fetch_at IS NULL OR next_fetch_at='' OR next_fetch_at<=?)`,
    now
  );
  // 按 intervalMin 升序,单批最多 BATCH_MAX 个
  const due = all
    .map((s) => ({ ...s, _interval: intervalMinFor(s) }))
    .sort((a, b) => a._interval - b._interval)
    .slice(0, BATCH_MAX);

  const results = [];
  for (const source of due) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      results.push({ name: source.name, ok: false, added: 0, skipped: 'time budget' });
      continue;
    }
    try {
      const { articles, videos } = await dispatch(source);
      const added = (await saveArticles(source.id, articles || [])) + (await saveVideos(source.id, videos || []));
      await markOk(source);
      results.push({ name: source.name, ok: true, added });
    } catch (e) {
      const { autoPaused } = await markError(source, e.message);
      // weread cookie 失效特征(401 / -2012 登录超时 / -2010 用户不存在)→ 全局报警(冷却 2h)
      if (source.type === 'wemp' && /401|-2012|-2010|cookie/i.test(String(e.message))) {
        try {
          await require('./_alerts').dispatch('wemp_cookie_expired', {
            title: '🔑 微信读书 Cookie 失效',
            text: `公众号「${source.name}」采集返回登录失效(${String(e.message).slice(0, 80)}),请到管理后台「微信读书授权」重新扫码。`,
          });
        } catch { /* 告警失败忽略 */ }
      }
      results.push({ name: source.name, ok: false, added: 0, error: e.message, autoPaused });
    }
    await sleep(SOURCE_GAP_MS);
  }
  return { ok: true, processed: results.filter((r) => !r.skipped).length, results };
}

module.exports = { collect };
