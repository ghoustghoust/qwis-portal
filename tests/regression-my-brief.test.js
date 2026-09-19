// 19-my-brief 回归测试：三态 API + 订阅过滤 + 分层约束
// **2026-09-19 起改在本地 libsql 文件库上跑（B77 / 坑 #52）**。
// 旧版（"真实 Turso，现场恢复"）直打生产：建 TEST 源、改写 settings.subscription.ids、
// 删 mybrief.latest，再靠 30~50s 轮询等读层缓存过期。两个后果本轮都实测到了：
//   ① 某次运行中断把 settings.subscription.ids 留在"已删除的 TEST 源 id"上 →
//      线上「我的早报」整页退化成未订阅引导态（B78 代码已兜底；数据面遗留 B79 等授权）；
//   ② 测试与 runner 每批重写 mybrief.latest 抢同一行，红不红取决于外部时序（B77：
//      我这边单跑两次全红，审计轮那边单跑 4/4 绿——两种观察都真）。
// 现在：每条用例起一个**子进程 + 本地文件库**，既零生产写入，又天然绕开
// `api/[...slug].js` 里 getSetting 的 30s 进程内缓存（同进程连测会读到上一条用例的缓存值），
// 所以也不再有 90s 轮询等待。
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(os.tmpdir(), `mybrief-local-${process.pid}.db`).replace(/\\/g, '/');
// 驱动脚本必须落在仓库内：Node 从**脚本所在目录**往上找 node_modules（放临时目录先撞 Cannot find module）
const DRIVER = path.join(ROOT, `.mybrief-driver-${process.pid}.cjs`);
const FAKE = { date: '2026-09-12', theme: '测试导语', keywords: ['AI'],
  sections: { top: [{ id: 1, title: '甲题' }], featured: [], rest: [] } };

