// WeRSS 集成路由单测：起一个假的 we-mp-rss 服务，验证扫码取码/图片代理/状态轮询/收尾/同步链路
require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const express = require('express');
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

const PNG_BYTES = Buffer.from('89504e470d0a1a0a', 'hex'); // PNG 魔数占位

let fakeWemp; // 假 we-mp-rss
let appServer;
let base; // 情报系统侧
let scanned = false;

before(async () => {
  // ---- 假 we-mp-rss ----
  fakeWemp = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (obj) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (url.pathname === '/api/v1/wx/auth/login') return json({ code: 0, data: { access_token: 'tok', expires_in: 3600 } });
    if (url.pathname === '/api/v1/wx/mps') {
      return json({ code: 0, data: { total: 2, list: [
        { id: 'MP_WXS_1', mp_name: '量子位', status: 1 },
        { id: 'MP_WXS_2', mp_name: '苍何', status: 1 },
      ] } });
    }
    if (url.pathname === '/api/v1/wx/weread/qr/code') { scanned = true; return json({ code: 0, data: { code: '/static/weread_qrcode.png', uid: 'u1' } }); }
    if (url.pathname === '/api/v1/wx/weread/qr/status') return json({ code: 0, data: { login_status: false, msg: '等待扫码...', data: {} } });
    if (url.pathname === '/api/v1/wx/weread/qr/over') return json({ code: 0, data: {} });
    if (url.pathname === '/static/weread_qrcode.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(PNG_BYTES);
    }
    res.writeHead(404); res.end();
  });
  const wempPort = await freePort();
  await new Promise((r) => fakeWemp.listen(wempPort, '127.0.0.1', r));

  process.env.WEMP_BASE_URL = `http://127.0.0.1:${wempPort}`;
  const router = require('../server/routes/wemp');
  const app = express();
  app.use('/api/wemp', router);
  const port = await freePort();
  appServer = http.createServer(app);
  await new Promise((r) => appServer.listen(port, '127.0.0.1', r));
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((r) => appServer.close(r));
  await new Promise((r) => fakeWemp.close(r));
  cleanup();
});

test('weread/qrcode 触发取码并返回图片代理路径', async () => {
  const r = await fetch(`${base}/api/wemp/weread/qrcode`).then((x) => x.json());
  assert.equal(r.ok, true);
  assert.ok(r.qrUrl.startsWith('/api/wemp/weread/qrcode.png'));
  assert.equal(scanned, true); // 确实调用了远端取码
});

test('weread/qrcode.png 代理返回图片且禁缓存', async () => {
  const res = await fetch(`${base}/api/wemp/weread/qrcode.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.equals(PNG_BYTES));
});

test('weread/status 透传等待扫码状态', async () => {
  const r = await fetch(`${base}/api/wemp/weread/status`).then((x) => x.json());
  assert.equal(r.ok, true);
  assert.equal(r.loginStatus, false);
  assert.equal(r.expired, false);
  assert.match(r.msg, /等待扫码/);
});

test('weread/complete 收尾成功', async () => {
  const r = await fetch(`${base}/api/wemp/weread/complete`, { method: 'POST' }).then((x) => x.json());
  assert.equal(r.ok, true);
});

test('sync 把远端订阅同步为本地 wemp 源（幂等）', async () => {
  const r1 = await fetch(`${base}/api/wemp/sync`, { method: 'POST' }).then((x) => x.json());
  assert.equal(r1.ok, true);
  assert.equal(r1.feeds, 2);
  assert.equal(r1.added, 2);
  // 再同步一次不重复
  const r2 = await fetch(`${base}/api/wemp/sync`, { method: 'POST' }).then((x) => x.json());
  assert.equal(r2.added, 0);
  const { db } = require('../server/db');
  const c = db.prepare("SELECT count(*) c FROM sources WHERE type='wemp'").get().c;
  assert.equal(c, 2);
});
