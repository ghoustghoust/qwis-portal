// AIHOT sitemap 历史回填（七期 F2）
// 抓 sitemap.xml → /items/ URL 去重 → 排除库中已有 → 逐条抓详情页直接入库（串行 ≥2s，N1 礼貌）
// 进度写 settings['aihot.backfill']；start 幂等（running 时拒绝）；失败条目不入库，重跑自然重试
const { db, getSetting, setSetting } = require('../../db');
const { fetchText } = require('../../util/http');
const log = require('../../util/log');
const { parseDetail } = require('./enrich');

const GAP_MS = Number(process.env.AIHOT_ENRICH_GAP_MS) || 2000;
const KEY = 'aihot.backfill';
const BASE = 'https://aihot.virxact.com';

const DEFAULT_PROGRESS = { running: false, total: 0, done: 0, failed: 0, lastError: null, finishedAt: null };

function status() {
  return getSetting(KEY, { ...DEFAULT_PROGRESS });
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// sitemap.xml → /items/ 详情页 URL 去重列表
async function sitemapUrls() {
  const xml = await fetchText(`${BASE}/sitemap.xml`);
  const urls = new Set();
  for (const m of String(xml).matchAll(/<loc>\s*(https:\/\/aihot\.virxact\.com\/items\/[^<\s]+)\s*<\/loc>/g)) {
    urls.add(m[1]);
  }
  return [...urls];
}

// 聚合源 id（回填条目挂到 AIHOT 聚合源下，进热榜）
function aggregatorSourceId() {
  const row = db.prepare(
    `SELECT id FROM sources WHERE json_extract(COALESCE(extra,'{}'),'$.aggregator')=1 ORDER BY id LIMIT 1`
  ).get();
  return row ? row.id : null;
}

// 单条：抓详情页 → parseDetail → 直接入库（不经过 feed）
async function backfillOne(sourceId, url) {
  const html = await fetchText(url);
  const d = parseDetail(html);
  const summary = d.summary || (d.zhHtml ? stripTags(d.zhHtml).slice(0, 200) : '');
  const contentHtml = d.zhHtml || (summary ? `<p>${summary}</p>` : '');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO articles(source_id, title, url, author, cover, summary, content_html, published_at, created_at,
                         score, reason, tags, featured, original_html, original_url)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      score = COALESCE(excluded.score, articles.score),
      reason = COALESCE(excluded.reason, articles.reason),
      tags = COALESCE(excluded.tags, articles.tags),
      featured = MAX(articles.featured, excluded.featured),
      original_html = COALESCE(excluded.original_html, articles.original_html),
      original_url = COALESCE(excluded.original_url, articles.original_url)
  `).run(
    sourceId, d.title || '', url, 'AIHOT', summary, contentHtml,
    d.publishedAt || now, now,
    d.score, d.reason, d.tags.length ? JSON.stringify(d.tags) : null,
    d.featured ? 1 : 0, d.originalHtml, d.originalUrl
  );
  return d;
}

async function run(progress, urls, sourceId) {
  for (const url of urls) {
    try {
      await backfillOne(sourceId, url);
      progress.done++;
    } catch (err) {
      progress.failed++;
      progress.lastError = `${url}: ${err.message}`;
      log.warn(`[aihot] backfill 失败 ${url}: ${err.message}`);
    }
    setSetting(KEY, { ...progress });
    await new Promise((r) => setTimeout(r, GAP_MS)); // 串行限速 ≥2s/条
  }
  progress.running = false;
  progress.finishedAt = new Date().toISOString();
  setSetting(KEY, { ...progress });
  log.info(`[aihot] backfill 完成 done=${progress.done} failed=${progress.failed} total=${progress.total}`);
}

// start({ urls, limit, wait })：默认抓 sitemap 全量；测试可注入 urls/limit 小规模跑
// running 中重复调用拒绝；返回立即（wait=true 时等全部跑完，供验证脚本用）
async function start({ urls, limit, wait = false } = {}) {
  const cur = status();
  if (cur.running) return { ok: false, error: 'backfill running', progress: cur };
  const sourceId = aggregatorSourceId();
  if (!sourceId) return { ok: false, error: '未找到聚合源（extra.aggregator=1）' };

  let list = urls || (await sitemapUrls());
  if (Number.isFinite(limit) && limit > 0) list = list.slice(0, limit);
  // 排除库中已有
  const existing = new Set(db.prepare('SELECT url FROM articles').all().map((r) => r.url));
  const todo = list.filter((u) => !existing.has(u));

  const progress = { ...DEFAULT_PROGRESS, running: true, total: todo.length, done: 0, failed: 0 };
  setSetting(KEY, progress);
  log.info(`[aihot] backfill 启动 total=${progress.total}（sitemap ${list.length}，已有 ${list.length - todo.length}）`);

  const p = run(progress, todo, sourceId);
  if (wait) await p;
  else p.catch((err) => {
    log.error('[aihot] backfill 异常中断:', err.message);
    setSetting(KEY, { ...status(), running: false, lastError: err.message, finishedAt: new Date().toISOString() });
  });
  return { ok: true, progress: status() };
}

module.exports = { start, status, sitemapUrls, backfillOne, _internals: { KEY, GAP_MS } };
