// 15-cloud-alerts 回归测试：云端报警引擎真实驱动（test 渠道用不可达 webhook，验证失败隔离）
// 运行：node --test tests/regression-cloud-alerts.test.js
const { test, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
for (const line of envTxt.split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

process.env.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const alerts = require('../api/_alerts');
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

let origAlerts = null;
let origCooldowns = null;

// 保存/恢复现场：alerts 配置与冷却是真实生产配置
// 2026-09-19 加固（坑 #T2 / BL7）：本测试曾把生产 settings.alerts 写成测试渠道且无人发现，
// 报警链路哑了两天。规则：①快照必须在任何用例之前完成；②恢复后必须回读断言，
// 恢复不成立就让测试变红；③开跑前先检查现场是否已被测试残留污染，污染则拒绝继续。
async function snapshot() {
  const a = await db.execute("SELECT value FROM settings WHERE key='alerts'");
  origAlerts = a.rows[0] ? a.rows[0].value : null;
  const c = await db.execute("SELECT value FROM settings WHERE key='alerts.cooldowns'");
  origCooldowns = c.rows[0] ? c.rows[0].value : null;
}
async function restore() {
  if (origAlerts !== null) await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('alerts',?)", args: [origAlerts] });
  if (origCooldowns !== null) await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('alerts.cooldowns',?)", args: [origCooldowns] });
}
async function verifyRestored() {
  const a = await db.execute("SELECT value FROM settings WHERE key='alerts'");
  const now = a.rows[0] ? a.rows[0].value : null;
  assert.equal(now, origAlerts, '现场恢复失败：生产 settings.alerts 与快照不一致，报警渠道可能被测试写坏（坑 #T2）');
}

// 快照在任何用例前取得（不放进 test()，避免与用例抢顺序）
// 生产现场已被测试残留污染时：本文件凡"写生产 alerts 配置"的用例一律跳过，
// 并以 diagnostic 打出恢复命令 —— 既不往坏现场叠写，也不伪造绿灯（skip ≠ pass，见 EVAL_GUIDE §3.4）。
let PROD_POLLUTED = false;

test('0. 现场快照与污染前置检查', async (t) => {
  await snapshot();
  assert.ok(origAlerts !== null, '生产 settings.alerts 必须存在，否则无从恢复');
  let cfg = {};
  try { cfg = JSON.parse(origAlerts); } catch { /* 非 JSON 视为污染 */ PROD_POLLUTED = true; }
  const bad = (cfg.channels || []).filter((c) => /^test-/i.test(String(c.id || ''))
    || /127\.0\.0\.1|localhost/i.test(String((c.config || {}).url || '')));
  if (bad.length || !Array.isArray(cfg.channels) || cfg.channels.length === 0) {
    PROD_POLLUTED = true;
    t.diagnostic(`⚠ 生产报警渠道不可用（残留/空：${JSON.stringify((cfg.channels || []).map((c) => c.id))}）`);
    t.diagnostic('⚠ 报警链路当前无出口；恢复命令：node tools/sync-alerts-config.js --force（需授权写生产）');
    t.diagnostic('⚠ 本文件写生产配置的用例（4/6/7）已跳过 —— skip 不算通过');
  }
});

const needsCleanProd = (t) => { if (PROD_POLLUTED) t.skip('生产 alerts 配置已污染，避免叠写'); };

after(async () => {
  await restore();
  if (!PROD_POLLUTED) await verifyRestored();
  db.close();
});

test('1. 错误分类器：youtube+404 → 反爬封锁；超时/DNS/500 分类正确', () => {
  assert.equal(alerts.classifyError('HTTP 404', 'youtube').category, '反爬封锁');
  assert.match(alerts.classifyError('HTTP 404', 'youtube').advice, /无需处理/);
  assert.equal(alerts.classifyError('HTTP 404', 'rss').category, '地址失效');
  assert.equal(alerts.classifyError('fetch timeout', 'rss').category, '超时');
  assert.equal(alerts.classifyError('ENOTFOUND x', 'rss').category, 'DNS 解析失败');
  assert.equal(alerts.classifyError('HTTP 502', 'rss').category, '源站故障');
});

test('2. 掩码合并：PUT 回写掩码不覆盖真实密钥', () => {
  const old = [{ id: 'c1', type: 'webhook', name: 't', config: { url: 'https://real.example.com/hook' } }];
  const neu = [{ id: 'c1', type: 'webhook', name: 't', config: { url: '********' } }];
  const merged = alerts.mergeChannelSecrets(old, neu);
  assert.equal(merged[0].config.url, 'https://real.example.com/hook');
});

test('3. 掩码输出：GET 视角密钥变 ********', () => {
  const masked = alerts.maskChannels([{ id: 'c1', type: 'webhook', config: { url: 'https://x' } }]);
  assert.equal(masked[0].config.url, '********');
});

test('4. dispatch 冷却：同事件同源第二次被抑制', async (t) => {
  needsCleanProd(t);
  // 临时配置：不可达 webhook 渠道
  await alerts.saveConfig({
    channels: [{ id: 'test-ch', type: 'webhook', name: 'TEST', enabled: true, config: { url: 'http://127.0.0.1:1/unreachable' } }],
    events: { source_error: true }, cooldownMin: 120, recentLog: [], silence: [],
  });
  await db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('alerts.cooldowns','{}')");
  const src = { id: 999999, name: 'TEST-源', type: 'rss' };
  const r1 = await alerts.sourceAlert(src, 2, 'HTTP 404');
  assert.equal(r1.sent, 0); // 渠道不可达，发送失败但流程走通
  assert.ok(!r1.skipped, '第一次不应被冷却');
  const r2 = await alerts.sourceAlert(src, 2, 'HTTP 404');
  assert.equal(r2.skipped, 'cooldown', '第二次应被冷却抑制');
});

test('5. dispatch 失败隔离：渠道不可达不 throw', async () => {
  const r = await alerts.dispatch('source_error', { sourceId: 888888, title: 'TEST', text: 'x' });
  assert.equal(typeof r.sent, 'number');
});

test('6. 静默规则：命中 silence 的事件不发送', async (t) => {
  needsCleanProd(t);
  await alerts.saveConfig({
    channels: [{ id: 'test-ch', type: 'webhook', name: 'TEST', enabled: true, config: { url: 'http://127.0.0.1:1/x' } }],
    events: { source_error: true }, cooldownMin: 120, recentLog: [],
    silence: [{ sourceId: 777777, event: 'source_error' }],
  });
  await db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('alerts.cooldowns','{}')");
  const r = await alerts.sourceAlert({ id: 777777, name: 'TEST-静默源', type: 'rss' }, 2, 'HTTP 404');
  assert.equal(r.skipped, 'silenced');
});

test('7. frozen_digest：无熔断源时不发（当前线上应为 0 或少量）', async (t) => {
  needsCleanProd(t);
  await db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('alerts.cooldowns','{}')");
  const r = await alerts.frozenDigest();
  // 有熔断源则发到不可达渠道（sent=0 但流程走通），无则 no-frozen
  assert.ok(r.skipped === 'no-frozen' || typeof r.sent === 'number');
});
