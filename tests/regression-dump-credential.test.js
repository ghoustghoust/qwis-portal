// ⑥b / B103 残余（P0-3）：转储凭证入库 + runner/云端删除闸改判凭证
// 判据本体：lib/content-dump.js（credentialFromManifest / credentialGate / deleteGateAny）
// 集成两条腿：runner（collect-turso.js cleanup 真库真删）与云端端点（POST /api/data/cleanup 接闸）
'use strict';
require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { createClient } = require('@libsql/client');

const ROOT = path.join(__dirname, '..');
// 惰性取（#64-1）：F2P 回基线时 lib/content-dump 的凭证函数还不存在
const CD = () => require('../lib/content-dump');
const { runDriver } = require('./driver-runner');

const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), tag));
const fileUrl = (dir) => 'file:' + path.join(dir, 't.db').replace(/\\/g, '/');
const freshCred = (rows = 100) => CD().credentialFromManifest({
  updatedAt: new Date().toISOString(), scope: 'cloud',
  tables: { articles: { rows, maxId: rows, bytes: 1024, chunks: [{}] }, videos: { rows: 1, maxId: 1, bytes: 10, chunks: [{}] } },
});

// 与 CO 组同形的最小转储目录（磁盘腿用）
function makeDump(dir) {
  const cd = CD();
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { schemaVersion: cd.SCHEMA_VERSION, scope: 'cloud', sourceKind: 'libsql', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tables: {} };
  for (const [table, rows] of Object.entries({
    articles: [{ id: 1, title: 't1', published_at: '2026-01-01', content_html: 'x' }],
    videos: [{ id: 1, title: 'v1', published_at: '2026-01-01' }],
  })) {
    const rec = cd.writeChunk(dir, table, 1, rows);
    manifest.tables[table] = { rows: rec.rows, maxId: rec.idMax, bytes: rec.bytes, columns: Object.keys(rows[0]), chunks: [rec] };
  }
  cd.writeManifest(dir, manifest);
  return dir;
}

test('DC1 凭证闸放行：新鲜且自洽的凭证 → allowed 且理由带行数与指纹（⑥b）', () => {
  const g = CD().credentialGate(freshCred(100), { maxAgeHours: 48 });
  assert.equal(g.allowed, true, g.reason);
  assert.match(g.reason, /101 行/);
  assert.match(g.reason, /指纹|manifest/);
});

test('DC2 凭证闸五种坏形状全挡：过期 / 未来 / 零行 / 缺指纹 / 非对象（⑥b）', () => {
  const cg = CD().credentialGate;
  const old = freshCred(); old.at = new Date(Date.now() - 72 * 3600e3).toISOString();
  assert.equal(cg(old, { maxAgeHours: 48 }).allowed, false, '72h 前的凭证不许放行');
  const future = freshCred(); future.at = new Date(Date.now() + 3600e3).toISOString();
  assert.equal(cg(future, {}).allowed, false, '未来时间不许放行');
  const zero = freshCred(0); zero.tables.videos.rows = 0;
  assert.equal(cg(zero, {}).allowed, false, '零行不许放行（空转储挡不住误删）');
  const noFp = freshCred(); delete noFp.manifestSha256;
  assert.equal(cg(noFp, {}).allowed, false, '缺 manifest 指纹不许放行');
  assert.equal(cg(null, {}).allowed, false, '库里没凭证不许放行');
});

test('DC3 deleteGateAny 磁盘优先、凭证兜底、两者皆无必挡（⑥b）', () => {
  const dir = tmp('dc3-');
  try {
    makeDump(path.join(dir, 'dump'));
    const disk = CD().deleteGateAny(path.join(dir, 'dump'), null, { maxAgeHours: 48 });
    assert.equal(disk.allowed, true, disk.reason);
    assert.equal(disk.via, 'disk', '有清单时不许走凭证腿');
    const credLeg = CD().deleteGateAny(path.join(dir, 'no-dump'), freshCred(7), { maxAgeHours: 48 });
    assert.equal(credLeg.allowed, true, credLeg.reason);
    assert.equal(credLeg.via, 'credential');
    const none = CD().deleteGateAny(path.join(dir, 'no-dump'), null, {});
    assert.equal(none.allowed, false, '磁盘与凭证都没有时必须挡');
    assert.match(none.reason, /凭证|转储/);
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows 句柄 */ } }
});

