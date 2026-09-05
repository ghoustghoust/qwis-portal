// T46 - 云端队列协议单测（T33/T34/T35，F43/F44，N3）
// 用便携 PHP（tools/.php-runtime/php.exe -S）在临时目录起 cloud/ 服务，
// 测 push / pull / clear 协议与 Token 403；并端到端验证本地 poller.syncQueue 导入链路。
// 临时 docroot 为 cloud/ 的拷贝（测试 Token 独立生成），不污染 cloud/ 与 data/app.db。
require('./helpers');
const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const { cleanup, DATA_DIR } = require('./helpers');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PHP_EXE = path.join(ROOT, 'tools', '.php-runtime', 'php.exe');
const TOKEN = 'test-token-3f9a1c7e5b2d4806aa11cc22dd33ee44ff556677'; // 测试专用 Token

let php = null;
let docroot = null;
let baseUrl = null;

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

async function waitReady(url, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error('PHP 服务未就绪: ' + url);
}

async function api(endpoint, { method = 'GET', token = TOKEN, action, body } = {}) {
  const qs = new URLSearchParams();
  if (token !== null) qs.set('token', token);
  if (action) qs.set('action', action);
  const res = await fetch(`${baseUrl}/${endpoint}?${qs}`, {
    method,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* 非 JSON 响应 */ }
  return { status: res.status, json };
}

before(async () => {
  // 1. 拷贝 cloud/ 到临时 docroot，写测试 token.json
  docroot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'qwis-cloud-'));
  for (const f of ['_queue_lib.php', 'wechat-rss-queue.php', 'bilibili-video-queue.php', 'douyin-video-queue.php']) {
    fs.copyFileSync(path.join(ROOT, 'cloud', f), path.join(docroot, f));
  }
  fs.writeFileSync(path.join(docroot, 'token.json'), JSON.stringify({ token: TOKEN }));

  // 2. spawn 便携 PHP 内置服务
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  php = spawn(PHP_EXE, ['-S', `127.0.0.1:${port}`, '-t', docroot], { stdio: 'ignore' });
  php.on('error', (e) => { throw e; });
  await waitReady(`${baseUrl}/wechat-rss-queue.php`);
});

after(() => {
  if (php && !php.killed) php.kill();
  php = null;
  if (docroot) { try { fs.rmSync(docroot, { recursive: true, force: true }); } catch { /* 尽力清理 */ } }
  cleanup();
});

test('Token 鉴权：无 Token / 错误 Token 一律 403 bad token（N3）', async () => {
  for (const ep of ['wechat-rss-queue.php', 'bilibili-video-queue.php', 'douyin-video-queue.php']) {
    const noToken = await api(ep, { token: null });
    assert.equal(noToken.status, 403, `${ep} 无 token 应 403`);
    assert.deepEqual(noToken.json, { ok: false, error: 'bad token' });
    const badToken = await api(ep, { token: 'wrong-token' });
    assert.equal(badToken.status, 403, `${ep} 错误 token 应 403`);
    assert.deepEqual(badToken.json, { ok: false, error: 'bad token' });
  }
});

test('push → pull(count 正确) → clear → 再 pull(count=0) 全流程（三端点）', async () => {
  const cases = [
    { ep: 'wechat-rss-queue.php', url: 'https://mp.weixin.qq.com/s/abc123', name: '某公众号文章' },
    { ep: 'bilibili-video-queue.php', url: 'https://space.bilibili.com/546195', name: '某UP主' },
    { ep: 'douyin-video-queue.php', url: 'https://www.douyin.com/user/MS4wLjABAAAAxxx', name: '某作者' },
  ];
  for (const c of cases) {
    // push 两条
    const p1 = await api(c.ep, { method: 'POST', body: { token: TOKEN, url: c.url, name: c.name } });
    assert.deepEqual(p1.json, { ok: true });
    const p2 = await api(c.ep, { method: 'POST', body: { token: TOKEN, url: c.url + '#2', name: c.name + '2' } });
    assert.deepEqual(p2.json, { ok: true });
    // pull：count=2，字段齐全
    const pull1 = await api(c.ep, { action: 'pull' });
    assert.equal(pull1.json.ok, true);
    assert.equal(pull1.json.count, 2);
    assert.equal(pull1.json.items.length, 2);
    assert.equal(pull1.json.items[0].url, c.url);
    assert.equal(pull1.json.items[0].name, c.name);
    // clear
    const clr = await api(c.ep, { action: 'clear' });
    assert.deepEqual(clr.json, { ok: true });
    // 再 pull：count=0
    const pull2 = await api(c.ep, { action: 'pull' });
    assert.equal(pull2.json.count, 0);
    assert.deepEqual(pull2.json.items, []);
  }
});

