// 14-sources-write 回归测试：云端 serverless handler 的源/组写路径校验
// **2026-09-19 起改在本地 libsql 文件库上跑（B83 / 坑 #52）**。
// 旧版用真凭据连生产 Turso，并且真的往生产里写：
//   · POST /api/sources 建 TEST 源（顺带跑 autoClassifySourceId，可能新建分组 + 改 daily.cocoonFamiliar）；
//   · batch focus/unfocus 改生产 spotlight 列；groups move 写 sources.group_id + extra.categoryLocked；
//   · refresh / refresh-all 把生产 next_fetch_at 打成 NULL（等于插队改线上采集节奏）；
//   · DELETE 级联删 articles/videos —— "现场恢复"全靠 after() 记得清，中断即留悬空 id（B78 就是这么来的）。
// 现在：夹具源用**固定 id**（9001/9002），每条用例起一个子进程 + file: 本地库，
// 既零生产写入，也天然绕开 getSetting 的 30s 进程内缓存。模板同 tests/regression-cloud-settings.test.js。
// 表结构取自生产实测 DDL（只读导出 sqlite_master），免得本地"简化表"让 SQL 少写一列却测不出问题。
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(os.tmpdir(), `cloud-sources-${process.pid}.db`).replace(/\\/g, '/');
// 驱动脚本必须落在仓库内：Node 从脚本所在目录往上找 node_modules（放临时目录先撞 Cannot find module）
const DRIVER = path.join(ROOT, `.cloud-sources-driver-${process.pid}.cjs`);

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
const NOW = new Date().toISOString();
const FUTURE = new Date(Date.now() + 3600e3).toISOString();
// 生产实测 DDL（sources/articles/groups/audit_log/settings）
const DDL = [
  "CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)",
  "CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user TEXT DEFAULT 'admin', action TEXT NOT NULL, target TEXT, detail TEXT, ip TEXT)",
  "CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, name TEXT NOT NULL, url TEXT, avatar TEXT, uid TEXT, group_id INTEGER, focus INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, status TEXT DEFAULT 'ok', last_fetched_at TEXT, next_fetch_at TEXT, extra TEXT, created_at TEXT, fail_count INTEGER DEFAULT 0, spotlight INTEGER DEFAULT 0, muted INTEGER DEFAULT 0, reader_visible INTEGER DEFAULT 1)",
  "CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, name TEXT NOT NULL, sort INTEGER DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS articles (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER, title TEXT, url TEXT UNIQUE, author TEXT, cover TEXT, summary TEXT, content_html TEXT, published_at TEXT, read_at TEXT, later INTEGER DEFAULT 0, created_at TEXT, score INTEGER, reason TEXT, tags TEXT, featured INTEGER DEFAULT 0, original_html TEXT, original_url TEXT, category TEXT, word_count INTEGER, translated_title TEXT, translated_content TEXT, translation_provider TEXT)",
  // DELETE /api/sources/:id 的级联是 articles + videos 两张表（handleSourceDelete 的 batch），少建一张就是把级联测丢了
  "CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER, platform TEXT, title TEXT, url TEXT UNIQUE, vid TEXT, cover TEXT, duration INTEGER, author TEXT, intro TEXT, published_at TEXT, favorite INTEGER DEFAULT 0, created_at TEXT, watched_at TEXT, play_uri TEXT)",
];
// 夹具：9001 普通 rss 源（next_fetch_at 预置为将来时刻，refresh 的"置 NULL"才可判）；
// 9002 热榜源（refresh-all?type=hotlist 的受影响数才可判）
const SEED = [
  { sql: "INSERT OR REPLACE INTO sources(id,type,name,url,enabled,status,next_fetch_at,extra,created_at) VALUES(9001,'rss','TEST-夹具源','https://seed.example.com/feed',1,'ok',?,?,?)",
    args: [FUTURE, null, NOW] },
  { sql: "INSERT OR REPLACE INTO sources(id,type,name,url,enabled,status,next_fetch_at,created_at) VALUES(9002,'hotlist','TEST-夹具热榜','hotlist://60s',1,'ok',?,?)",
    args: [FUTURE, NOW] },
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
  let r = { status: 0, body: null };
  const dbv = {};
  if (CASE === 'create') {
    r = await call('POST', '/api/sources', { url: 'https://test-example.com/feed.xml', name: 'TEST-回归源A' });
  }
  if (CASE === 'create-dup') {
    // 用夹具源已有的 url 打第二次 POST：旧版这条判的本来就是"对已存在的 url 再 POST → 幂等"
    // （它依赖上一条用例留下的行 + 同一个生产库；这里换成夹具，用例自身即可独立复现同一契约）
    r = await call('POST', '/api/sources', { url: 'https://seed.example.com/feed' });
    dbv.count = (await one("SELECT COUNT(*) c FROM sources WHERE url='https://seed.example.com/feed'")).c;
  }
  if (CASE === 'interval-bad') {
    r = await call('PUT', '/api/sources/9001/interval', { intervalMin: -5 });
    dbv.extra = (await one('SELECT extra FROM sources WHERE id=9001')).extra;
  }
  if (CASE === 'interval-ok') {
    r = await call('PUT', '/api/sources/9001/interval', { intervalMin: 45 });
    dbv.extra = (await one('SELECT extra FROM sources WHERE id=9001')).extra;
  }
  if (CASE === 'refresh') {
    r = await call('POST', '/api/sources/9001/refresh');
    dbv.next = (await one('SELECT next_fetch_at n FROM sources WHERE id=9001')).n;
  }
  if (CASE === 'refresh-all') {
    r = await call('POST', '/api/sources/refresh-all?type=hotlist');
    dbv.next = (await one('SELECT next_fetch_at n FROM sources WHERE id=9002')).n;
    dbv.rssNext = (await one('SELECT next_fetch_at n FROM sources WHERE id=9001')).n;
  }
  if (CASE === 'batch-focus') {
    let b = await call('POST', '/api/sources/batch', { ids: [9001], action: 'focus' });
    dbv.afterFocus = (await one('SELECT spotlight s FROM sources WHERE id=9001')).s;
    dbv.s1 = b.body.succeeded;
    b = await call('POST', '/api/sources/batch', { ids: [9001], action: 'unfocus' });
    dbv.afterUnfocus = (await one('SELECT spotlight s FROM sources WHERE id=9001')).s;
    dbv.s2 = b.body.succeeded;
    r = b;
  }
  if (CASE === 'batch-move-mismatch') {
    const g = await call('POST', '/api/groups', { kind: 'video', name: 'TEST-视频组' });
    dbv.gStatus = g.status;
    r = await call('POST', '/api/sources/batch', { ids: [9001], action: 'move', groupId: g.body.item.id });
    dbv.groupId = (await one('SELECT group_id g FROM sources WHERE id=9001')).g;
  }
  if (CASE === 'autoclassify-dry') {
    const b0 = await one('SELECT COUNT(*) c, COALESCE(SUM(group_id),0) g FROM sources');
    r = await call('POST', '/api/sources/autoclassify', { dryRun: true });
    const b1 = await one('SELECT COUNT(*) c, COALESCE(SUM(group_id),0) g FROM sources');
    dbv.before = { c: Number(b0.c), g: String(b0.g) };
    dbv.after = { c: Number(b1.c), g: String(b1.g) };
  }
  if (CASE === 'group-move') {
    const g = await call('POST', '/api/groups', { kind: 'article', name: 'TEST-文章组' });
    dbv.gid = g.body.item.id;
    r = await call('POST', '/api/groups/move', { source_id: 9001, group_id: dbv.gid });
    const s = await one('SELECT group_id g, extra FROM sources WHERE id=9001');
    dbv.groupId = s.g;
    dbv.extra = s.extra;
  }
  if (CASE === 'delete-cascade') {
    const c = await call('POST', '/api/sources', { url: 'https://test-delete.example.com/feed.xml', name: 'TEST-待删源' });
    dbv.id = c.body.item.id;
    await db.execute({ sql: 'INSERT INTO articles(source_id,title,url,created_at) VALUES(?,?,?,?)',
      args: [dbv.id, 't', 'https://test-delete.example.com/a1', NOW] });
    await db.execute({ sql: 'INSERT INTO videos(source_id,platform,title,url,vid,created_at) VALUES(?,?,?,?,?,?)',
      args: [dbv.id, 'bilibili', 'v', 'https://www.bilibili.com/video/BV_DEL_', 'BV_DEL_' + dbv.id, NOW] });
    dbv.artBefore = (await one('SELECT COUNT(*) c FROM articles WHERE source_id=' + dbv.id)).c;
    dbv.vidBefore = (await one('SELECT COUNT(*) c FROM videos WHERE source_id=' + dbv.id)).c;
    r = await call('DELETE', '/api/sources/' + dbv.id);
    dbv.sourceCount = (await one('SELECT COUNT(*) c FROM sources WHERE id=' + dbv.id)).c;
    dbv.articleCount = (await one('SELECT COUNT(*) c FROM articles WHERE source_id=' + dbv.id)).c;
    dbv.videoCount = (await one('SELECT COUNT(*) c FROM videos WHERE source_id=' + dbv.id)).c;
  }
  if (CASE === 'audit') {
    // 旧版这条数的是"前 11 条用例在生产 audit_log 留下的总行数"——同文件顺序耦合。
    // 这里改成一个子进程内把 5 条写路径各跑一遍，审计计数只由本用例负责，语义不变且可重复。
    await db.execute('DELETE FROM audit_log'); // 清掉同库文件里前序用例的行，计数才只属于这 5 次写
    await call('POST', '/api/sources', { url: 'https://test-audit.example.com/feed.xml', name: 'TEST-审计源' });
    await call('PUT', '/api/sources/9001/interval', { intervalMin: 30 });
    await call('POST', '/api/sources/9001/refresh');
    await call('POST', '/api/sources/batch', { ids: [9001], action: 'focus' });
    const g = await call('POST', '/api/groups', { kind: 'article', name: 'TEST-文章组' });
    r = await call('POST', '/api/groups/move', { source_id: 9001, group_id: g.body.item.id });
    const a = await one("SELECT COUNT(*) c FROM audit_log WHERE action IN ('source.create','source.interval','source.refresh','source.batch','group.move')");
    dbv.c = Number(a.c);
    dbv.byAction = (await db.execute("SELECT action, COUNT(*) c FROM audit_log WHERE action IN ('source.create','source.interval','source.refresh','source.batch','group.move') GROUP BY action")).rows;
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

test('1. POST 新增源 → 返回 item 含 id', () => {
  const r = run('create');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.item && r.body.item.id, '没拿到新行 id：' + JSON.stringify(r.body));
});

test('2. 同 url 重复 POST → 幂等不重复建', () => {
  const r = run('create-dup');
  assert.equal(r.status, 200);
  assert.equal(r.body.duplicated, true);
  assert.equal(r.dbv.count, 1, '同 url 建出了 ' + r.dbv.count + ' 行');
});

test('3. PUT interval 非法 → 400 零写入', () => {
  const r = run('interval-bad');
  assert.equal(r.status, 400);
  assert.ok(!JSON.parse(r.dbv.extra || '{}').intervalMin, '非法 intervalMin 被写进了 extra：' + r.dbv.extra);
});

test('4. PUT interval 合法 → extra.intervalMin 写入', () => {
  const r = run('interval-ok');
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.dbv.extra).intervalMin, 45);
});

