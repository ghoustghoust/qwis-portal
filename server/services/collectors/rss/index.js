// 通用 RSS/Atom 适配器（F47）：任意 RSS 地址可直接订阅
// T43 增强：youtube.com/@xxx、/channel/UCxxx 等频道链接自动转官方频道 RSS
// （https://www.youtube.com/feeds/videos.xml?channel_id=xxx），抓取结果入 videos 表（platform='youtube'）
const Parser = require('rss-parser');
const { httpFetch, fetchText } = require('../../../util/http');
const log = require('../../../util/log'); // ✅ P1 修复：log.is not not defined root cause

// customFields 显式保留 content:encoded / content：
// 部分 Atom 源（如 we-mp-rss 公众号全文源）把正文放在 <content:encoded>，
// rss-parser 默认不解析该字段，会导致正文丢失只剩摘要
const parser = new Parser({
  timeout: 15000,
  customFields: { item: ['content:encoded', 'content'] },
});

function stripTags(html) {
  return String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function firstImg(html) {
  // 跳过追踪像素/隐藏图（facebook.com/tr、display:none、1x1）
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

// 正文清洗：script/style/noscript、追踪像素、「Keep reading」相关推荐尾巴
function cleanContent(html) {
  let c = String(html || '');
  c = c.replace(/<script[\s\S]*?<\/script>/gi, '');
  c = c.replace(/<style[\s\S]*?<\/style>/gi, '');
  c = c.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  c = c.replace(/<img[^>]*(?:facebook\.com\/tr|doubleclick)[^>]*>/gi, '');
  // 微信公众号等懒加载图片:data-src → src(否则浏览器永远不加载,正文"没有图片")
  c = c.replace(/<img\b([^>]*?)\sdata-src=(["'])([^"']+)\2([^>]*)>/gi, (m, pre, q, src, post) => {
    const rest = (pre + ' ' + post).replace(/\ssrc=(["']).*?\1/gi, ''); // 去掉占位 src
    return `<img${rest} src=${q}${src}${q}>`;
  });
  // mmbiz.qpic.cn 等防盗链图:加 no-referrer 绕过 referer 校验
  c = c.replace(/<img\b(?![^>]*\breferrerpolicy\b)([^>]*?src=["']https?:\/\/mmbiz\.qpic\.cn[^>]*?)>/gi, '<img$1 referrerpolicy="no-referrer">');
  // 「Keep reading / 相关阅读」起的相关推荐区块直接截掉
  const m = c.match(/<h[23][^>]*>(?:<[^>]+>)*\s*(Keep reading|Related|More from|继续阅读|相关阅读)/i);
  if (m && m.index > 1000) {
    // 回退到该标题的容器起点
    const before = c.slice(0, m.index);
    const cut = Math.max(before.lastIndexOf('<div'), before.lastIndexOf('<section'));
    c = c.slice(0, cut > 0 ? cut : m.index);
  }
  // 去掉正文开头、首个 <p> 之前的导航链接列表（Readability/OpenRSS 常把站点 header 带进正文，含嵌套 ul）
  // 注意用 /<p[\s>]/ 匹配段落，避免命中 SVG 的 <path
  const pm = /<p[\s>]/.exec(c);
  if (pm) {
    const head = c
      .slice(0, pm.index)
      .replace(/<(ul|ol|nav)[\s\S]*<\/\1>/gi, '') // 贪婪到区域末尾，兼容嵌套
      .replace(/<li[\s\S]*?<\/li>/gi, ''); // Meta 等站点的裸 <li>（无 ul 包裹）
    c = head + c.slice(pm.index);
    // 头部仍是大段导航链接汤（≥3 个链接且超 1500 字符非段落标记）→ 整体丢弃
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

// 摘要提取：取第一个像样（≥40 字符）的 <p> 段落文本；没有则回退全文纯文本截断
function summarize(html, limit = 200) {
  const c = String(html || '');
  const ps = c.match(/<p[\s>][\s\S]*?<\/p>/gi) || [];
  for (const p of ps) {
    const t = stripTags(p).replace(/\s+/g, ' ').trim();
    if (t.length >= 40) return t.slice(0, limit);
  }
  return stripTags(c).replace(/\s+/g, ' ').trim().slice(0, limit);
}

// 内容是否被转义 JSON 页面状态污染（Meta 产品页会混入大量 \\\"type\\\" 垃圾）
// 或泄漏了 <meta> 等 head 标签（说明抓到的是页面碎片而非正文）
function isJunkContent(html) {
  const c = String(html || '');
  const junk = (c.match(/\\\\+"/g) || []).length;
  if (junk > 30 || /<meta[\s>]/i.test(c)) return true;
  // 微信风控/错误页(瞬时):纯文本只有这几个字,不是正文
  const text = c.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
  if (text && text.length < 30 && /参数错误|环境异常|访问过于频繁|操作频繁/.test(text)) return true;
  return false;
}

function faviconOf(link) {
  try {
    const u = new URL(link);
    return `${u.origin}/favicon.ico`;
  } catch {
    return null;
  }
}

// author 字段兼容：Atom 可能返回对象 {name: ...}
function textOf(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return v.name || v._ || '';
}

// description 里「🔗 <a href>阅读原文</a>」→ 第三方原文链接（七期 F1 original_url）
function extractOriginalUrl(rawHtml) {
  const m = String(rawHtml || '').match(/🔗[\s\S]{0,300}?<a[^>]+href="([^"]+)"/);
  return m ? m[1].replace(/&amp;/g, '&') : null;
}

function mapItem(item) {
  const rawContent = item['content:encoded'] || item.content || '';
  let contentHtml = rawContent;
  // 清理原站动态占位残留（OpenAI 等页面的加载占位符）
  contentHtml = contentHtml.replace(/<(p|div|span)[^>]*>\s*Loading…?\s*<\/\1>/gi, '');
  // 通用正文清洗（script/追踪器/相关推荐尾巴）
  contentHtml = cleanContent(contentHtml);
  // 清洗摘要：取清洗后正文的第一个像样段落（feed 自带摘要常带导航/日期/JSON 污染）
  let summary = summarize(contentHtml) || stripTags(item.contentSnippet || item.summary || '').replace(/\s+/g, ' ').trim();
  if (/^\s*[{\[]/.test(summary) || /"@context"|"@graph"|\\+"/.test(summary)) {
    summary = ''; // JSON-LD 污染，留空由全文补抓阶段用新正文重建
  }
  return {
    title: (item.title || '').trim(),
    url: item.link || '',
    author: textOf(item.creator || item.author),
    cover: (item.enclosure && item.enclosure.url) || firstImg(contentHtml) || null,
    summary,
    // 摘要型 feed（无正文）：用摘要垫底，保证阅读栏有内容可读，附「打开原文」
    content_html: contentHtml || `<p>${summary}</p>`,
    published_at: item.isoDate || (item.pubDate ? new Date(item.pubDate).toISOString() : null),
    // 六期 F6：feed 的 <category>（AIHOT 分类映射依据）
    category: Array.isArray(item.categories) && item.categories.length ? String(item.categories[0]).trim() : null,
    // 七期 F1：🔗 原文链接（AIHOT 聚合条目指向第三方原站）
    original_url: extractOriginalUrl(rawContent),
  };
}

async function parseFeed(url) {
  const xml = await fetchText(url); // 复用超时/重试/UA 封装
  return parser.parseString(xml);
}

// 七期 F2：ETag 条件请求。extra 里存 etag/lastModified，304 时短路（fetchText 对 !ok 抛错，故用 httpFetch 自行判状态）
// 返回 {feed, etag, lastModified}；304 → {notModified:true}
async function parseFeedConditional(url, extra = {}) {
  const headers = {};
  if (extra.etag) headers['If-None-Match'] = extra.etag;
  if (extra.lastModified) headers['If-Modified-Since'] = extra.lastModified;
  const res = await httpFetch(url, { headers });
  if (res.status === 304) return { notModified: true };
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const xml = await res.text();
  return {
    feed: await parser.parseString(xml),
    etag: res.headers.get('etag') || null,
    lastModified: res.headers.get('last-modified') || null,
  };
}

// ---- T43：YouTube 频道链接 → 官方频道 RSS ----
function isYoutubeUrl(input) {
  return /^https?:\/\/(www\.|m\.)?youtube\.com\//i.test(String(input || '').trim());
}

// 从频道页 HTML 解析 channel_id（canonical / "channelId" / externalId）
async function youtubeChannelId(input) {
  const s = String(input).trim();
  let m = s.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
  if (m) return m[1];
  // /@handle、/c/xxx、/user/xxx 或已是 feeds 链接 → 抓页面解析
  m = s.match(/[?&]channel_id=(UC[\w-]+)/i);
  if (m) return m[1];
  const html = await fetchText(s);
  m = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]+)"/i)
    || html.match(/"(?:channelId|externalId)"\s*:\s*"(UC[\w-]+)"/i);
  if (!m) throw new Error('未能从 YouTube 页面解析出频道 ID');
  return m[1];
}

function youtubeFeedUrl(channelId) {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

// 全文补抓：抓原文页，Readability 提取正文 HTML + og:image 封面（失败返回 null）
// 九期补丁：按 charset 解码（header 优先 → <meta charset> 嗅探），修复 GBK/GB2312/Big5 页面乱码
// 纯函数拆分（可测）：decodeHtmlBuffer 负责编码、extractArticleContent 负责抽取
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

// 从已解析的 document 抽正文:微信文章页走 #js_content,其余走 Readability
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

async function fetchHtmlSmart(url) {
  const res = await httpFetch(url, { timeout: 15000, retries: 2 });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return decodeHtmlBuffer(buf, res.headers.get('content-type'));
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

// 判断解析出的 feed 是否为 YouTube 频道 feed
function isYoutubeFeed(feed, sourceUrl) {
  if (isYoutubeUrl(sourceUrl)) return true;
  const link = String((feed && feed.link) || '');
  return /youtube\.com/.test(link) || (feed.items || []).some((it) => String(it.id || '').startsWith('yt:video:'));
}

// YouTube feed 条目 → videos 表记录（platform='youtube'）
function mapYoutubeItem(item, channelName) {
  const m = String(item.id || '').match(/yt:video:([\w-]+)/);
  const vid = m ? m[1] : (String(item.link || '').match(/[?&]v=([\w-]+)/) || [])[1];
  if (!vid) return null;
  return {
    platform: 'youtube',
    title: (item.title || '').trim(),
    url: `https://www.youtube.com/watch?v=${vid}`,
    vid,
    cover: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
    duration: null,
    author: textOf(item.author) || (channelName || '').trim(),
    intro: (item.contentSnippet || item.content || '').slice(0, 500),
    published_at: item.isoDate || (item.pubDate ? new Date(item.pubDate).toISOString() : null),
  };
}

module.exports = {
  type: 'rss',
  defaultIntervalMin: 480, // 8h
  // match：http(s) 链接即可（优先级最低，registry 中最后登记）
  match(url) {
    return /^https?:\/\/\S+$/i.test(String(url || '').trim()) ? {} : false;
  },
  async resolve(input) {
    let feedUrl = String(input).trim();
    let extra = { siteLink: null };
    let typeOverride = null;
    // T43：YouTube 频道/@handle 链接自动转官方频道 RSS
    if (isYoutubeUrl(feedUrl) && !/feeds\/videos\.xml/.test(feedUrl)) {
      const channelId = await youtubeChannelId(feedUrl);
      feedUrl = youtubeFeedUrl(channelId);
      extra = { siteLink: `https://www.youtube.com/channel/${channelId}`, youtubeChannelId: channelId };
      typeOverride = 'youtube'; // YouTube 源归入视频侧（Sidebar 视频态）
    }
    const feed = await parseFeed(feedUrl);
    // 头像校验：feed.image.url 可能是未渲染的模板占位符（如 Qwen 的 %3Clink...%3E），非法则回退 favicon
    let avatar = (feed.image && feed.image.url) || null;
    if (avatar && (/%3C|%3E/i.test(avatar) || /[<>]/.test(avatar) || !/^https?:\/\//.test(avatar))) avatar = null;
    return {
      type: typeOverride || undefined, // YouTube 时为 'youtube'，否则用适配器默认 'rss'
      name: (feed.title || input).trim(),
      url: feedUrl, // sources.url 存（可能是转换后的）RSS 链接
      uid: extra.youtubeChannelId || null,
      avatar: avatar || faviconOf(feed.link || feedUrl),
      extra: { ...extra, siteLink: feed.link || extra.siteLink },
    };
  },
  async fetch(source) {
    // P2: 七期 F2 + 海外源增量优化：extra 带聚合/精选标记；ETag 条件请求 304 短路
    let extra = {};
    try { extra = JSON.parse(source.extra || '{}'); } catch { /* 非法 JSON 按无 extra 处理 */ }
    const useConditional = !!(extra.etag || extra.lastModified || extra.aggregator || extra.marksFeatured);
    let feed = null;
    let etag = null;
    let lastModified = null;
    let result = null;
    
    if (useConditional) {
      result = await parseFeedConditional(source.url, extra);
      if (result.notModified) return { articles: [], videos: [], notModified: true };
      feed = result.feed;
      etag = result.etag;
      lastModified = result.lastModified;
    } else {
      feed = await parseFeed(source.url);
    }
    
    // P0-2 修复：增量过滤改为「已入库 URL 去重 + 14 天陈旧截断」双闸门，不再按 last_fetched_at 严格过滤
    // 原逻辑 `pubDate > lastFetchAt` 会把「发布早于上轮抓取、但迟到进 feed」的文章永久静默丢弃（wemp 源延迟实测 13min~40h）
    // 去重交给已入库 URL 精确判定 + INSERT OR IGNORE 兜底，迟到文章不再丢
    if (!etag && (feed.items || []).length > 0) {
      const totalBefore = feed.items.length;
      // 1) 已入库 URL 直接跳过（避免重复进 needFulltext 白白重抓全文）
      const urls = (feed.items || []).map((it) => it.link || it.guid).filter(Boolean).slice(0, 200);
      const known = new Set();
      if (urls.length) {
        try {
          const { db } = require('../../../db');
          const rows = db.prepare(`SELECT url FROM articles WHERE url IN (${urls.map(() => '?').join(',')})`).all(...urls);
          for (const r of rows) known.add(r.url);
        } catch { /* 查询失败则不去重，交给 INSERT OR IGNORE 兜底 */ }
      }
      // 2) 只丢弃明显陈旧的条目（14 天前），其余一律保留
      const cutoff = Date.now() - 14 * 86400e3;
      feed.items = (feed.items || []).filter((item) => {
        const u = item.link || item.guid;
        if (u && known.has(u)) return false;
        const pubDate = item.isoDate || item.pubDate;
        if (!pubDate) return true; // 无法判断日期则保留
        return new Date(pubDate).getTime() > cutoff;
      });
      const filteredCount = totalBefore - feed.items.length;
      if (filteredCount > 0) {
        log.info(`[RSS 增量] ${source.name}: 跳过已入库/超 14 天陈旧条目 ${filteredCount} 条`);
      }
    }
    
    // YouTube 频道 feed → videos 表（platform='youtube'）
    if (isYoutubeFeed(feed, source.url)) {
      const videos = (feed.items || [])
        .map((it) => mapYoutubeItem(it, source.name))
        .filter((v) => v && v.title);
      // 2026-09-04 修复：result 在非条件请求路径恒为 null，裸取 .notModified 必抛 TypeError（P0）
      return { articles: [], videos, etag, lastModified, notModified: !!(result && result.notModified) };
    }
    const articles = (feed.items || [])
      .map(mapItem)
      .filter((a) => a.url && a.title);
    // 全文补抓：feed 只有摘要（<1000 字符）或内容被转义 JSON 污染时，抓原文页用 Readability 提取正文
    // 限最新 10 条，避免大 feed 首次导入时请求风暴
    // 七期：aggregator 聚合源（AIHOT）跳过——详情页由 enrich 管线串行补抓，不对第三方原站发请求
    const needFulltext = extra.aggregator ? [] : articles
      .filter((a) => (a.content_html || '').length < 1000 || isJunkContent(a.content_html))
      .slice(0, 10);
    // P2 韧性：整批全文补抓加 60s 总预算——单条 fetchFulltext 最坏 15s×(1+2 重试)=45s，10 条顺序抓最坏 7.5min，
    // 期间 tick() 持 ticking 守卫会阻塞后续所有源；超预算则本轮跳过剩余（条目已入库，下次刷新凭 URL 去重续抓）
    const ftStart = Date.now();
    const FT_BUDGET_MS = 60000;
    for (let fi = 0; fi < needFulltext.length; fi++) {
      const a = needFulltext[fi];
      if (Date.now() - ftStart > FT_BUDGET_MS) {
        log.warn(`[全文补抓] ${source.name} 达 ${FT_BUDGET_MS / 1000}s 总预算，本轮跳过剩余 ${needFulltext.length - fi} 条（下次刷新续抓）`);
        break;
      }
      try {
        const full = await fetchFulltext(a.url);
        if (full) {
          const cur = a.content_html || '';
          if (isJunkContent(cur) || full.content.length > cur.length) {
            a.content_html = full.content;
            // 摘要为空或被 JSON 污染时，用新正文重建
            if (!a.summary || /^\s*[{\[]/.test(a.summary) || /"@context"|\\+"/.test(a.summary)) {
              a.summary = summarize(full.content);
            }
          }
          if (!a.cover && full.cover) a.cover = full.cover;
        }
      } catch (err) { log.warn(`[全文补抓] ${source.name} 单条失败(保留摘要): ${a.url} - ${err.message}`); } // P1-3 修复：静默失败可观测化
    }
    // 丢弃仍被污染的条目（如 Meta 产品落地页：JS 应用页拿不到正文，阅读栏会空白）
    const readable = articles.filter((a) => !isJunkContent(a.content_html));
    return { articles: readable, videos: [], etag, lastModified };
  },
  // 测试用内部函数
  _internals: { fetchHtmlSmart, decodeHtmlBuffer, extractArticleContent, cleanContent, isJunkContent, isYoutubeUrl, youtubeChannelId, youtubeFeedUrl, isYoutubeFeed, mapYoutubeItem, parseFeed, parseFeedConditional, extractOriginalUrl, fetchFulltext },
};
