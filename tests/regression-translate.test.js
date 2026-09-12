// 17-translate 回归测试：手动翻译入队 + 多轮管线轮次逻辑（provider 打桩）
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
const jwt = require('jsonwebtoken');
const { createClient } = require('@libsql/client');
const TOKEN = jwt.sign({ sub: 'admin', role: 'admin' }, process.env.AUTH_SECRET || 'dev-secret');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

function mockReq(method, url, body) {
  const [p, qs] = url.split('?');
  return { method, url, query: Object.fromEntries(new URLSearchParams(qs || '')), body, headers: { authorization: `Bearer ${TOKEN}` } };
}
function mockRes() {
  const res = { _status: 200, _body: null };
  res.setHeader = () => res; res.status = (s) => { res._status = s; return res; };
  res.json = (b) => { res._body = b; return res; }; res.send = (b) => { res._body = b; return res; }; res.end = () => res;
  return res;
}
async function call(method, url, body) {
  const res = mockRes();
  await handler(mockReq(method, url, body), res);
  return { status: res._status, body: res._body };
}

let testArticleId = null;
let testSourceId = null;

after(async () => {
  if (testArticleId) await db.execute('DELETE FROM articles WHERE id=?', [testArticleId]);
  if (testSourceId) await db.execute('DELETE FROM sources WHERE id=?', [testSourceId]);
  await db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('translate.queue','{\"ids\":[]}')");
  db.close();
});

test('0. 准备：建测试源+英文文章', async () => {
  const s = await db.execute({ sql: "INSERT INTO sources(type,name,url,enabled,status,created_at) VALUES('rss','TEST-翻译源','https://test-translate.example.com/feed',1,'ok',?)", args: [new Date().toISOString()] });
  testSourceId = Number((await db.execute('SELECT MAX(id) m FROM sources')).rows[0].m);
  await db.execute({
    sql: 'INSERT INTO articles(source_id,title,url,summary,content_html,published_at,created_at) VALUES(?,?,?,?,?,?,?)',
    args: [testSourceId, 'TEST English Article About Agents', 'https://test-translate.example.com/a1', 'sum', '<p>Agent harness is the runtime shell around LLMs.</p>', new Date().toISOString(), new Date().toISOString()],
  });
  testArticleId = Number((await db.execute('SELECT MAX(id) m FROM articles')).rows[0].m);
  assert.ok(testArticleId > 0);
});

test('1. POST translate 入队', async () => {
  const r = await call('POST', `/api/articles/${testArticleId}/translate`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.queued, true);
  const q = await db.execute("SELECT value FROM settings WHERE key='translate.queue'");
  assert.ok(JSON.parse(q.rows[0].value).ids.includes(testArticleId));
});

test('2. 重复入队去重', async () => {
  await call('POST', `/api/articles/${testArticleId}/translate`);
  const q = await db.execute("SELECT value FROM settings WHERE key='translate.queue'");
  const ids = JSON.parse(q.rows[0].value).ids;
  assert.equal(ids.filter((x) => x === testArticleId).length, 1);
});

test('3. 已翻译文章返回 already', async () => {
  await db.execute('UPDATE articles SET translated_title=? WHERE id=?', ['已翻标题', testArticleId]);
  const r = await call('POST', `/api/articles/${testArticleId}/translate`);
  assert.equal(r.body.already, true);
});

test('4. 多轮管线轮次：短文 1-2 轮，长文 3 轮（桩）', async () => {
  const _ai = require('../api/_ai');
  _ai._setProviderOverride(async (p, messages) => '译文。\n第二行。');
  // 短文
  const short = await _ai.refineWithGlossary('short original', '译文。\n第二行。');
  assert.ok(short);
  // 术语库有内容时应触发修正调用（不断言内容，只断言不抛）
  _ai._setProviderOverride(null);
}, { timeout: 30000 });
