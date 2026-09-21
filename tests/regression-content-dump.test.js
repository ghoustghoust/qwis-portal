// 内容级转储的回归锁（B103 / spec43 D3）。用户 09-21 整表放行后本批的第一条硬前置：
// **没有可核对的内容底牌，就不许跑任何"执行删除"的验证**。
// 为什么必须真跑（坑 #45/#58）：这条锁判的不是"文件里有没有某个字符串"，而是
// 「把库删空之后，能不能拿这份转储一字不差地放回来」——所以 D1 真的建库、真的转储、真的回放到另一个库。
// 负向样本（D2~D6）逐个把坏形态喂给判据：篡改字节、清单与分片脱钩、id 倒退、空转储、过期。
// 任一条"摘掉判据仍然绿"，这条锁就是假闸（坑 #64 规则②：新增门禁不套 F2P 改前红，改以突变对照出证）。
require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'tools', 'dump-content.cjs');
const cd = () => require('../lib/content-dump');

const ART_DDL = `CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER, title TEXT, url TEXT UNIQUE,
  author TEXT, cover TEXT, summary TEXT, content_html TEXT, published_at TEXT, read_at TEXT,
  later INTEGER DEFAULT 0, created_at TEXT, score INTEGER, reason TEXT, tags TEXT,
  featured INTEGER DEFAULT 0, original_html TEXT, original_url TEXT, category TEXT, word_count INTEGER,
  translated_title TEXT, translated_content TEXT, translation_provider TEXT)`;
const VID_DDL = `CREATE TABLE videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER, platform TEXT, title TEXT, url TEXT UNIQUE,
  vid TEXT, cover TEXT, duration INTEGER, author TEXT, intro TEXT, published_at TEXT,
  favorite INTEGER DEFAULT 0, created_at TEXT, play_uri TEXT, watched_at TEXT)`;

