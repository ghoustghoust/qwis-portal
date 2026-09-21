// B132（P0-4）：archive-articles 收编——谓词走 lib/retention 同一份、归档表 DDL 取自建表源、
// 先过删除闸、articles_archive 进转储面
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
const RT = () => require('../lib/retention');
const CD = () => require('../lib/content-dump');

const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), tag));
const fileUrl = (dir) => 'file:' + path.join(dir, 't.db').replace(/\\/g, '/');

function runTool(env, args = []) {
  const e = { ...process.env, ...env };
  delete e.NODE_TEST_CONTEXT;
  try {
    return { out: execFileSync(process.execPath, [path.join(ROOT, 'tools', 'archive-articles.js'), ...args],
      { cwd: ROOT, encoding: 'utf8', env: e, timeout: 120000 }), code: 0 };
  } catch (err) {
    return { out: `${err.stdout || ''}\n${err.stderr || ''}`, code: err.status === undefined ? -1 : err.status };
  }
}

// 造库：settings + articles（含 translated_* 与三种豁免形态）+ 1 条窗口内新文章
async function seedDb(url) {
  const db = createClient({ url });
  await db.execute('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)');
  await db.execute(`CREATE TABLE articles(id INTEGER PRIMARY KEY, source_id INTEGER, title TEXT, url TEXT,
    published_at TEXT, created_at TEXT, read_at TEXT, later INTEGER DEFAULT 0, featured INTEGER DEFAULT 0,
    translated_title TEXT, translated_content TEXT, translation_provider TEXT)`);
  const OLD = '2020-01-01T00:00:00.000Z';
  const NEW = new Date().toISOString();
  const ins = (a) => db.execute({
    sql: `INSERT INTO articles(id,source_id,title,url,published_at,created_at,read_at,later,featured,translated_title,translation_provider)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    args: a,
  });
  await ins([1, 2, '老未读', 'u1', OLD, OLD, null, 0, 0, '译文标题', 'agnes']); // 该搬（且译文必须跟着走）
  await ins([2, 2, '老已读', 'u2', OLD, OLD, NEW, 0, 0, null, null]);           // 豁免：已读
  await ins([3, 2, '老稍后读', 'u3', OLD, OLD, null, 1, 0, null, null]);          // 豁免：稍后读
  await ins([4, 2, '老精选', 'u4', OLD, OLD, null, 0, 1, null, null]);            // 豁免：精选（旧版工具漏这条，B132）
  await ins([5, 2, '新未读', 'u5', NEW, NEW, null, 0, 0, null, null]);            // 窗口内
  await db.close();
}

test('AR1 谓词与 lib/retention 同一份（源码级）：工具不再自带手写豁免条件（B132）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'archive-articles.js'), 'utf8');
  assert.ok(src.includes("require('../lib/retention')"), '没引 lib/retention');
  assert.ok(src.includes('ARTICLE_DELETE_COND'), '没用 ARTICLE_DELETE_COND（featured 豁免就是这么丢的）');
  assert.ok(!/WHERE\s+published_at\s*<\s*\?\s+AND\s+read_at/.test(src), '仍存手写谓词（旧形状）');
});

test('AR2 闸挡下：无转储且无凭证 → 一条不搬、退非 0、出声（B132/⑥b）', async () => {
  const dir = tmp('ar2-');
  try {
    const url = fileUrl(dir);
    await seedDb(url);
    const r = runTool({ TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: '', CONTENT_DUMP_DIR: path.join(dir, 'no-dump') }, ['--days=90']);
    assert.notEqual(r.code, 0, '无凭证竟然放行：' + r.out.slice(-300));
    assert.match(r.out, /删除闸挡下/, '被挡必须出声：' + r.out.slice(-300));
    const db = createClient({ url });
    const n = Number(Array.from((await db.execute('SELECT COUNT(*) c FROM articles')).rows)[0].c);
    assert.equal(n, 5, '被挡的一轮里主表少行了');
    await db.close();
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows 句柄 */ } }
});

test('AR3 凭证放行：该搬的搬、豁免的一条不动、译文列跟着走（B132 核心行为）', async () => {
  const dir = tmp('ar3-');
  try {
    const url = fileUrl(dir);
    await seedDb(url);
    // 凭证（形态与 dump-content 写入的相同）
    const db0 = createClient({ url });
    const cred = CD().credentialFromManifest({ updatedAt: new Date().toISOString(), scope: 'cloud',
      tables: { articles: { rows: 5, maxId: 5, bytes: 1, chunks: [{}] }, videos: { rows: 1, maxId: 1, bytes: 1, chunks: [{}] } } });
    await db0.execute({ sql: 'INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', args: [CD().CREDENTIAL_KEY, JSON.stringify(cred)] });
    await db0.close();
    const r = runTool({ TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: '', CONTENT_DUMP_DIR: path.join(dir, 'no-dump') }, ['--days=90']);
    assert.equal(r.code, 0, r.out.slice(-400));
    assert.match(r.out, /放行（credential）/, '放行没走凭证腿：' + r.out.slice(-300));
    const db = createClient({ url });
    const main = (await db.execute('SELECT title FROM articles ORDER BY id')).rows.map((x) => x.title);
    assert.deepEqual(main, ['老已读', '老稍后读', '老精选', '新未读'], `豁免/窗口内的行被动了：${JSON.stringify(main)}`);
    const arch = (await db.execute('SELECT title, translated_title, translation_provider FROM articles_archive')).rows;
    assert.equal(arch.length, 1, '归档表应只有那 1 条');
    assert.equal(arch[0].translated_title, '译文标题', '译文列在搬家中丢了（旧版内嵌 DDL 缺列就会这样）');
    await db.close();
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows 句柄 */ } }
});

test('AR4 归档表 DDL 取自建表源：lib/db.js SCHEMA 里的 articles_archive 必须带 translated_*（B132 防漂移）', () => {
  const { createSqlOf } = require('../lib/schema-columns');
  const ddl = createSqlOf(ROOT, 'lib/db.js', 'articles_archive');
  assert.ok(ddl, 'SCHEMA 里没有 articles_archive');
  for (const c of ['translated_title', 'translated_content', 'translation_provider']) {
    assert.ok(ddl.includes(c), `归档表 DDL 缺 ${c}`);
  }
});

test('AR5 articles_archive 进转储面，且源库没有它时 dump 跳过而不是报错（B132）', () => {
  assert.ok(CD().DUMP_TABLES.includes('articles_archive'), 'DUMP_TABLES 没收 articles_archive');
  // dump 跳过逻辑：0 行表出声跳过、全空抛错——D5 已在 regression-content-dump 钉住，这里钉「缺表不炸」
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'dump-content.cjs'), 'utf8');
  assert.match(src, /在源库不存在，跳过/, 'dump 没有缺表跳过分支');
});