test('type 校验：端点拒绝不属于本平台的链接（400）', async () => {
  // 公众号队列拒绝 B站链接
  const r1 = await api('wechat-rss-queue.php', { method: 'POST', body: { token: TOKEN, url: 'https://www.bilibili.com/video/BV1xx411c7mD' } });
  assert.equal(r1.status, 400);
  assert.equal(r1.json.ok, false);
  // B站队列拒绝公众号链接
  const r2 = await api('bilibili-video-queue.php', { method: 'POST', body: { token: TOKEN, url: 'https://mp.weixin.qq.com/s/abc' } });
  assert.equal(r2.status, 400);
  // 抖音队列拒绝 B站链接
  const r3 = await api('douyin-video-queue.php', { method: 'POST', body: { token: TOKEN, url: 'https://www.bilibili.com/video/BV1xx411c7mD' } });
  assert.equal(r3.status, 400);
  // 缺 url → 400 missing url
  const r4 = await api('wechat-rss-queue.php', { method: 'POST', body: { token: TOKEN } });
  assert.equal(r4.status, 400);
  assert.equal(r4.json.error, 'missing url');
});

test('Token 放 POST body 同样通过鉴权', async () => {
  // body 里带 token（query 无 token），push 应成功
  const res = await fetch(`${baseUrl}/wechat-rss-queue.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN, url: 'https://mp.weixin.qq.com/s/body-token', name: 'body token 测试' }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  await api('wechat-rss-queue.php', { action: 'clear' });
});

test('本地 poller.syncQueue(wechat)：云端两条 → 导入 pending_items → 云端清空', async () => {
  const { db, setSetting } = require('../server/db');
  const poller = require('../server/services/queue/poller');
  setSetting('queue', { baseUrl, token: TOKEN, intervalMin: 10, enabled: true });

  // 云端 push 两条公众号链接
  await api('wechat-rss-queue.php', { method: 'POST', body: { token: TOKEN, url: 'https://mp.weixin.qq.com/s/q1', name: '队列文章一' } });
  await api('wechat-rss-queue.php', { method: 'POST', body: { token: TOKEN, url: 'https://mp.weixin.qq.com/s/q2', name: '队列文章二' } });

  const r = await poller.syncQueue('wechat');
  assert.deepEqual(r, { imported: 2, updated: 0, cleared: 2 });

  const rows = db.prepare("SELECT * FROM pending_items WHERE type='wechat' ORDER BY id").all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, 'pending'); // wechat 不自动 resolve（F24）
  assert.equal(rows[1].name, '队列文章二');

  // 云端已清空
  const pull = await api('wechat-rss-queue.php', { action: 'pull' });
  assert.equal(pull.json.count, 0);

  // 重复同步同一链接：不重复导入（更新已有）
  await api('wechat-rss-queue.php', { method: 'POST', body: { token: TOKEN, url: 'https://mp.weixin.qq.com/s/q1', name: '队列文章一' } });
  const r2 = await poller.syncQueue('wechat');
  assert.deepEqual(r2, { imported: 0, updated: 1, cleared: 1 });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM pending_items WHERE type='wechat'").get().c, 2);
});

test('poller：未配置地址/Token 时 syncQueue 抛出明确错误', async () => {
  const { setSetting } = require('../server/db');
  const poller = require('../server/services/queue/poller');
  setSetting('queue', { baseUrl: '', token: '', enabled: false });
  await assert.rejects(() => poller.syncQueue('wechat'), /未配置队列地址或 Token/);
});

// 防御：确认测试用的临时数据目录，绝不是真实 data/app.db
test('测试隔离确认：DB 位于临时目录而非 data/', () => {
  assert.ok(DATA_DIR.includes('qwis-test-'));
  const { DATA_DIR: serverDataDir } = require('../server/db');
  assert.equal(serverDataDir, DATA_DIR);
});
