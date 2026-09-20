// 13-settings-write 回归测试：云端 serverless handler 的写路径校验（合法/非法/黑名单/审计）
// **2026-09-19 起改在本地 libsql 文件库上跑（B83 / 坑 #52）**。
// 旧版用真凭据连生产 Turso，并且：
//   · 整键覆盖生产 settings 的 reader.views / daily / queue；
//   · test 9 走的是 **spotlightSourceIds 全量替换语义**——不在名单里的源全部清零，
//     "恢复"靠先快照再写回（2026-09-13 就翻过车：只复位 2 个测试 id，把线上 8 个订阅源清零，坑 #17）；
//   · 每张表都要"现场恢复"，而任何中断/超都会把生产留在中间态（B78 的悬空 subscription.ids 同理）。
// 现在：本地文件库 + 每个用例一个子进程（冷 getSetting 缓存，无需轮询）。
// 表结构取自生产实测 DDL（archive/_diag/2026-09-19-mybrief-contract/dump-ddl.cjs 只读导出），
// 免得本地"简化表"让 SQL 少写一列却测不出问题。
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(os.tmpdir(), `cloud-settings-${process.pid}.db`).replace(/\\/g, '/');
const DRIVER = path.join(ROOT, `.cloud-settings-driver-${process.pid}.cjs`);

function run(caseName) {
  const out = execFileSync(process.execPath, [DRIVER, caseName, DB_FILE],
    { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  const line = out.trim().split('\n').filter((l) => l.startsWith('OUT ')).pop();
  assert.ok(line, `子进程没打印结果（${caseName}）：\n${out}`);
  return JSON.parse(line.slice(4));
}

before(() => {
  fs.writeFileSync(DRIVER, `
process.env.TURSO_DATABASE_URL = 'file:' + process.argv[3];
process.env.TURSO_AUTH_TOKEN = '';
// 本地自签：AUTH_SECRET 由本进程自己定，绝不为签 token 去读生产凭据
process.env.AUTH_SECRET = 'local-test-secret';
const { createClient } = require('@libsql/client');
const jwt = require('jsonwebtoken');
const handler = require(${JSON.stringify(path.join(ROOT, 'api', '[...slug].js'))});
const CASE = process.argv[2];
const TOKEN = jwt.sign({ sub: 'admin', role: 'admin' }, 'local-test-secret');
const VIEWS = [{ name: '测试视图', filter: { tab: 'all' } }];
(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL });
  await db.execute('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)');
  await db.execute('CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user TEXT DEFAULT \\'admin\\', action TEXT NOT NULL, target TEXT, detail TEXT, ip TEXT)');
  await db.execute('CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, name TEXT NOT NULL, url TEXT, avatar TEXT, uid TEXT, group_id INTEGER, focus INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, status TEXT DEFAULT \\'ok\\', last_fetched_at TEXT, next_fetch_at TEXT, extra TEXT, created_at TEXT, fail_count INTEGER DEFAULT 0, spotlight INTEGER DEFAULT 0, muted INTEGER DEFAULT 0, reader_visible INTEGER DEFAULT 1)');
  for (const id of [1, 2, 3]) {
    await db.execute({ sql: "INSERT OR REPLACE INTO sources(id,type,name,url,enabled,spotlight) VALUES(?,'rss',?,'https://s.example.com/f',1,?)", args: [id, '源' + id, id <= 2 ? 1 : 0] });
  }
  const put = (k, v) => db.execute({ sql: 'INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', args: [k, JSON.stringify(v)] });
  const get = async (k) => {
    const r = await db.execute({ sql: 'SELECT value FROM settings WHERE key=?', args: [k] });
    return r.rows[0] ? JSON.parse(r.rows[0].value) : null;
  };
  if (CASE === 'queue-token') await put('queue', { token: 'abc123', intervalMin: 10 });
  const call = async (method, url, body) => {
    const [p, qs] = url.split('?');
    const res = { _status: 200, _body: null };
    res.setHeader = () => res; res.status = (s) => { res._status = s; return res; };
    res.json = (b) => { res._body = b; return res; }; res.send = (b) => { res._body = b; return res; }; res.end = () => res;
    await handler({ method, url: p, query: Object.fromEntries(new URLSearchParams(qs || '')), body,
      headers: { authorization: 'Bearer ' + TOKEN } }, res);
    return { status: res._status, body: res._body };
  };
  let r = { status: 0, body: null }; const dbv = {};
  if (CASE === 'views-put') { r = await call('PUT', '/api/settings', { views: VIEWS }); dbv.views = await get('reader.views'); }
  if (CASE === 'views-bad') { r = await call('PUT', '/api/settings', { intervals: { rss: 99 }, views: [{ name: '', filter: {} }] }); dbv.intervals = await get('intervals'); }
  if (CASE === 'daily-bad') { r = await call('PUT', '/api/settings/daily', { time: '25:99' }); }
  if (CASE === 'blacklist') { r = await call('PUT', '/api/settings', { 'auth.secret': 'hack', intervals: { rss: 1 } }); dbv.intervals = await get('intervals'); }
  if (CASE === 'ai-lock') { r = await call('PUT', '/api/settings', { ai: { model: 'x' } }); }
  if (CASE === 'daily-get') { r = await call('GET', '/api/settings/daily'); }
  if (CASE === 'daily-window') { r = await call('PUT', '/api/settings/daily', { windowHours: 72 }); dbv.daily = await get('daily'); }
  if (CASE === 'queue-token') { r = await call('PUT', '/api/settings', { queue: { token: '', intervalMin: 15 } }); dbv.queue = await get('queue'); }
  if (CASE === 'spotlight') {
    r = await call('PUT', '/api/settings/daily', { spotlightSourceIds: [1] });
    const s = await db.execute('SELECT id, spotlight FROM sources ORDER BY id');
    dbv.spotlight = s.rows.map((x) => x.id + ':' + x.spotlight).join(',');
  }
  if (CASE === 'audit') {
    r = await call('PUT', '/api/settings', { data: { retentionDays: 7 } });
    const a = await db.execute("SELECT action, detail FROM audit_log WHERE action='settings.update' ORDER BY at DESC LIMIT 1");
    dbv.audit = a.rows[0] || null;
  }
  console.log('OUT ' + JSON.stringify({ status: r.status, body: r.body, dbv }));
  await db.close();
})().catch((e) => { console.error('DRIVERERR ' + e.message); process.exitCode = 3; });
`);
});
after(() => {
  for (const f of [DRIVER, DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) {
    try { fs.rmSync(f, { force: true }); } catch { /* 关不掉就留给系统临时目录 */ }
  }
});

test('1. PUT views 合法 → 读回一致', () => {
  const r = run('views-put');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.dbv.views, [{ name: '测试视图', filter: { tab: 'all' } }]);
});

test('2. PUT views 非法 → 400 且 intervals 未被写入', () => {
  const r = run('views-bad');
  assert.equal(r.status, 400);
  assert.ok(!r.dbv.intervals || r.dbv.intervals.rss !== 99, '非法请求不应写入 intervals：' + JSON.stringify(r.dbv.intervals));
});

test('3. PUT daily time 非法 → 400', () => {
  assert.equal(run('daily-bad').status, 400);
});

test('4. 黑名单键 → 400 零写入', () => {
  const r = run('blacklist');
  assert.equal(r.status, 400);
  assert.ok(!r.dbv.intervals, '黑名单请求连带写了 intervals：' + JSON.stringify(r.dbv.intervals));
});

test('5. AI 区锁定 → 400 且文案指向环境变量', () => {
  const r = run('ai-lock');
  assert.equal(r.status, 400);
  assert.match(r.body.error, /环境变量/);
});

test('6. GET /api/settings/daily 结构完整', () => {
  const r = run('daily-get');
  assert.equal(r.status, 200);
  for (const k of ['windowHours', 'time', 'articleSources', 'videoSources', 'columns', 'defaultColumns']) {
    assert.ok(k in r.body, `缺键 ${k}`);
  }
});

test('7. PUT daily windowHours=72 → 读回生效', () => {
  const r = run('daily-window');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.dbv.daily.windowHours, 72);
});

test('8. queue.token 留空不覆盖', () => {
  const r = run('queue-token');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.dbv.queue.token, 'abc123', 'token 留空不应覆盖：' + JSON.stringify(r.dbv.queue));
  assert.equal(r.dbv.queue.intervalMin, 15);
});