test('5. refresh → next_fetch_at 置 NULL + runner 文案', () => {
  const r = run('refresh');
  assert.equal(r.status, 200);
  assert.match(r.body.message, /runner/);
  // 夹具把 9001 的 next_fetch_at 预置成"一小时后"，所以这里判的是"真的被清空"而不是恒真
  assert.equal(r.dbv.next, null, 'next_fetch_at 没被置 NULL：' + JSON.stringify(r.dbv));
});

test('6. refresh-all?type=hotlist → 返回受影响数（只影响该类型）', () => {
  const r = run('refresh-all');
  assert.equal(r.status, 200);
  assert.ok(r.body.affected >= 1 && r.body.deferred === true, JSON.stringify(r.body));
  assert.equal(r.dbv.next, null, '热榜夹具源没被标记到期');
  assert.ok(r.dbv.rssNext !== null, '过滤串了：非 hotlist 的 9001 也被标记到期');
});

test('7. batch spotlight/unspotlight 增量语义（27b：focus 别名落 spotlight 列）', () => {
  const r = run('batch-focus');
  assert.equal(r.dbv.s1, 1, JSON.stringify(r.body));
  assert.equal(r.dbv.afterFocus, 1);
  assert.equal(r.dbv.s2, 1);
  assert.equal(r.dbv.afterUnfocus, 0);
  assert.equal(r.status, 200);
});

