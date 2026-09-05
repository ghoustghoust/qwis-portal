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

test('cleanup: preview 与 cleanup 计数一致，只动内容四表，源/设置不动', () => {
  seed();
  const preview = datamgr.previewCleanup(30);
  assert.deepEqual(preview.willDelete, { articles: 2, videos: 1, pending_items: 1, daily_reports: 1 });
  assert.equal(preview.total, 5);

  const r = datamgr.cleanup(30);
  assert.deepEqual(r.deleted, preview.willDelete);
  assert.equal(r.total, preview.total);
  // 新内容保留
  assert.equal(db.prepare('SELECT COUNT(*) c FROM articles').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM videos').get().c, 1);
  assert.equal(db.prepare("SELECT title FROM articles").get().title, '新文章');
  // 源不受影响
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sources').get().c, 1);
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
  assert.equal(r.restored.articles, 1);
  assert.equal(r.restored.sources, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM articles').get().c, 1);
  assert.equal(db.prepare('SELECT later FROM articles WHERE title=?').get('新文章').later, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM videos').get().c, 1);
  assert.equal(db.prepare('SELECT name FROM sources').get().name, '测试源');
});

test('restore: 非法文件名/不存在的快照报错', () => {
  assert.throws(() => datamgr.restore('../app.db'), /非法快照文件名/);
  assert.throws(() => datamgr.restore('app-20990101-000000.db'), /快照不存在/);
});

test('stats: 返回体积与八表条数', () => {
  const s = datamgr.stats();
  assert.ok(s.sizeBytes > 0);
  assert.equal(s.tables.articles, 1);
  assert.equal(s.tables.sources, 1);
  assert.equal(typeof s.tables.settings, 'number');
});

test('cleanup: 非法天数报错', () => {
  assert.throws(() => datamgr.previewCleanup(0), /正数/);
  assert.throws(() => datamgr.cleanup(-5), /正数/);
});
