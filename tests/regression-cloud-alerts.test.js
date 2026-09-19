// 15-cloud-alerts 回归测试：云端报警引擎（分类器 / 掩码 / 冷却 / 静默 / 失败隔离）
// **2026-09-19 起改在本地 libsql 文件库上跑（B83 / 坑 #T2 / 坑 #52）**。
// 旧版直打生产：`alerts.saveConfig()` 把**生产 settings.alerts 整键换成测试渠道**，靠
// 快照/恢复 + "污染就跳过"兜着。两个真实代价：
//   · 坑 #T2：某次运行没恢复成功，生产报警渠道被留在测试渠道上，报警链路哑了两天无人发现；
//   · 就在本轮：生产现场仍是污染态（preflight 报 channels=["test-ch:http://127.0.0.1:1/…"]），
//     于是旧版第 4/6/7 条**今天整批 skip**——覆盖率被生产状态悄悄吃掉（skip ≠ pass）。
// 现在这三条跑在本地库上：无论生产怎样都会真跑，且生产配置不再被测试改写。
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(os.tmpdir(), `cloud-alerts-${process.pid}.db`).replace(/\\/g, '/');
const DRIVER = path.join(ROOT, `.cloud-alerts-driver-${process.pid}.cjs`);
const alerts = require('../api/_alerts');   // 纯函数部分（分类器/掩码）在本进程直接判

function run(caseName) {
  const out = execFileSync(process.execPath, [DRIVER, caseName, DB_FILE],
    { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  const line = out.trim().split('\n').filter((l) => l.startsWith('OUT ')).pop();
  assert.ok(line, `子进程没打印结果（${caseName}）：\n${out}`);
  return JSON.parse(line.slice(4));
}

before(() => {
  fs.writeFileSync(DRIVER, `
process.env.TURSO_DATABASE_URL = 'file:' + process.argv[3];
process.env.TURSO_AUTH_TOKEN = '';
const { createClient } = require('@libsql/client');
const alerts = require(${JSON.stringify(path.join(ROOT, 'api', '_alerts.js'))});
const CASE = process.argv[2];
const CH = { channels: [{ id: 'test-ch', type: 'webhook', name: 'TEST', enabled: true, config: { url: 'http://127.0.0.1:1/unreachable' } }],
  events: { source_error: true }, cooldownMin: 120, recentLog: [], silence: [] };
(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL });
  await db.execute('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)');
  await db.execute('CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, name TEXT NOT NULL, url TEXT, avatar TEXT, uid TEXT, group_id INTEGER, focus INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, status TEXT DEFAULT \\'ok\\', last_fetched_at TEXT, next_fetch_at TEXT, extra TEXT, created_at TEXT, fail_count INTEGER DEFAULT 0, spotlight INTEGER DEFAULT 0, muted INTEGER DEFAULT 0, reader_visible INTEGER DEFAULT 1)');
  await db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('alerts.cooldowns','{}')");
  const out = {};
  if (CASE === 'cooldown') {
    await alerts.saveConfig(CH);
    const src = { id: 999999, name: 'TEST-源', type: 'rss' };
    const r1 = await alerts.sourceAlert(src, 2, 'HTTP 404');
    const r2 = await alerts.sourceAlert(src, 2, 'HTTP 404');
    out.r1 = r1; out.r2 = r2;
  }
  if (CASE === 'silence') {
    await alerts.saveConfig({ ...CH, silence: [{ sourceId: 777777, event: 'source_error' }] });
    out.r = await alerts.sourceAlert({ id: 777777, name: 'TEST-静默源', type: 'rss' }, 2, 'HTTP 404');
  }
  if (CASE === 'frozen') {
    await alerts.saveConfig(CH);
    out.r = await alerts.frozenDigest();
    // 再造一个熔断源：应当真的去发（不可达渠道 → sent=0，但流程走通）
    await db.execute({ sql: "INSERT OR REPLACE INTO sources(id,type,name,url,enabled,status,fail_count) VALUES(555,'rss','TEST-熔断源','https://x.example.com/f',0,'paused',3)" });
    out.r2 = await alerts.frozenDigest();
  }
  if (CASE === 'dispatch') out.r = await alerts.dispatch('source_error', { sourceId: 888888, title: 'TEST', text: 'x' });
  // 现场自查：本用例跑完后，配置只在本地库里，生产从未被碰过
  out.cfgKeys = (await db.execute('SELECT key FROM settings ORDER BY key')).rows.map((r) => r.key);
  console.log('OUT ' + JSON.stringify(out));
  await db.close();
})().catch((e) => { console.error('DRIVERERR ' + e.message); process.exitCode = 3; });
`);
});
after(() => {
  for (const f of [DRIVER, DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) {
    try { fs.rmSync(f, { force: true }); } catch { /* 关不掉就留给系统临时目录 */ }
  }
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
  assert.equal(alerts.mergeChannelSecrets(old, neu)[0].config.url, 'https://real.example.com/hook');
});

test('3. 掩码输出：GET 视角密钥变 ********', () => {
  assert.equal(alerts.maskChannels([{ id: 'c1', type: 'webhook', config: { url: 'https://x' } }])[0].config.url, '********');
});

test('4. dispatch 冷却：同事件第二次被抑制（本地库，永远真跑）', () => {
  const r = run('cooldown');
  assert.equal(r.r1.sent, 0, '渠道不可达应 sent=0：' + JSON.stringify(r.r1));
  assert.ok(!r.r1.skipped, '第一次不应被冷却：' + JSON.stringify(r.r1));
  assert.equal(r.r2.skipped, 'cooldown', '第二次应被冷却抑制：' + JSON.stringify(r.r2));
});

test('5. dispatch 失败隔离：渠道不可达不 throw', () => {
  const r = run('dispatch');
  assert.equal(typeof r.r.sent, 'number', JSON.stringify(r.r));
});

test('6. 静默规则：命中 silence 的事件不发送', () => {
  assert.equal(run('silence').r.skipped, 'silenced');
});

test('7. frozen_digest：无熔断源不发，有熔断源才走发送', () => {
  const r = run('frozen');
  assert.equal(r.r.skipped, 'no-frozen', '本地库初始没有熔断源：' + JSON.stringify(r.r));
  assert.equal(typeof r.r2.sent, 'number', '造出熔断源后应走发送：' + JSON.stringify(r.r2));
});

test('8. 自证：本文件不再碰生产库（B83/坑 #T2 的门禁）', () => {
  const full = fs.readFileSync(path.join(__dirname, 'regression-cloud-alerts.test.js'), 'utf8');
  const cut = full.indexOf("test('8.");
  assert.ok(cut > 0, '找不到自证条目起点，本条会退化成恒真');
  const src = full.slice(0, cut);
  assert.ok(!/['"]\.env['"]/.test(src), '还在读 .env → 又要拿真凭据连生产库了');
  assert.ok(!/authToken:\s*process\.env/.test(src), 'createClient 带真实 authToken → 会打到生产 Turso');
  assert.match(src, /TURSO_DATABASE_URL = 'file:'/, '子进程必须被指到本地文件库');
  assert.ok(!/PROD_POLLUTED/.test(src), '污染跳过的老机制已废弃：本地库上这三条必须真跑');
});
