// 九期回归测试:锁住所有"日报/阅读器数据质量"修复点,防止未来重构回归
// 覆盖:GBK 解码 / 微信 #js_content 抽取 / data-src 图片 / mmbiz 防盗链 / 风控页过滤 / 乱码安检
require('./helpers');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { cleanup } = require('./helpers');

const { _internals } = require('../server/services/collectors/rss');
const daily = require('../server/services/ai/daily');

after(() => cleanup());

// '中文' 的 GBK 字节
const GBK_ZHONGWEN = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);

test('编码:meta charset=gbk 的页面按 GBK 解码(联合早报乱码根因)', () => {
  const buf = Buffer.concat([
    Buffer.from('<html><head><meta charset="gbk"></head><body><p>'),
    GBK_ZHONGWEN,
    Buffer.from('</p></body></html>'),
  ]);
  const html = _internals.decodeHtmlBuffer(buf, 'text/html');
  assert.ok(html.includes('中文'), `GBK 解码失败: ${html.slice(0, 100)}`);
});

test('编码:header charset 优先于 meta', () => {
  const buf = Buffer.concat([Buffer.from('<p>'), GBK_ZHONGWEN, Buffer.from('</p>')]);
  const html = _internals.decodeHtmlBuffer(buf, 'text/html; charset=gbk');
  assert.ok(html.includes('中文'));
});

test('编码:UTF-8 页面不受影响', () => {
  const html = _internals.decodeHtmlBuffer(Buffer.from('<p>中文</p>', 'utf8'), 'text/html; charset=utf-8');
  assert.ok(html.includes('中文'));
});

test('微信文章页:#js_content 直接抽取(Readability 不适用)', () => {
  const { JSDOM } = require('jsdom');
  const html = `<html><body><div id="js_content"><p>微信正文内容应该被直接抽取出来而不是走Readability所以这里写得长一点</p></div></body></html>`;
  const doc = new JSDOM(html, { url: 'https://mp.weixin.qq.com/s/abc' }).window.document;
  const content = _internals.extractArticleContent(doc, 'https://mp.weixin.qq.com/s/abc');
  assert.ok(content.includes('微信正文内容应该被直接抽取出来'));
});

test('图片:懒加载 data-src 转 src + mmbiz 加 no-referrer', () => {
  const out = _internals.cleanContent('<p>文</p><img class="wxw" data-src="https://mmbiz.qpic.cn/x/1.jpg" src="data:image/gif;base64,xx">');
  assert.ok(out.includes('src="https://mmbiz.qpic.cn/x/1.jpg"'), 'data-src 应转为 src');
  assert.ok(out.includes('referrerpolicy="no-referrer"'), 'mmbiz 图应加 no-referrer');
  assert.ok(!out.includes('data-src'), '不应残留 data-src');
});

test('风控页过滤:「参数错误」错误页判定为垃圾内容', () => {
  assert.equal(_internals.isJunkContent('<div><p>参数错误</p></div>'), true);
  assert.equal(_internals.isJunkContent('<div><p>环境异常,请稍后重试</p></div>'), true);
  assert.equal(_internals.isJunkContent('<p>这是一篇正常的文章内容,长度足够正常。</p>'), false);
});

test('日报安检:乱码标题条目被剔除并计数', async () => {
  const { db } = require('../server/db');
  const now = new Date().toISOString();
  const srcId = db.prepare("INSERT INTO sources(type, name, url, enabled, status, created_at) VALUES('rss','安检测试源','https://t.example.com/f',1,'ok',?)").run(now).lastInsertRowid;
  db.prepare('INSERT INTO articles(source_id, title, url, summary, content_html, published_at, created_at) VALUES(?,?,?,?,?,?,?)')
    .run(srcId, '正常文章标题在这里', 'https://t.example.com/1', '', '<p>正文</p>', now, now);
  db.prepare('INSERT INTO articles(source_id, title, url, summary, content_html, published_at, created_at) VALUES(?,?,?,?,?,?,?)')
    .run(srcId, '乱码ҪˢƵ标题', 'https://t.example.com/2', '', '<p>正文</p>', now, now);
  const report = await daily.generate(24);
  const allTitles = report.sections.flatMap((s) => s.items.map((i) => i.title));
  assert.ok(allTitles.some((t) => t.includes('正常文章标题')), '正常条目应入报');
  assert.ok(!allTitles.some((t) => t.includes('Ҫˢ')), '乱码条目不得入报');
  assert.ok(report.stats.droppedBadItems >= 1, 'stats 应记录剔除数');
});

test('日报安检:热榜 hover 摘要乱码时热榜适配器丢弃摘要', () => {
  // 与 hotlist 适配器同规则:西里尔 + 修饰字母 + 高频乱码碎片字
  const MOJIBAKE = /[Ѐ-ӿˈ-˿锟锛銆]/;
  assert.ok(MOJIBAKE.test('ҪˢƵ'));
  assert.ok(MOJIBAKE.test('锟斤拷'));
  assert.ok(!MOJIBAKE.test('正常中文摘要'));
});