// ── 集成：runner cleanup 在「无磁盘 + 有凭证」下必须真删（GH runner 的真实形状）──
async function seedRunnerDb(url) {
  const db = createClient({ url });
  await db.execute('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)');
  await db.execute(`CREATE TABLE IF NOT EXISTS sources(id INTEGER PRIMARY KEY, name TEXT, type TEXT,
    extra TEXT, enabled INTEGER DEFAULT 1, status TEXT, fail_count INTEGER DEFAULT 0,
    last_fetched_at TEXT, next_fetch_at TEXT, muted INTEGER DEFAULT 0, reader_visible INTEGER DEFAULT 1, focus INTEGER DEFAULT 0)`);
  await db.execute("INSERT INTO sources(id,name,type) VALUES(1,'热榜源','hotlist'),(2,'普通源','rss')");
  await db.execute('CREATE TABLE IF NOT EXISTS articles(id INTEGER PRIMARY KEY, source_id INTEGER, title TEXT, url TEXT, content_html TEXT, summary TEXT, published_at TEXT, created_at TEXT, read_at TEXT, later INTEGER DEFAULT 0, featured INTEGER DEFAULT 0, score INTEGER DEFAULT 0, tags TEXT, extra TEXT)');
  const OLD = '2026-01-01T00:00:00.000Z';
  for (let i = 1; i <= 6; i++) {
    await db.execute({ sql: 'INSERT INTO articles(id,source_id,title,url,published_at,created_at) VALUES(?,?,?,?,?,?)', args: [i, i % 2 === 1 ? 1 : 2, `t${i}`, `u${i}`, OLD, OLD] });
  }
  return db;
}
function runCleanup(env) {
  const e = { ...process.env, ...env };
  delete e.NODE_TEST_CONTEXT;
  e.TURSO_AUTH_TOKEN = '';
  try {
    return { out: execFileSync(process.execPath, [path.join(ROOT, 'tools', 'collect-turso.js'), 'cleanup'], { cwd: ROOT, encoding: 'utf8', env: e, timeout: 180000 }), code: 0 };
  } catch (err) {
    return { out: `${err.stdout || ''}\n${err.stderr || ''}`, code: err.status === undefined ? -1 : err.status };
  }
}

test('DC4 runner：磁盘没有转储目录时凭凭证放行并真删；无凭证一条不删（⑥b 双向）', async () => {
  const dir = tmp('dc4-');
  try {
    // 有凭证 → 真删
    let url = fileUrl(path.join(dir, 'a'));
    fs.mkdirSync(path.join(dir, 'a'), { recursive: true });
    let db = await seedRunnerDb(url);
    await db.execute({ sql: 'INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', args: [CD().CREDENTIAL_KEY, JSON.stringify(freshCred(6))] });
    await db.close();
    const yes = runCleanup({ TURSO_DATABASE_URL: url, CONTENT_DUMP_DIR: path.join(dir, 'no-dump') });
    assert.equal(yes.code, 0, yes.out.slice(-400));
    db = createClient({ url });
    const left = Number(Array.from((await db.execute('SELECT COUNT(*) c FROM articles')).rows)[0].c);
    assert.equal(left, 0, `有凭证时 6 条超期文章应真删，剩 ${left}：${yes.out.slice(-300)}`);
    const row = JSON.parse(Array.from((await db.execute({ sql: "SELECT value FROM settings WHERE key='retention.pending'", args: [] })).rows)[0].value);
    assert.equal(row.gate.via, 'credential', '放行没走凭证腿：' + JSON.stringify(row.gate));
    await db.close();
    // 无凭证 → 一条不删
    url = fileUrl(path.join(dir, 'b'));
    fs.mkdirSync(path.join(dir, 'b'), { recursive: true });
    db = await seedRunnerDb(url);
    await db.close();
    const no = runCleanup({ TURSO_DATABASE_URL: url, CONTENT_DUMP_DIR: path.join(dir, 'no-dump') });
    db = createClient({ url });
    const left2 = Number(Array.from((await db.execute('SELECT COUNT(*) c FROM articles')).rows)[0].c);
    assert.equal(left2, 6, `无凭证时一条都不许删，实删 ${6 - left2}：${no.out.slice(-300)}`);
    assert.match(no.out, /挡下|没有.*凭证|delete-gate/, '被挡下却没出声：' + no.out.slice(-300));
    await db.close();
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows 句柄 */ } }
});

