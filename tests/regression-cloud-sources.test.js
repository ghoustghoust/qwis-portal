// 14-sources-write 回归测试：云端 serverless handler 真实调用
// 复用 13 项模式：mock req/res + JWT；测试数据 TEST- 前缀，用后即删
// 运行：node --test tests/regression-cloud-sources.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
for (const line of envTxt.split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const handler = require('../api/[...slug].js');
const jwt = require('jsonwebtoken');
const { createClient } = require('@libsql/client');

const TOKEN = jwt.sign({ sub: 'admin', role: 'admin' }, process.env.AUTH_SECRET || 'dev-secret');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

function mockReq(method, url, body) {
  const [p, qs] = url.split('?');
  return { method, url, query: Object.fromEntries(new URLSearchParams(qs || '')), body, headers: { authorization: `Bearer ${TOKEN}` } };
}
function mockRes() {
  const res = { _status: 200, _body: null };
  res.setHeader = () => res;
  res.status = (s) => { res._status = s; return res; };
  res.json = (b) => { res._body = b; return res; };
  res.send = (b) => { res._body = b; return res; };
  res.end = () => res;
  return res;
}
async function call(method, url, body) {
  const res = mockRes();
  await handler(mockReq(method, url, body), res);
  return { status: res._status, body: res._body };
}

let testSourceId = null;
let testGroupId = null;

after(async () => {
  // 清理测试现场
  if (testSourceId) {
    await db.execute('DELETE FROM articles WHERE source_id=?', [testSourceId]);
    await db.execute('DELETE FROM sources WHERE id=?', [testSourceId]);
  }
  await db.execute("DELETE FROM sources WHERE name LIKE 'TEST-%'");
  if (testGroupId) await db.execute('DELETE FROM groups WHERE id=?', [testGroupId]);
  await db.execute("DELETE FROM groups WHERE name LIKE 'TEST-%'");
  db.close();
});

test('1. POST 新增源 → 返回 item 含 id', async () => {
  const r = await call('POST', '/api/sources', { url: 'https://test-example.com/feed.xml', name: 'TEST-回归源A' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.item && r.body.item.id);
  testSourceId = r.body.item.id;
});

test('2. 同 url 重复 POST → 幂等不重复建', async () => {
  const r = await call('POST', '/api/sources', { url: 'https://test-example.com/feed.xml' });
  assert.equal(r.status, 200);
  assert.equal(r.body.duplicated, true);
  const c = await db.execute("SELECT COUNT(*) c FROM sources WHERE url='https://test-example.com/feed.xml'");
  assert.equal(c.rows[0].c, 1);
});

test('3. PUT interval 非法 → 400 零写入', async () => {
  const r = await call('PUT', `/api/sources/${testSourceId}/interval`, { intervalMin: -5 });
  assert.equal(r.status, 400);
  const s = await db.execute('SELECT extra FROM sources WHERE id=?', [testSourceId]);
  assert.ok(!JSON.parse(s.rows[0].extra || '{}').intervalMin);
});

test('4. PUT interval 合法 → extra.intervalMin 写入', async () => {
  const r = await call('PUT', `/api/sources/${testSourceId}/interval`, { intervalMin: 45 });
  assert.equal(r.status, 200);
  const s = await db.execute('SELECT extra FROM sources WHERE id=?', [testSourceId]);
  assert.equal(JSON.parse(s.rows[0].extra).intervalMin, 45);
});

test('5. refresh → next_fetch_at 置 NULL + runner 文案', async () => {
  const r = await call('POST', `/api/sources/${testSourceId}/refresh`);
  assert.equal(r.status, 200);
  assert.match(r.body.message, /runner/);
  const s = await db.execute('SELECT next_fetch_at FROM sources WHERE id=?', [testSourceId]);
  assert.equal(s.rows[0].next_fetch_at, null);
});

test('6. refresh-all?type=rss → 返回受影响数', async () => {
  const r = await call('POST', '/api/sources/refresh-all?type=hotlist');
  assert.equal(r.status, 200);
  assert.ok(r.body.affected >= 0 && r.body.deferred === true);
});

test('7. batch focus/unfocus 增量语义', async () => {
  let r = await call('POST', '/api/sources/batch', { ids: [testSourceId], action: 'focus' });
  assert.equal(r.body.succeeded, 1);
  let s = await db.execute('SELECT focus FROM sources WHERE id=?', [testSourceId]);
  assert.equal(s.rows[0].focus, 1);
  r = await call('POST', '/api/sources/batch', { ids: [testSourceId], action: 'unfocus' });
  assert.equal(r.body.succeeded, 1);
  s = await db.execute('SELECT focus FROM sources WHERE id=?', [testSourceId]);
  assert.equal(s.rows[0].focus, 0);
});

test('8. batch move kind 不匹配 → 该项报错（部分成功语义）', async () => {
  // 建一个 video 组，把 article 源 move 进去应失败
  const g = await call('POST', '/api/groups', { kind: 'video', name: 'TEST-视频组' });
  assert.equal(g.status, 200);
  testGroupId = g.body.item.id;
  const r = await call('POST', '/api/sources/batch', { ids: [testSourceId], action: 'move', groupId: testGroupId });
  assert.equal(r.body.succeeded, 0);
  assert.equal(r.body.failed, 1);
  assert.match(r.body.errors[0].error, /类型不匹配/);
});

test('9. autoclassify dryRun 不落库', async () => {
  const before = await db.execute('SELECT COUNT(*) c, COALESCE(SUM(group_id),0) g FROM sources');
  const r = await call('POST', '/api/sources/autoclassify', { dryRun: true });
  assert.equal(r.status, 200);
  assert.ok('items' in r.body && 'noSuggestion' in r.body);
  const afterSnap = await db.execute('SELECT COUNT(*) c, COALESCE(SUM(group_id),0) g FROM sources');
  assert.equal(afterSnap.rows[0].c, before.rows[0].c);
  assert.equal(String(afterSnap.rows[0].g), String(before.rows[0].g));
});

test('10. groups move kind 校验 + categoryLocked', async () => {
  // article 组 + article 源 → 成功且锁定
  const g = await call('POST', '/api/groups', { kind: 'article', name: 'TEST-文章组' });
  const gid = g.body.item.id;
  const r = await call('POST', '/api/groups/move', { source_id: testSourceId, group_id: gid });
  assert.equal(r.status, 200);
  const s = await db.execute('SELECT group_id, extra FROM sources WHERE id=?', [testSourceId]);
  assert.equal(s.rows[0].group_id, gid);
  assert.equal(JSON.parse(s.rows[0].extra).categoryLocked, 1);
  // 清理这个测试组
  await db.execute('UPDATE sources SET group_id=NULL WHERE id=?', [testSourceId]);
  await db.execute('DELETE FROM groups WHERE id=?', [gid]);
});

test('11. DELETE 源 → 级联删除', async () => {
  // 建一个一次性源再删
  const c = await call('POST', '/api/sources', { url: 'https://test-delete.com/feed.xml', name: 'TEST-待删源' });
  const id = c.body.item.id;
  await db.execute({ sql: "INSERT INTO articles(source_id,title,url,created_at) VALUES(?,?,?,?)", args: [id, 't', 'http://t/' + id, new Date().toISOString()] });
  const r = await call('DELETE', `/api/sources/${id}`);
  assert.equal(r.status, 200);
  const s = await db.execute('SELECT COUNT(*) c FROM sources WHERE id=?', [id]);
  const a = await db.execute('SELECT COUNT(*) c FROM articles WHERE source_id=?', [id]);
  assert.equal(s.rows[0].c, 0);
  assert.equal(a.rows[0].c, 0);
});

test('12. 写操作审计记录存在', async () => {
  const r = await db.execute("SELECT COUNT(*) c FROM audit_log WHERE action IN ('source.create','source.interval','source.refresh','source.batch','group.move')");
  assert.ok(r.rows[0].c >= 5, `审计记录数=${r.rows[0].c}`);
});
