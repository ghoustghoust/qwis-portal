// RSS 适配器解析回归：Atom 源的 <content:encoded> 必须被保留（we-mp-rss 公众号全文源）
// 背景：rss-parser 默认不解析 Atom entry 里的 content:encoded，曾导致公众号文章只剩摘要
require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanup } = require('./helpers');

const ATOM_FULLTEXT = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <title>测试公众号</title>
  <entry>
    <id>t1</id>
    <title>测试文章</title>
    <link href="https://mp.weixin.qq.com/s/abc" />
    <updated>Fri, 28 Aug 2026 11:54:01 +0800</updated>
    <summary>测试文章</summary>
    <content:encoded>${'&lt;p&gt;正文'.repeat(200)}&lt;/p&gt;</content:encoded>
  </entry>
</feed>`;

test('Atom <content:encoded> 全文被解析且长度完整', async () => {
  // 复用适配器内部 parser（带 customFields）
  const Parser = require('rss-parser');
  const parser = new Parser({ timeout: 15000, customFields: { item: ['content:encoded', 'content'] } });
  const feed = await parser.parseString(ATOM_FULLTEXT);
  const item = feed.items[0];
  assert.ok(item['content:encoded'], 'content:encoded 字段必须存在');
  assert.ok(item['content:encoded'].length >= 1000, `正文长度应 >=1000，实际 ${item['content:encoded'].length}`);
  assert.ok(item['content:encoded'].includes('<p>正文'), '实体应解码为 HTML');
  cleanup();
});
