// H51 回归锁（坑 #73）：任何写频率的路径必须同一次写入里处理到期时间。
// 为什么：云端单源/批接口/组级 SQL 与本地源库批量曾只写 extra.intervalMin、不动 next_fetch_at，
// 新间隔要等旧 deadline 走完才生效（最坏比新配置慢几倍）；本地单源端点（P0-1）是对的，作基准。
// 用户拍板（修复包）：把"写频率 + 顶到期"绑成一次动作。判据刻意用比夹具预置的
// "一小时后" 更短的间隔——旧代码留着的旧 deadline 会立刻让断言变红。
// 模板同 tests/regression-cloud-sources.test.js：子进程 + file: 本地库，零生产写入。
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runDriver } = require('./driver-runner');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(os.tmpdir(), `interval-deadline-${process.pid}.db`).replace(/\\/g, '/');
const DRIVER = path.join(ROOT, `.interval-deadline-driver-${process.pid}.cjs`);

function run(caseName) {
  const out = runDriver(DRIVER, [caseName, DB_FILE],
    { timeout: 120000, payloadRe: /^OUT /m });
  const line = out.trim().split('\n').filter((l) => l.startsWith('OUT ')).pop();
  assert.ok(line, `子进程没打印结果（${caseName}）：\n${out}`);
  return JSON.parse(line.slice(4));
}

before(() => {
  fs.writeFileSync(DRIVER, `
process.env.TURSO_DATABASE_URL = 'file:' + process.argv[3];
process.env.TURSO_AUTH_TOKEN = '';
process.env.AUTH_SECRET = 'local-test-secret';
const { createClient } = require('@libsql/client');
const jwt = require('jsonwebtoken');
const handler = require(${JSON.stringify(path.join(ROOT, 'api', '[...slug].js'))});
const CASE = process.argv[2];
const TOKEN = jwt.sign({ sub: 'admin', role: 'admin' }, 'local-test-secret');
const NOW = new Date().toISOString();
// 夹具到期时间预置"一小时后"：设值分支的新 deadline（<= 45min）必须比它早，旧代码（不动到期）会红
const FUTURE = new Date(Date.now() + 3600e3).toISOString();
const DDL = [
  "CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)",
  "CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user TEXT DEFAULT 'admin', action TEXT NOT NULL, target TEXT, detail TEXT, ip TEXT)",
  "CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, name TEXT NOT NULL, url TEXT, avatar TEXT, uid TEXT, group_id INTEGER, focus INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, status TEXT DEFAULT 'ok', last_fetched_at TEXT, next_fetch_at TEXT, extra TEXT, created_at TEXT, fail_count INTEGER DEFAULT 0, spotlight INTEGER DEFAULT 0, muted INTEGER DEFAULT 0, reader_visible INTEGER DEFAULT 1)",
  "CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, name TEXT NOT NULL, sort INTEGER DEFAULT 0)",
];
const SEED = [
  { sql: "INSERT OR REPLACE INTO sources(id,type,name,url,enabled,status,next_fetch_at,extra,created_at) VALUES(9001,'rss','TEST-夹具源','https://seed.example.com/feed',1,'ok',?,?,?)",
    args: [FUTURE, null, NOW] },
];
(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL });
  for (const sql of DDL) await db.execute(sql);
  for (const s of SEED) await db.execute(s);
  const call = async (method, url, body) => {
    const [p, qs] = url.split('?');
    const res = { _status: 200, _body: null };
    res.setHeader = () => res; res.status = (s) => { res._status = s; return res; };
    res.json = (b) => { res._body = b; return res; }; res.send = (b) => { res._body = b; return res; }; res.end = () => res;
    await handler({ method, url: p, query: Object.fromEntries(new URLSearchParams(qs || '')), body,
      headers: { authorization: 'Bearer ' + TOKEN } }, res);
    return { status: res._status, body: res._body };
  };
  const one = async (sql, args) => (await db.execute({ sql, args: args || [] })).rows[0];
  const readNext = async () => (await one('SELECT next_fetch_at n FROM sources WHERE id=9001')).n;
  let r = { status: 0, body: null };
  const dbv = {};
  if (CASE === 'single-set') {
    dbv.before = Date.now();
    r = await call('PUT', '/api/sources/9001/interval', { intervalMin: 45 });
    dbv.next = await readNext();
    dbv.extra = (await one('SELECT extra FROM sources WHERE id=9001')).extra;
  }
  if (CASE === 'single-null') {
    r = await call('PUT', '/api/sources/9001/interval', { intervalMin: null });
    dbv.next = await readNext();
  }
  if (CASE === 'batch-set') {
    dbv.before = Date.now();
    r = await call('POST', '/api/sources/batch', { ids: [9001], action: 'interval', intervalMin: 20 });
    dbv.next = await readNext();
    dbv.extra = (await one('SELECT extra FROM sources WHERE id=9001')).extra;
  }
  if (CASE === 'batch-null') {
    r = await call('POST', '/api/sources/batch', { ids: [9001], action: 'interval', intervalMin: null });
    dbv.next = await readNext();
  }
  if (CASE === 'group-set') {
    const g = await call('POST', '/api/groups', { kind: 'article', name: 'TEST-调频组' });
    dbv.gid = g.body.item.id;
    await db.execute({ sql: 'UPDATE sources SET group_id=? WHERE id=9001', args: [dbv.gid] });
    dbv.before = Date.now();
    r = await call('POST', '/api/sources/batch', { groupScopeId: dbv.gid, action: 'interval', intervalMin: 15 });
    dbv.next = await readNext();
    dbv.extra = (await one('SELECT extra FROM sources WHERE id=9001')).extra;
  }
  if (CASE === 'group-null') {
    const g = await call('POST', '/api/groups', { kind: 'article', name: 'TEST-调频组2' });
    await db.execute({ sql: 'UPDATE sources SET group_id=? WHERE id=9001', args: [g.body.item.id] });
    r = await call('POST', '/api/sources/batch', { groupScopeId: g.body.item.id, action: 'interval', intervalMin: null });
    dbv.next = await readNext();
  }
  console.log('OUT ' + JSON.stringify({ status: r.status, body: r.body, dbv }));
  await db.close();
})().catch((e) => { console.error('DRIVERERR ' + e.message); process.exitCode = 3; });
`);
});
after(() => {
  for (const f of [DRIVER, DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) {
    try { fs.rmSync(f, { force: true }); } catch { /* 留给系统临时目录 */ }
  }
});

// 设值分支：deadline 必须落在 [调用前, 调用前 + n分钟 + 容差] 内——比夹具的"一小时后"早才算修了
function assertFreshDeadline(next, before, minutes, label) {
  assert.ok(next, `${label}: next_fetch_at 没写（旧代码只写频率不动到期）：${JSON.stringify(next)}`);
  const t = Date.parse(next);
  assert.ok(Number.isFinite(t), `${label}: next_fetch_at 不是可解析时间：${next}`);
  assert.ok(t > before - 1000, `${label}: deadline 被顶到过去（${next}）`);
  assert.ok(t <= before + minutes * 60000 + 5000,
    `${label}: 新间隔没生效，deadline 还是旧值（${next}，期望 <= now+${minutes}min）`);
}

test('1. PUT 单源 interval 设值 → extra 与 next_fetch_at 同一次写入', () => {
  const r = run('single-set');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(JSON.parse(r.dbv.extra).intervalMin, 45);
  assertFreshDeadline(r.dbv.next, r.dbv.before, 45, 'single-set');
  assert.equal(r.body.nextFetchAt, r.dbv.next, '响应里的 nextFetchAt 与库里不一致');
});

test('2. PUT 单源 interval 置 null → 顶成立即到期（NULL）', () => {
  const r = run('single-null');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.dbv.next, null, '置 null 后 next_fetch_at 应为 NULL（立即到期）：' + r.dbv.next);
});

