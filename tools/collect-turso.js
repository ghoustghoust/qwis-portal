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

// ─── 配置 ───
const MODE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'collect';
const LIMIT = Number(process.env.COLLECT_LIMIT) || 500;
const CONCURRENCY = Number(process.env.COLLECT_CONCURRENCY) || 6;
const FETCH_TIMEOUT = 10000;   // 单源抓取超时（无 serverless 限制，给足 10s）
// 必须用浏览器 UA：newsnow 等热榜 API 对自定义 UA 直接 403（ARCHITECTURE 已知坑 #4 链路）
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
// serverless/云端不可采类型：wemp 已退役、douyin 需 Playwright 登录态、bilibili 需 wbi 签名（后续移植）
const UNSUPPORTED_TYPES = "type NOT IN ('wemp', 'bilibili', 'douyin')";

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
    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
      throw new Error('缺少 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN');
    }
    _db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return _db;
}
async function qAll(sql, args = []) { return Array.from((await getDb().execute({ sql, args })).rows); }
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
    default:
      return null;
  }
}

// ─── 落库（按源聚合 batch，减少 Turso 往返） ───
async function saveArticles(sourceId, articles, { marksFeatured = false } = {}) {
  const db = getDb();
  const now = nowIso();
  const stmts = [];
  for (const a of articles) {
    const score = Number(a.score);
    const wc = textLen(a.content_html);
    stmts.push({
      sql: `INSERT OR IGNORE INTO articles(source_id, title, url, author, cover, summary, content_html, published_at, created_at, category, original_url, score, word_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        sourceId, a.title || '', a.url, a.author || '', a.cover || null,
        a.summary || '', a.content_html || '', a.published_at || null, now,
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

// ─── 源状态 ───
async function updateSourceOk(sourceId, extra, intervalMin) {
  const now = nowIso();
  const next = new Date(Date.now() + intervalMin * 60000).toISOString();
  await qRun(
    "UPDATE sources SET extra=?, last_fetched_at=?, next_fetch_at=?, status='ok', fail_count=0 WHERE id=?",
    [JSON.stringify(extra), now, next, sourceId]
  );
}

async function updateSourceError(sourceId, extra, errMsg, sourceType) {
  extra.lastError = String(errMsg || '').slice(0, 300);
  extra.lastErrorAt = nowIso();
  await qRun(
    "UPDATE sources SET status='error', fail_count=COALESCE(fail_count,0)+1, extra=? WHERE id=?",
    [JSON.stringify(extra), sourceId]
  );
  const rows = await qAll('SELECT fail_count, enabled FROM sources WHERE id=?', [sourceId]);
  const r = rows[0];
  // YouTube 对数据中心 IP 反爬会返回假 404/500（间歇性、按 IP 掷骰），
  // 熔断阈值放宽到 10，避免把活源误杀；真死频道 10 连跪后也照停。
  const threshold = sourceType === 'youtube' ? 10 : 3;
  if (r && r.fail_count >= threshold && r.enabled !== 0) {
    await qRun('UPDATE sources SET enabled=0 WHERE id=?', [sourceId]);
    return { autoPaused: true };
  }
  return { autoPaused: false };
}

// ─── 单源采集 ───
async function collectOne(source, stats) {
  const adapter = getAdapter(source.type);
  if (!adapter) { stats.skipped++; return; }

  let extra = {};
  try { extra = JSON.parse(source.extra || '{}'); } catch { /* 无 extra */ }

  try {
    const result = await adapter.fetch(source);
    if (result.skipped) { stats.skipped++; return; }

    const added = await saveArticles(source.id, result.articles || [], { marksFeatured: !!extra.marksFeatured });
    stats.articles += added;

    if (result.etag) extra.etag = result.etag;
    if (result.lastModified) extra.lastModified = result.lastModified;
    if (extra.lastError) { delete extra.lastError; delete extra.lastErrorAt; }

    // 2026-09-11：RSS 默认间隔 480→60min。runner 容量充足（全量一轮几分钟），
    // ETag 304 使重复拉取几乎免费；8h 间隔会导致公众号新文章延迟大半天才入流。
    const intervalMin = Number(extra.intervalMin) || (source.type === 'hotlist' ? 30 : 60);
    await updateSourceOk(source.id, extra, intervalMin);
    stats.success++;
  } catch (err) {
    const { autoPaused } = await updateSourceError(source.id, extra, err.message, source.type);
    stats.failed++;
    log(`  ✗ ${source.type}:${source.name} — ${err.message}${autoPaused ? ' (已自动暂停)' : ''}`);
    // 15-cloud-alerts：收集失败源供批次尾部报警
    stats.failures.push({ source, errMsg: err.message });
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
    await qRun(
      'INSERT OR REPLACE INTO settings(key, value) VALUES(?, ?)',
      ['cloud.collect', JSON.stringify({ mode, lastRunAt: nowIso(), stats })]
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
  stats.total = sources.length;
  log(`到期源 ${sources.length} 个，并发 ${CONCURRENCY} 开始采集`);

  const t0 = Date.now();
  await runPool(sources, (s) => collectOne(s, stats), CONCURRENCY);
  const sec = ((Date.now() - t0) / 1000).toFixed(1);

  log(`采集完成: 成功 ${stats.success} / 失败 ${stats.failed} / 跳过 ${stats.skipped} / 新增 ${stats.articles} 篇 / 耗时 ${sec}s`);
  await writeHeartbeat('collect', stats);
  await postRunAlerts(stats); // 15-cloud-alerts：批次尾部报警（失败隔离，绝不影响退出码）
  return stats;
}

// 15-cloud-alerts：批次尾部报警检测（源失败/熔断/停滞）
async function postRunAlerts(stats) {
  try {
    const alerts = require('../api/_alerts');
    // 逐失败源（failCount 重查以获得最新值）
    for (const f of stats.failures || []) {
      const row = await qOne('SELECT fail_count FROM sources WHERE id=?', [f.source.id]);
      const failCount = row ? row.fail_count : 1;
      if (failCount >= 2) await alerts.sourceAlert({ ...f.source }, failCount, f.errMsg);
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

// ─── 模式：cleanup（清理 7 天前热榜旧数据） ───
async function runCleanup() {
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  const r = await qRun(
    `DELETE FROM articles WHERE source_id IN (SELECT id FROM sources WHERE type='hotlist') AND published_at < ? AND read_at IS NULL AND later=0`,
    [cutoff]
  );
  log(`清理完成: 删除 ${r.changes} 条热榜旧数据`);
  await writeHeartbeat('cleanup', { deleted: r.changes });
  // 15-cloud-alerts F5：熔断不沉默——每日清理批次附带熔断待办汇总
  try { await require('../api/_alerts').frozenDigest(); } catch { /* 报警失败不阻断 */ }
  return r;
}

// ─── 模式：daily-ai（18-daily-ai-v2：AI 策展早报，自然日窗口） ───
async function runDailyAi() {
  const _ai = require('../api/_ai');
  const BUDGET_MS = 90 * 60e3;
  const t0 = Date.now();

  // 窗口：北京自然日 [昨00:00, 今00:00)
  const bjOffset = 8 * 3600e3;
  const bjNow = new Date(Date.now() + bjOffset);
  const todayStart = new Date(bjNow); todayStart.setUTCHours(0, 0, 0, 0);
  const startUtc = new Date(todayStart.getTime() - 24 * 3600e3 - bjOffset).toISOString();
  const endUtc = new Date(todayStart.getTime() - bjOffset).toISOString();
  log(`daily-ai 窗口: ${startUtc} ~ ${endUtc}（北京自然日）`);

  // 候选（沿用关键词版排除规则）
  const cfg = await getSetting('daily', {});
  const selectedIds = Array.isArray(cfg.articleSourceIds) ? cfg.articleSourceIds.map(Number) : null;
  let sql = `SELECT a.id, a.title, a.url, a.author, a.summary, a.content_html, a.published_at, a.score, a.translated_title, s.name AS source_name, s.focus AS source_focus
             FROM articles a LEFT JOIN sources s ON s.id = a.source_id
             WHERE a.published_at >= ? AND a.published_at < ? AND s.enabled = 1
               AND s.type != 'hotlist' AND COALESCE(json_extract(COALESCE(s.extra,'{}'),'$.aggregator'),0) != 1`;
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

  // 阶段 1：初筛
  const passed = [];
  for (const a of valid) {
    if (Date.now() - t0 > BUDGET_MS * 0.5) { log('初筛预算过半，截断'); break; }
    const f = await _ai.filterArticle({ title: a.title, source: a.source_name, category: null, summary: a.summary });
    if (!f.ignore) passed.push({ ...a, filterScore: f.score, filterReason: f.reason });
  }
  log(`初筛通过 ${passed.length}/${valid.length}，开始深析`);

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
        await qRun("UPDATE daily_reports SET stats = json_set(stats, '$.degraded', json('true'), '$.schemaVersion', '1') WHERE id = (SELECT MAX(id) FROM daily_reports)");
        return { degraded: true, fallback: stats };
      }
      continue;
    }
    consecFail = 0;
    analyzed.push({ ...a, ...r });
  }
  log(`深析完成 ${analyzed.length} 篇，组装栏目`);

  // 栏目组装（沿用 columns 语义：focus 优先 → 关键词 → fallback 按总分）
  const columns = await getSetting('daily.columns', null) || DEFAULT_COLUMNS;
  const used = new Set();
  const sections = [];
  const fmt = (a) => ({
    id: a.id, title: a.translated_title || a.title, url: a.url, source: a.source_name,
    source_name: a.source_name, published_at: a.published_at,
    totalScore: a.totalScore, score: a.totalScore, // score 兼容现有 Stars 组件
    scores: a.scores,
    reason: a.reason, summary: a.summary, quote: a.quote, points: a.points, tags: a.tags,
    translated: !!a.translated_title,
  });
  for (const col of columns) {
    const items = [];
    if (col.special === 'focus') {
      for (const a of analyzed) {
        if (used.has(a.id)) continue;
        if (a.source_focus) { items.push(fmt(a)); used.add(a.id); }
      }
    } else if (col.special === 'fallback') {
      const rest = analyzed.filter((a) => !used.has(a.id)).sort((x, y) => y.totalScore - x.totalScore).slice(0, 10);
      for (const a of rest) { items.push(fmt(a)); used.add(a.id); }
    } else if (col.keywords && col.keywords.length) {
      for (const a of analyzed) {
        if (used.has(a.id)) continue;
        const text = `${a.title} ${a.summary || ''} ${(a.tags || []).join(' ')}`;
        if (col.keywords.some((kw) => text.includes(kw))) { items.push(fmt(a)); used.add(a.id); }
      }
    }
    const deduped = dedupItems(items);
    if (deduped.length) sections.push({ column: col.name, desc: col.desc || '', items: deduped.slice(0, 15) });
  }

  // 主题导语
  const allItems = sections.flatMap((s) => s.items);
  const theme = await _ai.generateTheme(allItems).catch(() => null);

  const stats = {
    schemaVersion: 2, theme, degraded: false,
    filterStats: { candidates: valid.length, passed: passed.length, analyzed: analyzed.length },
    sections: sections.length, totalItems: allItems.length,
    elapsedMin: Math.round((Date.now() - t0) / 600e2) / 10,
  };
  await qRun(
    'INSERT INTO daily_reports(generated_at, window_hours, stats, sections) VALUES(?, ?, ?, ?)',
    [nowIso(), 24, JSON.stringify(stats), JSON.stringify(sections)]
  );
  log(`daily-ai 早报生成完成: ${sections.length} 栏 ${allItems.length} 条, 耗时 ${stats.elapsedMin}min, 主题: ${theme || '(无)'}`);
  await writeHeartbeat('daily-ai', stats);
  return stats;
}

// ─── 模式：daily（日报生成，逻辑与 api/daily-generate.js 对齐） ───
const DEFAULT_COLUMNS = [
  { id: 'c1', name: '培训课程发布', desc: '课程/训练营/社群招募', keywords: ['课程', '训练营', '社群', '招募', '培训'] },
  { id: 'focus', name: '重点更新', special: 'focus' },
  { id: 'c2', name: 'AI技术', desc: 'Codex/Claude/Agent/模型等', keywords: ['Codex', 'Claude', '豆包', 'Agent', '模型', '自动化', 'RAG', 'MCP'] },
  { id: 'fallback', name: '其它重要', special: 'fallback' },
];
const ARTICLE_SOURCE_TYPES = ['wechat', 'rss', 'x'];

async function getSetting(key, def = null) {
  const rows = await qAll('SELECT value FROM settings WHERE key = ?', [key]);
  if (!rows[0]) return def;
  try { return JSON.parse(rows[0].value); } catch { return def; }
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
  const now = new Date();
  const bjOffset = 8 * 3600e3;
  const bjNow = new Date(now.getTime() + bjOffset);
  const todayStart = new Date(bjNow);
  todayStart.setUTCHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 3600e3);
  const todaySixAM = new Date(todayStart.getTime() + 6 * 3600e3);
  const cutoff = new Date(yesterdayStart.getTime() - bjOffset).toISOString();
  const cutoffEnd = new Date(todaySixAM.getTime() - bjOffset).toISOString();
  const columns = await getSetting('daily.columns', null) || DEFAULT_COLUMNS;
  const selectedIds = Array.isArray(cfg.articleSourceIds) ? cfg.articleSourceIds.map(Number) : null;

  let sql = `SELECT a.*, s.name AS source_name, s.focus AS source_focus
             FROM articles a LEFT JOIN sources s ON s.id = a.source_id
             WHERE a.published_at >= ? AND a.published_at <= ? AND s.enabled = 1
               AND s.type IN (${ARTICLE_SOURCE_TYPES.map(() => '?').join(',')})`;
  const args = [cutoff, cutoffEnd, ...ARTICLE_SOURCE_TYPES];
  if (selectedIds && selectedIds.length) {
    sql += ` AND a.source_id IN (${selectedIds.map(() => '?').join(',')})`;
    args.push(...selectedIds);
  }
  sql += " AND s.type != 'hotlist' AND COALESCE(json_extract(COALESCE(s.extra,'{}'),'$.aggregator'),0) != 1";
  sql += ' ORDER BY a.published_at DESC LIMIT 500';

  const candidates = await qAll(sql, args);
  const valid = candidates.filter(a => !hasMojibake(a.title) && !isErrorPageItem(a));

  const sections = [];
  const used = new Set();
  for (const col of columns) {
    const items = [];
    if (col.special === 'focus') {
      for (const a of valid) {
        if (used.has(a.id)) continue;
        if (a.source_focus) { items.push(formatItem(a)); used.add(a.id); }
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
// 语义对齐本地：同一默认 Prompt、同一 isEnglish 判定、同一写入列（translated_title/translated_content）
const TRANSLATE_DEFAULT_PROMPT = `你是一位资深科技翻译专家，擅长将英文新闻资讯、技术论文和工程类文章翻译为高质量中文。

翻译要求：
1. 【准确性】忠实原文，不遗漏关键信息，不添加原文没有的内容
2. 【流畅性】符合中文表达习惯，避免翻译腔（如"被...所"、"对于...来说"过多使用）
3. 【专业性】技术术语首次出现时采用「中文（英文原文）」格式，如"大语言模型（LLM）"
4. 【结构保持】保留原文的段落结构、列表、标题层级
5. 【数字与单位】保留原始数字，单位按中文习惯转换（如 "10 million" → "1000 万"）
6. 【专有名词】公司名/产品名/人名保留英文或通用译名，不强行音译
7. 【语境适配】新闻体用简洁明快的语言，论文体用严谨正式的措辞

请翻译以下内容，只输出翻译结果，不要添加任何解释或注释。`;

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

// AI 调用链：Agnes（主，key 绑 IP 地区，Azure runner 会被 401）→ DeepSeek（备，DEEPSEEK_API_KEY 存在时启用）
// [2026-09-11 发现] Agnes key 从亚洲 IP（HK/东京）可用，从 Azure US 返回 "api key invalid"
async function llmChat(messages, { temperature, timeoutMs = 120000 } = {}) {
  const aiCfg = await getSetting('ai', {});
  const normBase = (b) => String(b || '').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  const providers = [];
  if (process.env.AGNES_API_KEY || aiCfg.apiKey) {
    providers.push({
      name: 'agnes',
      key: process.env.AGNES_API_KEY || aiCfg.apiKey,
      base: normBase(process.env.AGNES_API_BASE || aiCfg.apiBase || 'https://apihub.agnes-ai.com/v1'),
      model: process.env.AGNES_MODEL || aiCfg.model || 'agnes-2.5-flash',
    });
  }
  if (process.env.DEEPSEEK_API_KEY) {
    providers.push({
      name: 'deepseek',
      key: process.env.DEEPSEEK_API_KEY,
      base: 'https://api.deepseek.com',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    });
  }
  if (!providers.length) throw new Error('未配置任何 AI Key（AGNES_API_KEY / DEEPSEEK_API_KEY）');

  let lastErr = null;
  for (const p of providers) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const doFetch = proxyFetch || fetch;
      const resp = await doFetch(`${p.base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
        body: JSON.stringify({ model: p.model, messages, ...(temperature !== undefined ? { temperature } : {}) }),
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        const bodyText = await resp.text().catch(() => '');
        throw new Error(`${p.name} HTTP ${resp.status}: ${bodyText.slice(0, 200)}`);
      }
      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error(`${p.name} 返回空内容`);
      return content.trim();
    } catch (err) {
      lastErr = err;
      log(`  [AI] ${p.name} 失败: ${err.message.slice(0, 120)}${p !== providers[providers.length - 1] ? '，回退下一个' : ''}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
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

  const input = title ? `Title: ${title}\n\nArticle:\n${plainText}` : plainText;
  // 轮 1：初翻（含降级链）
  const r = await _ai.translateText(input, { kind: 'translate' });
  if (!r.ok) throw new Error(r.error || '翻译失败');
  let reply = r.text;
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
    if (firstLine.length < 100 && firstLine.length > 2) {
      translatedTitle = firstLine;
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

async function runTranslate() {
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
  const candidates = titleRows.filter(a => isEnglish(a.title)).slice(0, limit);
  log(`英文候选 ${candidates.length} 篇（扫描最近 ${titleRows.length} 条标题，本轮上限 ${limit}）`);

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
  try {
    if (MODE === 'collect') await runCollect();
    else if (MODE === 'cleanup') await runCleanup();
    else if (MODE === 'daily') await runDaily();
    else if (MODE === 'daily-ai') await runDailyAi();
    else if (MODE === 'translate') await runTranslate();
    else { console.error(`未知模式: ${MODE}`); process.exit(1); }
  } catch (err) {
    console.error(`Fatal: ${err.message}`);
    // 15-cloud-alerts：daily 失败发报警后再退出
    if (MODE === 'daily') {
      try { await require('../api/_alerts').dailyFailed(err.message); } catch { /* 隔离 */ }
    }
    process.exit(1);
  }
  // 有序收尾：关连接后自然退出（process.exit 会触发 libuv UV_HANDLE_CLOSING 断言，exit 127）
  try { if (_db) _db.close(); } catch { /* 忽略 */ }
  try { if (proxyAgent) await proxyAgent.close(); } catch { /* 忽略 */ }
  process.exitCode = 0;
})();
