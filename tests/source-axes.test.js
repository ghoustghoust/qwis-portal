// 27b 源四轴迁移回归测试（2026-09-15）——锁死：
// ①迁移幂等（focus=1 → spotlight=1 + subscription.ids 初始化，二次运行不覆盖用户改动）
// ②四轴互不影响（mute 不动 enabled / invisible 不动 spotlight / subscribe 不动任何 sources 列）
// ③batch 新轴 action 与组级 groupScopeId 生效于成员
// ④resolveSubscriptionIds 三态（ids 生效 / 空数组=无订阅 / 键缺失兜底 spotlight）
require('./helpers');
const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const { cleanup } = require('./helpers');
const { db, getSetting, setSetting } = require('../server/db');
const { nowIso } = require('../server/util/time');
const axes = require('../lib/source-axes');

after(() => cleanup());

// lib/source-axes 的 async deps 包本地同步 better-sqlite3（await 对同步值成立）
const deps = {
  qAll: async (sql, args) => db.prepare(sql).all(...(args || [])),
  qRun: async (sql, args) => db.prepare(sql).run(...(args || [])),
  getSetting: async (k, d) => getSetting(k, d),
  setSetting: async (k, v) => setSetting(k, v),
};

function createSource(type, name, cols = {}) {
  const r = db.prepare(
    "INSERT INTO sources(type, name, url, extra, enabled, status, created_at) VALUES(?,?,?,?,1,'ok',?)"
  ).run(type, name, `http://test/${name}`, '{}', nowIso());
  const id = Number(r.lastInsertRowid);
  for (const [k, v] of Object.entries(cols)) db.prepare(`UPDATE sources SET ${k}=? WHERE id=?`).run(v, id);
  return id;
}

// ── 真实路由环境（batch 走真路由，与 regression-sourcelib 同样板） ──
let base, token, server;
before(async () => {
  const express = require('express');
  const { authMiddleware, generateToken } = require('../server/middleware/auth');
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api/sources', require('../server/routes/sourcelib'));
  app.use('/api/sources', require('../server/routes/sources'));
  app.use('/api/articles', require('../server/routes/articles'));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  token = generateToken({ user: 'admin' });
});
after(() => { try { server?.close(); } catch { /* 已关闭 */ } });

function req(method, path, body) {
  return fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
}

// ── ① 迁移语义 ──
test('migrateAxes: focus=1 → spotlight=1 + subscription.ids 初始化', async () => {
  const id = createSource('rss', '迁移源A', { focus: 1 });
  db.prepare("DELETE FROM settings WHERE key IN ('axes.migrated','subscription.ids')").run();
  const ran = await axes.migrateAxes(deps);
  assert.equal(ran, true);
  assert.equal(db.prepare('SELECT spotlight FROM sources WHERE id=?').get(id).spotlight, 1);
  const ids = getSetting('subscription.ids', null);
  assert.ok(Array.isArray(ids) && ids.includes(id), 'subscription.ids 应包含迁移源');
  assert.equal(getSetting('axes.migrated', 0), 1);
});

test('migrateAxes: 幂等——二次运行不覆盖用户后续的 spotlight 改动', async () => {
  const id = createSource('rss', '迁移源B', { focus: 1 });
  // 用户后来把 B 的重点取消又手动订阅别的源
  db.prepare('UPDATE sources SET spotlight=0 WHERE id=?').run(id);
  setSetting('subscription.ids', [999]);
  const ran = await axes.migrateAxes(deps); // 闸已立 → 应直接跳过
  assert.equal(ran, false);
  assert.equal(db.prepare('SELECT spotlight FROM sources WHERE id=?').get(id).spotlight, 0, '用户改动不被覆盖');
  assert.deepEqual(getSetting('subscription.ids', []), [999]);
});

// ── ④ 订阅集合解析三态 ──
test('resolveSubscriptionIds: ids 生效且过滤停用源；空数组=无订阅；键缺失兜底 spotlight', async () => {
  const a = createSource('rss', '订阅源A');
  const b = createSource('rss', '订阅源B（停用）', { enabled: 0 });
  const c = createSource('rss', '重点源C', { spotlight: 1 });
  setSetting('subscription.ids', [a, b]);
  assert.deepEqual(await axes.resolveSubscriptionIds(deps), [a], '停用源被过滤');
  setSetting('subscription.ids', []);
  assert.deepEqual(await axes.resolveSubscriptionIds(deps), [], '显式空数组 = 无订阅（不兜底）');
  // 键缺失场景：置 null（getSetting 解析后为 null，Array.isArray=false → 走兜底）；
  // 不用直接 DELETE 行——那会绕过 server/db 的 30s settings 缓存，读到旧值
  setSetting('subscription.ids', null);
  const fell = await axes.resolveSubscriptionIds(deps);
  assert.ok(fell.includes(c) && !fell.includes(a), '键缺失时兜底 spotlight 集合');
});

