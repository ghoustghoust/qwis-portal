// T46 - 适配器 match 单测（T10 / T40）
// 覆盖：B站三种输入（space 链接 / BV 链接 / 纯数字 uid）、抖音三种输入（主页 / 短链 / sec_uid）、
//       错误输入返回 spec 原文提示（resolve 对不识别的输入在发起任何网络请求前即抛出）
// 需要真实网络的 resolve 成功路径不在此处测（由联调与 AC 走查覆盖）
require('./helpers');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { cleanup } = require('./helpers');

const bilibili = require('../server/services/collectors/bilibili');
const douyin = require('../server/services/collectors/douyin');
const registry = require('../server/services/collectors/registry');

after(cleanup);

// ---------- B站 match ----------
test('B站 match: space.bilibili.com 主页链接', () => {
  assert.deepEqual(bilibili.match('https://space.bilibili.com/546195'), { uid: '546195' });
  assert.deepEqual(bilibili.match('https://space.bilibili.com/546195/video'), { uid: '546195' });
});

test('B站 match: BV 号视频链接与裸 BV 号', () => {
  assert.deepEqual(bilibili.match('https://www.bilibili.com/video/BV1xx411c7mD'), { bvid: 'BV1xx411c7mD' });
  assert.deepEqual(bilibili.match('BV1xx411c7mD'), { bvid: 'BV1xx411c7mD' });
});

test('B站 match: 纯数字 uid', () => {
  assert.deepEqual(bilibili.match('546195'), { uid: '546195' });
  assert.deepEqual(bilibili.match('  208259  '), { uid: '208259' });
});

test('B站 match: 错误输入返回 false；resolve 抛出 spec 原文提示', async () => {
  assert.equal(bilibili.match('https://example.com/foo'), false);
  assert.equal(bilibili.match('不是链接'), false);
  assert.equal(bilibili.match(''), false);
  await assert.rejects(() => bilibili.resolve('https://example.com/foo'), (err) => {
    assert.equal(err.message, bilibili.FAIL_MSG);
    assert.equal(err.message, '添加失败：没有识别到 B站 up，请粘贴 space.bilibili.com 的主页链接或直接填写数字 uid');
    return true;
  });
});

// ---------- 抖音 match ----------
test('抖音 match: douyin.com/user/ 主页链接', () => {
  const r = douyin.match('https://www.douyin.com/user/MS4wLjABAAAAxxx-yyy');
  assert.deepEqual(r, { sec_uid: 'MS4wLjABAAAAxxx-yyy' });
});

test('抖音 match: v.douyin.com 分享短链', () => {
  assert.deepEqual(douyin.match('https://v.douyin.com/iABC123/'), { shortUrl: 'https://v.douyin.com/iABC123/' });
  assert.deepEqual(douyin.match('https://v.douyin.com/iABC123'), { shortUrl: 'https://v.douyin.com/iABC123' });
});

test('抖音 match: sec_uid 直填', () => {
  const uid = 'MS4wLjABAAAAL7eebKxGQf0f0B-JVq7pbHmVQ1234567890abcd';
  assert.deepEqual(douyin.match(uid), { sec_uid: uid });
});

test('抖音 match: 错误输入返回 false；resolve 抛出 spec 原文提示', async () => {
  assert.equal(douyin.match('https://example.com/user/abc'), false);
  assert.equal(douyin.match('123'), false); // 纯数字不是合法 sec_uid
  assert.equal(douyin.match(''), false);
  await assert.rejects(() => douyin.resolve('https://example.com/user/abc'), (err) => {
    assert.equal(err.message, douyin.FAIL_MSG);
    assert.equal(err.message, '添加失败：没有识别到抖音 uid/sec_uid，请粘贴抖音用户主页链接或直接填写 sec_uid');
    return true;
  });
});

// ---------- registry 识别 ----------
test('registry.detectByUrl: 各平台链接命中对应适配器，未知链接兜底 rss', () => {
  assert.equal(registry.detectByUrl('https://space.bilibili.com/546195').type, 'bilibili');
  assert.equal(registry.detectByUrl('https://www.douyin.com/user/MS4wLjABAAAAxxx').type, 'douyin');
  // rss 兜底：任意 http(s) 链接
  assert.equal(registry.detectByUrl('https://blog.example.com/feed.xml').type, 'rss');
});

// ---------- 抖音串行队列限速（N4）：缩短间隔验证严格串行 ----------
test('抖音串行队列：任务严格串行执行且相邻访问间隔 >= 配置间隔', async () => {
  process.env.DOUYIN_QUEUE_GAP_MS = '50'; // 测试缩短间隔（生产默认 10000）
  const events = [];
  const t0 = Date.now();
  await Promise.all([
    douyin.enqueue(async () => { events.push({ n: 1, at: Date.now() - t0 }); }),
    douyin.enqueue(async () => { events.push({ n: 2, at: Date.now() - t0 }); }),
    douyin.enqueue(async () => { events.push({ n: 3, at: Date.now() - t0 }); }),
  ]);
  assert.deepEqual(events.map((e) => e.n), [1, 2, 3]); // 严格按入队顺序
  assert.ok(events[1].at - events[0].at >= 45, `第二次访问间隔应 >=50ms，实际 ${events[1].at - events[0].at}ms`);
  assert.ok(events[2].at - events[1].at >= 45, `第三次访问间隔应 >=50ms，实际 ${events[2].at - events[1].at}ms`);
});

test('抖音串行队列：单个任务失败不阻塞后续任务', async () => {
  let ran = false;
  await douyin.enqueue(async () => { throw new Error('模拟失败'); }).catch((e) => assert.equal(e.message, '模拟失败'));
  await douyin.enqueue(async () => { ran = true; });
  assert.equal(ran, true);
});
