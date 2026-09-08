// 2026-09-05 视觉精修数据契约回归
// 覆盖:UI-D1 文章列表字段(tags/score/reason/word_count) / UI-D2 status overview 统计轨契约
require('./helpers');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { cleanup } = require('./helpers');
const { db } = require('../server/db');
const express = require('express');

after(() => cleanup());

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/articles', require('../server/routes/articles'));
  app.use('/api/status', require('../server/routes/status'));
  return app;
}

async function withServer(app, fn) {
  const srv = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
}

function seedArticle() {
  const sid = db.prepare(
    "INSERT INTO sources(type,name,url,enabled,created_at) VALUES('rss','测试源','https://example.com/feed',1,?)"
  ).run(new Date().toISOString()).lastInsertRowid;
  const { textLen } = require('../server/services/collectors/repo');
  const content = '<p>正文</p>'.repeat(50);
  db.prepare(
    `INSERT INTO articles(source_id,title,url,summary,content_html,published_at,created_at,score,tags,reason,word_count)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    sid, '契约测试标题', 'https://example.com/a1', '摘要',
    content, new Date().toISOString(), new Date().toISOString(),
    85, '["人工智能","模型发布"]', '推荐理由文本', textLen(content)
  );
  return sid;
}

test('UI-D1: GET /api/articles 列表条目带 tags/score/reason/word_count', async () => {
  seedArticle();
  await withServer(makeApp(), async (base) => {
    const r = await fetch(`${base}/api/articles`);
    assert.equal(r.status, 200);
    const data = await r.json();
    const it = (data.items || []).find((x) => x.title === '契约测试标题');
    assert.ok(it, '应能找到种子文章');
    assert.equal(it.score, 85);
    assert.ok(String(it.tags).includes('人工智能'), 'tags 应原样下发');
    assert.equal(it.reason, '推荐理由文本');
    assert.ok(it.word_count > 0, 'word_count 应为正数（纯文本字数，非 HTML 长度）');
    // word_count 应远小于 content_html 的 LENGTH（剥掉了标签与内联样式）
    const raw = db.prepare('SELECT LENGTH(content_html) l FROM articles WHERE id=?').get(it.id).l;
    assert.ok(it.word_count < raw, 'word_count 应小于 HTML 源码长度');
  });
});

test('UI-D2: GET /api/status 带 overview(统计轨契约)', async () => {
  await withServer(makeApp(), async (base) => {
    const r = await fetch(`${base}/api/status`);
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.ok(data.overview, '应有 overview 字段');
    const o = data.overview;
    for (const k of ['enabledSources', 'todayNew', 'weekNew', 'dailyItemCount']) {
      assert.equal(typeof o[k], 'number', `overview.${k} 应为数字`);
    }
    assert.ok(Array.isArray(o.dailyTopSources), 'dailyTopSources 应为数组');
    assert.ok(o.enabledSources >= 1, '至少有种子源');
  });
});

test('UI-D3: overview.dailyTopSources 统计最新日报条目来源 Top5', async () => {
  const sections = [
    { key: 'ai', items: [
      { source_name: '来源甲' }, { source_name: '来源甲' }, { source_name: '来源乙' },
    ] },
    { key: 'pocoon', items: [{ source_name: '3 源' }] }, // 合成条目应被跳过
  ];
  db.prepare('INSERT INTO daily_reports(generated_at,window_hours,stats,sections) VALUES(?,?,?,?)')
    .run(new Date().toISOString(), 24, '{}', JSON.stringify(sections));
  await withServer(makeApp(), async (base) => {
    const data = await (await fetch(`${base}/api/status`)).json();
    const o = data.overview;
    assert.equal(o.dailyItemCount, 4);
    assert.deepEqual(o.dailyTopSources[0], { name: '来源甲', count: 2 });
    assert.deepEqual(o.dailyTopSources[1], { name: '来源乙', count: 1 });
    assert.equal(o.dailyTopSources.length, 2, '合成「N 源」条目不计入');
  });
});

// ─── 阅读器降噪（热榜/聚合源不进文章流）───
function seedNoise() {
  const now = new Date().toISOString();
  const hid = db.prepare(
    "INSERT INTO sources(type,name,url,enabled,created_at) VALUES('hotlist','微博热搜T','hotlist://weibo',1,?)"
  ).run(now).lastInsertRowid;
  db.prepare("INSERT INTO articles(source_id,title,url,published_at,created_at) VALUES(?,?,?,?,?)")
    .run(hid, '热榜噪音条目', 'https://hot.example.com/1', now, now);
  const aid = db.prepare(
    "INSERT INTO sources(type,name,url,enabled,extra,created_at) VALUES('rss','AIHOT聚合T','https://aihot.example.com',1,?,?)"
  ).run('{"aggregator":1}', now).lastInsertRowid;
  db.prepare("INSERT INTO articles(source_id,title,url,published_at,created_at) VALUES(?,?,?,?,?)")
    .run(aid, '聚合噪音条目', 'https://aihot.example.com/1', now, now);
}

test('UI-D4: 列表默认排除 hotlist/聚合源，include_hot=1 豁免', async () => {
  seedNoise();
  await withServer(makeApp(), async (base) => {
    const data = await (await fetch(`${base}/api/articles`)).json();
    const titles = (data.items || []).map((x) => x.title);
    assert.ok(!titles.includes('热榜噪音条目'), '热榜条目不应出现在默认列表');
    assert.ok(!titles.includes('聚合噪音条目'), '聚合源条目不应出现在默认列表');
    const inc = await (await fetch(`${base}/api/articles?include_hot=1`)).json();
    const t2 = (inc.items || []).map((x) => x.title);
    assert.ok(t2.includes('热榜噪音条目') && t2.includes('聚合噪音条目'), 'include_hot=1 应包含噪音源');
    const bySource = await (await fetch(`${base}/api/articles?source_id=2`)).json(); // 占位防误用
    assert.ok(bySource.ok);
  });
});

test('UI-D5: overview 统计排除 hotlist/聚合源噪音', async () => {
  await withServer(makeApp(), async (base) => {
    const data = await (await fetch(`${base}/api/status`)).json();
    const o = data.overview;
    // 种子噪音源的今日新增/启用源数不应被计入
    const noiseEnabled = db.prepare("SELECT COUNT(*) c FROM sources WHERE enabled=1 AND type='hotlist'").get().c;
    assert.ok(noiseEnabled >= 1, '前提：存在 hotlist 种子源');
    assert.ok(!o.dailyTopSources.some((s) => s.name === '微博热搜T'), '来源榜不含热榜源');
    // enabledSources 应小于启用总数（排除了噪音源）
    const total = db.prepare('SELECT COUNT(*) c FROM sources WHERE enabled=1').get().c;
    assert.ok(o.enabledSources < total, 'enabledSources 应排除 hotlist/聚合源');
    assert.equal(typeof o.unreadArticles, 'number');
  });
});

test('UI-D6: firstImg 解码 cover URL 里的 &amp; 实体（封面防盗链代理参数不被破坏）', () => {
  const { _internals } = require('../server/services/collectors/rss');
  const html = '<p>x</p><img src="https://wechat2rss.bestblogs.dev/img-proxy/?k=abc&amp;u=https%3A%2F%2Fmmbiz.qpic.cn%2Fx.jpg">';
  const cover = _internals.firstImg(html);
  assert.equal(cover, 'https://wechat2rss.bestblogs.dev/img-proxy/?k=abc&u=https%3A%2F%2Fmmbiz.qpic.cn%2Fx.jpg');
  // 追踪像素仍被跳过
  const px = _internals.firstImg('<img src="https://facebook.com/tr?id=1"><img src="https://ok.example.com/a.jpg">');
  assert.equal(px, 'https://ok.example.com/a.jpg');
});

test('UI-D7: /api/reading 的 counts.all = 已读+稍后读并集，不是全库文章数', async () => {
  // 种子：1 篇已读、1 篇稍后读、1 篇未读未稍后（不应计入）
  const now = new Date().toISOString();
  const sid = db.prepare("INSERT INTO sources(type,name,url,enabled,created_at) VALUES('rss','阅读计数源','https://r.example.com/f',1,?)").run(now).lastInsertRowid;
  const ins = db.prepare('INSERT INTO articles(source_id,title,url,read_at,later,created_at) VALUES(?,?,?,?,?,?)');
  ins.run(sid, 'R-已读', 'https://r.example.com/1', now, 0, now);
  ins.run(sid, 'R-稍后读', 'https://r.example.com/2', null, 1, now);
  ins.run(sid, 'R-未读', 'https://r.example.com/3', null, 0, now);

  const app = express();
  app.use('/api/reading', require('../server/routes/reading'));
  await withServer(app, async (base) => {
    const data = await (await fetch(`${base}/api/reading?tab=all`)).json();
    const c = data.counts;
    // 库里还有其他测试种的文章（契约测试标题等均未读未稍后），全部不计
    const expect = db.prepare("SELECT COUNT(*) c FROM articles WHERE read_at IS NOT NULL OR later=1").get().c;
    assert.equal(c.all, expect, 'counts.all 必须等于已读+稍后读并集');
    assert.ok(c.all >= 2 && c.read >= 1 && c.favorited >= 1);
    // 列表条目同样不含未读未稍后的
    const titles = (data.items || []).map((x) => x.title);
    assert.ok(titles.includes('R-已读') && titles.includes('R-稍后读') && !titles.includes('R-未读'));
  });
});
