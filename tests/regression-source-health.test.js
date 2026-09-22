// 35B / B23+B24（P1-3）：每源滚动尝试窗口 + 成功率公式唯一实现
// 判据本体：lib/source-health.js；端点：/api/health/source-stats
'use strict';
require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runDriver } = require('./driver-runner');

const ROOT = path.join(__dirname, '..');
const SH = () => require('../lib/source-health');

// 造窗口：从 now 往前每 6h 一条的序列
const mkWindow = (outcomes, nowMs) => {
  let extra = {};
  outcomes.forEach((o, i) => {
    const t = nowMs - (outcomes.length - i) * 6 * 3600e3;
    extra = SH().recordAttempt(extra, o, o === 'f' ? 'net' : null, t);
  });
  return extra;
};

test('SH1 公式精确断言（35B AC1）：全成功≠100、安静源不打红、样本不足→null', () => {
  const now = Date.parse('2026-09-21T12:00:00Z');
  // 8 次全新（忽略衰减时 p̂=(2+8)/12=83.3）
  const allOk = SH().successRate(mkWindow('nnnnnnnn'.split(''), now), { nowMs: now, halfLifeH: 1e9 });
  assert.ok(allOk && allOk.p < 90 && allOk.p > 80, `全成功应接近 83 而非 100：${allOk && allOk.p}`);
  // 8 次 ok-empty（e=0.6）→ (2+4.8)/12 ≈ 56.7 —— 安静源是中间档，不许被判红
  const quiet = SH().successRate(mkWindow('eeeeeeee'.split(''), now), { nowMs: now, halfLifeH: 1e9 });
  assert.ok(quiet && quiet.p > 50 && quiet.p < 65, `安静源应在中档：${quiet && quiet.p}`);
  // 2 次全成功 → W=2 < Wmin=3 → null（不许显示 100%）
  assert.equal(SH().successRate(mkWindow('nn'.split(''), now), { nowMs: now }), null, '样本不足必须 null');
  // 8 次全成功但全在 10 天前（H=48h，每次衰减 0.5^5≈0.031）→ W≈0.25 → null（老样本回拉）
  const staleNow = now + 10 * 86400e3;
  assert.equal(SH().successRate(mkWindow('nnnnnnnn'.split(''), now), { nowMs: staleNow }), null,
    '十天前的老样本应被衰减到「未知」');
});

test('SH2 recordAttempt：三态入窗、定长 40 封顶、滑窗把最旧的类别计数一起带走（35B AC2/F2/F7）', () => {
  let extra = {};
  for (let i = 0; i < 45; i++) extra = SH().recordAttempt(extra, i < 3 ? 'f' : 'n', i < 3 ? 'http' : null, 1000000 + i * 60000);
  const w = SH().windowOf(extra);
  assert.equal(w.length, 40, '窗口没封顶');
  assert.equal(w.filter((e) => e.outcome === 'f').length, 0, '滑出窗口的 3 次 fail 还在');
  const sr = SH().successRate(extra, { nowMs: 1000000 + 45 * 60000, wmin: 0 });
  assert.equal(sr.dominantErr, null, '滑出窗口的错误类别还在计数（F7 滑窗过期失效）');
  // 三类三态都在窗里才完整
  let e2 = {};
  e2 = SH().recordAttempt(e2, 'n', null, 1);
  e2 = SH().recordAttempt(e2, 'e', null, 120000);
  e2 = SH().recordAttempt(e2, 'f', 'auth', 180000);
  const w2 = SH().windowOf(e2);
  assert.deepEqual(w2.map((x) => x.outcome), ['n', 'e', 'f']);
  assert.equal(w2[2].kind, 'auth');
});

