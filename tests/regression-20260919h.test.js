// 2026-09-19 深夜轮（对抗审查后）回归锁 H 组：mybrief 空态二义性（B76）
// 起因：全量 `npm test` 里 `regression-my-brief` 第 3 条连红两次（`d.empty` 为 undefined）。
// 追到的不是"测试运气差"，而是**同一份空态有两种 API 表达**：
//   · 行缺失            → `api/[...slug].js` 返回 `{empty:'no-content'}`
//   · 行内 sentinel 态  → `tools/collect-turso.js:1372` 把 `{empty:'no-content',…}` 当报告**写进 settings 行**，
//                        读层只判 `if (!report)`，于是返回 `{report:{empty:'no-content'}}`
// 前台 `MyBriefPage.jsx:45` 写成 `data?.empty || report?.empty` 是在**替后端兜这个二义性**；
// 任何只看 `data.empty` 的客户端（portal、飞书推送、脚本）都会把"今日无更新"当成"有内容"。
// 两条纪律：①**零生产写入**——本文件在本地 libsql 文件库上跑；②读层 `getSetting` 有 30s 进程内缓存，
// 同进程连测会拿到上一条用例的缓存值（假绿/假红都行不通），所以**每条用例起一个子进程**（冷缓存）。
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(os.tmpdir(), `b76-mybrief-${process.pid}.db`).replace(/\\/g, '/');
// 驱动脚本必须落在**仓库内**：Node 从脚本所在目录往上找 node_modules，放临时目录连 @libsql/client
// 都解析不到——那条红是环境红，测不到产品（本轮实测踩过）。用完在 after() 里删。
const DRIVER = path.join(ROOT, `.b76-driver-${process.pid}.cjs`);

function call(caseName) {
  const out = execFileSync(process.execPath, [DRIVER, caseName, DB_FILE], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  const m = /BODY (.*)$/.exec(out.trim().split('\n').pop() || '');
  assert.ok(m, `子进程没打印响应体（${caseName}）：\n${out}`);
  return JSON.parse(m[1]);
}

before(() => {
  fs.writeFileSync(DRIVER, `
const fs = require('fs');
const path = require('path');
process.env.TURSO_DATABASE_URL = 'file:' + process.argv[3];
process.env.TURSO_AUTH_TOKEN = '';
// 驱动脚本在仓库内，裸包名就能解析到仓库 node_modules（放临时目录里会先撞 Cannot find module）
const { createClient } = require('@libsql/client');
const handler = require(${JSON.stringify(path.join(ROOT, 'api', '[...slug].js'))});
const CASE = process.argv[2];
const SENT = {
  'no-content-row': { empty: 'no-content', date: '2026-09-19', message: '今天你的订阅源没有新的精选内容' },
  'no-sub-row': { empty: 'no-subscription', date: '2026-09-19' },
  'real-report': { date: '2026-09-19', theme: '真报告', keywords: ['AI'], sections: { top: [{ id: 1, title: '甲题' }], featured: [], rest: [] } },
  'missing-row': null,
};
(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL });
  await db.execute('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)');
  await db.execute('CREATE TABLE IF NOT EXISTS sources(id INTEGER PRIMARY KEY, name TEXT, url TEXT, type TEXT, enabled INTEGER DEFAULT 1, spotlight INTEGER DEFAULT 0)');
  await db.execute('CREATE TABLE IF NOT EXISTS articles(id INTEGER PRIMARY KEY, title TEXT, translated_title TEXT)');
  await db.execute({ sql: 'INSERT OR REPLACE INTO articles(id,title,translated_title) VALUES(1,?,?)', args: ['Title A', '甲题'] });
  await db.execute({ sql: 'INSERT OR REPLACE INTO sources(id,name,url,enabled,spotlight) VALUES(2104,?,?,1,0)', args: ['TEST-B76', 'https://b76.example.com/f'] });
  await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('subscription.ids',?)", args: [JSON.stringify([2104])] });
  const v = SENT[CASE];
  if (v === null) await db.execute("DELETE FROM settings WHERE key='mybrief.latest'");
  else await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('mybrief.latest',?)", args: [JSON.stringify(v)] });
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
  for (const f of [DRIVER, DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) { try { fs.rmSync(f, { force: true }); } catch { /* 留给系统临时目录 */ } }
});

test('H1 行内 no-content sentinel 必须归一成 API 空态，不许当报告透传（B76）', () => {
  const d = call('no-content-row');
  assert.equal(d.empty, 'no-content', `空态被包成 report 透传了：${JSON.stringify(d).slice(0, 160)}`);
  assert.equal(d.report, undefined, '空态响应里不该再有 report 键');
  assert.equal(d.message, '今天你的订阅源没有新的精选内容', '空态文案要一起归一，前端才有话可说');
});

test('H2 行内 no-subscription sentinel 同样归一（引导态，collect-turso.js:1308 的写法）', () => {
  const d = call('no-sub-row');
  assert.equal(d.empty, 'no-subscription', JSON.stringify(d).slice(0, 160));
  assert.equal(d.report, undefined);
});

test('H3 归一化不许误伤真报告（正常早报必须原样透传，否则就是改坏了）', () => {
  const d = call('real-report');
  assert.equal(d.empty, undefined, '真报告被判成空态（归一化过头）：' + JSON.stringify(d).slice(0, 160));
  assert.ok(d.report, '真报告没透传出来：' + JSON.stringify(d).slice(0, 160));
  assert.equal(d.report.theme, '真报告');
  assert.equal(d.report.sections.top.length, 1);
});

test('H4 行缺失时的三态仍然成立（regression-my-brief 第 3 条依赖的就是这一支）', () => {
  const d = call('missing-row');
  assert.equal(d.empty, 'no-content', JSON.stringify(d).slice(0, 160));
});

test('H5 前端兜底不许被当成"已经修好"：读层归一后前端两处判据都要在（防反向回退）', () => {
  const page = fs.readFileSync(path.join(ROOT, 'web', 'src', 'pages', 'MyBriefPage.jsx'), 'utf8');
  assert.match(page, /data\?\.empty \|\| report\?\.empty/, '前端的双形态兜底要保留（历史数据里仍有 sentinel 行）');
  const api = fs.readFileSync(path.join(ROOT, 'api', '[...slug].js'), 'utf8');
  assert.match(api, /report\.empty/, '读层必须有 sentinel 归一分支，否则只是把二义性推给前端');
});
