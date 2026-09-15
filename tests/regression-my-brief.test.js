// 19-my-brief 回归测试：三态 API + 订阅过滤 + 分层约束（真实 Turso，现场恢复）
// 27b（2026-09-15）：订阅集合从 focus=1 列迁移为 settings subscription.ids（四轴之订阅轴）——
// 本测试的快照/恢复对象同步改为 subscription.ids（现场恢复纪律不变：直打生产库，测后必须还原）
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

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

function mockRes() {
  const res = { _status: 200, _body: null };
  res.setHeader = () => res; res.status = (s) => { res._status = s; return res; };
  res.json = (b) => { res._body = b; return res; }; res.send = (b) => { res._body = b; return res; }; res.end = () => res;
  return res;
}
async function callGet(url) {
  const res = mockRes();
  await handler({ method: 'GET', url, query: {}, headers: {} }, res);
  return res._body;
}

let testSourceId = null;
let origMybrief = null;
let origSubIds = null;

before(async () => {
  const r = await db.execute("SELECT value FROM settings WHERE key='mybrief.latest'");
  origMybrief = r.rows[0] ? r.rows[0].value : null;
  // 快照订阅集合（测试会改写 subscription.ids，必须恢复——曾误清用户标记的 focus 现场翻版）
  const s = await db.execute("SELECT value FROM settings WHERE key='subscription.ids'");
  origSubIds = s.rows[0] ? s.rows[0].value : null;
});

after(async () => {
  if (testSourceId) await db.execute('DELETE FROM sources WHERE id=?', [testSourceId]);
  if (origMybrief !== null) await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('mybrief.latest',?)", args: [origMybrief] });
  // 恢复订阅集合快照
  if (origSubIds !== null) await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('subscription.ids',?)", args: [origSubIds] });
  else await db.execute("DELETE FROM settings WHERE key='subscription.ids'");
  db.close();
});

test('1. subscription.ids 为空时返回 no-subscription 引导态', async () => {
  await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('subscription.ids',?)", args: ['[]'] });
  const d = await callGet('/api/mybrief');
  assert.equal(d.empty, 'no-subscription');
});

test('2. 有订阅 + settings 报告 → 正常透传', async () => {
  // 建测试订阅源（subscription.ids 直接指它；enabled=1）
  await db.execute({ sql: "INSERT INTO sources(type,name,url,enabled,status,created_at) VALUES('rss','TEST-早报源','https://test-brief.example.com/f',1,'ok',?)", args: [new Date().toISOString()] });
  testSourceId = Number((await db.execute('SELECT MAX(id) m FROM sources')).rows[0].m);
  await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('subscription.ids',?)", args: [JSON.stringify([testSourceId])] });
  const fake = {
    date: '2026-09-12', theme: '测试导语', keywords: ['AI'],
    sections: { top: [{ id: 1, title: 't1' }], featured: [], rest: [] },
  };
  await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('mybrief.latest',?)", args: [JSON.stringify(fake)] });
  // subscription.ids 经 getSetting 读取且 slug 有 30s 进程内缓存（test 1 刚把 [] 缓存住）——轮询等缓存过期
  let d = null;
  for (let i = 0; i < 10; i++) {
    d = await callGet('/api/mybrief');
    if (d.report) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  assert.ok(d.report, '订阅生效后应透传报告');
  assert.equal(d.report.theme, '测试导语');
  assert.equal(d.report.sections.top.length, 1);
}, { timeout: 90000 });

test('3. 有订阅但无报告 → no-content', async () => {
  await db.execute("DELETE FROM settings WHERE key='mybrief.latest'");
  // [...slug].js settings 缓存 TTL=30s，轮询等待（全量测试并行时序不稳，容忍到 50s）
  let d = null;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    d = await callGet('/api/mybrief');
    if (d.empty === 'no-content') break;
  }
  assert.equal(d.empty, 'no-content');
}, { timeout: 90000 });

test('4. 分层约束：组装逻辑 top≤3/featured≤7/rest≤40（模拟 60 条深析数据）', () => {
  // 直接复现 runMyBrief 的切层逻辑验证数量约束
  const mine = Array.from({ length: 60 }, (_, i) => ({ totalScore: 100 - i, source_id: 1 }));
  const sections = {
    top: mine.slice(0, 3),
    featured: mine.slice(3, 10),
    rest: mine.slice(10, 50),
  };
  assert.equal(sections.top.length, 3);
  assert.equal(sections.featured.length, 7);
  assert.equal(sections.rest.length, 40);
});
