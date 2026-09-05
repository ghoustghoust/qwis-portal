// T46 - 日报栏目规则单测（T26 / F15，N7 降级）
// 覆盖：focus 优先全收 / 关键词命中首个栏目 / fallback 兜底 / 空栏保留 / 无 AI 降级
// 全部使用独立临时 DB（tests/helpers.js），不触碰 data/app.db
require('./helpers');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { cleanup } = require('./helpers');

const { db, setSetting } = require('../server/db');
const daily = require('../server/services/ai/daily');

after(cleanup);

// ---------- 纯规则引擎：classify / keywordHits ----------
const COLUMNS = [
  { id: 'c1', name: '培训课程发布', desc: '课程类', keywords: ['课程', '训练营'] },
  { id: 'focus', name: '重点更新', special: 'focus' },
  { id: 'c2', name: 'AI技术', desc: 'AI 动向', keywords: ['Claude', 'Agent'] },
  { id: 'fallback', name: '其它重要', special: 'fallback' },
];

function mkItem(over) {
  return { kind: 'article', ref_id: 1, title: '', text: '', published_at: '', focus: false, ...over };
}

test('classify: focus 源内容全部进「重点更新」，即使命中关键词也不进关键词栏目', () => {
  const items = [
    mkItem({ ref_id: 1, focus: true, text: 'Claude 新课程发布' }), // focus + 命中 c2/c1 关键词
    mkItem({ ref_id: 2, focus: true, text: '完全无关键词的日常更新' }),
  ];
  const buckets = daily.classify(items, COLUMNS);
  assert.equal(buckets.get('focus').length, 2);
  assert.equal(buckets.get('c1').length, 0);
  assert.equal(buckets.get('c2').length, 0);
  assert.equal(buckets.get('fallback').length, 0);
});

test('classify: 命中多个栏目时只进配置顺序最先命中的栏目', () => {
  // 同时命中 c1（课程）与 c2（Agent）→ 进 c1
  const buckets = daily.classify([mkItem({ ref_id: 1, text: 'Agent 课程上新' })], COLUMNS);
  assert.equal(buckets.get('c1').length, 1);
  assert.equal(buckets.get('c2').length, 0);
  assert.equal(buckets.get('fallback').length, 0);
});

test('classify: 未命中任何关键词进 fallback「其它重要」', () => {
  const buckets = daily.classify([mkItem({ ref_id: 1, text: '随便聊聊周末见闻' })], COLUMNS);
  assert.equal(buckets.get('fallback').length, 1);
});

test('classify: 无 fallback 栏目时未命中内容不收录', () => {
  const noFallback = COLUMNS.filter((c) => c.special !== 'fallback');
  const buckets = daily.classify([mkItem({ ref_id: 1, text: '无关键词内容' })], noFallback);
  for (const col of noFallback) assert.equal(buckets.get(col.id).length, 0);
});

test('keywordHits: 大小写不敏感、计数命中关键词个数', () => {
  assert.equal(daily.keywordHits(mkItem({ text: 'Claude 与 AGENT 的新动向' }), ['claude', 'agent']), 2);
  assert.equal(daily.keywordHits(mkItem({ text: '无关内容' }), ['claude']), 0);
  assert.equal(daily.keywordHits(mkItem({ text: 'a' }), []), 0);
});

