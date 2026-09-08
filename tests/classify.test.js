// 自动分类纯逻辑单测
require('./helpers');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { cleanup } = require('./helpers');

const classify = require('../server/services/classify');

after(() => cleanup());

// ── 关键词匹配 ──
test('关键词命中:「腾讯技术工程」→ 编程技术', () => {
  const r = classify.classifySource({ name: '腾讯技术工程', type: 'rss', url: 'x' }, new Map());
  assert.ok(r);
  assert.equal(r.key, 'programming');
  assert.equal(r.zh, '编程技术');
  assert.equal(r.reason, 'keyword');
});

test('关键词命中:「AI前线」→ 人工智能', () => {
  const r = classify.classifySource({ name: 'AI前线', type: 'rss', url: 'x' }, new Map());
  assert.ok(r);
  assert.equal(r.key, 'ai');
  assert.equal(r.zh, '人工智能');
});

test('关键词命中:「金融宏观」→ 金融经济', () => {
  const r = classify.classifySource({ name: '金融宏观', type: 'rss', url: 'x' }, new Map());
  assert.ok(r);
  assert.equal(r.key, 'finance');
});

// ── 别名归一 ──
test('英文别名归一: Programming & Technology → 编程技术', () => {
  const cat = classify.categoryFromOpml('Programming & Technology');
  assert.ok(cat);
  assert.equal(cat.zh, '编程技术');
});

test('英文别名归一: Artificial Intelligence → 人工智能', () => {
  const cat = classify.categoryFromOpml('Artificial Intelligence');
  assert.ok(cat);
  assert.equal(cat.zh, '人工智能');
});

test('英文别名归一: Business & Technology → 商业科技', () => {
  const cat = classify.categoryFromOpml('Business & Technology');
  assert.ok(cat);
  assert.equal(cat.zh, '商业科技');
});

// ── 未命中 ──
test('无命中返回 null', () => {
  const r = classify.classifySource({ name: '某某无分类博客', type: 'rss', url: 'random-url' }, new Map());
  assert.equal(r, null);
});

// ── OPML 映射优先于关键词 ──
test('OPML 映射优先: 若 opmlMap 命中则走 opml 路径', () => {
  const opmlMap = new Map([['test-url', 'Artificial Intelligence']]);
  const r = classify.classifySource({ name: '某技术源', type: 'rss', url: 'test-url' }, opmlMap);
  assert.ok(r);
  assert.equal(r.reason, 'opml');
  assert.equal(r.key, 'ai');
});

// ── kindOfType ──
test('kindOfType: bilibili → video', () => {
  assert.equal(classify.kindOfType('bilibili'), 'video');
  assert.equal(classify.kindOfType('douyin'), 'video');
  assert.equal(classify.kindOfType('youtube'), 'video');
  assert.equal(classify.kindOfType('rss'), 'article');
  assert.equal(classify.kindOfType('wechat'), 'article');
  assert.equal(classify.kindOfType('hotlist'), 'article');
});

// ── normalizeName ──
test('normalizeName: 大小写+trim 归一', () => {
  assert.equal(classify.normalizeName('  AI  '), 'ai');
  assert.equal(classify.normalizeName('Programming'), 'programming');
});

// ── buildOpmlCategoryMap ──
test('buildOpmlCategoryMap: 能解析 OPML 层级', () => {
  const map = classify.buildOpmlCategoryMap();
  // YouTube OPML 有 ~124 条，播客 ~60 条
  assert.ok(map.size > 100, `OPML map 应 >100 条，实际 ${map.size}`);
  // 抽查一个 YouTube URL（AI Engineer）
  const aiEngineerUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCLKPca3kwwd-B59HNr-_lvA';
  assert.equal(map.get(aiEngineerUrl), 'Artificial Intelligence');
});

// ── 目录优先级 ──
test('目录优先级:「技术」命中 programming（排在 business 之前）', () => {
  // 「技术」在 programming 的 keywords 中，且 programming 在 business 之前
  const r = classify.matchByKeyword('技术前沿');
  assert.ok(r);
  assert.equal(r.key, 'programming');
});
