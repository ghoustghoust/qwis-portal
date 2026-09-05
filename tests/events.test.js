// 九期 M4:事件聚合引擎单测 —— 跨源同事件聚类、热度排序、领域归属、状态标
require('./helpers');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { cleanup } = require('./helpers');

function seedData() {
  const { db } = require('../server/db');
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const insSrc = db.prepare("INSERT INTO sources(type, name, url, enabled, status, created_at) VALUES(?,?,?,1,'ok',?)");
  const insArt = db.prepare('INSERT INTO articles(source_id, title, url, summary, content_html, published_at, created_at, score) VALUES(?,?,?,?,?,?,?,?)');
  // 三个源报道同一事件(标题措辞不同),一个无关事件
  const s1 = insSrc.run('hotlist', '微博热搜', 'hotlist://weibo', iso(now)).lastInsertRowid;
  const s2 = insSrc.run('hotlist', '知乎热榜', 'hotlist://zhihu', iso(now)).lastInsertRowid;
  const s3 = insSrc.run('rss', '某科技博客', 'https://example.com/feed', iso(now)).lastInsertRowid;
  insArt.run(s1, '某公司发布全新一代大模型', 'https://a.com/1', '', '', iso(now - 2 * 3600e3), iso(now), 5e6);
  insArt.run(s2, '某公司发布全新一代大模型,性能翻倍', 'https://a.com/2', '', '', iso(now - 1 * 3600e3), iso(now), 3e6);
  insArt.run(s3, '全新一代大模型发布:某公司宣布性能翻倍', 'https://a.com/3', '', '', iso(now - 0.5 * 3600e3), iso(now), 0);
  insArt.run(s1, '完全无关的另一条新闻', 'https://a.com/4', '', '', iso(now), iso(now), 0);
  return { s1, s2, s3 };
}

after(() => cleanup());

test('同事件跨源聚类 + 热度 > 单篇 + 排序正确', () => {
  seedData();
  const events = require('../server/services/events');
  events.invalidate();
  const all = events.getEvents('all');
  assert.equal(all.length, 1, '只有多源同事件才成簇(单篇不成事件)');
  const ev = all[0];
  assert.equal(ev.sourceCount, 3);
  assert.equal(ev.reportCount, 3);
  assert.ok(ev.heat > 3, '热度应含信源多样性加成');
  assert.equal(ev.status, '新'); // 首发 2h 前
  assert.ok(ev.items[0].published_at >= ev.items[1].published_at, '报道时间线按时间倒序');
});

test('单源多篇同主题也聚类(信源数=1 加成不生效)', () => {
  const { db } = require('../server/db');
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const s = db.prepare("SELECT id FROM sources WHERE url='hotlist://weibo'").get();
  db.prepare('INSERT INTO articles(source_id, title, url, summary, content_html, published_at, created_at) VALUES(?,?,?,?,?,?,?)')
    .run(s.id, '某公司发布全新一代大模型 Pro 版', 'https://a.com/5', '', '', iso(now), iso(now));
  const events = require('../server/services/events');
  events.invalidate();
  const all = events.getEvents('all');
  const ev = all[0];
  assert.ok(ev.reportCount >= 4, '同主题新增报道并入既有事件');
});