test('3. batch interval 设值 → 同一次写入带新 deadline', () => {
  const r = run('batch-set');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.succeeded, 1, JSON.stringify(r.body));
  assert.equal(JSON.parse(r.dbv.extra).intervalMin, 20);
  assertFreshDeadline(r.dbv.next, r.dbv.before, 20, 'batch-set');
});

test('4. batch interval 置 null → NULL', () => {
  const r = run('batch-null');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.dbv.next, null, '批量置 null 没顶到期：' + r.dbv.next);
});

test('5. 组级 interval（单条 SQL）设值 → deadline 一并重算', () => {
  const r = run('group-set');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.succeeded >= 1, JSON.stringify(r.body));
  assert.equal(JSON.parse(r.dbv.extra).intervalMin, 15);
  assertFreshDeadline(r.dbv.next, r.dbv.before, 15, 'group-set');
});

test('6. 组级 interval 置 null → NULL', () => {
  const r = run('group-null');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.dbv.next, null, '组级置 null 没顶到期：' + r.dbv.next);
});

test('7. 自证：本文件零生产写入（B83/坑 #52 同款门禁）', () => {
  const full = fs.readFileSync(path.join(__dirname, 'regression-interval-deadline.test.js'), 'utf8');
  const cut = full.indexOf("test('7.");
  assert.ok(cut > 0, '找不到自证条目起点，本条会退化成恒真');
  const src = full.slice(0, cut);
  assert.ok(!/['"]\.env['"]/.test(src), '还在读 .env → 会拿真凭据连生产库');
  assert.ok(!/authToken:\s*process\.env/.test(src), 'createClient 带真实 authToken → 会打到生产 Turso');
  assert.match(src, /TURSO_DATABASE_URL = 'file:'/, '子进程必须被指到本地文件库');
});
