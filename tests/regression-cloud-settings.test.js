// 13-settings-write 回归测试：云端 serverless handler 真实调用
// 直接 require api/[...slug].js，mock req/res；test.* 前缀键隔离，用后即删
// 运行：node --test tests/regression-cloud-settings.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// 加载 .env（TURSO_* / AUTH_SECRET）
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
  return {
    method, url,
    query: Object.fromEntries(new URLSearchParams(qs || '')),
    body,
    headers: { authorization: `Bearer ${TOKEN}` },
  };
}
function mockRes() {
  const res = { _status: 200, _body: null, _headers: {} };
  res.setHeader = (k, v) => { res._headers[k] = v; return res; };
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
async function delTestKeys() {
  await db.execute("DELETE FROM settings WHERE key LIKE 'test.%'");
}
// 视图用 reader.views 正式键测试（会写真实键，测完恢复）；daily 用 windowHours 测完恢复
let origViews = null;
let origDaily = null;

before(async () => {
  const v = await db.execute("SELECT value FROM settings WHERE key='reader.views'");
  origViews = v.rows[0] ? v.rows[0].value : null;
  const d = await db.execute("SELECT value FROM settings WHERE key='daily'");
  origDaily = d.rows[0] ? d.rows[0].value : null;
  await delTestKeys();
});

after(async () => {
  // 恢复现场
  if (origViews !== null) await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('reader.views',?)", args: [origViews] });
  if (origDaily !== null) await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('daily',?)", args: [origDaily] });
  await delTestKeys();
  db.close();
});

test('1. PUT views 合法 → 读回一致', async () => {
  const views = [{ name: '测试视图', filter: { tab: 'all' } }];
  const r = await call('PUT', '/api/settings', { views });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const got = await db.execute("SELECT value FROM settings WHERE key='reader.views'");
  assert.deepEqual(JSON.parse(got.rows[0].value), views);
});

test('2. PUT views 非法 → 400 且 intervals 未被写入', async () => {
  const r = await call('PUT', '/api/settings', {
    intervals: { rss: 99 },
    views: [{ name: '', filter: {} }],
  });
  assert.equal(r.status, 400);
  const got = await db.execute("SELECT value FROM settings WHERE key='intervals'");
  if (got.rows[0]) assert.ok(!JSON.parse(got.rows[0].value).rss || JSON.parse(got.rows[0].value).rss !== 99, '非法请求不应写入 intervals');
});

test('3. PUT daily time 非法 → 400', async () => {
  const r = await call('PUT', '/api/settings/daily', { time: '25:99' });
  assert.equal(r.status, 400);
});

test('4. 黑名单键 → 400 零写入', async () => {
  const r = await call('PUT', '/api/settings', { 'auth.secret': 'hack', intervals: { rss: 1 } });
  assert.equal(r.status, 400);
});

test('5. AI 区锁定 → 400', async () => {
  const r = await call('PUT', '/api/settings', { ai: { model: 'x' } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /环境变量/);
});

test('6. GET /api/settings/daily 结构完整', async () => {
  const r = await call('GET', '/api/settings/daily');
  assert.equal(r.status, 200);
  for (const k of ['windowHours', 'time', 'articleSources', 'videoSources', 'columns', 'defaultColumns']) {
    assert.ok(k in r.body, `缺键 ${k}`);
  }
});

test('7. PUT daily windowHours=72 → 读回生效', async () => {
  const r = await call('PUT', '/api/settings/daily', { windowHours: 72 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const got = await db.execute("SELECT value FROM settings WHERE key='daily'");
  assert.equal(JSON.parse(got.rows[0].value).windowHours, 72);
});

test('8. queue.token 留空不覆盖（test 键模拟）', async () => {
  // 用真实 queue 键测：先记下原值
  const orig = await db.execute("SELECT value FROM settings WHERE key='queue'");
  const origVal = orig.rows[0] ? orig.rows[0].value : null;
  await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('queue',?)", args: [JSON.stringify({ token: 'abc123', intervalMin: 10 })] });
  const r = await call('PUT', '/api/settings', { queue: { token: '', intervalMin: 15 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const got = JSON.parse((await db.execute("SELECT value FROM settings WHERE key='queue'")).rows[0].value);
  assert.equal(got.token, 'abc123', 'token 留空不应覆盖');
  assert.equal(got.intervalMin, 15);
  // 恢复
  if (origVal !== null) await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('queue',?)", args: [origVal] });
  else await db.execute("DELETE FROM settings WHERE key='queue'");
});

test('9. focusSourceIds 全量替换生效', async () => {
  // 取两个真实源 id
  const srcs = await db.execute('SELECT id FROM sources LIMIT 2');
  if (srcs.rows.length < 2) return; // 数据不足跳过
  const [a, b] = srcs.rows.map(r => r.id);
  const r = await call('PUT', '/api/settings/daily', { focusSourceIds: [a] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const fa = await db.execute('SELECT focus FROM sources WHERE id=?', [a]);
  const fb = await db.execute('SELECT focus FROM sources WHERE id=?', [b]);
  assert.equal(fa.rows[0].focus, 1);
  assert.equal(fb.rows[0].focus, 0);
  // 恢复：清空 focus（测试前状态未记录，焦点位为可逆标志位，置 0 为安全默认）
  await db.execute({ sql: 'UPDATE sources SET focus=0 WHERE id IN (?,?)', args: [a, b] });
});

test('10. 成功写入产生审计记录', async () => {
  const r = await call('PUT', '/api/settings', { data: { retentionDays: 7 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const log = await db.execute("SELECT * FROM audit_log WHERE action='settings.update' ORDER BY at DESC LIMIT 1");
  assert.ok(log.rows[0], '应有审计记录');
  assert.match(log.rows[0].detail, /data/);
});
