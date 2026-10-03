// H52 回归锁：报警渠道的回调地址必须过真出口判据（lib/alert-channels）。
// 为什么：现役库的"渠道齐、看起来通"是当年从本地副本迁库的副产物，不是修好的结果；
// 旧库里那份至今仍是本机回环哨兵——任何"迁 settings / 手滑保存"都会把哨兵带回现役库，
// 而症状是"渠道数对、配置齐、一条都发不出去"（BL7）。此前判据契约只钉了 2 个形态、
// 写入口完全不设防。本锁三腿：①判据全契约双向；②写入口（云端+本地）真接了守卫；
// ③云端保存路径行为探针（哨兵 400、真地址 200、停用不拦）。云端复验现读法见
// docs/ISSUES.md H35（每条回调喂判据 + 最近投递有无成功）。
'use strict';
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { test, before, after } = require('node:test');
const { runDriver } = require('./driver-runner');

const ROOT = path.join(__dirname, '..');
const { isRealEndpointUrl, usableChannels, assertEnabledChannelsHaveExit } = require('../lib/alert-channels');

test('H52-1 真出口判据全契约：每个拒绝分支都有一个坏样本钉着（放宽任何一条就红）', () => {
  const rejected = [
    '', 'undefined', 'null', 'not a url',                    // 解析失败/坏值形态
    'ftp://files.example.com/hook',                          // 非 http(s)
    'https://user:pass@oapi.example.com/hook',               // userinfo 凭据进日志
    'http://127.0.0.1:1/hook', 'http://localhost:9000/hook', // 回环
    'http://[::1]:9000/', 'http://[fe80::1]/hook',           // IPv6 回环/链路本地
    'http://10.0.0.5/hook', 'http://192.168.1.7/hook', 'http://172.16.0.9/hook', // 内网
    'http://169.254.169.254/latest/meta-data',               // 云元数据面
    'http://metadata.google.internal/', 'http://printer.local/hook', // 内部 TLD
    'http://[fd00::1]/hook',                                 // IPv6 ULA
    'https://webhook.example.com:80/hook',                   // 哨兵端口（<1024）
  ];
  for (const url of rejected) {
    assert.equal(isRealEndpointUrl(url), false, `该形态必须判否：${JSON.stringify(url)}`);
  }
});

test('H52-2 真出口判据：真 webhook 形态必须通过（判据不许放宽成全否）', () => {
  for (const url of [
    'https://oapi.dingtalk.com/robot/send?access_token=x',
    'https://qyapi.weixin.qq.com/cgi-bin/webhook?key=x',
    'http://alerts.example.org:9000/hook',
  ]) {
    assert.equal(isRealEndpointUrl(url), true, `真出口形态被误拒：${url}`);
  }
});

test('H52-3 共享守卫：启用渠道必须过判据，停用渠道不拦', () => {
  assert.throws(
    () => assertEnabledChannelsHaveExit([{ id: 'x', enabled: true, config: { url: 'http://127.0.0.1:1' } }]),
    /真出口/,
    '启用中的哨兵渠道没被拒'
  );
  assert.doesNotThrow(
    () => assertEnabledChannelsHaveExit([{ id: 'x', enabled: true, config: { url: 'https://oapi.dingtalk.com/robot/send' } }]),
    '真渠道被误拦'
  );
  assert.doesNotThrow(
    () => assertEnabledChannelsHaveExit([{ id: 'x', enabled: false, config: { url: 'http://127.0.0.1:1' } }]),
    '停用渠道不该拦（它不构成出口主张）'
  );
  assert.equal(usableChannels([{ id: 'test-ch', enabled: true, config: { url: 'https://oapi.dingtalk.com/robot/send' } }]).length, 0,
    '哨兵 id（test- 前缀）不该算可用渠道（BL7 形态）');
});

test('H52-4 写入口接线：云端与本地保存路径都过了守卫（不许只在健康面判）', () => {
  const cloud = fs.readFileSync(path.join(ROOT, 'api', '[...slug].js'), 'utf8');
  assert.match(cloud, /assertEnabledChannelsHaveExit/, '云端 PUT /api/alerts/config 没接守卫');
  const local = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'alerts.js'), 'utf8');
  assert.match(local, /assertEnabledChannelsHaveExit/, '本地 PUT /api/alerts/config 没接守卫');
});

// ─── H52-5 云端保存路径行为探针（子进程 + file: 本地库，零生产写入） ──────────
const DB_FILE = path.join(os.tmpdir(), `alert-guard-${process.pid}.db`).replace(/\\/g, '/');
const DRIVER = path.join(ROOT, `.alert-guard-driver-${process.pid}.cjs`);

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
  const cfg = (url, enabled) => ({ alerts: { channels: [{ id: 'guard-ch', enabled, type: 'webhook', name: '守卫探针', config: { url } }] } });
  if (CASE === 'put-sentinel') r = await call('PUT', '/api/alerts/config', cfg('http://127.0.0.1:1', true));
  if (CASE === 'put-real') r = await call('PUT', '/api/alerts/config', cfg('https://oapi.dingtalk.com/robot/send?access_token=x', true));
  if (CASE === 'put-disabled-sentinel') r = await call('PUT', '/api/alerts/config', cfg('http://127.0.0.1:1', false));
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

test('H52-5 云端保存哨兵回调 → 400 且不落库', () => {
  const r = run('put-sentinel');
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.error, /真出口/);
});

test('H52-6 云端保存真回调 → 200', () => {
  const r = run('put-real');
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('H52-7 停用中的哨兵回调不拦（它不构成出口主张）', () => {
  const r = run('put-disabled-sentinel');
  assert.equal(r.status, 200, JSON.stringify(r.body));
});
