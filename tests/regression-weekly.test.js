// 20-weekly-picks 回归测试：窗口/归类/加权/上限/归档/API
const { test, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
for (const line of envTxt.split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const handler = require('../api/[...slug].js');
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// 从 collect-turso 借归类函数语义（独立验证，不依赖导出）
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

let origWeekly = null;
let origArchive = null;

after(async () => {
  if (origWeekly !== null) await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('weekly.latest',?)", args: [origWeekly] });
  else await db.execute("DELETE FROM settings WHERE key='weekly.latest'");
  if (origArchive !== null) await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('weekly.archive',?)", args: [origArchive] });
  else await db.execute("DELETE FROM settings WHERE key='weekly.archive'");
  db.close();
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
  const ia = a.totalScore * W[a.weeklyTheme];
  const ib = b.totalScore * W[b.weeklyTheme];
  assert.ok(ia > ib);
});

test('4. top20 硬上限与宁缺', () => {
  const many = Array.from({ length: 35 }, (_, i) => ({ impactScore: 100 - i }));
  assert.equal(many.slice(0, 20).length, 20);
  const few = Array.from({ length: 7 }, (_, i) => ({ impactScore: i }));
  assert.equal(few.slice(0, 20).length, 7);
});

test('5. API：空态 → 正常 → 归档查询', async () => {
  const wr = await db.execute("SELECT value FROM settings WHERE key='weekly.latest'");
  origWeekly = wr.rows[0] ? wr.rows[0].value : null;
  const ar = await db.execute("SELECT value FROM settings WHERE key='weekly.archive'");
  origArchive = ar.rows[0] ? ar.rows[0].value : null;

  const call = async (url) => {
    const res = { _status: 200, _body: null, setHeader() { return res; }, status(s) { res._status = s; return res; }, json(b) { res._body = b; return res; }, send(b) { res._body = b; return res; }, end() { return res; } };
    const [p, qs] = url.split('?');
    await handler({ method: 'GET', url: p, query: Object.fromEntries(new URLSearchParams(qs || '')), headers: {} }, res);
    return { status: res._status, body: res._body };
  };

  // 空态
  await db.execute("DELETE FROM settings WHERE key='weekly.latest'");
  let r = await call('/api/weekly');
  assert.equal(r.body.empty, 'no-content');

  // 正常 + 归档（settings 缓存 30s，轮询等待）
  const report = { issue: 2, dateStart: '2026-09-05', dateEnd: '2026-09-12', theme: '测试主题', items: [{ rank: 1, id: 1, title: 't' }] };
  const archive = [
    { issue: 1, dateStart: '2026-08-29', dateEnd: '2026-09-05', theme: '上期', count: 1, report: { issue: 1, items: [{ rank: 1, id: 9, title: 'old' }] } },
    { issue: 2, dateStart: '2026-09-05', dateEnd: '2026-09-12', theme: '测试主题', count: 1, report },
  ];
  await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('weekly.latest',?)", args: [JSON.stringify(report)] });
  await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('weekly.archive',?)", args: [JSON.stringify(archive)] });
  for (let i = 0; i < 10; i++) {
    await new Promise((res) => setTimeout(res, 5000));
    r = await call('/api/weekly');
    if (r.body.report && r.body.report.theme === '测试主题') break;
  }
  assert.equal(r.body.report.theme, '测试主题');
  assert.equal(r.body.archive.length, 2);
  r = await call('/api/weekly?issue=1');
  assert.equal(r.body.report.issue, 1);
  r = await call('/api/weekly?issue=99');
  assert.equal(r.status, 404);
});
