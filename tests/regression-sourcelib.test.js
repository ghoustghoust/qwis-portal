// 源库接口回归测试：batch/autoclassify/move/401/自动分类挂接
// 2026-09-05 验收后重写(P2-2 修复):消灭「重述实现」的空转测试——
// move/batch/autoclassify 一律起真实 express 实例打真实路由(含真鉴权链),不在测试体内手写 SQL 模拟
require('./helpers');
const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const { cleanup } = require('./helpers');
const { db, getSetting } = require('../server/db');
const { nowIso } = require('../server/util/time');
const classify = require('../server/services/classify');

after(() => cleanup());

// ── 辅助:建源/建组 ──
function createSource(type, name, url, extra = {}) {
  return db.prepare(
    "INSERT INTO sources(type, name, url, avatar, uid, extra, enabled, status, created_at) VALUES(?,?,?,?,?,?,1,'ok',?)"
  ).run(type, name, url || `http://test/${name}`, null, null, JSON.stringify(extra), nowIso());
}
function createGroup(kind, name) {
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort),0) m FROM groups').get().m;
  return db.prepare('INSERT INTO groups(kind, name, sort) VALUES(?,?,?)').run(kind, name, maxSort + 1);
}

// ── 真实路由环境:express 实例 + authMiddleware + 两个路由,与生产挂载一致 ──
let base; // http://127.0.0.1:PORT
let token;
let server;
before(async () => {
  const express = require('express');
  const { authMiddleware, generateToken } = require('../server/middleware/auth');
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware); // 与 index.js 一致:先鉴权再挂路由
  app.use('/api/sources', require('../server/routes/sourcelib'));
  app.use('/api/groups', require('../server/routes/groups'));
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

// ── T5: 建源自动入组(纯逻辑层,直接调 classify) ──
test('autoClassifySourceId: 名称含「技术」的源自动归入编程技术', () => {
  const r = createSource('rss', '某技术博客');
  const ok = classify.autoClassifySourceId(r.lastInsertRowid);
  assert.ok(ok);
  const s = db.prepare('SELECT * FROM sources WHERE id=?').get(r.lastInsertRowid);
  const g = db.prepare('SELECT * FROM groups WHERE id=?').get(s.group_id);
  assert.ok(g);
  assert.equal(g.name, '编程技术');
});

test('autoClassifySourceId: 无命中源保持未分组', () => {
  const r = createSource('rss', '某某无分类博客');
  const ok = classify.autoClassifySourceId(r.lastInsertRowid);
  assert.equal(ok, false);
  assert.equal(db.prepare('SELECT group_id FROM sources WHERE id=?').get(r.lastInsertRowid).group_id, null);
});

// ── 鉴权(真实中间件 + 真实路由) ──
test('鉴权: batch/autoclassify/move 无 token 一律 401', async () => {
  for (const [m, p, b] of [
    ['POST', '/api/sources/batch', { ids: [1], action: 'focus' }],
    ['POST', '/api/sources/autoclassify', { dryRun: true }],
    ['POST', '/api/groups/move', { source_id: 1, group_id: 1 }],
  ]) {
    const r = await req(m, p, b, false);
    assert.equal(r.status, 401, `${m} ${p} 无 token 应 401`);
    assert.ok(r.body.needLogin);
  }
});

test('鉴权: GET /api/sources/library 公开只读', async () => {
  const r = await req('GET', '/api/sources/library', undefined, false);
  assert.equal(r.status, 200);
  assert.ok(r.body.ok);
  assert.ok(Array.isArray(r.body.items));
});

// ── T4: move 真实路由 ──
test('move(真实路由): 跨类型拒绝 400,video 源 → article 组', async () => {
  const ag = createGroup('article', '文章组X');
  const vs = createSource('bilibili', 'B站源X');
  const r = await req('POST', '/api/groups/move', { source_id: vs.lastInsertRowid, group_id: ag.lastInsertRowid });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /类型不匹配/);
  assert.equal(db.prepare('SELECT group_id FROM sources WHERE id=?').get(vs.lastInsertRowid).group_id, null);
});

test('move(真实路由): 同类型成功且写 categoryLocked', async () => {
  const ag = createGroup('article', '文章组Y');
  const rs = createSource('rss', 'RSS源Y');
  const r = await req('POST', '/api/groups/move', { source_id: rs.lastInsertRowid, group_id: ag.lastInsertRowid });
  assert.equal(r.status, 200);
  const s = db.prepare('SELECT group_id, extra FROM sources WHERE id=?').get(rs.lastInsertRowid);
  assert.equal(s.group_id, ag.lastInsertRowid);
  assert.equal(JSON.parse(s.extra).categoryLocked, 1);
});

