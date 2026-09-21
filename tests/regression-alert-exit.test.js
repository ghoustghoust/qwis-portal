// B69（P1-2）：「报警有出口」只许一份实现（lib/alert-channels#usableChannels），
// 本地 health 摘要与云端 /api/health/status 都走它，且哨兵渠道不算出口
'use strict';
require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runDriver } = require('./driver-runner');

const ROOT = path.join(__dirname, '..');
const AC = () => require('../lib/alert-channels');

test('AE1 两端健康面都引 usableChannels，不再自带第二份判定（B69 源码形态）', () => {
  const local = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'health.js'), 'utf8');
  const cloud = fs.readFileSync(path.join(ROOT, 'api', '[...slug].js'), 'utf8');
  assert.ok(local.includes("require('../../lib/alert-channels')") && /usableChannels\(/.test(local),
    '本地 health.js 没接 usableChannels');
  assert.ok(/require\('\.\.\/lib\/alert-channels'\)/.test(cloud) && /usableChannels\(/.test(cloud),
    '云端 health/status 没接 usableChannels');
  // 旧坏形态：只看 enabled 就报数
  assert.ok(!/enabledChannelCount: channels\.filter/.test(local) || /usableChannelCount/.test(local),
    '本地仍只有「开着」计数而没有「有出口」计数');
});

test('AE2 哨兵渠道不算出口：noExit 必须为真（BL7 家族：test-ch 开着但打不出去）（B69）', () => {
  const { usableChannels } = AC();
  const sentinel = [{ id: 'test-ch', enabled: true, config: { url: 'http://127.0.0.1:1' } }];
  assert.equal(usableChannels(sentinel).length, 0, '哨兵渠道被判成有出口');
  const real = [{ id: 'feishu-123', enabled: true, config: { url: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc' } }];
  assert.equal(usableChannels(real).length, 1, '真渠道被误判成无出口');
});

test('AE3 云端 /api/health/status：alerts 摘要带 usableChannelCount/noExit，且不回显任何 URL（B69）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae3-'));
  const DRIVER = path.join(ROOT, `.alert-exit-driver-${process.pid}.cjs`);
  fs.writeFileSync(DRIVER, `
process.env.TURSO_DATABASE_URL = 'file:' + process.argv[2].replace(/\\\\/g, '/');
process.env.TURSO_AUTH_TOKEN = '';
process.env.AUTH_SECRET = 'local-test-secret';
const jwt = require('jsonwebtoken');
const TOKEN = jwt.sign({ sub: 'admin', role: 'admin' }, 'local-test-secret');
const db = require(${JSON.stringify(path.join(ROOT, 'lib', 'db.js'))});
const handler = require(${JSON.stringify(path.join(ROOT, 'api', '[...slug].js'))});
(async () => {
  await db.ensureSchema();
  await db.setSetting('alerts', { channels: [{ id: 'test-ch', enabled: true, config: { url: 'http://127.0.0.1:1' } }], recentLog: [] });
  const res = { _s: 200, _b: null };
  res.setHeader = () => res; res.status = (s) => { res._s = s; return res; };
  res.json = (b) => { res._b = b; return res; }; res.send = (b) => { res._b = b; return res; }; res.end = () => res;
  await handler({ method: 'GET', url: '/api/health/status', query: {}, headers: { authorization: 'Bearer ' + TOKEN } }, res);
  console.log('OUT ' + JSON.stringify(res._b));
  process.exit(0);
})().catch((e) => { console.error('DRIVERERR ' + e.message); process.exit(3); });
`);
  try {
    const out = runDriver(DRIVER, [path.join(dir, 't.db')], { payloadRe: /^OUT /m });
    const body = JSON.parse(/^OUT (.+)$/m.exec(out)[1]);
    assert.equal(body.ok, true, JSON.stringify(body).slice(0, 200));
    assert.equal(body.alerts.usableChannelCount, 0, '哨兵渠道被算成有出口');
    assert.equal(body.alerts.noExit, true, '哨兵渠道在场时 noExit 必须为真');
    assert.ok(!JSON.stringify(body).includes('127.0.0.1'), '响应里回显了渠道 URL（脱敏面破口）');
  } finally {
    try { fs.rmSync(DRIVER, { force: true }); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});
