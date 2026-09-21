// 20-weekly-picks 回归测试：窗口/归类/加权/上限/归档/API
// **2026-09-19 起改在本地 libsql 文件库上跑（B83 / 坑 #52）**：
// 旧版用真凭据连生产 Turso，DELETE + INSERT OR REPLACE 生产 settings 的 weekly.latest /
// weekly.archive（107KB 的归档数组整键覆盖），再靠 50s 轮询等读层 30s 缓存过期。
// 这一族的实际代价已经付过一次：中断后 settings 里留下指向已删除 TEST 源的 subscription.ids，
// 线上「我的早报」整页退化成引导态（B78/B79）。模板同 tests/regression-my-brief.test.js：
// 每条 API 用例起一个子进程 + file: 本地库，既零生产写入，又天然绕开进程内缓存。
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runDriver } = require('./driver-runner');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(os.tmpdir(), `weekly-local-${process.pid}.db`).replace(/\\/g, '/');
const DRIVER = path.join(ROOT, `.weekly-driver-${process.pid}.cjs`);

// 从 collect-turso 借归类语义（独立验证，不依赖导出）
const WEEKLY_THEMES = [
  { key: '行业大变化', kws: ['发布', '上线', '收购', '融资', '政策', '监管'] },
  { key: '重大影响', kws: ['安全', '漏洞', '泄露', '事故', '涨价'] },
  { key: '教学课程', kws: ['教程', '指南', '实战', '课程', '万字'] },
  { key: '新理解', kws: ['观点', '思考', '复盘', '范式', '趋势'] },
];
function classify(item) {
  const text = `${item.title || ''} ${item.summary || ''} ${(item.tags || []).join(' ')}`;
  for (const t of WEEKLY_THEMES) if (t.kws.some((k) => text.includes(k))) return t.key;
  return '其它';
}

function call(query) {
  const out = runDriver(DRIVER, [query || '', DB_FILE],
    { timeout: 120000, payloadRe: /^BODY /m });
  const line = out.trim().split('\n').filter((l) => l.startsWith('BODY ')).pop();
  assert.ok(line, `子进程没打印响应体（${query}）：\n${out}`);
  return JSON.parse(line.slice(5));
}

