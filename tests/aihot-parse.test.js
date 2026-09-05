// T3 - AIHOT 详情页 parseDetail 单测（七期 F1，N3 降级）
// 覆盖：真实样例 fixture 全字段 / 小样例评分·理由·标签 / RSC $xx 还原 / 缺字段降级 / 6 位 hex 颜色码排除
require('./helpers'); // APP_DATA_DIR 隔离必须先于任何 server/* 模块（此前漏引会以读写模式打开生产库）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { parseDetail } = require('../server/services/aihot/enrich');

// ---------- 真实详情页样例（Cursor 条目，352KB SSR + RSC）----------
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures-aihot-detail.html'), 'utf8');

test('fixture: 评分/推荐理由/标签/精选/双语全文/发布时间/原文链接全部解析', () => {
  const d = parseDetail(fixture);
  assert.equal(d.score, 71);
  assert.ok(d.reason && d.reason.includes('Cursor'), '推荐理由非空');
  assert.ok(d.tags.includes('行业动态'), '标签含行业动态');
  assert.ok(d.tags.includes('编码'), '标签含编码');
  assert.equal(d.featured, true);
  assert.equal(d.title, 'Cursor 正式被 SpaceX 收购');
  assert.equal(d.publishedAt, '2026-08-15T20:05:54.703Z');
  assert.equal(d.originalUrl, 'https://cursor.com/blog/joining-spacex');
  assert.ok(d.zhHtml && d.zhHtml.length > 1000, 'zhHtml > 1000 字符');
  assert.ok(d.originalHtml && d.originalHtml.length > 1000, 'originalHtml > 1000 字符');
  assert.ok(d.zhHtml.includes('<h1>'), 'zhHtml 是 HTML');
  assert.ok(d.originalHtml.includes('Cursor is now a part of SpaceX'), 'originalHtml 是英文原文');
});

// ---------- 小样例：锚点单项 ----------
test('小样例: 评分 aria-label / 推荐理由 / m-detail-tag 标签', () => {
  const html = `
    <div class="m-detail-marks"><span class="m-badge">精选</span>
      <details class="m-score-tip"><summary class="m-score" aria-label="AI 编辑部评分 88，满分 100，点击查看说明">88</summary></details>
    </div>
    <h1 class="m-detail-title">测试标题</h1>
    <div class="m-detail-meta"><span>2026-08-01 12:30</span></div>
    <p class="m-detail-summary-text">这是摘要。</p>
    <p class="m-detail-reason-text">这是推荐理由。</p>
    <div class="m-detail-tags"><a class="m-detail-tag" href="/topics/a">模型</a><a class="m-detail-tag" href="/topics/b">安全/对齐</a></div>
    <a href="https://example.com/post" class="m-detail-bar-ext" aria-label="打开原文">原文</a>
  `;
  const d = parseDetail(html);
  assert.equal(d.score, 88);
  assert.equal(d.reason, '这是推荐理由。');
  assert.deepEqual(d.tags, ['模型', '安全/对齐']);
  assert.equal(d.featured, true);
  assert.equal(d.title, '测试标题');
  assert.equal(d.summary, '这是摘要。');
  assert.equal(d.publishedAt, new Date('2026-08-01T12:30:00+08:00').toISOString());
  assert.equal(d.originalUrl, 'https://example.com/post');
});

// ---------- RSC $xx 引用还原（含无换行续块、UTF-8 字节长度）----------
function rscPush(payload) {
  // 模拟 self.__next_f.push([1,"..."])，payload 为未转义的 RSC 流片段
  return `<script>self.__next_f.push([1,${JSON.stringify(payload)}])</script>`;
}

test('RSC: zhHtml/originalHtml 经 $xx 引用还原，T 长度按 UTF-8 字节截取（块后无换行）', () => {
  const zh = '<h1>中文标题</h1><p>中文正文内容，含多字节字符。</p>';
  const en = '<h1>English Title</h1><p>English body text.</p>';
  const zhBytes = Buffer.byteLength(zh, 'utf8').toString(16);
  const enBytes = Buffer.byteLength(en, 'utf8').toString(16);
  const stream =
    '\\n10:["$","div",null,{"zhHtml":"$1a","originalHtml":"$1b"}]' +
    `\n1a:T${zhBytes},${zh}` + // 文本块结束后直接跟下一块（无换行）
    `1b:T${enBytes},${en}`;
  const html = rscPush(stream);
  const d = parseDetail(html);
  assert.equal(d.zhHtml, zh);
  assert.equal(d.originalHtml, en);
});

test('RSC: aiSelected=true 时 featured 兜底为 true', () => {
  const html = rscPush('\n5:["$","div",null,{"aiSelected":true,"score":66}]');
  const d = parseDetail(html);
  assert.equal(d.featured, true);
});

// ---------- 标签 #词 兜底 + 6 位 hex 颜色码排除 ----------
test('标签兜底: #词 形式可用，#10151c 这类 6 位 hex 颜色码被排除', () => {
  const html = `
    <span style="color:#10151c">x</span>
    <a href="/t/1">#智能体</a>
    <a href="/t/2">#agent</a>
    <a href="/c">#a1b2c3</a>
  `;
  const d = parseDetail(html);
  assert.ok(d.tags.includes('智能体'));
  assert.ok(d.tags.includes('agent'));
  assert.ok(!d.tags.includes('a1b2c3'), '6 位 hex 颜色码排除');
  assert.ok(!d.tags.includes('10151c'));
});

// ---------- N3 降级：字段全缺 ----------
test('降级: 无锚点页面各字段为 null/[]，不抛错', () => {
  const d = parseDetail('<html><body><p>随便一个页面</p></body></html>');
  assert.equal(d.score, null);
  assert.equal(d.reason, null);
  assert.deepEqual(d.tags, []);
  assert.equal(d.featured, false);
  assert.equal(d.zhHtml, null);
  assert.equal(d.originalHtml, null);
  assert.equal(d.originalUrl, null);
  assert.equal(d.title, null);
  assert.equal(d.publishedAt, null);
});

test('降级: 空输入/非字符串不抛错', () => {
  for (const v of ['', null, undefined]) {
    const d = parseDetail(v);
    assert.equal(d.score, null);
    assert.deepEqual(d.tags, []);
  }
});
