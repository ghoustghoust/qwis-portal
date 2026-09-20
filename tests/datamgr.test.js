// T8 - 数据管理单测（七期 F6）：快照/恢复/清理预览/清理执行
// 全部使用独立临时 DB（tests/helpers.js），不触碰 data/app.db
require('./helpers');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { cleanup: cleanupTmp, DATA_DIR } = require('./helpers');

const { db } = require('../server/db');
const datamgr = require('../server/services/datamgr');

after(cleanupTmp);

function seed() {
  const now = Date.now();
  const iso = (daysAgo) => new Date(now - daysAgo * 86400e3).toISOString();
  const srcId = db.prepare("INSERT INTO sources(type,name,url,enabled,status,created_at) VALUES('rss','测试源','https://a.example.com/feed',1,'ok',?)").run(iso(0)).lastInsertRowid;
  const insA = db.prepare('INSERT INTO articles(source_id,title,url,published_at,created_at) VALUES(?,?,?,?,?)');
  insA.run(srcId, '新文章', 'https://a.example.com/new', iso(1), iso(1));   // 保留
  insA.run(srcId, '老文章1', 'https://a.example.com/old1', iso(40), iso(40)); // 删
  insA.run(srcId, '老文章2', 'https://a.example.com/old2', iso(50), iso(50)); // 删
  const insV = db.prepare("INSERT INTO videos(source_id,platform,title,url,published_at,created_at) VALUES(?,'bilibili',?,?,?,?)");
  insV.run(srcId, '新视频', 'https://v.example.com/new', iso(2), iso(2));   // 保留
  insV.run(srcId, '老视频', 'https://v.example.com/old', iso(60), iso(60));  // 删
  db.prepare("INSERT INTO pending_items(type,url,name,status,imported_at) VALUES('rss','https://p.example.com/old','老待导入','failed',?)").run(iso(45)); // 删
  db.prepare('INSERT INTO daily_reports(generated_at,window_hours,stats,sections) VALUES(?,24,\'{}\',\'[]\')').run(iso(50)); // 删
  return { srcId };
}

test('cleanup: 本地只清队列与日报，文章/视频一律不动（B102 收口，用户 09-20 定"本地不删内容"）', () => {
  seed();
  const preview = datamgr.previewCleanup(30);
  // 旧版这里是 { articles: 2, videos: 1, ... } —— 那正是事故本身：本地库每 24h 会自我清空内容。
  // 谓词的唯一实现在 lib/retention.js 的 local 作用域，articles/videos 都是 skip（跳过必须带理由）。
  assert.deepEqual(preview.willDelete, { articles: 0, videos: 0, pending_items: 1, daily_reports: 1 });
  assert.equal(preview.total, 2);
  assert.equal(preview.skipped.articles.includes('灾备'), true, '跳过 articles 的理由没写出来 = 下轮会被当成漏接');
  assert.ok(preview.skipped.videos);

  const r = datamgr.cleanup(30);
  assert.deepEqual(r.deleted, preview.willDelete);
  assert.equal(r.total, preview.total);
  // 内容一行不少（老文章也留着 —— 它是灾备副本）
  assert.equal(db.prepare('SELECT COUNT(*) c FROM articles').get().c, 3);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM videos').get().c, 2);
  assert.ok(db.prepare('SELECT title FROM articles WHERE title=?').get('老文章1'), '老文章被删了 = B102 复发');
  // 队列与本地产物照旧清掉
  assert.equal(db.prepare('SELECT COUNT(*) c FROM pending_items').get().c, 0);
  // 源不受影响
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sources').get().c, 1);
});

test('cleanup: 保留天数不许是 0/负数（防"清空全库"被当成配置）', () => {
  assert.throws(() => datamgr.cleanup(0), /正数/);
  assert.throws(() => datamgr.cleanup(-7), /正数/);
});

test('snapshot/restore: 快照→删数据→恢复→数据完整回来（八表同事务清插）', async () => {
  // 当前状态：seed 后 cleanup 过，剩 1 源 1 文 1 视频；再补一条稍后读标记验证字段保真
  db.prepare('UPDATE articles SET later=1 WHERE title=?').run('新文章');
  const snap = await datamgr.snapshot();
  assert.ok(/^app-.*\.db$/.test(snap.file));
  assert.ok(snap.sizeBytes > 0);
  assert.ok(fs.existsSync(path.join(DATA_DIR, 'backups', snap.file)));

  // 列表能查到
  const backups = datamgr.list();
  assert.ok(backups.some((b) => b.file === snap.file));

  // 删掉所有内容 + 改设置，模拟数据丢失
  db.prepare('DELETE FROM articles').run();
  db.prepare('DELETE FROM videos').run();
  db.prepare('DELETE FROM sources').run();
  assert.equal(db.prepare('SELECT COUNT(*) c FROM articles').get().c, 0);

  // 恢复
  const r = datamgr.restore(snap.file);
  // 快照里有 3 篇文章、2 条视频 —— cleanup 已不再动内容表（B102），所以这里的数与 seed 一致
  assert.equal(r.restored.articles, 3);
  assert.equal(r.restored.sources, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM articles').get().c, 3);
  assert.equal(db.prepare('SELECT later FROM articles WHERE title=?').get('新文章').later, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM videos').get().c, 2);
  assert.equal(db.prepare('SELECT name FROM sources').get().name, '测试源');
});

test('restore: 非法文件名/不存在的快照报错', () => {
  assert.throws(() => datamgr.restore('../app.db'), /非法快照文件名/);
  assert.throws(() => datamgr.restore('app-20990101-000000.db'), /快照不存在/);
});

test('stats: 返回体积与八表条数', () => {
  const s = datamgr.stats();
  assert.ok(s.sizeBytes > 0);
  // 与真实行数对账，不写死数字：B102 之后本地清理不再动内容表，写死的条数第二天就会假红/假绿
  assert.equal(s.tables.articles, db.prepare('SELECT COUNT(*) c FROM articles').get().c);
  assert.equal(s.tables.articles, 3, '样本前提：seed 的 3 篇文章都还在（本地不删内容）');
  assert.equal(s.tables.sources, 1);
  assert.equal(typeof s.tables.settings, 'number');
});

test('cleanup: 非法天数报错', () => {
  assert.throws(() => datamgr.previewCleanup(0), /正数/);
  assert.throws(() => datamgr.cleanup(-5), /正数/);
});
