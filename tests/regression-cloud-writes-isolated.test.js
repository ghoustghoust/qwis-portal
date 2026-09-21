// 云端**写方法**端点的隔离库回归锁（B117 / spec43 §六）。
// 为什么单独成文件：本仓此前有两份测试用真凭据、在生产 Turso 上发写方法 ——
//   · `regression-20260918` 第 1 条：`DELETE /api/weekly/archive/999999` 带 `.env` 里的真 Bearer token；
//   · `regression-20260913b` R6：`POST /api/data/cleanup/preview {days:7}` 直打生产。
// 两条都没真删成东西（已逐份证死，见 spec43 §六），但**安全性押在夹具选择上而不是押在隔离上**：
// 前者靠"999999 期恰好不存在"，后者靠"preview 函数体里恰好没有 DELETE"。这就是"下一次 BL7"的形状。
// 现在两份都搬到本地 libsql 文件库，并且从"路由可达"升级成**正负两条行为断言**（存在→真删并回 removed；
// 不存在→404 期号不存在）。最后一条是自证：子进程必须真的指在 `file:` 上、没带生产凭据（坑 #52/#64）。
// 样板与 `regression-cloud-settings` 同形：每个用例一个子进程（绕开 getSetting 的进程内缓存）。
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runDriver } = require('./driver-runner');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(os.tmpdir(), `cloud-writes-${process.pid}.db`).replace(/\\/g, '/');
const DRIVER = path.join(ROOT, `.cloud-writes-driver-${process.pid}.cjs`);

function run(caseName) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // 嵌套 node 会因子进程的测试上下文被静默跳过（坑：删掉才有真退出码）
  const out = runDriver(DRIVER, [caseName, DB_FILE], { env, timeout: 180000, payloadRe: /^OUT /m });
  const line = out.trim().split('\n').filter((l) => l.startsWith('OUT ')).pop();
  assert.ok(line, `子进程没打印结果（${caseName}）：\n${out}`);
  return JSON.parse(line.slice(4));
}

