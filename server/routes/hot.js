// 热点榜 API（六期 F6/F7；七期 F2/F3/F4 增强）
// GET  /api/hot?tab=featured|all&category=&q=&source=&cursor=  —— featured 分类过滤；all 时间线+搜索+来源筛选
// GET  /api/hot/sources                          —— 聚合源 author 聚合计数（来源下拉）
// POST /api/hot/original {id}                    —— 英文原文抓取（Readability，走代理；original_html 兜底路由保留）
// GET  /api/hot/categories                       —— 六类清单 + 映射规则表
// POST /api/hot/backfill + GET /api/hot/backfill —— sitemap 历史回填控制与进度（F2）
// POST /api/hot/enrich {id}                      —— 单条手动补抓详情（调试用）
const express = require('express');
const hot = require('../services/hot');
const backfill = require('../services/aihot/backfill');
const enrich = require('../services/aihot/enrich');
const events = require('../services/events');

const router = express.Router();

// 九期 M4:跨域事件热点榜
// GET /api/hot/events?domain=all|综合热搜|科技热榜|...  —— 聚合事件列表(热度排序)
router.get('/events', (req, res) => {
  try {
    const domain = req.query.domain || 'all';
    const list = events.getEvents(domain);
    res.json({
      ok: true,
      events: list.map((e, i) => ({ rank: i + 1, ...e, items: undefined })), // 列表不带簇内条目
      domains: [...new Set(events.getEvents('all').map((e) => e.domain))],
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// GET /api/hot/events/:rank?domain= —— 事件详情(含报道时间线)
router.get('/events/:rank', (req, res) => {
  try {
    const idx = Number(req.params.rank) - 1;
    if (!Number.isInteger(idx) || idx < 0) return res.status(400).json({ ok: false, error: 'rank 必须是正整数' });
    const ev = events.getEvent(idx, req.query.domain || 'all');
    if (!ev) return res.status(404).json({ ok: false, error: '事件不存在' });
    res.json({ ok: true, event: { rank: idx + 1, ...ev } });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// 注意：/categories /sources /backfill 必须先注册，避免落入其它参数路由
router.get('/categories', (req, res) => {
  res.json({ ok: true, categories: hot.CATEGORIES, map: hot.categoryMap() });
});

router.get('/sources', (req, res) => {
  res.json({ ok: true, sources: hot.sources() });
});

// 回填：POST 触发（幂等，running 拒绝）；GET 查进度（前端轮询）
router.post('/backfill', async (req, res) => {
  try {
    const r = await backfill.start();
    res.status(r.ok ? 200 : 409).json(r);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.get('/backfill', (req, res) => {
  res.json({ ok: true, progress: backfill.status() });
});

router.post('/enrich', async (req, res) => {
  const id = Number((req.body || {}).id);
  if (!id) return res.status(400).json({ ok: false, error: '缺少 id' });
  try {
    const d = await enrich.enrichArticle(id);
    res.json({ ok: true, detail: { score: d.score, tags: d.tags, featured: d.featured, hasOriginal: !!d.originalHtml } });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.get('/', (req, res) => {
  const tab = req.query.tab || 'featured';
  const { items, nextCursor } = hot.query({
    category: tab === 'featured' ? (req.query.category || '') : '', // tab=featured 时 category 生效
    q: tab === 'all' ? (req.query.q || '') : '', // tab=all 时 q 生效
    source: tab === 'all' ? (req.query.source || '') : '', // tab=all 时 source 生效
    cursor: req.query.cursor || '',
  });
  res.json({ ok: true, items, nextCursor });
});

router.post('/original', async (req, res) => {
  const id = Number((req.body || {}).id);
  if (!id) return res.status(400).json({ ok: false, error: '缺少 id' });
  try {
    const { html, sourceUrl } = await hot.originalHtml(id);
    res.json({ ok: true, html, sourceUrl });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

module.exports = router;