function makeSource(withRows = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdump-src-'));
  const file = path.join(dir, 'src.db');
  const db = new Database(file);
  db.exec(ART_DDL); db.exec(VID_DDL);
  if (withRows) {
    const ins = db.prepare(`INSERT INTO articles(id,source_id,title,url,content_html,published_at,read_at,later,featured,score,tags)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    ins.run(1, 10, '未读老文章', 'https://a/1', '<p>' + '正文'.repeat(2000) + '</p>', '2026-01-01T00:00:00.000Z', null, 0, 0, null, null);
    ins.run(2, 10, '已读文章', 'https://a/2', '<p>已读正文</p>', '2026-01-02T00:00:00.000Z', '2026-03-01T00:00:00.000Z', 0, 0, 42, '["AI"]');
    ins.run(3, 11, '带 NULL 的文章', 'https://a/3', null, null, null, 1, 1, 0, '');
    db.prepare(`INSERT INTO videos(id,source_id,platform,title,url,intro,published_at,watched_at)
      VALUES (9,'7','douyin','一条播客','https://v/9',null,'2026-01-03T00:00:00.000Z','null')`).run();
  }
  db.close();
  return file;
}

function makeTarget(missingColumn = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdump-dst-'));
  const file = path.join(dir, 'dst.db');
  const db = new Database(file);
  db.exec(ART_DDL);
  db.exec(missingColumn ? VID_DDL.replace('play_uri TEXT, ', '') : VID_DDL);
  db.close();
  return file;
}

function cli(args) {
  // 子进程必须清掉 NODE_TEST_CONTEXT，否则嵌套 node --test 会被静默跳过（本轮真正的判据全在这个子进程里）
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.TURSO_DATABASE_URL; delete env.TURSO_AUTH_TOKEN;
  try {
    return { out: execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env, cwd: ROOT }), code: 0 };
  } catch (e) {
    return { out: `${e.stdout || ''}${e.stderr || ''}`, code: e.status === undefined ? -1 : e.status };
  }
}

test('D1 端到端：真转储 → 真回放 → 逐字段一致（含 4000 字节正文与 NULL 两侧）', () => {
  const src = makeSource();
  const dst = makeTarget();
  const out = path.join(path.dirname(src), 'dump');
  const r1 = cli(['--scope', src, '--out', out, '--full', '--chunk-rows', '2']);
  assert.equal(r1.code, 0, `转储应当成功：${r1.out}`);
  const m = cd().readManifest(out);
  assert.equal(m.tables.articles.rows, 3, 'articles 行数与夹具不符');
  assert.equal(m.tables.videos.rows, 1);
  assert.equal(m.tables.articles.chunks.length, 2, 'chunk-rows=2 应切两片（分片游标没生效？）');

  // 把源库删空，模拟"清理误火"之后的现场
  const srcDb = new Database(src);
  const before = srcDb.prepare('SELECT * FROM articles ORDER BY id').all();
  srcDb.exec('DELETE FROM articles'); srcDb.exec('DELETE FROM videos');
  assert.equal(srcDb.prepare('SELECT COUNT(*) c FROM articles').get().c, 0, '夹具没删干净，这条锁就是空跑');

  const r2 = cli(['--scope', src, '--out', out, '--restore', '--into', dst]);
  assert.equal(r2.code, 0, `回放应当成功：${r2.out}`);
  const dstDb = new Database(dst);
  const after = dstDb.prepare('SELECT * FROM articles ORDER BY id').all();
  assert.equal(after.length, 3, '回放回来的行数不对');
  assert.deepEqual(after.map((r) => r.content_html), before.map((r) => r.content_html), '正文字节不一致（长文本被截断/换行被吞）');
  assert.deepEqual(after.map((r) => [r.id, r.title, r.read_at, r.later, r.featured, r.score, r.tags]),
    before.map((r) => [r.id, r.title, r.read_at, r.later, r.featured, r.score, r.tags]), '关键列不一致');
  assert.equal(dstDb.prepare('SELECT watched_at FROM videos WHERE id=9').get().watched_at, 'null',
    "字面串 'null' 必须原样回放——转储是底牌，不是订正工具（订正是 BL10 那一刀）");
  srcDb.close(); dstDb.close();
});

test('D2 分片被篡改 → 校验必须红且点名那个文件', () => {
  const src = makeSource();
  const out = path.join(path.dirname(src), 'dump');
  assert.equal(cli(['--scope', src, '--out', out, '--full']).code, 0);
  const m = cd().readManifest(out);
  const victim = m.tables.articles.chunks[0].file;
  const p = path.join(out, victim);
  fs.writeFileSync(p, Buffer.concat([fs.readFileSync(p), Buffer.from('x')]));
  const v = cd().verifyDump(out, {});
  assert.equal(v.ok, false, '篡改过的分片仍然"通过"＝这份转储是假底牌');
  assert.ok(v.reasons.some((r) => r.includes(victim) && /校验和/.test(r)), `原因里没点名被篡改的分片：${v.reasons.join(' | ')}`);
  assert.equal(cli(['--scope', src, '--out', out, '--verify']).code, 1, 'CLI --verify 对坏分片必须退 1');
});

test('D3 清单行数与分片求和脱钩 → 红（防"清单说备份了 3 万行、盘上只有 3 千行"）', () => {
  const src = makeSource();
  const out = path.join(path.dirname(src), 'dump');
  assert.equal(cli(['--scope', src, '--out', out, '--full']).code, 0);
  const m = cd().readManifest(out);
  m.tables.articles.rows += 1000;
  cd().writeManifest(out, m);
  const v = cd().verifyDump(out, {});
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => /行数/.test(r)), v.reasons.join(' | '));
});

test('D4 分片 id 区间倒退/重叠 → 红（增量拼接最怕把同一段写两遍）', () => {
  const src = makeSource();
  const out = path.join(path.dirname(src), 'dump');
  assert.equal(cli(['--scope', src, '--out', out, '--full', '--chunk-rows', '2']).code, 0);
  const m = cd().readManifest(out);
  const chunks = m.tables.articles.chunks;
  m.tables.articles.chunks = [chunks[1], chunks[0]]; // 交换顺序 → 第一段 idMax 大于第二段 idMin
  m.tables.articles.rows = chunks.reduce((a, c) => a + c.rows, 0);
  cd().writeManifest(out, m);
  const v = cd().verifyDump(out, {});
  assert.equal(v.ok, false, 'id 区间不递增竟然算通过');
  assert.ok(v.reasons.some((r) => /不递增|区间不符/.test(r)), v.reasons.join(' | '));
});

test('D5 空转储 / 缺清单 → 删除闸不许放行（"目录存在"不等于"有底牌"）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdump-empty-'));
  assert.equal(cd().deleteGate(dir, {}).allowed, false, '没有清单竟然放行删除');
  const src = makeSource(false); // 有表、0 行
  const out = path.join(path.dirname(src), 'dump');
  const r = cli(['--scope', src, '--out', out, '--full']);
  assert.notEqual(r.code, 0, '0 行的"转储"竟然退 0 —— 这正是坑 #41 说的把空跑读成成功');
  assert.ok(/没有任何分片|空转储|0 行/.test(r.out), `应当出声说明是 0 行，而不是静悄悄：${r.out}`);  // ⑥b 后空表在 dump 侧跳过并出声，文案换形态不换行为
  const g = cd().deleteGate(out, {});
  assert.equal(g.allowed, false, `0 行内容被判成"可删"：${g.reason}`);
});

test('D6 新鲜度上限是真判据（把 updatedAt 拨旧必须翻红）', () => {
  const src = makeSource();
  const out = path.join(path.dirname(src), 'dump');
  assert.equal(cli(['--scope', src, '--out', out, '--full']).code, 0);
  const m = cd().readManifest(out);
  const dayMs = 86400e3;
  m.updatedAt = new Date(Date.now() - 30 * dayMs).toISOString();
  cd().writeManifest(out, m);
  const stale = cd().deleteGate(out, { maxAgeHours: 24 });
  assert.equal(stale.allowed, false, `30 天前的转储仍然通过 24h 新鲜度闸：${stale.reason}`);
  assert.ok(/过期/.test(stale.reason), stale.reason);
  m.updatedAt = new Date(Date.now() - 2 * 3600e3).toISOString();
  cd().writeManifest(out, m);
  assert.equal(cd().deleteGate(out, { maxAgeHours: 24 }).allowed, true, '新鲜且校验通过的转储应当放行');
});

test('D7 SQL 片段只认显式列名与合法标识符（防"SELECT *"式隐式列序）', () => {
  const r = cd();
  assert.throws(() => r.keysetSql('articles', [], 0, 100), /列清单为空/);
  assert.throws(() => r.keysetSql('art; DROP TABLE articles', ['id'], 0, 100), /合法标识符/);
  assert.throws(() => r.keysetSql('articles', ['id', 'title;--'], 0, 100), /合法标识符/);
  assert.throws(() => r.keysetSql('articles', ['id'], 0, 0), /分片行数/);
  const q = r.keysetSql('articles', ['id', 'title'], 42, 500);
  assert.equal(q.sql, 'SELECT id, title FROM articles WHERE id > ? ORDER BY id ASC LIMIT 500');
  assert.deepEqual(q.args, [42], '游标必须是参数，不是字符串拼接');
  assert.match(r.restoreSql('videos', ['id', 'title']), /^INSERT OR REPLACE INTO videos \(id, title\) VALUES \(\?, \?\)$/);
});

test('D8 回放目标的三条拒签：缺列 / 没表 / 目标是云端串', () => {
  const src = makeSource();
  const out = path.join(path.dirname(src), 'dump');
  assert.equal(cli(['--scope', src, '--out', out, '--full']).code, 0);
  const missing = makeTarget(true);
  const r1 = cli(['--scope', src, '--out', out, '--restore', '--into', missing]);
  assert.notEqual(r1.code, 0);
  assert.ok(/缺列/.test(r1.out), `缺列应当拒绝而不是把数据插错位：${r1.out}`);

  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdump-notable-'));
  const noTable = path.join(emptyDir, 'bare.db');
  new Database(noTable).close();
  const r2 = cli(['--scope', src, '--out', out, '--restore', '--into', noTable]);
  assert.notEqual(r2.code, 0);
  assert.ok(/没有 videos 表/.test(r2.out) || /没有 articles 表/.test(r2.out), `目标缺表应当直接拒：${r2.out}`);

  const r3 = cli(['--scope', src, '--out', out, '--restore', '--into', 'data/turso-mirror.db']);
  assert.notEqual(r3.code, 0, '名字里带 turso 的目标竟然接受');
});

test('D9 转储表白名单就是内容表，配置表另有 /api/backup（不重复一份事实源）', () => {
  assert.deepEqual(cd().DUMP_TABLES, ['articles', 'videos', 'articles_archive']);  // B132：归档表同属「删了就回不来」的内容表
  const src = makeSource();
  const out = path.join(path.dirname(src), 'dump');
  assert.equal(cli(['--scope', src, '--out', out, '--full']).code, 0);
  assert.deepEqual(Object.keys(cd().readManifest(out).tables).sort(), ['articles', 'videos']);
});

test('D10 清单必须带建表语句；--mktarget 用源库形状建回放场（本地 schema 少列时仍能证明"回得来"= B131）', () => {
  const src = makeSource();
  const out = path.join(path.dirname(src), 'dump');
  assert.equal(cli(['--scope', src, '--out', out, '--full']).code, 0);
  const m = cd().readManifest(out);
  for (const t of Object.keys(m.tables)) {
    assert.ok(m.tables[t].ddl && /CREATE TABLE/i.test(m.tables[t].ddl), `${t} 的清单没带建表语句 —— 回放场无从建立`);
  }
  const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdump-bare-'));
  const bare = path.join(bareDir, 'bare.db');
  new Database(bare).close();
  assert.equal(cli(['--scope', src, '--out', out, '--restore', '--mktarget', '--into', bare]).code, 0,
    '带 --mktarget 的空库应当能建表并回放');
  const db = new Database(bare, { readonly: true });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM articles').get().c, 3);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM videos').get().c, 1);
  // 同一条 DDL 建出来的表必须能装下全部列（反证：不是靠"少插几列"混过去的）
  assert.deepEqual(db.prepare(`SELECT name FROM pragma_table_info('articles')`).all().map((r) => r.name), m.tables.articles.columns);
  db.close();
});
