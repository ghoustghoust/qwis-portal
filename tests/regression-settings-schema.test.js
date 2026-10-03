// H41 回归锁：设置面三型静默失真。
// 为什么（账本 H41 / settings-plane.md §三/§四/§六）：
//   ① 未知键静默假保存——本地连清单都没有、写都没写还回"成功"，是唯一会主动骗人的形态；
//   ② 云端 AI 段回显只看 env、执行先看库里那份——"存了、显示也对、运行时没变"；
//   ③ 坏值回落只写日志不落库——生产日志你看不到，"哪些键在吃缺省"无从判别。
// 修法（用户拍板修复包）：合法区判定收敛 lib/settings-schema.js 一份（两端共用）；
// AI 回显与执行共用 api/_ai.js effectiveAiConfig；回落留痕落 settings.valueFallbacks。
'use strict';
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { test, before, after } = require('node:test');

const ROOT = path.join(__dirname, '..');
const schema = require('../lib/settings-schema');
const { effectiveAiConfig } = require('../api/_ai');
const { recordSettingFallback, LIST_KEY } = require('../lib/setting-fallback');
const prescreen = require('../lib/prescreen');

// ── ① 唯一判定：未知区 / 闭集区未知键 / 保留键 ──────────────────────────────
const CLOUD_SECTIONS = ['intervals', 'opml', 'queue', 'daily', 'hot', 'data', 'mybrief', 'weekly', 'prescreen', 'views'];
const LOCAL_SECTIONS = ['intervals', 'opml', 'queue', 'daily', 'hot', 'data', 'views', 'bilibili', 'ai'];

test('H41-1 未知区 → 拒绝并点名（两端同一份判定）', () => {
  for (const sections of [CLOUD_SECTIONS, LOCAL_SECTIONS]) {
    const r = schema.checkWritableKeys({ bogus: { a: 1 } }, { allowSections: sections });
    assert.equal(r.ok, false, '未知区被放行');
    assert.match(r.error, /bogus/);
    assert.match(r.error, /不会生效/, '错误文案必须说清"写了也不会生效"');
  }
});

test('H41-2 闭集区收到未知键 → 拒绝并点名（queue/opml/prescreen/ai/bilibili）', () => {
  const r = schema.checkWritableKeys({ queue: { intervalMin: 5, bogusKey: 1 } }, { allowSections: CLOUD_SECTIONS });
  assert.equal(r.ok, false);
  assert.match(r.error, /queue: bogusKey/);
  const r2 = schema.checkWritableKeys({ ai: { model: 'x', throttleMs: 1 } }, { allowSections: LOCAL_SECTIONS });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /ai: throttleMs/);
});

test('H41-3 已知区与开放集合放行；云端不认 bilibili（它没有那个写入分支）', () => {
  assert.equal(schema.checkWritableKeys({ queue: { intervalMin: 5, enabled: true }, daily: { whatever: 1 } }, { allowSections: CLOUD_SECTIONS }).ok, true);
  assert.equal(schema.checkWritableKeys({ opml: { url: 'x', enabled: true } }, { allowSections: LOCAL_SECTIONS }).ok, true);
  assert.equal(schema.checkWritableKeys({ bilibili: { cookie: 'c' } }, { allowSections: CLOUD_SECTIONS }).ok, false);
});

test('H41-4 保留键（点分键名，顶层或嵌套字面量）都要被点名；区+键形态由①拦', () => {
  assert.deepEqual(schema.findBlocklistedKeys({ 'cloud.collect': 1, hot: { enabled: true } }), ['cloud.collect']);
  assert.deepEqual(schema.findBlocklistedKeys({ queue: { 'auth.secret': 'x' } }), ['auth.secret']);
  assert.deepEqual(schema.findBlocklistedKeys({ hot: { enabled: true } }), []);
  // {admin:{passwordHash:…}} 这种"区+键"形态不属于点分保留键（那是另一行 settings），由①的未知区判定拦下
  assert.equal(schema.checkWritableKeys({ admin: { passwordHash: 'x' } }, { allowSections: CLOUD_SECTIONS }).ok, false);
});

