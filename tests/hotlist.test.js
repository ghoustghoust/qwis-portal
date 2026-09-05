// 九期 M1:hotlist 适配器单测 —— 假 newsnow + 假 60s 服务,验证抓取映射与热度解析
require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const { cleanup } = require('./helpers');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

let fakeNewsnow, fake60s;

before(async () => {
  fakeNewsnow = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'cache', id: 'zhihu', updatedTime: 1787911376501,
      items: [
        { id: '1', title: '某热点事件', url: 'https://www.zhihu.com/question/1', extra: { info: '1001 万热度', hover: '事件概述文本' } },
        { id: '2', title: '无热度字段条目', url: 'https://www.zhihu.com/question/2', extra: {} },
        { id: '3', title: '缺url条目应被过滤', extra: {} },
      ],
    }));
  });
  const p1 = await freePort();
  await new Promise((r) => fakeNewsnow.listen(p1, '127.0.0.1', r));
  process.env.HOTLIST_BASE_URL = `http://127.0.0.1:${p1}`;
});

after(async () => {
  await new Promise((r) => fakeNewsnow.close(r));
  cleanup();
});

test('newsnow 抓取:映射标题/链接/概述/热度,过滤缺链接条目', async () => {
  const adapter = require('../server/services/collectors/hotlist');
  const src = { url: 'hotlist://zhihu', extra: JSON.stringify({ platform: '知乎热榜', domain: '综合热搜' }) };
  const r = await adapter.fetch(src);
  assert.equal(r.articles.length, 2);
  const a = r.articles[0];
  assert.equal(a.title, '某热点事件');
  assert.equal(a.url, 'https://www.zhihu.com/question/1');
  assert.equal(a.author, '知乎热榜');
  assert.equal(a.summary, '事件概述文本');
  assert.equal(a.score, 10010000); // 1001 万
  assert.equal(a.category, '综合热搜');
  assert.equal(r.articles[1].score, null);
});

test('60s 抓取:news 数组映射为稳定 url 条目', async () => {
  fake60s = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 200, data: { date: '2026-08-28', news: ['新闻一', '新闻二'] } }));
  });
  const p2 = await freePort();
  await new Promise((r) => fake60s.listen(p2, '127.0.0.1', r));
  process.env.D60S_BASE_URL = `http://127.0.0.1:${p2}`;
  const adapter = require('../server/services/collectors/hotlist');
  const r = await adapter.fetch({ url: 'hotlist60s://60s', extra: '{}' });
  assert.equal(r.articles.length, 2);
  assert.equal(r.articles[0].title, '新闻一');
  assert.ok(r.articles[0].url.includes('2026-08-28'), 'url 应含日期供去重');
  assert.equal(r.articles[0].published_at, new Date('2026-08-28T08:00:00+08:00').toISOString());
  await new Promise((r2) => fake60s.close(r2));
});

test('resolve 契约:newsnow id 与 60s', async () => {
  const adapter = require('../server/services/collectors/hotlist');
  const info = await adapter.resolve('zhihu');
  assert.equal(info.url, 'hotlist://zhihu');
  const info60 = await adapter.resolve('60s');
  assert.equal(info60.url, 'hotlist60s://60s');
});

test('registry 已登记 hotlist 适配器', () => {
  const registry = require('../server/services/collectors/registry');
  const a = registry.getAdapter('hotlist');
  assert.ok(a, 'hotlist 适配器应已注册');
  assert.equal(a.type, 'hotlist');
});