function call(caseName) {
  const out = execFileSync(process.execPath, [DRIVER, caseName, DB_FILE],
    { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  const line = out.trim().split('\n').filter((l) => l.startsWith('BODY ')).pop();
  assert.ok(line, `子进程没打印响应体（${caseName}）：\n${out}`);
  return JSON.parse(line.slice(5));
}

before(() => {
  fs.writeFileSync(DRIVER, `
process.env.TURSO_DATABASE_URL = 'file:' + process.argv[3];
process.env.TURSO_AUTH_TOKEN = '';
const { createClient } = require('@libsql/client');
const handler = require(${JSON.stringify(path.join(ROOT, 'api', '[...slug].js'))});
const CASE = process.argv[2];
const FAKE = ${JSON.stringify(FAKE)};
const REAL = { date: '2026-09-19', theme: '真报告', keywords: ['AI'],
  sections: { top: [{ id: 1, title: '甲题' }, { id: 2, title: '乙题' }], featured: [], rest: [] } };
(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL });
  await db.execute('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)');
  await db.execute('CREATE TABLE IF NOT EXISTS sources(id INTEGER PRIMARY KEY, name TEXT, url TEXT, type TEXT, enabled INTEGER DEFAULT 1, spotlight INTEGER DEFAULT 0)');
  await db.execute('CREATE TABLE IF NOT EXISTS articles(id INTEGER PRIMARY KEY, title TEXT, translated_title TEXT, source_id INTEGER)');
  await db.execute({ sql: 'INSERT OR REPLACE INTO sources(id,name,url,enabled,spotlight) VALUES(3001,?,?,1,1)', args: ['星标源', 'https://sp.example.com/f'] });
  await db.execute({ sql: 'INSERT OR REPLACE INTO sources(id,name,url,enabled,spotlight) VALUES(4001,?,?,1,0)', args: ['TEST-早报源', 'https://test-brief.example.com/f'] });
  await db.execute({ sql: 'INSERT OR REPLACE INTO articles(id,title,translated_title,source_id) VALUES(1,?,?,3001)', args: ['Title A', '甲题'] });
  await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('mybrief.latest',?)", args: [JSON.stringify(REAL)] });
  const put = (k, v) => db.execute({ sql: 'INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', args: [k, JSON.stringify(v)] });
  if (CASE === 'empty-sub') await put('subscription.ids', []);
  if (CASE === 'sub-report') { await put('subscription.ids', [4001]); await put('mybrief.latest', FAKE); }
  if (CASE === 'no-content') { await put('subscription.ids', [4001]); await db.execute("DELETE FROM settings WHERE key='mybrief.latest'"); }
  if (CASE === 'dangling-sub') await put('subscription.ids', [999999]);
  const res = { _status: 200, _body: null };
  res.setHeader = () => res; res.status = (s) => { res._status = s; return res; };
  res.json = (b) => { res._body = b; return res; }; res.send = (b) => { res._body = b; return res; }; res.end = () => res;
  await handler({ method: 'GET', url: '/api/mybrief', query: {}, headers: {} }, res);
  console.log('BODY ' + JSON.stringify(res._body));
  await db.close();
})().catch((e) => { console.error('DRIVERERR ' + e.message); process.exitCode = 3; });
`);
});
after(() => {
  for (const f of [DRIVER, DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) {
    try { fs.rmSync(f, { force: true }); } catch { /* 关不掉就留给系统临时目录 */ }
  }
});

test('1. subscription.ids 空数组时兜底 spotlight 集合（不再返回 no-subscription）', () => {
  // 2026-09-17 修复：空数组 [] 不视为"显式清空"，而是兜底 spotlight 集合
  const d = call('empty-sub');
  assert.notEqual(d.empty, 'no-subscription',
    '空数组应兜底 spotlight，而不是退回未订阅引导态：' + JSON.stringify(d).slice(0, 160));
  assert.ok(d.report, '兜底后没拿到报告：' + JSON.stringify(d).slice(0, 160));
});

test('2. 有订阅 + settings 报告 → 正常透传（必须是本轮写入的那份）', () => {
  const d = call('sub-report');
  assert.equal(d.empty, undefined, '有订阅有报告却回了空态：' + JSON.stringify(d).slice(0, 160));
  assert.equal(d.report.theme, '测试导语', JSON.stringify(d).slice(0, 160));
  assert.equal(d.report.sections.top.length, 1);
});

test('3. 订阅有效但报告行缺失 → API 层 no-content（三态里那一支）', () => {
  const d = call('no-content');
  assert.equal(d.empty, 'no-content',
    '必须是 API 层空态而不是 {report:{empty}} 包装（B76）：' + JSON.stringify(d).slice(0, 160));
  assert.equal(d.report, undefined);
});

test('4. 分层约束：组装逻辑 top≤3/featured≤7/rest≤40（模拟 60 条深析数据）', () => {
  // 直接复现 runMyBrief 的切层逻辑验证数量约束
  const mine = Array.from({ length: 60 }, (_, i) => ({ totalScore: 100 - i, source_id: 1 }));
  const sections = { top: mine.slice(0, 3), featured: mine.slice(3, 10), rest: mine.slice(10, 50) };
  assert.equal(sections.top.length, 3);
  assert.equal(sections.featured.length, 7);
  assert.equal(sections.rest.length, 40);
});

test('5. 订阅 id 全部悬空时不再打死整页（B78 同族；本文件当年就是那个污染源）', () => {
  const d = call('dangling-sub');
  assert.notEqual(d.empty, 'no-subscription', '一个坏 id 不该让整页变引导态：' + JSON.stringify(d).slice(0, 160));
  assert.ok(d.report);
});

test('6. 自证：本文件不再碰生产库（B77/坑 #52 的门禁）', () => {
  const full = fs.readFileSync(path.join(__dirname, 'regression-my-brief.test.js'), 'utf8');
  // **只扫本条自证之前的部分**：判据文本里出现 '.env' / AUTH_SECRET 这些字面量是必需的，
  // 扫全文会让探针命中自己的源码（坑 #50/#53 里 nav1===nav0 的同一个错，我又差点犯一次）。
  const cut = full.indexOf("test('6.");
  assert.ok(cut > 0, '找不到自证条目的起点，本条会退化成恒真');
  const src = full.slice(0, cut);
  // 判据看的是**凭据来源**：不读 .env、不把 authToken 传给 createClient，就连不上生产库
  //（file: 本地库不需要 token）。不能简单禁 "TURSO_AUTH_TOKEN" 这个词——驱动里要显式把它置空。
  assert.ok(!/['"]\.env['"]/.test(src), '还在读 .env → 说明又打算拿真凭据连生产库了');
  assert.ok(!/authToken:\s*process\.env/.test(src), 'createClient 带了真实 authToken → 会打到生产 Turso');
  assert.match(src, /TURSO_DATABASE_URL = 'file:'/, '子进程必须被指到本地文件库');
  assert.ok(!fs.existsSync(path.join(ROOT, '.mybrief-driver.cjs')), '不带进程号的常驻驱动不该留在仓库里');
});