// ── ② 四轴互不影响（回归锁） ──
test('四轴互不影响：mute/visible/subscribe 各不动其它轴', async () => {
  const id = createSource('rss', '四轴源', { spotlight: 1 });
  setSetting('subscription.ids', []);
  // mute 只动 muted
  let r = await req('POST', '/api/sources/batch', { ids: [id], action: 'mute' });
  assert.equal(r.body.succeeded, 1);
  let s = db.prepare('SELECT enabled, spotlight, muted, reader_visible FROM sources WHERE id=?').get(id);
  assert.deepEqual([s.enabled, s.spotlight, s.muted, s.reader_visible], [1, 1, 1, 1], 'mute 不动 enabled/spotlight/reader_visible');
  // invisible 只动 reader_visible
  r = await req('POST', '/api/sources/batch', { ids: [id], action: 'invisible' });
  assert.equal(r.body.succeeded, 1);
  s = db.prepare('SELECT enabled, spotlight, muted, reader_visible FROM sources WHERE id=?').get(id);
  assert.deepEqual([s.enabled, s.spotlight, s.muted, s.reader_visible], [1, 1, 1, 0]);
  // subscribe 只动 settings subscription.ids，sources 任何列都不变
  r = await req('POST', '/api/sources/batch', { ids: [id], action: 'subscribe' });
  assert.equal(r.body.succeeded, 1);
  s = db.prepare('SELECT enabled, spotlight, muted, reader_visible FROM sources WHERE id=?').get(id);
  assert.deepEqual([s.enabled, s.spotlight, s.muted, s.reader_visible], [1, 1, 1, 0], 'subscribe 不动 sources 任何列');
  assert.deepEqual(getSetting('subscription.ids', []), [id]);
  // unsubscribe 移出
  await req('POST', '/api/sources/batch', { ids: [id], action: 'unsubscribe' });
  assert.deepEqual(getSetting('subscription.ids', []), []);
});

// ── ③ 组级操作 ──
test('batch groupScopeId: disable/enable/interval 生效于整组成员', async () => {
  const g = db.prepare("INSERT INTO groups(kind, name, sort) VALUES('article','轴测试组',0)").run();
  const gid = Number(g.lastInsertRowid);
  const m1 = createSource('rss', '组员1');
  const m2 = createSource('rss', '组员2');
  db.prepare('UPDATE sources SET group_id=? WHERE id IN (?,?)').run(gid, m1, m2);

  // 组级停用
  let r = await req('POST', '/api/sources/batch', { groupScopeId: gid, action: 'disable' });
  assert.equal(r.status, 200);
  assert.equal(r.body.succeeded, 2);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sources WHERE group_id=? AND enabled=0').get(gid).c, 2);

  // 组级恢复（解冻语义：fail_count 清零、错误字段移除）
  db.prepare("UPDATE sources SET fail_count=3, status='error', extra=json_set(extra,'$.lastError','x') WHERE group_id=?").run(gid);
  r = await req('POST', '/api/sources/batch', { groupScopeId: gid, action: 'enable' });
  assert.equal(r.body.succeeded, 2);
  const row = db.prepare('SELECT enabled, fail_count, status, extra FROM sources WHERE id=?').get(m1);
  assert.deepEqual([row.enabled, row.fail_count, row.status], [1, 0, 'ok']);
  assert.equal(JSON.parse(row.extra).lastError, undefined, 'lastError 被清除');

  // 组级调频（json_set 保留 extra 其它键）
  db.prepare("UPDATE sources SET extra=json_set(COALESCE(extra,'{}'),'$.categoryLocked',1) WHERE id=?").run(m1);
  r = await req('POST', '/api/sources/batch', { groupScopeId: gid, action: 'interval', intervalMin: 120 });
  assert.equal(r.body.succeeded, 2);
  const ex1 = JSON.parse(db.prepare('SELECT extra FROM sources WHERE id=?').get(m1).extra);
  assert.equal(ex1.intervalMin, 120);
  assert.equal(ex1.categoryLocked, 1, 'interval 写入不清 extra 其它键');

  // 组级订阅（settings 合并）
  setSetting('subscription.ids', []);
  r = await req('POST', '/api/sources/batch', { groupScopeId: gid, action: 'subscribe' });
  assert.equal(r.body.subscriptionTotal, 2);
  assert.deepEqual(new Set(getSetting('subscription.ids', [])), new Set([m1, m2]));

  // 组级非法值
  r = await req('POST', '/api/sources/batch', { groupScopeId: gid, action: 'interval', intervalMin: -5 });
  assert.equal(r.status, 400);
  r = await req('POST', '/api/sources/batch', { groupScopeId: 99999, action: 'disable' });
  assert.equal(r.status, 404);
});

test('batch: focus/unfocus 兼容别名落 spotlight 列', async () => {
  const id = createSource('rss', '别名源');
  await req('POST', '/api/sources/batch', { ids: [id], action: 'focus' });
  assert.equal(db.prepare('SELECT spotlight FROM sources WHERE id=?').get(id).spotlight, 1);
  await req('POST', '/api/sources/batch', { ids: [id], action: 'unfocus' });
  assert.equal(db.prepare('SELECT spotlight FROM sources WHERE id=?').get(id).spotlight, 0);
});