// ── 集成：云端手动端点接闸（06b 的另一半）──
const DRIVER = path.join(ROOT, `.dump-gate-driver-${process.pid}.cjs`);
test('DC5 云端 POST /api/data/cleanup：无凭证 409 + 审计行 + 一条不删；有凭证正常删（⑥b）', async () => {
  const dir = tmp('dc5-');
  const dbFile = path.join(dir, 'api.db').replace(/\\/g, '/');
  fs.writeFileSync(DRIVER, `
process.env.TURSO_DATABASE_URL = 'file:' + process.argv[3];
process.env.TURSO_AUTH_TOKEN = '';
process.env.AUTH_SECRET = 'local-test-secret';
const jwt = require('jsonwebtoken');
const db = require(${JSON.stringify(path.join(ROOT, 'lib', 'db.js'))});
const cd = require(${JSON.stringify(path.join(ROOT, 'lib', 'content-dump.js'))});
const handler = require(${JSON.stringify(path.join(ROOT, 'api', '[...slug].js'))});
const CASE = process.argv[2];
const TOKEN = jwt.sign({ sub: 'admin', role: 'admin' }, 'local-test-secret');
function mockRes() { const r = { _s: 200, _b: null }; r.setHeader = () => r; r.status = (s) => { r._s = s; return r; };
  r.json = (b) => { r._b = b; return r; }; r.send = (b) => { r._b = b; return r; }; r.end = () => r; return r; }
async function callCleanup() {
  const res = mockRes();
  await handler({ method: 'POST', url: '/api/data/cleanup', query: {}, body: { days: 7, confirm: true },
    headers: { authorization: 'Bearer ' + TOKEN } }, res);
  return { status: res._s, body: res._b || {} };
}
(async () => {
  await db.ensureSchema();
  // 注意：api 的 getSetting 有读缓存，所以「无凭证」与「有凭证」必须在两个进程里各跑一次
  if (CASE === 'seed-nocred') {
    await db.dbRun("INSERT INTO sources(id,type,name,url,enabled) VALUES(2,'rss','s','u',1)");
    await db.dbRun("INSERT INTO articles(source_id,title,url,published_at,created_at) VALUES(2,'t','u1','2026-01-01','2026-01-01')");
    console.log('OUT ' + JSON.stringify({ seeded: 'nocred' }));
    process.exit(0);
  }
  if (CASE === 'seed') {
    const cred = cd.credentialFromManifest({ updatedAt: new Date().toISOString(), scope: 'cloud',
      tables: { articles: { rows: 5, maxId: 5, bytes: 1, chunks: [{}] }, videos: { rows: 1, maxId: 1, bytes: 1, chunks: [{}] } } });
    await db.dbRun('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', cd.CREDENTIAL_KEY, JSON.stringify(cred));
    console.log('OUT ' + JSON.stringify({ seeded: true }));
    process.exit(0);
  }
  const r = await callCleanup();
  const rows = (await db.dbAll('SELECT COUNT(*) c FROM articles'))[0].c;
  const auditBlocked = (await db.dbAll("SELECT COUNT(*) c FROM audit_log WHERE action='data.cleanup.blocked'"))[0].c;
  console.log('OUT ' + JSON.stringify({ status: r.status, body: r.body, rows, auditBlocked }));
  process.exit(0);
})().catch((e) => { console.error('DRIVERERR ' + e.message); process.exit(3); });
`);
  try {
    // 第一遍：无凭证 → 409 + 审计行 + 一条不删
    //（api 的 getSetting 有读缓存：建文章与建凭证必须分进程，否则同一进程里写完凭证再测"无凭证"是假动作）
    runDriver(DRIVER, ['seed-nocred', dbFile], { payloadRe: /^OUT /m });
    const out1 = runDriver(DRIVER, ['nocred', dbFile], { payloadRe: /^OUT /m });
    const r1 = JSON.parse(/^OUT (.+)$/m.exec(out1)[1]);
    assert.equal(r1.status, 409, `无凭证应 409，实得 ${r1.status}：${JSON.stringify(r1.body)}`);
    assert.match(JSON.stringify(r1.body), /删除闸挡下|凭证/, '409 必须带闸的原因');
    assert.equal(r1.rows, 1, '被挡的一轮删了行');
    assert.ok(r1.auditBlocked >= 1, '被挡没写审计行（静默挡下不允许）');
    // 第二遍：写入凭证 → 放行真删
    runDriver(DRIVER, ['seed', dbFile], { payloadRe: /^OUT /m });
    const out2 = runDriver(DRIVER, ['withcred', dbFile], { payloadRe: /^OUT /m });
    const r2 = JSON.parse(/^OUT (.+)$/m.exec(out2)[1]);
    assert.equal(r2.status, 200, `有凭证应放行：${JSON.stringify(r2.body)}`);
    assert.equal(r2.body.deleted.articles, 1, '有凭证应真删那 1 条超期文章');
    assert.equal(r2.rows, 0);
  } finally { try { fs.rmSync(DRIVER, { force: true }); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
});
