// 17-translate 回归测试：手动翻译入队 + 多轮精翻管线轮次（provider 全部打桩）
// **2026-09-19 起改在本地 libsql 文件库上跑（B83 / 坑 #52）**。
// 旧版用真凭据连生产 Turso，而且：
//   · 每条用例往生产 sources/articles 插 TEST 行，再靠 after() 删（中断即留孤行）；
//   · `translate.queue` 是**整键覆盖**——收尾那句 INSERT OR REPLACE 会把生产真实的翻译队列清空，
//     正好撞上 runner 每 15 分钟拾取同一个键（与坑 #17「spotlight 全量替换」同一族语义）。
// 现在：夹具源/夹具文章用固定 id（9101），每条用例一个子进程 + file: 本地库，零生产写入。
// 表结构取自生产实测 DDL（只读导出 sqlite_master），少一列就会把"写进 translated_content 也算已翻"这类分支测漏。
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(os.tmpdir(), `translate-${process.pid}.db`).replace(/\\/g, '/');
// 驱动脚本必须落在仓库内：Node 从脚本所在目录往上找 node_modules（放临时目录先撞 Cannot find module）
const DRIVER = path.join(ROOT, `.translate-driver-${process.pid}.cjs`);

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
const _ai = require(${JSON.stringify(path.join(ROOT, 'api', '_ai.js'))}); // 与 handler 内部 require('./_ai') 同一实例
const CASE = process.argv[2];
const TOKEN = jwt.sign({ sub: 'admin', role: 'admin' }, 'local-test-secret');
const NOW = new Date().toISOString();
const ARTICLE_ID = 9101;
const DDL = [
  "CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)",
  "CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user TEXT DEFAULT 'admin', action TEXT NOT NULL, target TEXT, detail TEXT, ip TEXT)",
  "CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, name TEXT NOT NULL, url TEXT, avatar TEXT, uid TEXT, group_id INTEGER, focus INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, status TEXT DEFAULT 'ok', last_fetched_at TEXT, next_fetch_at TEXT, extra TEXT, created_at TEXT, fail_count INTEGER DEFAULT 0, spotlight INTEGER DEFAULT 0, muted INTEGER DEFAULT 0, reader_visible INTEGER DEFAULT 1)",
  "CREATE TABLE IF NOT EXISTS articles (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER, title TEXT, url TEXT UNIQUE, author TEXT, cover TEXT, summary TEXT, content_html TEXT, published_at TEXT, read_at TEXT, later INTEGER DEFAULT 0, created_at TEXT, score INTEGER, reason TEXT, tags TEXT, featured INTEGER DEFAULT 0, original_html TEXT, original_url TEXT, category TEXT, word_count INTEGER, translated_title TEXT, translated_content TEXT, translation_provider TEXT)",
];
(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL });
  for (const sql of DDL) await db.execute(sql);
  // 夹具：TEST-翻译源 + 一篇未翻译英文文章（固定 id，跨子进程可引用）
  await db.execute({ sql: "INSERT OR REPLACE INTO sources(id,type,name,url,enabled,status,created_at) VALUES(9100,'rss','TEST-翻译源','https://test-translate.example.com/feed',1,'ok',?)", args: [NOW] });
  await db.execute({ sql: 'INSERT OR REPLACE INTO articles(id,source_id,title,url,summary,content_html,published_at,created_at,translated_title,translated_content) VALUES(9101,?,?,?,?,?,?,?,NULL,NULL)',
    args: [9100, 'TEST English Article About Agents', 'https://test-translate.example.com/a1', 'sum', '<p>Agent harness is the runtime shell around LLMs.</p>', NOW, NOW] });
  // AI 通道：打桩不发真请求，但 _providerChain 必须非空（apiKey 用假值，绝不为它读生产凭据）；
  // minIntervalMs=0 免得桩用例被 4s 串行间隔拖慢
  const put = (k, v) => db.execute({ sql: 'INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', args: [k, v] });
  await put('ai', JSON.stringify({ apiKey: 'local-fake-key', model: 'stub' }));
  await put('ai.minIntervalMs', '0');
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
  const queue = async () => {
    const row = await one("SELECT value FROM settings WHERE key='translate.queue'");
    return row ? JSON.parse(row.value) : null;
  };
  let r = { status: 0, body: null };
  const dbv = { ARTICLE_ID };
  if (CASE === 'prepare') {
    // 旧版这条是"插一行测试数据"的现场准备；迁移后夹具已在上面建好，
    // 这条改判**夹具真的可被入队接口读到**（等价于旧断言 id>0，且不再往生产插行）
    await put('translate.queue', JSON.stringify({ ids: [] }));
    r = await call('POST', '/api/articles/' + ARTICLE_ID + '/translate');
    dbv.status = r.status;
    dbv.article = await one('SELECT id, source_id, title, translated_title FROM articles WHERE id=' + ARTICLE_ID);
  }
  if (CASE === 'enqueue') {
    await put('translate.queue', JSON.stringify({ ids: [] }));
    r = await call('POST', '/api/articles/' + ARTICLE_ID + '/translate');
    dbv.queue = await queue();
  }
  if (CASE === 'dedup') {
    await put('translate.queue', JSON.stringify({ ids: [] }));
    await call('POST', '/api/articles/' + ARTICLE_ID + '/translate');
    r = await call('POST', '/api/articles/' + ARTICLE_ID + '/translate');
    dbv.queue = await queue();
  }
  if (CASE === 'already') {
    await db.execute({ sql: 'UPDATE articles SET translated_title=? WHERE id=9101', args: ['已翻标题'] });
    // 队列键先归零：本库文件被同轮其它用例共用，不清就会把上一条用例写入的 id 当成"这条也入队了"
    await put('translate.queue', JSON.stringify({ ids: [] }));
    r = await call('POST', '/api/articles/' + ARTICLE_ID + '/translate');
    dbv.queue = await queue();
  }
  if (CASE === 'pipeline') {
    // 轮 2 只有在术语库非空时才值得跑（refineWithGlossary 的第一条分支就是"空库直接回草稿"）——
    // 旧版这条靠生产库里恰好有词条才走到模型调用，桩其实没被打到；这里把两种状态都钉住。
    await put('ai.glossary', JSON.stringify([{ en: 'agent', zh: '智能体', domain: 'AI', occurrenceCount: 1, locked: false }]));
    _ai._setProviderOverride(async () => '译文。\\n第二行。');
    const withGlossary = await _ai.refineWithGlossary('short original', '旧草稿。');
    dbv.withGlossary = withGlossary;
    _ai._setProviderOverride(null);
    _ai._setProviderOverride(async () => '不该被调用');
    await put('ai.glossary', '[]');
    dbv.withoutGlossary = await _ai.refineWithGlossary('short original', '旧草稿。');
    _ai._setProviderOverride(null);
    // 轮 3（长文精翻）
    _ai._setProviderOverride(async () => '终稿译文。');
    dbv.polished = await _ai.refinePass('an original text', '第二段草稿。');
    _ai._setProviderOverride(null);
    r = { status: 200, body: { ok: true } };
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

test('0. 准备：夹具源 + 未翻译英文文章可被入队接口读到', () => {
  const r = run('prepare');
  assert.ok(r.dbv.article.id > 0, '夹具文章没建出来：' + JSON.stringify(r.dbv.article));
  assert.equal(r.dbv.article.translated_title, null, '夹具必须是"未翻译"，否则后面的入队断言全是空的');
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('1. POST translate 入队', () => {
  const r = run('enqueue');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.queued, true);
  assert.ok(r.dbv.queue.ids.includes(r.dbv.ARTICLE_ID), JSON.stringify(r.dbv.queue));
});

test('2. 重复入队去重', () => {
  const r = run('dedup');
  const ids = r.dbv.queue.ids;
  assert.equal(ids.filter((x) => x === r.dbv.ARTICLE_ID).length, 1, JSON.stringify(ids));
});

test('3. 已翻译文章返回 already', () => {
  const r = run('already');
  assert.equal(r.body.already, true, JSON.stringify(r.body));
  assert.ok(!r.dbv.queue || !r.dbv.queue.ids.includes(r.dbv.ARTICLE_ID), 'already 的文章还被塞进队列');
});

test('4. 多轮管线轮次：短文 1-2 轮，长文 3 轮（桩）', () => {
  const r = run('pipeline');
  assert.ok(r.dbv.withGlossary, '轮 2 返回空');
  // 术语库非空 → 必须真的打到（打桩的）模型，而不是把草稿原样退回
  assert.equal(r.dbv.withGlossary, '译文。\n第二行。', JSON.stringify(r.dbv));
  // 术语库为空 → 轮 2 直接跳过，回上一轮草稿（短文 1-2 轮的那一支）
  assert.equal(r.dbv.withoutGlossary, '旧草稿。', JSON.stringify(r.dbv));
  // 轮 3 精翻（长文才有）：桩输出即终稿
  assert.equal(r.dbv.polished, '终稿译文。', JSON.stringify(r.dbv));
});

test('5. 自证：本文件不再碰生产库（B83/坑 #52 的门禁）', () => {
  const full = fs.readFileSync(path.join(__dirname, 'regression-translate.test.js'), 'utf8');
  const cut = full.indexOf("test('5.");
  assert.ok(cut > 0, '找不到自证条目起点，本条会退化成恒真');
  const src = full.slice(0, cut);
  assert.ok(!/['"]\.env['"]/.test(src), '还在读 .env → 又要拿真凭据连生产库了');
  assert.ok(!/authToken:\s*process\.env/.test(src), 'createClient 带真实 authToken → 会打到生产 Turso');
  assert.match(src, /TURSO_DATABASE_URL = 'file:'/, '子进程必须被指到本地文件库');
  assert.match(src, /local-test-secret/, 'AUTH_SECRET 必须本地自定，不为签 token 读生产凭据');
});
