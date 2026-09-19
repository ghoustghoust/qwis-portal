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
  const addr = srv.address();
  // 整串跑（npm test）时偶发过一次 fetch "bad port"：那时 addr 为 null，
  // base 变成 http://127.0.0.1:undefined。单跑该文件永远复现不出来 → 属于夹具问题，
  // 所以这里显式断言拿到端口，宁可红在夹具也不要红在无关断言上（分类：fail_flaky）。
  if (!addr || typeof addr === 'string' || !Number.isFinite(addr.port) || addr.port <= 0) {
    await new Promise((r) => srv.close(r));
    throw new Error(`withServer 没拿到有效端口（address=${JSON.stringify(addr)}）`);
  }
  const base = `http://127.0.0.1:${addr.port}`;
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
    for (const k of ['enabledSources', 'todayNew', 'weekNew']) {
      assert.equal(typeof o[k], 'number', `overview.${k} 应为数字`);
    }
    // B26：入报统计已移出首屏，两端同一契约——留一条"不许回到首屏"的反向断言，
    // 否则日后有人图省事把它塞回 /api/status，本地测不出、只有线上会慢
    assert.ok(!('dailyItemCount' in o) && !('dailyTopSources' in o),
      '首屏 status 又带上了重统计字段（应只在 /api/status/daily-sources）');
    assert.ok(o.enabledSources >= 1, '至少有种子源');
  });
});

test('UI-D3: overview.dailyTopSources 统计近 7 天日报条目的来源 Top5（带头像）', async () => {
  const sections = [
    { key: 'ai', items: [
      { source_name: '来源甲' }, { source_name: '来源甲' }, { source_name: '来源乙' },
    ] },
    { key: 'pocoon', items: [{ source_name: '3 源' }] }, // 合成条目应被跳过
  ];
  // B26：本地端来源榜现在与云端同口径（近 7 天窗口 + 按名字补头像），
  // 所以除了"计数对不对"，还要正向证明"头像取得到"——否则 avatar 永远是 null 也没人发现。
  db.prepare("INSERT INTO sources(type,name,url,enabled,avatar,created_at) VALUES('rss','来源甲','https://a.example/rss',1,?,?)")
    .run('https://cdn.example/a.png', new Date().toISOString());
  db.prepare('INSERT INTO daily_reports(generated_at,window_hours,stats,sections) VALUES(?,?,?,?)')
    .run(new Date().toISOString(), 24, '{}', JSON.stringify(sections));
  // 窗口外（8 天前）的一期不得计入：钉的是"近 7 天"这句话，不是"最新一期"（本地旧实现就是后者）
  db.prepare('INSERT INTO daily_reports(generated_at,window_hours,stats,sections) VALUES(?,?,?,?)')
    .run(new Date(Date.now() - 8 * 86400e3).toISOString(), 24, '{}',
      JSON.stringify([{ key: 'ai', items: [{ source_name: '窗口外来源' }] }]));

  await withServer(makeApp(), async (base) => {
    // B26：来源榜现在只在 GET /api/status/daily-sources 上提供（首屏不含），本用例钉这份契约
    const r = await fetch(`${base}/api/status/daily-sources`);
    assert.equal(r.status, 200);
    const o = (await r.json()).overview;

    assert.equal(o.dailyItemCount, 4, '窗口外的期不得计入');
    assert.equal(o.dailyTopSources[0].name, '来源甲');
    assert.equal(o.dailyTopSources[0].count, 2);
    assert.equal(o.dailyTopSources[0].avatar, 'https://cdn.example/a.png', '来源榜要带头像（统计轨渲染头像）');
    assert.equal(o.dailyTopSources[1].name, '来源乙');
    assert.equal(o.dailyTopSources[1].avatar, null, '无头像源显式 null，不能缺字段');
    assert.ok(!o.dailyTopSources.some((t) => t.name === '窗口外来源'), '8 天前那期不得进榜');
    assert.equal(o.dailyTopSources.length, 2, '合成「N 源」条目不计入');
  });
  // 首屏必须不再带这份统计；带上了就是 B26 的拆分被回退（与 UI-D2 的反向断言成对）
  await withServer(makeApp(), async (base) => {
    const light = (await (await fetch(`${base}/api/status`)).json()).overview;
    assert.ok(!('dailyItemCount' in light) && !('dailyTopSources' in light), '重统计又回到首屏');
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

test('UI-D5: 噪音排除同时作用于轻统计与来源榜', async () => {
  // B26 后来源榜搬到了 /api/status/daily-sources，本用例跟着拆成两段：
  // 前半钉首屏(enabledSources/unread 排噪音)，后半钉来源榜(热榜/聚合源名不得进 Top)。
  // 种一期"含热榜源名"的日报，否则"来源榜不含热榜"这条断言永远空跑（坑 #41 同族：假绿锁）。
  const seedAt = new Date().toISOString();
  db.prepare('INSERT INTO daily_reports(generated_at,window_hours,stats,sections) VALUES(?,?,?,?)')
    .run(seedAt, 24, '{}', JSON.stringify([
      { key: 'ai', items: [{ source_name: '微博热搜T' }, { source_name: 'AIHOT聚合T' }, { source_name: '正常来源' }] },
    ]));
  await withServer(makeApp(), async (base) => {
    const data = await (await fetch(`${base}/api/status`)).json();
    const o = data.overview;
    const noiseEnabled = db.prepare("SELECT COUNT(*) c FROM sources WHERE enabled=1 AND type='hotlist'").get().c;
    assert.ok(noiseEnabled >= 1, '前提：存在 hotlist 种子源');
    // enabledSources 应小于启用总数（排除了噪音源）
    const total = db.prepare('SELECT COUNT(*) c FROM sources WHERE enabled=1').get().c;
    assert.ok(o.enabledSources < total, 'enabledSources 应排除 hotlist/聚合源');
    assert.equal(typeof o.unreadArticles, 'number');
    // 未读口径也必须排噪音：用"全量 − 噪音"精确对账（坑 #41：`<` 这类松判据会被
    // 库里的过期文章蒙过去，改成等式 + 噪音条目数 ≥1 的前提断言才可能真红）
    const threeDaysAgo = new Date(Date.now() - 3 * 86400e3).toISOString();
    const win = "a.read_at IS NULL AND COALESCE(a.published_at,a.created_at) >= ?";
    const allIn = db.prepare(`SELECT COUNT(*) c FROM articles a JOIN sources s ON s.id=a.source_id WHERE ${win}`).get(threeDaysAgo).c;
    const noiseIn = db.prepare(`SELECT COUNT(*) c FROM articles a JOIN sources s ON s.id=a.source_id
      WHERE ${win} AND (s.type='hotlist' OR COALESCE(json_extract(COALESCE(s.extra,'{}'),'$.aggregator'),0)=1)`).get(threeDaysAgo).c;
    assert.ok(noiseIn >= 2, `前提：窗口内应有热榜+聚合两条噪音未读，实际 ${noiseIn}`);
    assert.equal(o.unreadArticles, allIn - noiseIn, '未读统计未排除噪音源条目');
  });
  await withServer(makeApp(), async (base) => {
    const o = (await (await fetch(`${base}/api/status/daily-sources`)).json()).overview;
    const names = o.dailyTopSources.map((s) => s.name);
    assert.ok(names.includes('正常来源'), '正常来源必须进榜（否则是"全都排掉"的假绿）');
    assert.ok(!names.includes('微博热搜T'), '来源榜不含热榜源');
    assert.ok(!names.includes('AIHOT聚合T'), '来源榜不含聚合源');
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
