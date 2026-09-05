// 六期 T6 - 日报去重/限流单测（F5）+ needsGeneration（F3）
// 覆盖：同主题合并（一手源优先/related 记录）、无关联不合并、同源限流前 3、stale 判定
// 全部使用独立临时 DB（tests/helpers.js），不触碰 data/app.db
require('./helpers');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { cleanup } = require('./helpers');

const { db, setSetting } = require('../server/db');
const daily = require('../server/services/ai/daily');

after(cleanup);

function mkItem(over) {
  return {
    kind: 'article', ref_id: 1, source_id: 1, title: '', source_name: '', url: '',
    published_at: '2026-08-15T08:00:00.000Z', focus: false, aggregator: false, text: '', ...over,
  };
}

test('dedupAndCap: 不同源同主题合并为一条，官博（非 aggregator）为主条目，AIHOT 进 related', () => {
  const items = [
    mkItem({ ref_id: 1, source_id: 25, source_name: 'AIHOT 热榜', aggregator: true, title: 'Cursor 被 SpaceX 收购', published_at: '2026-08-15T10:00:00.000Z' }),
    mkItem({ ref_id: 2, source_id: 3, source_name: 'Cursor 官方博客', aggregator: false, title: 'Cursor 正式被 SpaceX 收购', published_at: '2026-08-15T09:00:00.000Z' }),
  ];
  const out = daily.dedupAndCap(items);
  assert.equal(out.length, 1);
  assert.equal(out[0].source_name, 'Cursor 官方博客'); // 一手源优先（尽管发布更晚）
  assert.equal(out[0].related.length, 1);
  assert.deepEqual(out[0].related[0], { kind: 'article', ref_id: 1, source_name: 'AIHOT 热榜' });
});

test('dedupAndCap: 同优先级（都非 aggregator）时取发布时间早者为主条目', () => {
  const items = [
    mkItem({ ref_id: 1, source_id: 1, source_name: '甲', title: 'OpenAI 发布 GPT-6 模型', published_at: '2026-08-15T12:00:00.000Z' }),
    mkItem({ ref_id: 2, source_id: 2, source_name: '乙', title: 'OpenAI 正式发布 GPT-6 模型', published_at: '2026-08-15T08:00:00.000Z' }),
  ];
  const out = daily.dedupAndCap(items);
  assert.equal(out.length, 1);
  assert.equal(out[0].source_name, '乙');
  assert.equal(out[0].related[0].source_name, '甲');
});

test('dedupAndCap: 标题无关的条目不合并', () => {
  const items = [
    mkItem({ ref_id: 1, source_id: 1, title: 'OpenAI 发布 GPT-6 模型' }),
    mkItem({ ref_id: 2, source_id: 2, title: '周末爬山见闻与美食记录' }),
  ];
  const out = daily.dedupAndCap(items);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].related, []);
  assert.deepEqual(out[1].related, []);
});

test('dedupAndCap: 同一来源同栏超过 3 条时只保留前 3（命中数优先，其次时间）', () => {
  const items = [];
  const titles = ['新模型评测榜单出炉', '开源社区热议许可协议', '价格战再度升级', '压缩技术取得突破', '端侧部署实践分享'];
  for (let i = 1; i <= 5; i++) {
    items.push(mkItem({
      ref_id: i, source_id: 7, source_name: '高频源',
      title: titles[i - 1], // 互不相同，不触发合并
      _hits: i === 5 ? 9 : 1, // 第 5 条命中最高
      published_at: `2026-08-15T0${i}:00:00.000Z`,
    }));
  }
  const out = daily.dedupAndCap(items);
  assert.equal(out.length, 3);
  // 命中最高的第 5 条必须保留；最早的两条（i=1,2，命中数低、时间早）被截掉
  assert.ok(out.some((i) => i.ref_id === 5));
  assert.deepEqual(out.map((i) => i.ref_id).sort(), [3, 4, 5]);
});

test('dedupAndCap: 合并后再限流——同源 4 条其中 2 条先合并，剩余 3 条全保留', () => {
  const items = [
    mkItem({ ref_id: 1, source_id: 9, source_name: 'S', title: 'Claude 发布新模型', published_at: '2026-08-15T01:00:00.000Z' }),
    mkItem({ ref_id: 2, source_id: 9, source_name: 'S', title: 'Claude 发布新模型：全文解读', published_at: '2026-08-15T02:00:00.000Z' }),
    mkItem({ ref_id: 3, source_id: 9, source_name: 'S', title: '苹果发布会官宣时间', published_at: '2026-08-15T03:00:00.000Z' }),
    mkItem({ ref_id: 4, source_id: 9, source_name: 'S', title: '谷歌云上线新数据库功能', published_at: '2026-08-15T04:00:00.000Z' }),
  ];
  const out = daily.dedupAndCap(items);
  assert.equal(out.length, 3); // 1+2 合并 → 3 组，未超限流
});