test('8. batch move kind 不匹配 → 该项报错（部分成功语义）', () => {
  const r = run('batch-move-mismatch');
  assert.equal(r.dbv.gStatus, 200);
  assert.equal(r.body.succeeded, 0);
  assert.equal(r.body.failed, 1);
  assert.match(r.body.errors[0].error, /类型不匹配/);
  assert.equal(r.dbv.groupId, null, '类型不匹配却还是写了 group_id');
});

test('9. autoclassify dryRun 不落库', () => {
  const r = run('autoclassify-dry');
  assert.equal(r.status, 200);
  assert.ok('items' in r.body && 'noSuggestion' in r.body, JSON.stringify(r.body).slice(0, 160));
  assert.equal(r.dbv.after.c, r.dbv.before.c);
  assert.equal(String(r.dbv.after.g), String(r.dbv.before.g), 'dryRun 改了 group_id 分布');
});

test('10. groups move kind 校验 + categoryLocked', () => {
  const r = run('group-move');
  assert.equal(r.status, 200);
  assert.equal(r.dbv.groupId, r.dbv.gid, '移动到文章组没生效');
  assert.equal(JSON.parse(r.dbv.extra).categoryLocked, 1);
});

test('11. DELETE 源 → 级联删除', () => {
  const r = run('delete-cascade');
  assert.equal(r.dbv.artBefore, 1, '夹具文章没挂上，级联断言会是空的');
  assert.equal(r.dbv.vidBefore, 1, '夹具视频没挂上，videos 那一支级联就测不到');
  assert.equal(r.status, 200);
  assert.equal(r.dbv.sourceCount, 0);
  assert.equal(r.dbv.articleCount, 0);
  assert.equal(r.dbv.videoCount, 0, '源删了但 videos 留了孤行');
});