// ---------- 集成：generate() 走真实临时 DB ----------
function seed() {
  const now = Date.now();
  const insSource = db.prepare(
    "INSERT INTO sources(type, name, url, focus, enabled, status, created_at) VALUES(?,?,?,?,1,'ok',?)"
  );
  // 1 个 focus 公众号源 + 1 个普通公众号源 + 1 个 B站源
  const focusSrc = insSource.run('wechat', '重点公众号', 'https://rss.example.com/focus', 1, new Date(now).toISOString()).lastInsertRowid;
  const normalSrc = insSource.run('wechat', '普通公众号', 'https://rss.example.com/normal', 0, new Date(now).toISOString()).lastInsertRowid;
  const videoSrc = insSource.run('bilibili', '某UP主', 'https://space.bilibili.com/1', 0, new Date(now).toISOString()).lastInsertRowid;

  const insArticle = db.prepare(
    'INSERT INTO articles(source_id, title, url, summary, content_html, published_at, created_at) VALUES(?,?,?,?,?,?,?)'
  );
  const iso = (h) => new Date(now - h * 3600e3).toISOString();
  // focus 源两条（其中一条带关键词，验证 focus 优先）
  insArticle.run(focusSrc, 'Claude 课程重磅发布', 'https://a.example.com/f1', '', '', iso(1), iso(1));
  insArticle.run(focusSrc, '无关键词的重点更新', 'https://a.example.com/f2', '', '', iso(2), iso(2));
  // 普通源：一条命中「AI技术」、一条命中「培训课程发布」、一条都不命中
  insArticle.run(normalSrc, 'Agent 与模型新进展', 'https://a.example.com/n1', 'RAG 动向', '', iso(3), iso(3));
  insArticle.run(normalSrc, '新训练营招募启动', 'https://a.example.com/n2', '', '', iso(4), iso(4));
  insArticle.run(normalSrc, '周末随笔', 'https://a.example.com/n3', '', '', iso(5), iso(5));

  const insVideo = db.prepare(
    "INSERT INTO videos(source_id, platform, title, url, vid, intro, published_at, created_at) VALUES(?,?,?,?,?,?,?,?)"
  );
  insVideo.run(videoSrc, 'bilibili', 'MCP 实战视频', 'https://www.bilibili.com/video/BV1', 'BV1', '', iso(6), iso(6));

  return { focusSrc, normalSrc, videoSrc };
}

test('generate: 分栏正确（focus 全收时间倒序/关键词命中/fallback 兜底/空栏保留/stats 正确），无 AI 降级', async () => {
  seed();
  setSetting('daily', { windowHours: 48, aiEnabled: false }); // AI 关闭
  const report = await daily.generate(48);

  assert.equal(report.stats.candidates, 6);
  assert.equal(report.stats.articles, 5);
  assert.equal(report.stats.videos, 1);
  assert.equal(report.stats.windowHours, 48);
  assert.equal(report.stats.sortMode, 'keyword'); // N7：无 AI → 关键词规则排序

  // 栏目按配置顺序完整保留（含空栏）
  assert.deepEqual(report.sections.map((s) => s.column), ['培训课程发布', '重点更新', 'AI技术', '其它重要']);

  const byName = Object.fromEntries(report.sections.map((s) => [s.column, s.items]));
  // 培训课程发布：只有「新训练营招募启动」
  assert.deepEqual(byName['培训课程发布'].map((i) => i.title), ['新训练营招募启动']);
  // 重点更新：focus 源两条全收（含带关键词的那条），时间倒序
  assert.deepEqual(byName['重点更新'].map((i) => i.title), ['Claude 课程重磅发布', '无关键词的重点更新']);
  // AI技术：普通源关键词命中 + 视频关键词命中（MCP）
  assert.deepEqual(
    byName['AI技术'].map((i) => i.title).sort(),
    ['Agent 与模型新进展', 'MCP 实战视频']
  );
  // 其它重要：兜底
  assert.deepEqual(byName['其它重要'].map((i) => i.title), ['周末随笔']);
  // 无 AI：无摘要、无重要度评分
  for (const s of report.sections) {
    for (const i of s.items) {
      assert.equal(i.summary, '');
      assert.equal(i.score, undefined);
    }
  }
  // 落库可查
  const latest = daily.getLatest();
  assert.equal(latest.id, report.id);
  assert.equal(latest.stats.candidates, 6);
});

test('generate: aiEnabled=true 但无 Key 时仍整体降级（N7），日报正常产出', async () => {
  setSetting('daily', { windowHours: 48, aiEnabled: true }); // 开了开关但没配 Key
  const report = await daily.generate(48);
  assert.equal(report.stats.sortMode, 'keyword');
  assert.equal(report.stats.candidates, 6);
  assert.equal(report.sections.length, 4);
});

test('generate: 空栏保留——全部内容都命中时其它栏目仍在 sections 中且 items 为空', async () => {
  // 自定义栏目：全部关键词必然命中第一栏
  setSetting('daily.columns', [
    { id: 'all', name: '全部命中栏', keywords: [''] }, // 空关键词不命中
    { id: 'never', name: '永远空栏', keywords: ['zzz绝不可能命中的词zzz'] },
    { id: 'fb', name: '兜底', special: 'fallback' },
  ]);
  const report = await daily.generate(48);
  assert.deepEqual(report.sections.map((s) => s.column), ['全部命中栏', '永远空栏', '兜底']);
  const empty = report.sections.find((s) => s.column === '永远空栏');
  assert.ok(empty, '空栏应保留在 sections 中');
  assert.deepEqual(empty.items, []);
});
