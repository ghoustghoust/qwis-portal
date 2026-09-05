// AIHOT 详情页解析与补抓（七期 F1 核心）
// parseDetail(html)：纯函数，从 SSR HTML + RSC payload 提取 评分/推荐理由/标签/精选/双语全文/发布时间/原文链接
// enrichArticle(id)：fetchText（浏览器 UA，全局代理已在入口生效）→ parseDetail → UPDATE articles
// enrichMissing(limit)：aggregator 源中 score IS NULL 的条目串行补抓（间隔 AIHOT_ENRICH_GAP_MS，默认 2000ms）
const { db } = require('../../db');
const { fetchText } = require('../../util/http');
const log = require('../../util/log');

const GAP_MS = Number(process.env.AIHOT_ENRICH_GAP_MS) || 2000;

function stripTags(html) {
  return String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// HTML 实体反转义（RSC 还原后的正文里残留 &amp; &quot; 等）
function unescapeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// ---- RSC payload 还原 ----
// self.__next_f.push([1,"..."]) 的字符串块逐个 JSON 反转义后拼接成完整 RSC 流
function extractRscStream(html) {
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let stream = '';
  let m;
  while ((m = re.exec(html))) {
    try {
      stream += JSON.parse('"' + m[1] + '"');
    } catch { /* 个别块解析失败跳过 */ }
  }
  return stream;
}

// RSC 文本块：`id:T<hexByteLen>,<text>`（长度是 UTF-8 字节数；块结束可能无换行，必须按字节长度精确截取）
function readRscTextChunk(stream, buf, id) {
  const headRe = new RegExp('(?<![0-9a-z])' + id + ':T([0-9a-f]+),');
  const hm = headRe.exec(stream);
  if (!hm) return null;
  const byteLen = parseInt(hm[1], 16);
  if (!Number.isFinite(byteLen) || byteLen <= 0) return null;
  const startByte = Buffer.byteLength(stream.slice(0, hm.index), 'utf8') + hm[0].length;
  const text = buf.slice(startByte, startByte + byteLen).toString('utf8');
  return text || null;
}

// 从 RSC 流解析 "zhHtml":"$xx" / "originalHtml":"$xx" 引用并还原对应文本块（取首个命中，移动端与桌面端内容相同）
function extractRscHtml(stream, key) {
  const rm = stream.match(new RegExp('"' + key + '":"\\$([0-9a-z]+)"'));
  if (!rm) return null;
  const buf = Buffer.from(stream, 'utf8');
  return readRscTextChunk(stream, buf, rm[1]);
}

// 标签：优先 m-detail-tags 区块的 a.m-detail-tag；兜底正文中「#词」链接（排除 #10151c 这类 6 位 hex 颜色码）
function extractTags(html) {
  const tags = [];
  const block = html.match(/<div class="m-detail-tags">([\s\S]*?)<\/div>/);
  const scope = block ? block[1] : html;
  const re = /<a[^>]*class="[^"]*(?:m-detail-tag|dt-tag)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(scope))) {
    const t = stripTags(m[1]).replace(/^#/, '').trim();
    if (t && !tags.includes(t)) tags.push(t);
  }
  if (tags.length) return tags;
  // 兜底：#词 形式的标签文本（限中文/英文词，排除 6 位 hex 颜色码）
  const re2 = /<a[^>]*>([^<]*#[^<]{1,30})<\/a>/g;
  while ((m = re2.exec(html))) {
    const t = stripTags(m[1]).replace(/^#/, '').trim();
    if (!t || /^[0-9a-fA-F]{6}$/.test(t)) continue;
    if (!tags.includes(t)) tags.push(t);
  }
  return tags;
}

// parseDetail：字段全缺时各项返回 null/[]（N3 降级），调用方按需落库
function parseDetail(html) {
  const s = String(html || '');

  // AI 评分：aria-label="AI 编辑部评分 71，满分 100"（可能带「，点击查看说明」后缀）
  const sm = s.match(/aria-label="AI 编辑部评分 (\d+)，满分 100/);
  const score = sm ? Number(sm[1]) : null;

  // 推荐理由：p.m-detail-reason-text
  const rm = s.match(/<p class="m-detail-reason-text">([\s\S]*?)<\/p>/);
  const reason = rm ? stripTags(unescapeHtml(rm[1])) || null : null;

  // 标题 / 摘要（backfill 直接入库用）
  const tm = s.match(/<h1 class="m-detail-title">([\s\S]*?)<\/h1>/);
  const title = tm ? stripTags(unescapeHtml(tm[1])) || null : null;
  const sum = s.match(/<p class="m-detail-summary-text">([\s\S]*?)<\/p>/);
  const summary = sum ? stripTags(unescapeHtml(sum[1])) || null : null;

  // 发布时间：JSON-LD datePublished（ISO）优先；兜底详情页头部「2026-08-16 04:05」
  let publishedAt = null;
  const dm = s.match(/"datePublished":"([^"]+)"/);
  if (dm) publishedAt = dm[1];
  else {
    const mm = s.match(/<div class="m-detail-meta"><span>(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
    if (mm) publishedAt = new Date(mm[1].replace(' ', 'T') + ':00+08:00').toISOString();
  }

  // 精选徽章：可见标记 m-detail-marks 内「精选」/ dt-selected-badge；或 RSC 的 "aiSelected":true
  let featured = /<div class="m-detail-marks">[\s\S]{0,200}?<span class="m-badge">精选<\/span>/.test(s)
    || /class="dt-selected-badge"/.test(s);

  // 原文链接：详情页「打开原文」外链
  const om = s.match(/<a href="(https?:\/\/[^"]+)"[^>]*class="m-detail-bar-ext"/)
    || s.match(/<a href="(https?:\/\/[^"]+)"[^>]*class="dt-original-button"/);
  const originalUrl = om ? unescapeHtml(om[1]) : null;

  // RSC 流：双语全文 + aiSelected 兜底
  let zhHtml = null;
  let originalHtml = null;
  const stream = extractRscStream(s);
  if (stream) {
    zhHtml = extractRscHtml(stream, 'zhHtml');
    originalHtml = extractRscHtml(stream, 'originalHtml');
    if (!featured) {
      const am = stream.match(/"aiSelected":(true|false)/);
      if (am) featured = am[1] === 'true';
    }
  }

  return {
    score,
    reason,
    tags: extractTags(s),
    featured,
    title,
    summary,
    publishedAt,
    originalUrl,
    zhHtml,
    originalHtml,
  };
}

// ---- 串行补抓队列（独立链，不复用抖音队列；N1 礼貌 ≥2s/条）----
let queueTail = Promise.resolve();

function enqueue(fn) {
  const run = queueTail.then(async () => {
    try {
      return await fn();
    } finally {
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  });
  queueTail = run.catch(() => {});
  return run;
}

// 单条补抓：取 articles.url（详情页地址）→ 解析 → 更新富字段；返回解析结果
async function enrichArticle(articleId) {
  const id = Number(articleId);
  const row = db.prepare('SELECT id, url, published_at FROM articles WHERE id=?').get(id);
  if (!row) throw new Error('文章不存在');
  const html = await fetchText(row.url);
  const d = parseDetail(html);
  db.prepare(`
    UPDATE articles SET
      score = COALESCE(?, score),
      reason = COALESCE(?, reason),
      tags = COALESCE(?, tags),
      featured = CASE WHEN ? THEN 1 ELSE featured END,
      original_html = COALESCE(?, original_html),
      original_url = COALESCE(?, original_url),
      published_at = COALESCE(published_at, ?),
      content_html = CASE WHEN LENGTH(COALESCE(?,'')) > LENGTH(COALESCE(content_html,'')) THEN ? ELSE content_html END,
      category = COALESCE(category, ?)
    WHERE id = ?
  `).run(
    d.score, d.reason, d.tags.length ? JSON.stringify(d.tags) : null,
    d.featured ? 1 : 0, d.originalHtml, d.originalUrl, d.publishedAt,
    d.zhHtml, d.zhHtml, categoryFromTags(d.tags), id
  );
  return d;
}

// 从详情页标签推导类目（取第一个命中类目词表的标签；词表与 hot.js 映射一致）
const CATEGORY_VOCAB = ['模型发布', '评测/基准', 'AI 模型', '产品更新', 'AI 产品', '行业动态', '论文', '论文/研究', '教程/实践', '教程', '大佬观点', '现象/趋势', '技巧观点'];
function categoryFromTags(tags) {
  if (!Array.isArray(tags)) return null;
  return tags.find((t) => CATEGORY_VOCAB.includes(t)) || null;
}

// P1: 批量补抓：从 pending_items 读取待补抓的 aggregator 文章，串行限速；失败记日志继续
// pending_items 表结构 (type,url,name,status,error,imported_at)——文章 id 经 url 关联 articles 取得，
// 绝不能把 pending_items.id 当 articles.id 用（历史 bug：补抓错对象）
async function enrichMissing(limit = 10) {
  // 先清理悬挂记录：文章已被按天清理掉的 pending 行（INNER JOIN 选不出它们，不删会永远残留）
  db.prepare("DELETE FROM pending_items WHERE type='aihot_enrich' AND url NOT IN (SELECT url FROM articles)").run();
  const rows = db.prepare(`
    SELECT p.id AS pending_id, a.id AS article_id, a.title, a.url
    FROM pending_items p
    JOIN articles a ON a.url = p.url
    JOIN sources s ON s.id = a.source_id
    WHERE p.type = 'aihot_enrich'
      AND json_extract(COALESCE(s.extra,'{}'),'$.aggregator') = 1
    ORDER BY p.imported_at DESC
    LIMIT ?
  `).all(Number(limit) || 10);

  let done = 0;
  let failed = 0;

  for (const r of rows) {
    try {
      await enqueue(() => enrichArticle(r.article_id));
      // 成功后删除 pending 记录
      db.prepare('DELETE FROM pending_items WHERE id=?').run(r.pending_id);
      done++;
    } catch (err) {
      failed++;
      log.warn(`[aihot] enrich 失败 pending=${r.pending_id} article=${r.article_id}: ${err.message}`);
      // 失败保留待下轮重试（悬挂行已在入口预清理）
    }
    // 限速：每条间隔 GAP_MS（默认 2s，避免第三方反爬）
    if (done % 10 === 0) await new Promise(resolve => setTimeout(resolve, GAP_MS));
  }
  
  if (done || failed) log.info(`[aihot] enrichMissing 补抓 done=${done} failed=${failed} total=${rows.length}`);
  return { total: rows.length, done, failed };
}

module.exports = { parseDetail, enrichArticle, enrichMissing, _internals: { extractRscStream, readRscTextChunk, extractTags, GAP_MS } };
