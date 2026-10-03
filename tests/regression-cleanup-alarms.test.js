// H29 回归锁：删除闸不许再沉默。
// 为什么（账本 H29，用户 10-03 拍板①②）：闸挡住与"当日没跑到清理"此前都不出声——
// 人工转储一断，清理必然进入"跑到也被挡、一条都不删"，而库只涨不删会把行读单价与存储
// 同向顶高（任一维度越限即整站封锁，本仓被禁过六小时）。同时 runner 的转储腿在临时盘上
// 结构性不成立，凭证改由清理档按天自写、有效期绑"最近一次成功采集"（用户选的续期路径）。
'use strict';
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const events = require('../lib/alert-events');
const cd = require('../lib/content-dump');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('H29-1 事件表注册了 cleanup_blocked / cleanup_missed（唯一实现，不许自造键名）', () => {
  assert.equal(events.isKnownEvent('cleanup_blocked'), true);
  assert.equal(events.isKnownEvent('cleanup_missed'), true);
});

test('H29-2 凭证闸新腿：凭证早于最近一次成功采集 → 挡下并说明原因', () => {
  const t0 = '2026-10-03T00:00:00.000Z';
  const cred = cd.credentialFromManifest({
    updatedAt: t0, scope: 'runner-daily',
    tables: { articles: { rows: 10, maxId: 5, bytes: 100, chunks: ['c1'] } },
  });
  // 不传 validAfter：维持旧语义（只看新鲜度）→ 放行
  assert.equal(cd.credentialGate(cred, {}).allowed, true, '旧语义不该被破坏');
  // 采集晚于凭证：库里有清单没覆盖的新数据 → 挡
  const blocked = cd.credentialGate(cred, { validAfter: '2026-10-03T02:00:00.000Z' });
  assert.equal(blocked.allowed, false, '凭证早于最近成功采集时必须挡下');
  assert.match(blocked.reason, /最近一次成功采集/);
  // 采集早于凭证（凭证更新）→ 放行
  assert.equal(cd.credentialGate(cred, { validAfter: '2026-09-30T00:00:00.000Z' }).allowed, true);
  // 凭证不新鲜照旧挡（新腿不取代旧腿）
  const stale = cd.credentialFromManifest({
    updatedAt: '2026-09-01T00:00:00.000Z', scope: 'x',
    tables: { articles: { rows: 10, maxId: 5, bytes: 100, chunks: ['c1'] } },
  });
  assert.equal(cd.credentialGate(stale, { validAfter: '2026-08-01T00:00:00.000Z' }).allowed, false);
});

test('H29-3 runner 接线：清理档自写凭证并按 validAfter 重判，闸挡下要出声', () => {
  const runner = read('tools/collect-turso.js');
  assert.match(runner, /function lastCollectAtOf/, '没有"最近一次成功采集"的取法');
  assert.match(runner, /source: 'runner-daily'/, '清理档没有自写凭证（转储腿在 runner 结构性不成立）');
  assert.match(runner, /retentionReadout\(\{ validAfter: lastCollectAt \}\)/, '重判闸时没绑最近成功采集');
  assert.match(runner, /dispatch\('cleanup_blocked'/, '闸挡下没有接报警');
  assert.match(runner, /beijingDateStr/, '北京日必须走 lib/time-window 共用实现（invariant 17），不许手写偏移');
});

test('H29-4 runner 接线：采集批尾检测"当日清理没跑"', () => {
  const runner = read('tools/collect-turso.js');
  assert.match(runner, /dispatch\('cleanup_missed'/, '批尾没有接 cleanup_missed');
  assert.match(runner, /beijingNow\(\)\.getUTCHours\(\) >= 23/, '检测没有等到北京时间 23 点后（会天天误报）');
  assert.match(runner, /beijingDateStr\(Date\.parse\(e\.at \|\| ''\)\)/, '心跳时刻必须换算成北京日再比（invariant 17）');
  assert.match(runner, /mode === 'cleanup'/, '没有读清理档心跳');
});