before(() => {
  fs.writeFileSync(DRIVER, `
process.env.TURSO_DATABASE_URL = 'file:' + process.argv[3];
process.env.TURSO_AUTH_TOKEN = '';
process.env.AUTH_SECRET = 'local-test-secret';   // 本地自签：绝不为签 token 去读生产凭据
const jwt = require('jsonwebtoken');
const db = require(${JSON.stringify(path.join(ROOT, 'lib', 'db.js'))});
const handler = require(${JSON.stringify(path.join(ROOT, 'api', '[...slug].js'))});
const CASE = process.argv[2];
const TOKEN = jwt.sign({ sub: 'admin', role: 'admin' }, 'local-test-secret');

function mockRes() {
  const res = { _status: 200, _body: null };
  res.setHeader = () => res; res.status = (s) => { res._status = s; return res; };
  res.json = (b) => { res._body = b; return res; }; res.send = (b) => { res._body = b; return res; };
  res.end = () => res; return res;
}
async function call(method, url, body) {
  const [p, qs] = url.split('?');
  const res = mockRes();
  await handler({ method, url: p, query: Object.fromEntries(new URLSearchParams(qs || '')), body: body || {},
    headers: { authorization: 'Bearer ' + TOKEN } }, res);
  return { status: res._status, body: res._body || {} };
}
const daysAgo = (d) => new Date(Date.now() - d * 86400e3).toISOString();

(async () => {
  await db.ensureSchema();
  const r = { case: CASE, iso: { url: process.env.TURSO_DATABASE_URL, hasToken: !!process.env.TURSO_AUTH_TOKEN } };

  if (CASE === 'weekly-del-hit' || CASE === 'weekly-del-miss' || CASE === 'weekly-del-latest') {
    r.auditBefore = (await db.dbAll("SELECT COUNT(*) c FROM audit_log WHERE action='weekly.archiveDelete'"))[0].c;
    await db.setSetting('weekly.archive', [
      { issue: 7, dateStart: '2026-09-01', dateEnd: '2026-09-07', theme: '第七期', count: 2, report: { theme: '第七期' } },
      { issue: 8, dateStart: '2026-09-08', dateEnd: '2026-09-14', theme: '第八期', count: 1, report: { theme: '第八期' } },
    ]);
    await db.setSetting('weekly.latest', { issue: 8, theme: '第八期' });
    const beforeArchive = await db.getSetting('weekly.archive', []);
    r.beforeCount = beforeArchive.length;
    r.del = await call('DELETE', CASE === 'weekly-del-hit' ? '/api/weekly/archive/7'
      : CASE === 'weekly-del-latest' ? '/api/weekly/archive/8' : '/api/weekly/archive/999999');
    r.afterArchive = await db.getSetting('weekly.archive', []);
    r.afterLatest = await db.getSetting('weekly.latest', null);
    r.auditRows = (await db.dbAll("SELECT COUNT(*) c FROM audit_log WHERE action='weekly.archiveDelete'"))[0].c;
    r.auditDelta = r.auditRows - r.auditBefore;
  }

  if (CASE === 'weekly-get') {
    await db.setSetting('weekly.latest', { issue: 9, theme: '第九期', storylines: [{ title: '主线', items: [{ id: 'a1', title: 'x' }] }] });
    r.get = await call('GET', '/api/weekly');
  }

  if (CASE === 'preview') {
    // 五种形态各造 1 条：老未读（该删）/ 老已读 / 老稍后读 / 老精选（三条豁免）/ 新未读（窗口内）
    // 注意 dbAll/dbRun 是 **变参** 签名（不是数组），传数组会被 libsql 判成"绑定非法值"
    const src = (await db.dbAll("SELECT id FROM sources WHERE type='rss' LIMIT 1"))[0]
      || (await db.dbRun("INSERT INTO sources(type,name,url,enabled,status,created_at) VALUES('rss','隔离源','https://iso.example.com/f',1,'ok',?)", daysAgo(1)),
          { lastInsertRowid: 1 });
    const sid = Number(src.id || src.lastInsertRowid);
    const ins = (title, at, extra) => db.dbRun(
      'INSERT INTO articles(source_id,title,url,published_at,created_at,read_at,later,featured) VALUES(?,?,?,?,?,?,?,?)',
      sid, title, 'https://iso.example.com/' + title, at, at, extra.read || null, extra.later || 0, extra.featured || 0);
    await ins('老未读', daysAgo(20), {});
    await ins('老已读', daysAgo(20), { read: daysAgo(2) });
    await ins('老稍后读', daysAgo(20), { later: 1 });
    await ins('老精选', daysAgo(20), { featured: 1 });
    await ins('新未读', daysAgo(1), {});
    await db.dbRun("INSERT INTO videos(source_id,platform,title,url,published_at,created_at) VALUES(?,?,?,?,?,?)",
      sid, 'douyin', '老视频', 'https://iso.example.com/v1', daysAgo(20), daysAgo(20));
    r.preview = await call('POST', '/api/data/cleanup/preview', { days: 7 });
    // 真删只许发生在**这个隔离库**里：把同一份谓词在本库跑一遍 DELETE，行数必须与 preview 报的数一致
    const exec = await call('POST', '/api/data/cleanup', { days: 7, confirm: true });
    r.exec = exec;
    r.survivors = (await db.dbAll('SELECT title FROM articles ORDER BY id')).map((x) => x.title);
    r.videosLeft = (await db.dbAll('SELECT COUNT(*) c FROM videos'))[0].c;
  }

  console.log('OUT ' + JSON.stringify(r));
  await db.close();
})().catch((e) => { console.error('DRIVERERR ' + e.message); process.exitCode = 3; });
`);
});
after(() => {
  for (const f of [DRIVER, DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) {
    try { fs.rmSync(f, { force: true }); } catch { /* 关不掉就留给系统临时目录 */ }
  }
});

test('W-1 归档删除（正向）：期号存在 → 200 回 removed，清单里真少了那一期', () => {
  const r = run('weekly-del-hit');
  assert.equal(r.beforeCount, 2, '夹具没种够两期');
  assert.equal(r.del.status, 200, JSON.stringify(r.del.body));
  assert.equal(r.del.body.removed, 7, '应当删掉第 7 期');
  assert.deepEqual(r.afterArchive.map((a) => a.issue), [8], '删完还剩的期号不对');
  assert.equal(r.auditDelta, 1, '归档删除必须留审计行（AGENTS §2 BL9 裁决的口径）');
});

test('W-2 归档删除（负向）：期号不存在 → 404 且清单一字未动（旧版只测"路由可达"）', () => {
  const r = run('weekly-del-miss');
  assert.equal(r.del.status, 404);
  assert.match(String(r.del.body.error || ''), /第 999999 期不存在|不存在/, JSON.stringify(r.del.body));
  assert.deepEqual(r.afterArchive.map((a) => a.issue), [7, 8], '不存在的期号竟然改了归档');
  assert.equal(r.auditDelta, 0, '未发生的删除不该留审计行');
});

test('W-3 latest 指针跟不跟着退：删最新期 → latest 退到剩下那期；删非最新期 → latest 不许动', () => {
  const delLatest = run('weekly-del-latest');
  assert.equal(delLatest.del.status, 200, JSON.stringify(delLatest.del.body));
  assert.deepEqual(delLatest.afterArchive.map((a) => a.issue), [7], '应当只剩第 7 期');
  assert.equal(delLatest.afterLatest && delLatest.afterLatest.theme, '第七期',
    `删掉最新期后 latest 没退位，实得 ${JSON.stringify(delLatest.afterLatest)}`);

  const delOlder = run('weekly-del-hit');
  assert.equal(delOlder.afterLatest && delOlder.afterLatest.issue, 8,
    `删的是第 7 期，latest 不该被改，实得 ${JSON.stringify(delOlder.afterLatest)}`);
});

test('W-4 GET /api/weekly 公开读路径仍正常（搬库没搬坏读侧）', () => {
  const r = run('weekly-get');
  assert.ok(r.get.body.ok || r.get.body.empty, JSON.stringify(r.get.body));
});

test('W-5 cleanup preview 与真删在隔离库里对账：只删老未读，豁免三条 + 视频一条不动', () => {
  const r = run('preview');
  assert.equal(r.preview.status, 200, JSON.stringify(r.preview.body));
  const wd = r.preview.body.willDelete || {};
  assert.equal(r.preview.body.total >= wd.articles, true, 'total 应当含 articles');
  assert.equal(wd.articles, 1, `预览应当只数出 1 条（老未读），实得 ${wd.articles}`);
  assert.equal(wd.videos, 0, '视频/播客永不清理（2026-09-13 决策）');
  assert.equal(r.exec.status, 200, JSON.stringify(r.exec.body));
  assert.deepEqual(r.survivors, ['老已读', '老稍后读', '老精选', '新未读'],
    `真删之后的存活行不对（删多/删少都是事故）：${JSON.stringify(r.survivors)}`);
  assert.equal(r.videosLeft, 1, '视频被删了');
});

test('W-6 自证：驱动确实把 TURSO_DATABASE_URL 指到 file: 本地库，且没读 .env、没带 authToken', () => {
  const r = run('weekly-get');
  assert.match(r.iso.url, /^file:/, `子进程指向的不是本地文件库：${r.iso.url}`);
  assert.equal(r.iso.hasToken, false, '隔离库里不该出现 TURSO_AUTH_TOKEN');
  const src = fs.readFileSync(DRIVER, 'utf8');
  assert.ok(!/readFileSync\([^)]*\.env/.test(src), '驱动不许读 .env 文件（读了就等于拿生产凭据）');
  assert.match(src, /TURSO_DATABASE_URL\s*=\s*'file:'/, '驱动没把库指成 file: 就是假隔离');
  assert.match(src, /TURSO_AUTH_TOKEN\s*=\s*''/, '驱动没清空 authToken 就是假隔离');
});