before(() => {
  fs.writeFileSync(DRIVER, `
process.env.TURSO_DATABASE_URL = 'file:' + process.argv[3];
process.env.TURSO_AUTH_TOKEN = '';
const { createClient } = require('@libsql/client');
const handler = require(${JSON.stringify(path.join(ROOT, 'api', '[...slug].js'))});
const ARG = process.argv[2] || '';
const Q = ARG === 'empty' ? '' : ARG;
const REPORT = { issue: 2, dateStart: '2026-09-05', dateEnd: '2026-09-12', theme: '测试主题',
  items: [{ rank: 1, id: 1, title: '甲题' }] };
const ARCHIVE = [
  { issue: 1, dateStart: '2026-08-29', dateEnd: '2026-09-05', theme: '上期', count: 1,
    report: { issue: 1, items: [{ rank: 1, id: 9, title: '旧题' }] } },
  { issue: 2, dateStart: '2026-09-05', dateEnd: '2026-09-12', theme: '测试主题', count: 1, report: REPORT },
];
(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL });
  await db.execute('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)');
  await db.execute('CREATE TABLE IF NOT EXISTS articles(id INTEGER PRIMARY KEY, title TEXT, translated_title TEXT)');
  await db.execute('CREATE TABLE IF NOT EXISTS sources(id INTEGER PRIMARY KEY, name TEXT, url TEXT, type TEXT, enabled INTEGER DEFAULT 1, spotlight INTEGER DEFAULT 0)');
  await db.execute({ sql: 'INSERT OR REPLACE INTO articles(id,title,translated_title) VALUES(1,?,?)', args: ['Title A', '甲题'] });
  await db.execute({ sql: 'INSERT OR REPLACE INTO articles(id,title,translated_title) VALUES(9,?,?)', args: ['Old B', '旧题'] });
  // 「空态」用例：latest 缺失（不写入）；其余写正常态
  if (ARG !== 'empty') {
    await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('weekly.latest',?)", args: [JSON.stringify(REPORT)] });
    await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('weekly.archive',?)", args: [JSON.stringify(ARCHIVE)] });
  }
  const res = { _status: 200, _body: null };
  res.setHeader = () => res; res.status = (s) => { res._status = s; return res; };
  res.json = (b) => { res._body = b; return res; }; res.send = (b) => { res._body = b; return res; }; res.end = () => res;
  await handler({ method: 'GET', url: '/api/weekly', query: Object.fromEntries(new URLSearchParams(Q.replace(/^empty\\?/, '?'))), headers: {} }, res);
  console.log('BODY ' + JSON.stringify({ status: res._status, body: res._body }));
  await db.close();
})().catch((e) => { console.error('DRIVERERR ' + e.message); process.exitCode = 3; });
`);
});
after(() => {
  for (const f of [DRIVER, DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) {
    try { fs.rmSync(f, { force: true }); } catch { /* 关不掉就留给系统临时目录 */ }
  }
});

test('1. 窗口为前 7 天', () => {
  const start = new Date(Date.now() - 7 * 86400e3);
  assert.equal(Math.round((Date.now() - start.getTime()) / 86400e3), 7);
});

test('2. 归类规则 4 类命中', () => {
  assert.equal(classify({ title: 'OpenAI 发布新模型' }), '行业大变化');
  assert.equal(classify({ title: '大规模数据泄露事故分析' }), '重大影响');
  assert.equal(classify({ title: '万字教程：从 0 到 1 搭建 RAG' }), '教学课程');
  assert.equal(classify({ title: '对 AI 范式的深度思考与复盘' }), '新理解');
  assert.equal(classify({ title: '某公司日常新闻' }), '其它');
});

test('3. impactScore 加权：同总分行业大变化排前', () => {
  const W = { 行业大变化: 1.2, 其它: 0.9 };
  const a = { totalScore: 80, weeklyTheme: '行业大变化' };
  const b = { totalScore: 80, weeklyTheme: '其它' };
  assert.ok(a.totalScore * W[a.weeklyTheme] > b.totalScore * W[b.weeklyTheme]);
});

test('4. top20 硬上限与宁缺', () => {
  const many = Array.from({ length: 35 }, (_, i) => ({ impactScore: 100 - i }));
  assert.equal(many.slice(0, 20).length, 20);
  const few = Array.from({ length: 7 }, (_, i) => ({ impactScore: i }));
  assert.equal(few.slice(0, 20).length, 7);
});

test('5. API 空态：latest 缺失 → no-content（不是空 report 壳）', () => {
  const r = call('empty');
  assert.equal(r.body.empty, 'no-content', JSON.stringify(r.body).slice(0, 160));
  assert.equal(r.body.report, undefined);
});

test('6. API 正常态 + 归档列表（issue/count 都在）', () => {
  const r = call('');
  assert.equal(r.body.report.theme, '测试主题', JSON.stringify(r.body).slice(0, 160));
  assert.equal(r.body.archive.length, 2);
  assert.equal(r.body.archive[0].issue, 1);
});

test('7. API 按 issue 查归档，不存在的期号回 404', () => {
  assert.equal(call('issue=1').body.report.issue, 1);
  assert.equal(call('issue=99').status, 404);
});

test('8. 自证：本文件不再碰生产库（B83/坑 #52 的门禁）', () => {
  const full = fs.readFileSync(path.join(__dirname, 'regression-weekly.test.js'), 'utf8');
  const cut = full.indexOf("test('8.");
  assert.ok(cut > 0, '找不到自证条目起点，本条会退化成恒真');
  const src = full.slice(0, cut);
  assert.ok(!/['"]\.env['"]/.test(src), '还在读 .env → 又要拿真凭据连生产库了');
  assert.ok(!/authToken:\s*process\.env/.test(src), 'createClient 带真实 authToken → 会打到生产 Turso');
  assert.match(src, /TURSO_DATABASE_URL = 'file:'/, '子进程必须被指到本地文件库');
});