test('9. spotlightSourceIds 全量替换语义（名单外全部清零）—— 坑 #17 的教训就在这一条', () => {
  const r = run('spotlight');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // 1 在名单内 → 1；2、3 不在 → 0。这条在本地库上判的就是"全量替换"这个危险语义本身，
  // 旧版同样的断言跑在生产库上，靠快照/恢复兜（2026-09-13 曾把线上 8 个星标源清零）。
  assert.equal(r.dbv.spotlight, '1:1,2:0,3:0', JSON.stringify(r.dbv.spotlight));
});

test('10. 成功写入产生审计记录', () => {
  const r = run('audit');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.dbv.audit, '应有审计记录');
  assert.equal(r.dbv.audit.action, 'settings.update');
  assert.match(r.dbv.audit.detail, /data/);
});

test('11. 自证：本文件不再碰生产库（B83/坑 #52 的门禁）', () => {
  const full = fs.readFileSync(path.join(__dirname, 'regression-cloud-settings.test.js'), 'utf8');
  const cut = full.indexOf("test('11.");
  assert.ok(cut > 0, '找不到自证条目起点，本条会退化成恒真');
  const src = full.slice(0, cut);
  assert.ok(!/['"]\.env['"]/.test(src), '还在读 .env → 又要拿真凭据连生产库了');
  assert.ok(!/authToken:\s*process\.env/.test(src), 'createClient 带真实 authToken → 会打到生产 Turso');
  assert.match(src, /TURSO_DATABASE_URL = 'file:'/, '子进程必须被指到本地文件库');
  assert.match(src, /local-test-secret/, 'AUTH_SECRET 必须本地自定，不为签 token 读生产凭据');
});
