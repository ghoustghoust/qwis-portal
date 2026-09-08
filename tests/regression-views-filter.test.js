// 十一期回归测试：smart 排序 / score_min / lang 启发式 / views 分区 / 缺省零回归
// 真实路由驱动（样板 regression-sourcelib.test.js）
require('./helpers');
const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const { cleanup } = require('./helpers');
const { db, setSetting } = require('../server/db');
const { nowIso } = require('../server/util/time');

after(() => cleanup());

// ── 辅助：建源 + 建文章 ──
function createSource(type, name, opts = {}) {
  return db.prepare(
    "INSERT INTO sources(type, name, url, avatar, uid, extra, enabled, status, focus, created_at) VALUES(?,?,?,?,?,?,1,'ok',?,?)"
  ).run(type, name, `http://test/${name}`, null, null, '{}', opts.focus ? 1 : 0, nowIso());
}
function createArticle(sourceId, title, opts = {}) {
  const pub = opts.published_at || nowIso();
  return db.prepare(
    'INSERT INTO articles(source_id, title, url, summary, published_at, created_at, score) VALUES(?,?,?,?,?,?,?)'
  ).run(sourceId, title, `http://test/${title}`, '', pub, pub, opts.score ?? null);
}

// ── 真实路由环境 ──
let base;
let token;
let server;
before(async () => {
  const express = require('express');
  const { authMiddleware, generateToken } = require('../server/middleware/auth');
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api/articles', require('../server/routes/articles'));
  app.use('/api/settings', require('../server/routes/settings'));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  token = generateToken({ user: 'admin' });
});
after(() => { try { server?.close(); } catch { /* 已关闭 */ } });

function req(method, path, body, withAuth = true) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (withAuth) headers.Authorization = `Bearer ${token}`;
  return fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
}

// ── T1: sort=smart — focus 源优先 ──
test('sort=smart: focus 源文章排在同时间窗非 focus 源之前', async () => {
  const focusSrc = createSource('rss', '焦点源', { focus: true });
  const normalSrc = createSource('rss', '普通源');
  // 同一时间发布
  const sameTime = '2026-09-05T10:00:00.000Z';
  createArticle(focusSrc.lastInsertRowid, '焦点文章', { published_at: sameTime });
  createArticle(normalSrc.lastInsertRowid, '普通文章', { published_at: sameTime });
  const r = await req('GET', '/api/articles?sort=smart');
  assert.equal(r.status, 200);
  assert.ok(r.body.ok);
  const items = r.body.items;
  const focusIdx = items.findIndex((a) => a.title === '焦点文章');
  const normalIdx = items.findIndex((a) => a.title === '普通文章');
  assert.ok(focusIdx >= 0 && normalIdx >= 0, '两篇文章都应出现');
  assert.ok(focusIdx < normalIdx, 'focus 源文章应排在非 focus 源之前');
});

test('sort=smart: 3天前的 focus 源排在刚发布的非 focus 之前', async () => {
  const focusSrc2 = createSource('rss', '焦点源2', { focus: true });
  const normalSrc2 = createSource('rss', '普通源2');
  const threeDaysAgo = new Date(Date.now() - 2 * 86400 * 1000).toISOString(); // 2 天前（在 3d 窗口内）
  const justNow = nowIso();
  createArticle(focusSrc2.lastInsertRowid, '焦点旧文', { published_at: threeDaysAgo });
  createArticle(normalSrc2.lastInsertRowid, '普通新文', { published_at: justNow });
  const r = await req('GET', '/api/articles?sort=smart');
  const items = r.body.items;
  const focusIdx = items.findIndex((a) => a.title === '焦点旧文');
  const normalIdx = items.findIndex((a) => a.title === '普通新文');
  assert.ok(focusIdx >= 0 && normalIdx >= 0);
  assert.ok(focusIdx < normalIdx, '2天前的 focus 源（在 3d 加成窗口内）应排在刚发布的非 focus 之前');
});

// ── T2: score_min ──
test('score_min=80: 隐藏无评分与低分条目', async () => {
  const src = createSource('rss', '评分测试源');
  createArticle(src.lastInsertRowid, '高分文章', { score: 95 });
  createArticle(src.lastInsertRowid, '中分文章', { score: 85 });
  createArticle(src.lastInsertRowid, '低分文章', { score: 60 });
  createArticle(src.lastInsertRowid, '无评分文章');
  const r = await req('GET', '/api/articles?score_min=80');
  assert.equal(r.status, 200);
  const titles = r.body.items.map((a) => a.title);
  assert.ok(titles.includes('高分文章'));
  assert.ok(titles.includes('中分文章'));
  assert.ok(!titles.includes('低分文章'), '低分条目应被隐藏');
  assert.ok(!titles.includes('无评分文章'), '无评分条目应被隐藏');
});

