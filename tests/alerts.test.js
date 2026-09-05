// 九期:报警系统单测 —— 假渠道服务器验证 payload、冷却去重、失败容错、测试直发
require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const { cleanup } = require('./helpers');

let server;
let received = [];
let base;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ url: req.url, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ errcode: 0 }));
    });
  });
  const port = await freePort();
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  cleanup();
});

function setupChannels() {
  const alerts = require('../server/services/alerts');
  const cfg = alerts.getConfig();
  cfg.channels = [
    { id: 't1', type: 'dingtalk', name: '钉钉测试', enabled: true, config: { url: `${base}/dingtalk` } },
    { id: 't2', type: 'webhook', name: '自定义', enabled: true, config: { url: `${base}/hook` } },
  ];
  cfg.cooldownMin = 120;
  alerts.saveConfig(cfg);
  return alerts;
}

test('分发:钉钉 text 格式 + 自定义 webhook 通用格式', async () => {
  received = [];
  const alerts = setupChannels();
  const r = await alerts.dispatch('source_paused', { sourceId: 999, title: '测试标题', text: '测试正文' });
  assert.equal(r.sent, 2);
  const ding = received.find((x) => x.url === '/dingtalk');
  assert.ok(ding, '钉钉渠道应收到请求');
  const payload = JSON.parse(ding.body);
  assert.equal(payload.msgtype, 'text');
  assert.ok(payload.text.content.includes('测试标题'));
  const hook = JSON.parse(received.find((x) => x.url === '/hook').body);
  assert.equal(hook.event, 'source_paused');
  assert.ok(hook.time);
});

test('冷却:同源同事件 2 小时内不重复发送', async () => {
  received = [];
  const alerts = setupChannels();
  await alerts.dispatch('source_paused', { sourceId: 888, title: 'A', text: 'a' });
  const r2 = await alerts.dispatch('source_paused', { sourceId: 888, title: 'A2', text: 'a2' });
  assert.equal(r2.skipped, 'cooldown');
  assert.equal(received.length, 2); // 只有第一次的 2 个渠道
  // 不同源不受冷却影响
  received = [];
  const r3 = await alerts.dispatch('source_paused', { sourceId: 777, title: 'B', text: 'b' });
  assert.equal(r3.sent, 2);
});

test('容错:渠道失败不影响其他渠道,且触发日志留痕', async () => {
  const alerts = setupChannels();
  const cfg = alerts.getConfig();
  cfg.channels[0].config.url = 'http://127.0.0.1:1/dead'; // 死地址
  alerts.saveConfig(cfg);
  const r = await alerts.dispatch('source_error', { sourceId: 555, title: '容错测试', text: 'x' });
  assert.equal(r.sent, 1); // 好渠道仍成功
  const log = alerts.getConfig().recentLog;
  assert.ok(log[0].title === '容错测试' && log[0].results.some((x) => !x.ok));
});

test('sourceError 阈值:连失 2 次报 source_error,3 次升级为 source_paused,重复暂停不再报', async () => {
  const alerts = setupChannels();
  const src = { id: 444, name: '测试源' };
  let r = await alerts.sourceError(src, 1, 'e');
  assert.equal(r.skipped, 'below-threshold');
  r = await alerts.sourceError(src, 2, 'e');
  assert.equal(r.sent, 2); // source_error 发出
  r = await alerts.sourceError(src, 3, 'e');
  assert.equal(r.sent, 2); // 升级为 source_paused,是更严重的新事件,不受 source_error 冷却影响
  r = await alerts.sourceError(src, 3, 'e'); // 重复暂停事件
  assert.equal(r.skipped, 'cooldown');
});

test('事件开关:关闭后不发送', async () => {
  const alerts = setupChannels();
  const cfg = alerts.getConfig();
  cfg.events.collect_stalled = false;
  alerts.saveConfig(cfg);
  const r = await alerts.collectStalled('测试');
  assert.equal(r.skipped, 'disabled');
});

test('加签:钉钉 sign 进 URL,飞书 sign 进 body', async () => {
  received = [];
  const alerts = require('../server/services/alerts');
  const ding = { name: '钉', config: { url: `${base}/dd?a=1`, secret: 'SEC123' } };
  await alerts.SENDERS.dingtalk(ding, 't', 'x');
  const dingReq = received.find((x) => x.url.startsWith('/dd'));
  assert.ok(/[?&]timestamp=\d+/.test(dingReq.url), '钉钉 URL 应带 timestamp');
  assert.ok(/[?&]sign=/.test(dingReq.url), '钉钉 URL 应带 sign');

  const fs = { name: '飞', config: { url: `${base}/fs`, secret: 'SEC456' } };
  await alerts.SENDERS.feishu(fs, 't', 'x');
  const fsBody = JSON.parse(received.find((x) => x.url === '/fs').body);
  assert.ok(fsBody.timestamp && fsBody.sign, '飞书 body 应带 timestamp/sign');
  assert.equal(fsBody.msg_type, 'text');
});