// ---------- needsGeneration（F3 stale 判定） ----------
test('needsGeneration: 生成时间已过且今日无日报 → true；有日报 → false；时间未到 → false', () => {
  db.prepare('DELETE FROM daily_reports').run();
  // 生成时间设为 00:00（必然已过）
  setSetting('daily', { time: '00:00', aiEnabled: false });
  assert.equal(daily.needsGeneration(), true);
  // 写入一条今日日报 → false
  db.prepare('INSERT INTO daily_reports(generated_at, window_hours, stats, sections) VALUES(?,?,?,?)')
    .run(new Date().toISOString(), 48, '{}', '[]');
  assert.equal(daily.needsGeneration(), false);
  // 生成时间设为 23:59（今天还没到，除非本就在 23:59 跑测试——极端边界可接受）
  setSetting('daily', { time: '23:59' });
  db.prepare('DELETE FROM daily_reports').run();
  const now = new Date();
  if (now.getHours() === 23 && now.getMinutes() >= 59) return; // 边界时刻跳过断言
  assert.equal(daily.needsGeneration(), false);
});

// ---------- 集成：generate() 应用 dedupAndCap ----------
test('generate: 同主题跨源合并且 related 落库；同源同栏限流 3 条', async () => {
  db.prepare('DELETE FROM daily_reports').run();
  db.prepare('DELETE FROM articles').run();
  db.prepare('DELETE FROM sources').run();
  setSetting('daily', { windowHours: 48, aiEnabled: false });
  db.prepare('DELETE FROM settings WHERE key=?').run('daily.columns'); // 恢复默认四栏目

  const now = Date.now();
  const iso = (h) => new Date(now - h * 3600e3).toISOString();
  const insSource = db.prepare(
    "INSERT INTO sources(type, name, url, focus, enabled, status, extra, created_at) VALUES(?,?,?,0,1,'ok',?,?)"
  );
  const aggSrc = insSource.run('rss', 'AIHOT 热榜', 'https://aihot.example.com/feed', JSON.stringify({ aggregator: 1 }), iso(0)).lastInsertRowid;
  const orgSrc = insSource.run('wechat', '某官博', 'https://rss.example.com/org', '{}', iso(0)).lastInsertRowid;
  const noisySrc = insSource.run('wechat', '高频公众号', 'https://rss.example.com/noisy', '{}', iso(0)).lastInsertRowid;

  const insArticle = db.prepare(
    'INSERT INTO articles(source_id, title, url, summary, content_html, published_at, created_at) VALUES(?,?,?,?,?,?,?)'
  );
  // 同主题两条：AIHOT（聚合）+ 官博（一手），都命中「AI技术」栏关键词 Claude
  insArticle.run(aggSrc, 'Claude 发布新一代 Agent 模型', 'https://a.example.com/d1', '', '', iso(1), iso(1));
  insArticle.run(orgSrc, 'Claude 新一代 Agent 模型正式发布', 'https://a.example.com/d2', '', '', iso(2), iso(2));
  // 高频源 5 条同栏（都命中「模型」），互不同主题
  const noisyTitles = ['新模型评测榜单出炉', '开源社区热议模型许可协议', '大模型价格战再度升级', '模型压缩技术取得突破', '端侧模型部署实践分享'];
  for (let i = 1; i <= 5; i++) {
    insArticle.run(noisySrc, noisyTitles[i - 1], `https://a.example.com/h${i}`, '', '', iso(i), iso(i));
  }

  const report = await daily.generate(48);
  const aiCol = report.sections.find((s) => s.column === 'AI技术');
  // 同主题合并：官博为主条目，related 含 AIHOT
  const merged = aiCol.items.find((i) => i.source_name === '某官博');
  assert.ok(merged, '官博主条目应存在');
  assert.equal(merged.related.length, 1);
  assert.equal(merged.related[0].source_name, 'AIHOT 热榜');
  assert.ok(!aiCol.items.some((i) => i.source_name === 'AIHOT 热榜'), 'AIHOT 条目应被合并掉');
  // 同源限流：高频公众号只剩 3 条
  assert.equal(aiCol.items.filter((i) => i.source_name === '高频公众号').length, 3);
});