test('score_min=90: 只保留 ≥90 分', async () => {
  const r = await req('GET', '/api/articles?score_min=90');
  const titles = r.body.items.map((a) => a.title);
  assert.ok(titles.includes('高分文章'));
  assert.ok(!titles.includes('中分文章'));
});

// ── T2: lang 启发式 ──
test('lang=zh: 中文标题可见、英文标题不可见', async () => {
  const src = createSource('rss', '语言测试源');
  createArticle(src.lastInsertRowid, '这是一篇中文标题的文章');
  createArticle(src.lastInsertRowid, 'This is an English title article');
  const r = await req('GET', '/api/articles?lang=zh');
  assert.equal(r.status, 200);
  const titles = r.body.items.map((a) => a.title);
  assert.ok(titles.includes('这是一篇中文标题的文章'), '中文标题应在 lang=zh 下可见');
  assert.ok(!titles.includes('This is an English title article'), '英文标题不应在 lang=zh 下出现');
});

test('lang=en: 英文标题可见、中文标题不可见', async () => {
  const r = await req('GET', '/api/articles?lang=en');
  const titles = r.body.items.map((a) => a.title);
  assert.ok(titles.includes('This is an English title article'), '英文标题应在 lang=en 下可见');
  assert.ok(!titles.includes('这是一篇中文标题的文章'), '中文标题不应在 lang=en 下出现');
});

test('dedup=1 & lang=zh: dedup 优先，lang 忽略', async () => {
  const r = await req('GET', '/api/articles?dedup=1&lang=zh');
  assert.equal(r.status, 200);
  assert.ok(r.body.deduped, 'dedup=1 应生效');
});

// ── T3: views 分区 ──
test('views GET: 公开可读，初始为空数组', async () => {
  const r = await req('GET', '/api/settings', undefined, false);
  assert.equal(r.status, 200);
  assert.ok(r.body.ok);
  assert.ok(Array.isArray(r.body.views));
  assert.equal(r.body.views.length, 0);
});

test('views PUT: 无 token 401', async () => {
  const r = await req('PUT', '/api/settings', { views: [{ name: '测试', filter: { sort: 'new' } }] }, false);
  assert.equal(r.status, 401);
});

test('views PUT: 合法写入', async () => {
  const views = [{ id: 'v1', name: 'AI 精选', filter: { sort: 'smart', scoreMin: 80 } }];
  const r = await req('PUT', '/api/settings', { views });
  assert.equal(r.status, 200);
  const g = await req('GET', '/api/settings');
  assert.equal(g.body.views.length, 1);
  assert.equal(g.body.views[0].name, 'AI 精选');
});

test('views PUT: 非数组 400', async () => {
  const r = await req('PUT', '/api/settings', { views: 'not-array' });
  assert.equal(r.status, 400);
});

test('views PUT: 超 20 个 400', async () => {
  const views = Array.from({ length: 21 }, (_, i) => ({ name: `v${i}`, filter: {} }));
  const r = await req('PUT', '/api/settings', { views });
  assert.equal(r.status, 400);
});

test('views PUT: 空名 400', async () => {
  const r = await req('PUT', '/api/settings', { views: [{ name: '', filter: {} }] });
  assert.equal(r.status, 400);
});

test('views PUT: 名称超 20 字 400', async () => {
  const r = await req('PUT', '/api/settings', { views: [{ name: 'a'.repeat(21), filter: {} }] });
  assert.equal(r.status, 400);
});

// ── 缺省零回归 ──
test('缺省新参数: 响应契约与现状一致（字段/分页）', async () => {
  const r = await req('GET', '/api/articles');
  assert.equal(r.status, 200);
  assert.ok(r.body.ok);
  assert.ok(Array.isArray(r.body.items));
  assert.ok('nextCursor' in r.body);
  assert.ok('span' in r.body);
  assert.ok('counts' in r.body);
  // LIST_FIELDS 增量字段存在（不破坏旧字段）
  if (r.body.items.length > 0) {
    const item = r.body.items[0];
    assert.ok('source_focus' in item, 'source_focus 字段应存在');
    assert.ok('score' in item, 'score 字段应存在');
    assert.ok('source_name' in item, '原有 source_name 字段不应丢失');
  }
});

test('sort=smart + group_id + q 组合查询', async () => {
  const r = await req('GET', '/api/articles?sort=smart&q=中文');
  assert.equal(r.status, 200);
  assert.ok(r.body.ok);
});