test('12. 写操作审计记录存在', () => {
  const r = run('audit');
  assert.ok(r.dbv.c >= 5, `审计记录数=${r.dbv.c}`);
  // 光看总数会被"某条写路径没记审计、另一条记了两条"糊过去，逐条点名
  const seen = r.dbv.byAction.reduce((m, x) => { m[x.action] = Number(x.c); return m; }, {});
  for (const a of ['source.create', 'source.interval', 'source.refresh', 'source.batch', 'group.move']) {
    assert.ok(seen[a] >= 1, `写路径 ${a} 没有审计记录：${JSON.stringify(seen)}`);
  }
});

test('13. 自证：本文件不再碰生产库（B83/坑 #52 的门禁）', () => {
  const full = fs.readFileSync(path.join(__dirname, 'regression-cloud-sources.test.js'), 'utf8');
  const cut = full.indexOf("test('13.");
  assert.ok(cut > 0, '找不到自证条目起点，本条会退化成恒真');
  const src = full.slice(0, cut);
  assert.ok(!/['"]\.env['"]/.test(src), '还在读 .env → 又要拿真凭据连生产库了');
  assert.ok(!/authToken:\s*process\.env/.test(src), 'createClient 带真实 authToken → 会打到生产 Turso');
  assert.match(src, /TURSO_DATABASE_URL = 'file:'/, '子进程必须被指到本地文件库');
  assert.match(src, /local-test-secret/, 'AUTH_SECRET 必须本地自定，不为签 token 读生产凭据');
});