test('SH3 端点真值：rate 不再是 ok?100:0，无窗口的源标 unknown，口径随响应回显（35B F6/AC5）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh3-'));
  const DRIVER = path.join(ROOT, `.source-health-driver-${process.pid}.cjs`);
  fs.writeFileSync(DRIVER, `
process.env.TURSO_DATABASE_URL = 'file:' + process.argv[2].replace(/\\\\/g, '/');
process.env.TURSO_AUTH_TOKEN = '';
process.env.AUTH_SECRET = 'local-test-secret';
const jwt = require('jsonwebtoken');
const TOKEN = jwt.sign({ sub: 'admin', role: 'admin' }, 'local-test-secret');
const db = require(${JSON.stringify(path.join(ROOT, 'lib', 'db.js'))});
const sh = require(${JSON.stringify(path.join(ROOT, 'lib', 'source-health.js'))});
const handler = require(${JSON.stringify(path.join(ROOT, 'api', '[...slug].js'))});
(async () => {
  await db.ensureSchema();
  const ins = async (name, withWindow) => {
    const r = await db.dbRun("INSERT INTO sources(type,name,url,enabled,status,fail_count) VALUES('rss',?,?,1,'ok',0)", name, 'http://x/' + name);
    const id = Number(r.lastInsertRowid);
    if (withWindow) {
      let extra = {};
      const now = Date.now();
      for (let i = 0; i < 8; i++) extra = sh.recordAttempt(extra, 'n', null, now - (8 - i) * 3600e3);
      await db.dbRun('UPDATE sources SET extra=? WHERE id=?', JSON.stringify(extra), id);
    }
    return id;
  };
  await ins('有窗口源', true);
  await ins('无窗口源', false);
  const res = { _s: 200, _b: null };
  res.setHeader = () => res; res.status = (s) => { res._s = s; return res; };
  res.json = (b) => { res._b = b; return res; }; res.send = (b) => { res._b = b; return res; }; res.end = () => res;
  await handler({ method: 'GET', url: '/api/health/source-stats', query: {}, headers: { authorization: 'Bearer ' + TOKEN } }, res);
  console.log('OUT ' + JSON.stringify(res._b));
  process.exit(0);
})().catch((e) => { console.error('DRIVERERR ' + e.message); process.exit(3); });
`);
  try {
    const out = runDriver(DRIVER, [path.join(dir, 't.db')], { payloadRe: /^OUT /m });
    const body = JSON.parse(/^OUT (.+)$/m.exec(out)[1]);
    assert.equal(body.ok, true, JSON.stringify(body).slice(0, 200));
    const withW = body.items.find((i) => i.name === '有窗口源');
    const withoutW = body.items.find((i) => i.name === '无窗口源');
    assert.ok(withW && typeof withW.rate === 'number' && withW.rate > 60 && withW.rate < 95,
      `有窗口源的 rate 应是公式真值：${withW && withW.rate}`);
    assert.ok(withoutW && withoutW.rate === null && withoutW.unknown === true,
      '无窗口源必须标 unknown，不许给 100/0');
    assert.ok(body.caliber && body.caliber.v >= 1, '响应没带口径版本（N4）');
    assert.ok(!/status\s*===\s*'ok'\s*\?\s*100/.test(fs.readFileSync(path.join(ROOT, 'api', '[...slug].js'), 'utf8')),
      '端点文件里还存在 ok?100:0 假成功率形态');
  } finally {
    try { fs.rmSync(DRIVER, { force: true }); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

test('SH4 三端写入口同一份实现（源码形态，AGENTS §1）', () => {
  for (const [f, re] of [
    ['tools/collect-turso.js', /require\('\.\.\/lib\/source-health'\)/],
    ['api/collect.js', /require\('\.\.\/lib\/source-health'\)/],
    ['server/services/collectors/fetcher.js', /lib\/source-health/],
    ['server/services/collectors/store.js', /lib\/source-health/],
  ]) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(re.test(src) && src.includes('recordAttempt'), `${f} 没接 lib/source-health`);
  }
});

test('SH5 错误归类粗粒度正确（展示用，别长成第二份分类器）', () => {
  const c = SH().classifyErr;
  assert.equal(c('fetch failed'), 'net');
  assert.equal(c('HTTP 404'), 'http');
  assert.equal(c('Cookie 过期 401'), 'auth');
  assert.equal(c('JSON parse error'), 'parse');
  assert.equal(c('奇奇怪怪的错'), 'other');
});