// ── ② AI 回显与执行同一次解析 ────────────────────────────────────────────────
test('H41-5 effectiveAiConfig：库里那份逐字段优先，来源层如实标注', () => {
  process.env.AGNES_MODEL = 'env-model';
  const withSettings = effectiveAiConfig({ enabled: true, model: 'lib-model', apiBase: 'https://x.example.com/v1/', apiKey: 'sk' });
  assert.equal(withSettings.model, 'lib-model');
  assert.equal(withSettings.modelSource, 'settings');
  assert.equal(withSettings.keySource, 'settings');
  assert.equal(withSettings.apiBase, 'https://x.example.com/v1'); // 尾斜杠归一与执行侧同一形状
  const envOnly = effectiveAiConfig({});
  assert.equal(envOnly.model, 'env-model');
  assert.equal(envOnly.modelSource, 'env');
  assert.equal(envOnly.hasKey, false);
  delete process.env.AGNES_MODEL;
});

test('H41-6 接线：执行链与回显共用 effectiveAiConfig（不许各解析一份）', () => {
  const ai = fs.readFileSync(path.join(ROOT, 'api', '_ai.js'), 'utf8');
  assert.match(ai, /const eff = effectiveAiConfig\(cfg\)/, '_providerChain 没走共享解析');
  const slug = fs.readFileSync(path.join(ROOT, 'api', '[...slug].js'), 'utf8');
  assert.match(slug, /effectiveAiConfig\(aiCfg\)/, 'GET /api/settings 的 ai 段没走共享解析');
  assert.match(slug, /modelSource/, '回显没标来源层（哪层在覆盖必须显式）');
});

// ── ③ 回落留痕落库 ───────────────────────────────────────────────────────────
function fakeStore() {
  const m = new Map();
  return { getSetting: async (k, d) => (m.has(k) ? m.get(k) : d), setSetting: async (k, v) => { m.set(k, v); }, _m: m };
}

test('H41-7 留痕：坏值回落写进 valueFallbacks，同键 1 小时节流，上限 50', async () => {
  const s = fakeStore();
  assert.equal(await recordSettingFallback(s, 'prescreen.perSourceCap', 'abc', 2), true);
  const list1 = await s.getSetting(LIST_KEY, []);
  assert.equal(list1.length, 1);
  assert.equal(list1[0].key, 'prescreen.perSourceCap');
  assert.match(list1[0].raw, /abc/);
  assert.equal(await recordSettingFallback(s, 'prescreen.perSourceCap', 'xyz', 2), false, '节流窗口内不应重复写');
  await recordSettingFallback(s, 'other.key', '', 1);
  for (let i = 0; i < 60; i++) await recordSettingFallback(s, 'k' + i, i, 1);
  const list2 = await s.getSetting(LIST_KEY, []);
  assert.equal(list2.length, 50, '列表必须截断在 50 条');
});

test('H41-8 prescreenCapOf：坏值回落并留痕，好值不记，没 store 不炸', async () => {
  const s = fakeStore();
  assert.equal(prescreen.prescreenCapOf('abc', null, s), 2, '坏值必须回默认');
  await new Promise((r) => setImmediate(r));
  const list = await s.getSetting(LIST_KEY, []);
  assert.equal(list.length, 1, '坏值回落没有落库留痕');
  assert.equal(prescreen.prescreenCapOf(7, null, s), 7, '好值不许回落');
  await new Promise((r) => setImmediate(r));
  assert.equal((await s.getSetting(LIST_KEY, [])).length, 1, '好值不该留痕');
  assert.equal(prescreen.prescreenCapOf('abc', null), 2, '没传 store 时必须照常回落（不炸）');
});

