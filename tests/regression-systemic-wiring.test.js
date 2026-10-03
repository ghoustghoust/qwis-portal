// H16 回归锁：系统性故障抑制必须三端同判据，且失败真的路由进了这条判据。
// 为什么：判据（lib/source-breaker.js detectSystemicFailure）曾只在 runner 生效，
// 云端备份采集与本地端只取了熔断阈值、没调这条判据 → 一次代理故障仍会把几百个活源
// 折算成单源连跪逐个熔断（坑 #35 的 458 源事故）。旧对账锁（regression-20260919b）
// 只验"引用了 source-breaker 模块"，验不出"取了阈值但没调判据"这个洞——本锁升级为：
// A. 逐端验"失败登记路径真的调用了同一判据"（H16 现读法：可读代码证）；
// B. 本地端行为正向探针：环境类风暴必须抑制（不计数），稀释后与源侧风暴必须照常计数。
'use strict';
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('H16-A1 runner：失败登记走 detectSystemicFailure(stats.outcomes)', () => {
  const src = read('tools/collect-turso.js');
  assert.match(src, /detectSystemicFailure\(stats\.outcomes\)/, 'runner 没把本轮 outcomes 喂给判据');
  assert.match(src, /systemicSuppressed/, 'runner 没落抑制标记（读数侧无从判别）');
});

test('H16-A2 云端备份采集：同样接线（api/collect.js）', () => {
  const src = read('api/collect.js');
  assert.match(src, /detectSystemicFailure\(stats\.outcomes\)/, 'api/collect.js 没把 outcomes 喂给判据');
  assert.match(src, /systemicSuppressed/, 'api/collect.js 没落抑制标记');
  assert.match(src, /source-breaker/, '判据必须来自 lib/source-breaker（不许另写一份）');
});

test('H16-A3 本地端：markSourceError 先入分母再过判据，成功也入分母', () => {
  const store = read('server/services/collectors/store.js');
  assert.match(store, /windowIsSystemic\(\)/, 'markSourceError 没过系统性判据');
  assert.match(store, /noteOutcome\(false/, '失败没进分母');
  const shared = read('server/services/collectors/_shared.js');
  assert.match(shared, /detectSystemicFailure\(/, '判据必须来自 lib/source-breaker（不许另写一份）');
  assert.match(shared, /ok: !!ok/, '分母丢了成功侧（坑 #39 分母陷阱：只记失败恒 100%）');
  const fetcher = read('server/services/collectors/fetcher.js');
  assert.match(fetcher, /noteOutcome\(true\)/, '抓取成功没进分母，失败率会被抬高成假系统性');
});

// ─── B：本地行为正向探针（临时本地库，零生产写入；helpers 必须先于 server/db） ───
require('./helpers');
const { db } = require('../server/db');
const store = require('../server/services/collectors/store');
const shared = require('../server/services/collectors/_shared');

const DDL = `CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, name TEXT NOT NULL, url TEXT,
  enabled INTEGER DEFAULT 1, status TEXT DEFAULT 'ok', next_fetch_at TEXT, extra TEXT, fail_count INTEGER DEFAULT 0)`;
const seed = (id) => {
  db.prepare(`INSERT OR REPLACE INTO sources(id,type,name,url,enabled,status,fail_count,extra)
              VALUES(?,'rss','TEST-系统性探针','https://seed.example.com/feed',1,'ok',0,NULL)`).run(id);
  return { id, type: 'rss', name: 'TEST-系统性探针', extra: null };
};
const rowOf = (id) => db.prepare('SELECT fail_count fc, status FROM sources WHERE id=?').get(id);

test('H16-B1 环境类同指纹风暴 → 抑制：不计数、不熔断、只留排障线索', () => {
  db.exec(DDL);
  const s = seed(9101);
  for (let i = 0; i < 30; i++) shared.noteOutcome(false, 'connect ECONNREFUSED 127.0.0.1:78' + i);
  const r = store.markSourceError(s, 'connect ECONNREFUSED 127.0.0.1:7899', { silent: true });
  assert.equal(r.suppressed, true, '环境类风暴没被判系统性（三闸门应全中）');
  const row = rowOf(9101);
  assert.equal(row.fc, 0, '抑制轮不许累加 fail_count');
  assert.equal(row.status, 'error', '抑制轮仍要写 status=error 供排障');
});

test('H16-B2 同样规模的源侧 404 风暴 → 照常计数（不许借"系统性"赦免真死源）', () => {
  const s = seed(9102);
  for (let i = 0; i < 30; i++) shared.noteOutcome(false, 'HTTP 404 for feed #' + i);
  const r = store.markSourceError(s, 'HTTP 404 for feed #x', { silent: true });
  assert.notEqual(r.suppressed, true, '源侧 4xx 被系统性豁免了——真死源会被集体赦免');
  assert.equal(rowOf(9102).fc, 1, '源侧失败必须计入连跪');
});

test('H16-B3 分母稀释后同样的环境错误 → 恢复正常计数（窗口不是永免金牌）', () => {
  const s = seed(9103);
  for (let i = 0; i < 30; i++) shared.noteOutcome(false, 'connect ETIMEDOUT peer ' + i);
  for (let i = 0; i < 130; i++) shared.noteOutcome(true);
  const r = store.markSourceError(s, 'connect ETIMEDOUT peer x', { silent: true });
  assert.notEqual(r.suppressed, true, '失败率被成功稀释后仍判系统性，抑制器就成了永久免死金牌');
  assert.equal(rowOf(9103).fc, 1, '稀释后失败要照常计入');
});
