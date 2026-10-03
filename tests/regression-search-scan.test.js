// H29③ 回归锁：搜索不许扫正文列。
// 为什么：content_html 的 LIKE 会把每行正文物化出来做匹配，是行读单价最大的界面入口之一
// （docs/ISSUES.md H29；用户拍板"搜索不扫正文列"）。正文命中不再算搜索命中——
// 搜索召回面 = 标题 + 摘要。两端（云端读层 + 本地 articles 路由）必须同批改（AGENTS §1）。
'use strict';
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { test, before, after } = require('node:test');
const { runDriver } = require('./driver-runner');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('H29-5 两端搜索条件都不再引用 content_html，且带 summary（删伤防护）', () => {
  for (const f of ['api/[...slug].js', 'server/routes/articles.js']) {
    const src = read(f);
    const line = src.split('\n').find((l) => l.includes('a.title LIKE ?'));
    assert.ok(line, `${f} 里找不到搜索条件行`);
    assert.ok(!/content_html/.test(line), `${f} 的搜索还在扫正文列：${line.trim()}`);
    assert.match(line, /a\.summary LIKE \?/, `${f} 的搜索丢了摘要召回面：${line.trim()}`);
  }
});

// ── 行为探针：正文独有词搜不到、标题/摘要词搜得到（子进程 + file: 本地库，零生产写入） ──
const DB_FILE = path.join(os.tmpdir(), `search-scan-${process.pid}.db`).replace(/\\/g, '/');
const DRIVER = path.join(ROOT, `.search-scan-driver-${process.pid}.cjs`);

function run(caseName) {
  const out = runDriver(DRIVER, [caseName, DB_FILE], { timeout: 120000, payloadRe: /^OUT /m });
  const line = out.trim().split('\n').filter((l) => l.startsWith('OUT ')).pop();
  assert.ok(line, `子进程没打印结果（${caseName}）：\n${out}`);
  return JSON.parse(line.slice(4));
}

const DRIVER_SRC = `
process.env.TURSO_DATABASE_URL = 'file:' + process.argv[3];
process.env.TURSO_AUTH_TOKEN = '';
const { createClient } = require('@libsql/client');
const handler = require(${JSON.stringify(path.join(ROOT, 'api', '[...slug].js'))});
const CASE = process.argv[2];
const NOW = new Date(Date.now() - 3600e3).toISOString(); // 列表默认"今日"滚动窗，夹具必须在窗内
const DDL = [
  // 生产实测 DDL（同 tests/regression-cloud-sources.test.js；少一列 handler 的 fields 就 500）
  "CREATE TABLE IF NOT EXISTS sources(id INTEGER PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, url TEXT, avatar TEXT, uid TEXT, group_id INTEGER, focus INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, status TEXT DEFAULT 'ok', last_fetched_at TEXT, next_fetch_at TEXT, extra TEXT, created_at TEXT, fail_count INTEGER DEFAULT 0, spotlight INTEGER DEFAULT 0, muted INTEGER DEFAULT 0, reader_visible INTEGER DEFAULT 1)",
  "CREATE TABLE IF NOT EXISTS articles(id INTEGER PRIMARY KEY, source_id INTEGER, title TEXT, url TEXT UNIQUE, author TEXT, cover TEXT, summary TEXT, content_html TEXT, published_at TEXT, read_at TEXT, later INTEGER DEFAULT 0, created_at TEXT, score INTEGER, reason TEXT, tags TEXT, featured INTEGER DEFAULT 0, original_html TEXT, original_url TEXT, category TEXT, word_count INTEGER, translated_title TEXT, translated_content TEXT, translation_provider TEXT)",
];
const SEED = [
  { sql: "INSERT OR REPLACE INTO sources(id,name,type) VALUES(1,'普通源','rss')" },
  { sql: "INSERT OR REPLACE INTO articles(id,source_id,title,url,summary,content_html,published_at,created_at) VALUES(1,1,'量子计算新进展','u1','摘要内容在这里','正文里藏着独有正文词丙',?,?)", args: [NOW, NOW] },
];
(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL });
  for (const sql of DDL) await db.execute(sql);
  for (const s of SEED) await db.execute(s);
  const call = async (url) => {
    const [p, qs] = url.split('?');
    const res = { _status: 200, _body: null };
    res.setHeader = () => res; res.status = (s) => { res._status = s; return res; };
    res.json = (b) => { res._body = b; return res; }; res.send = (b) => { res._body = b; return res; }; res.end = () => res;
    await handler({ method: 'GET', url: p, query: Object.fromEntries(new URLSearchParams(qs || '')), headers: {} }, res);
    return res._body;
  };
  let r;
  if (CASE === 'content-word') r = await call('/api/articles?q=独有正文词丙&include_hot=1');
  if (CASE === 'title-word') r = await call('/api/articles?q=量子计算&include_hot=1');
  if (CASE === 'summary-word') r = await call('/api/articles?q=摘要内容&include_hot=1');
  console.log('OUT ' + JSON.stringify({ items: (r.items || []).length }));
  await db.close();
})().catch((e) => { console.error('DRIVERERR ' + e.message); process.exitCode = 3; });
`;

before(() => {
  fs.writeFileSync(DRIVER, DRIVER_SRC);
});
after(() => {
  for (const f of [DRIVER, DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) {
    try { fs.rmSync(f, { force: true }); } catch { /* 留给系统临时目录 */ }
  }
});

test('H29-6 正文独有词搜不到（正文列真的不在扫描面里）', () => {
  const r = run('content-word');
  assert.equal(r.items, 0, `正文命中仍被返回 = 还在扫正文列：${JSON.stringify(r)}`);
});

test('H29-7 标题词搜得到（搜索没被删残）', () => {
  const r = run('title-word');
  assert.equal(r.items, 1, `标题命中丢了：${JSON.stringify(r)}`);
});

test('H29-8 摘要词搜得到（召回面按新契约）', () => {
  const r = run('summary-word');
  assert.equal(r.items, 1, `摘要命中丢了：${JSON.stringify(r)}`);
});