test('H41-9 接线：三个生成消费方都把 SETTING_STORE 递给了 prescreenCapOf', () => {
  for (const f of ['tools/collect-turso.js', 'api/daily-generate.js', 'api/[...slug].js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(src, /SETTING_STORE/, `${f} 没有定义/使用 SETTING_STORE`);
    const callLine = src.split('\n').find((l) => l.includes("prescreenCapOf(await getSetting('prescreen.perSourceCap'"));
    assert.ok(callLine, `${f} 里找不到 prescreenCapOf 消费点`);
    assert.match(callLine, /SETTING_STORE/, `${f} 的 prescreenCapOf 没递留痕面：${callLine.trim()}`);
  }
});

// ── 云端 PUT 行为探针（子进程 + file: 本地库，零生产写入） ────────────────────
const { runDriver } = require('./driver-runner');
const DB_FILE = path.join(os.tmpdir(), `settings-schema-${process.pid}.db`).replace(/\\/g, '/');
const DRIVER = path.join(ROOT, `.settings-schema-driver-${process.pid}.cjs`);

function run(caseName) {
  const out = runDriver(DRIVER, [caseName, DB_FILE], { timeout: 120000, payloadRe: /^OUT /m });
  const line = out.trim().split('\n').filter((l) => l.startsWith('OUT ')).pop();
  assert.ok(line, `子进程没打印结果（${caseName}）：\n${out}`);
  return JSON.parse(line.slice(4));
}

before(() => {
  fs.writeFileSync(DRIVER, `
process.env.TURSO_DATABASE_URL = 'file:' + process.argv[3];
process.env.TURSO_AUTH_TOKEN = '';
process.env.AUTH_SECRET = 'local-test-secret';
const jwt = require('jsonwebtoken');
const handler = require(${JSON.stringify(path.join(ROOT, 'api', '[...slug].js'))});
const CASE = process.argv[2];
const TOKEN = jwt.sign({ sub: 'admin', role: 'admin' }, 'local-test-secret');
const DDL = [
  "CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)",
  "CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user TEXT DEFAULT 'admin', action TEXT NOT NULL, target TEXT, detail TEXT, ip TEXT)",
];
(async () => {
  const { createClient } = require('@libsql/client');
  const db = createClient({ url: process.env.TURSO_DATABASE_URL });
  for (const sql of DDL) await db.execute(sql);
  const call = async (method, url, body) => {
    const [p, qs] = url.split('?');
    const res = { _status: 200, _body: null };
    res.setHeader = () => res; res.status = (s) => { res._status = s; return res; };
    res.json = (b) => { res._body = b; return res; }; res.send = (b) => { res._body = b; return res; }; res.end = () => res;
    await handler({ method, url: p, query: Object.fromEntries(new URLSearchParams(qs || '')), body,
      headers: { authorization: 'Bearer ' + TOKEN } }, res);
    return { status: res._status, body: res._body };
  };
  let r;
  if (CASE === 'unknown-section') r = await call('PUT', '/api/settings', { bogus: { a: 1 } });
  if (CASE === 'queue-bad-key') r = await call('PUT', '/api/settings', { queue: { intervalMin: 5, bogusKey: 1 } });
  if (CASE === 'queue-ok') r = await call('PUT', '/api/settings', { queue: { intervalMin: 5, enabled: true } });
  console.log('OUT ' + JSON.stringify({ status: r.status, body: r.body }));
  await db.close();
})().catch((e) => { console.error('DRIVERERR ' + e.message); process.exitCode = 3; });
`);
});
after(() => {
  for (const f of [DRIVER, DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) {
    try { fs.rmSync(f, { force: true }); } catch { /* 留给系统临时目录 */ }
  }
});

test('H41-10 云端 PUT 未知区 → 400 点名，零写入', () => {
  const r = run('unknown-section');
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.error, /bogus/);
});

test('H41-11 云端 PUT 闭集区未知键 → 400 点名', () => {
  const r = run('queue-bad-key');
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.error, /queue: bogusKey/);
});

test('H41-12 云端 PUT 已知区已知键 → 200 照常生效', () => {
  const r = run('queue-ok');
  assert.equal(r.status, 200, JSON.stringify(r.body));
});