// ── T7: batch 真实路由 ──
test('batch enable(真实路由): 解冻语义 + 6h 错峰', async () => {
  const a = createSource('rss', '错峰A');
  const b = createSource('rss', '错峰B');
  db.prepare('UPDATE sources SET enabled=0, fail_count=3 WHERE id IN (?,?)').run(a.lastInsertRowid, b.lastInsertRowid);
  const r = await req('POST', '/api/sources/batch', { ids: [a.lastInsertRowid, b.lastInsertRowid], action: 'enable' });
  assert.equal(r.status, 200);
  assert.equal(r.body.succeeded, 2);
  const rows = db.prepare('SELECT enabled, fail_count, next_fetch_at FROM sources WHERE id IN (?,?)').all(a.lastInsertRowid, b.lastInsertRowid);
  for (const row of rows) {
    assert.equal(row.enabled, 1, '启用');
    assert.equal(row.fail_count, 0, '解冻清零');
    const t = new Date(row.next_fetch_at).getTime();
    const now = Date.now();
    assert.ok(t >= now - 5000 && t <= now + 6 * 3600 * 1000 + 5000, '错峰落在 6h 窗口');
  }
  assert.notEqual(rows[0].next_fetch_at, rows[1].next_fetch_at, '两源首刷时间应被打散');
});

test('batch focus(真实路由): 增量更新不清他人(AC12)', async () => {
  const a = createSource('rss', '焦点A');
  const b = createSource('rss', '焦点B');
  db.prepare('UPDATE sources SET focus=1 WHERE id=?').run(a.lastInsertRowid); // 模拟日报设置页已勾选 A
  const r = await req('POST', '/api/sources/batch', { ids: [b.lastInsertRowid], action: 'focus' });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT focus FROM sources WHERE id=?').get(a.lastInsertRowid).focus, 1, 'A 的 focus 不被清除');
  assert.equal(db.prepare('SELECT focus FROM sources WHERE id=?').get(b.lastInsertRowid).focus, 1);
});

test('batch(真实路由): 空 ids / 非法 action 返回 400', async () => {
  const r1 = await req('POST', '/api/sources/batch', { ids: [], action: 'focus' });
  assert.equal(r1.status, 400);
  const r2 = await req('POST', '/api/sources/batch', { ids: [1], action: 'nuke' });
  assert.equal(r2.status, 400);
});

// ── T8 + P2-1: autoclassify 真实路由 ──
test('autoclassify dryRun(真实路由): 不落库,且变更清单不含无建议条目(P2-1 回归锁)', async () => {
  createSource('rss', '技术前沿哨兵'); // 有建议(关键词)
  createSource('rss', 'zzz无命中源');   // 无建议
  const cntBefore = db.prepare('SELECT COUNT(*) c FROM sources WHERE group_id IS NOT NULL').get().c;
  const r = await req('POST', '/api/sources/autoclassify', { dryRun: true });
  assert.equal(r.status, 200);
  const cntAfter = db.prepare('SELECT COUNT(*) c FROM sources WHERE group_id IS NOT NULL').get().c;
  assert.equal(cntBefore, cntAfter, 'dryRun 不得落库');
  assert.ok(r.body.changed >= 1);
  for (const it of r.body.items) {
    assert.ok(it.suggested, `变更清单不得包含无建议条目(id=${it.id})`);
  }
  assert.ok(typeof r.body.noSuggestion === 'number' && r.body.noSuggestion >= 1, '无建议条目应单独计数');
});

test('autoclassify apply(真实路由): 跳过 locked 源', async () => {
  const r = createSource('rss', '技术锁定源', null, { categoryLocked: 1 });
  const res = await req('POST', '/api/sources/autoclassify', { apply: true, ids: [r.lastInsertRowid] });
  assert.equal(res.status, 200);
  assert.equal(res.body.applied, 0);
  assert.equal(res.body.skippedLocked, 1);
  assert.equal(db.prepare('SELECT group_id FROM sources WHERE id=?').get(r.lastInsertRowid).group_id, null);
});

// ── 破茧栏联动 ──
test('mergeCocoonFamiliar: 新组名并入 settings', () => {
  classify.mergeCocoonFamiliar('测试新分类');
  const arr = JSON.parse(getSetting('daily.cocoonFamiliar'));
  assert.ok(arr.includes('测试新分类'));
});

// ── 落组复用 ──
test('getOrCreateGroupId: 同名同 kind 复用不重复建组', () => {
  const id1 = classify.getOrCreateGroupId('测试复用组', 'article');
  const id2 = classify.getOrCreateGroupId('测试复用组', 'article');
  assert.equal(id1, id2);
});

test('getOrCreateGroupId: 同名不同 kind 分别建组', () => {
  const id1 = classify.getOrCreateGroupId('同名组', 'article');
  const id2 = classify.getOrCreateGroupId('同名组', 'video');
  assert.notEqual(id1, id2);
});