// ═══ 对抗审查（2026-09-15 commit f338ac1）发现问题的回归锁 ═══

// P1-1：groupScopeId=null（未分组卡）不得静默成功——跌进 per-ids 路径报 400（前端已禁用入口，锁后端行为）
test('P1-1: groupScopeId=null 返回 400 缺少 ids（不静默作用于全表）', async () => {
  const r = await req('POST', '/api/sources/batch', { groupScopeId: null, action: 'spotlight' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /缺少 ids/);
});

// 四轴核心语义：muted/reader_visible 源被 /api/articles 排除，显式 source_id 豁免
test('轴语义: muted / reader_visible=0 源被文章流排除，显式 source_id 豁免', async () => {
  const a = createSource('rss', '正常源X');
  const m = createSource('rss', '屏蔽源X', { muted: 1 });
  const v = createSource('rss', '未收录源X', { reader_visible: 0 });
  const pub = nowIso();
  for (const [sid, t] of [[a, '正常文X'], [m, '屏蔽文X'], [v, '未收录文X']]) {
    db.prepare('INSERT INTO articles(source_id, title, url, published_at, created_at) VALUES(?,?,?,?,?)')
      .run(sid, t, `http://test/${t}`, pub, pub);
  }
  const r = await req('GET', '/api/articles?sort=new', undefined);
  const titles = r.body.items.map((x) => x.title);
  assert.ok(titles.includes('正常文X'));
  assert.ok(!titles.includes('屏蔽文X'), 'muted 源不进文章流');
  assert.ok(!titles.includes('未收录文X'), 'reader_visible=0 不进文章流');
  // 显式 source_id 豁免（检索层可回看任何源——specs/26：采集全量、选择只过滤消费端）
  const r2 = await req('GET', `/api/articles?source_id=${m}`, undefined);
  assert.ok(r2.body.items.map((x) => x.title).includes('屏蔽文X'), '显式 source_id 可回看屏蔽源');
});

// 27-reader-today：since 精确时刻下限 + smart 游标翻页（新代码路径回归锁）
test('since 参数: 只回窗口内条目；smart 排序游标翻页不丢不重', async () => {
  const s = createSource('rss', 'since源');
  const old = new Date(Date.now() - 48 * 3600e3).toISOString();
  db.prepare('INSERT INTO articles(source_id, title, url, published_at, created_at) VALUES(?,?,?,?,?)')
    .run(s, 'since旧文', 'http://test/since-old', old, old);
  const fresh = nowIso();
  db.prepare('INSERT INTO articles(source_id, title, url, published_at, created_at) VALUES(?,?,?,?,?)')
    .run(s, 'since新文', 'http://test/since-new', fresh, fresh);
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const r = await req('GET', `/api/articles?since=${encodeURIComponent(since)}&sort=new`, undefined);
  const titles = r.body.items.map((x) => x.title);
  assert.ok(titles.includes('since新文'));
  assert.ok(!titles.includes('since旧文'), 'since 之前的条目不出现');
  assert.ok(r.body.counts && typeof r.body.counts.today === 'number', 'counts.today 透出');
  // smart 游标：用 last.sort_key 翻第二页（同型数值）
  const r1 = await req('GET', `/api/articles?since=${encodeURIComponent(since)}&sort=smart`, undefined);
  if (r1.body.nextCursor) {
    const r2 = await req('GET', `/api/articles?since=${encodeURIComponent(since)}&sort=smart&cursor=${encodeURIComponent(r1.body.nextCursor)}`, undefined);
    assert.equal(r2.status, 200);
    const ids1 = new Set(r1.body.items.map((x) => x.id));
    for (const it of r2.body.items) assert.ok(!ids1.has(it.id), '翻页不重复');
  }
});

// 27-reader-today：未读近 3 天口径（/api/sources unread 不计 3 天前的未读）
test('未读口径: /api/sources unread 只计近 3 天', async () => {
  const s = createSource('rss', '未读口径源');
  const old = new Date(Date.now() - 5 * 86400e3).toISOString();
  const fresh = nowIso();
  db.prepare('INSERT INTO articles(source_id, title, url, published_at, created_at) VALUES(?,?,?,?,?)')
    .run(s, '旧未读', 'http://test/old-unread', old, old);
  db.prepare('INSERT INTO articles(source_id, title, url, published_at, created_at) VALUES(?,?,?,?,?)')
    .run(s, '新未读', 'http://test/new-unread', fresh, fresh);
  const r = await req('GET', '/api/sources'); // 公开 GET（带 token 也无妨）
  const row = (r.body.items || []).find((x) => x.id === s);
  assert.ok(row, '源在列表中');
  assert.equal(row.unread, 1, '只有近 3 天未读被计入');
});
