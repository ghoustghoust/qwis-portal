// B109/B45 报警事件表单实现回归锁（spec 37-2 的 AC1~AC3，2026-09-21）。
//
// 一句话病根：事件表有四份副本且键集互不相同 —— 云端 DEFAULT_EVENTS 7 键、本地 EVENT_TITLE 5 键、
// 健康摘要第三份 3 键、管理台前端第 4 份说明；而云端 `GET /api/alerts/config` 的 `eventMeta`
// **硬写四个在任何表里都不存在的键**（fuse/stall/queue/error）→ 云端后台"报警事件"区显示的是
// 四个不存在事件的开关，真事件一个都看不见，勾了也没人读（B45 的硬根因）。
//
// 锁的形状：判据与门禁共用 lib/alert-events#findAlertEventCopies（坑 #58/#59）；
// 每条禁写法配负向样本（塞进去必红），每个形状配反向样本（合法写法不许红，坑 #62/#63），
// 关键断言是**行为锁**而不是文本比对（V4/V5 直接打两端点读响应）。
'use strict';
require('./helpers'); // 先于任何 server/*：给它临时 APP_DATA_DIR，绝不碰 data/app.db
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
// 惰性取（坑 #64/#67）：F2P 会在"基线树里还没有 lib/alert-events.js"的 worktree 里跑本文件，
// 顶层 require 会让它崩在加载期，读成"锁假了"而不是"改前红"。
const AE = () => require('../lib/alert-events');

const write = (dir, rel, text) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};

test('V1 事件表在活代码里只剩一份：违规 0、分母够大、四个消费点真接上了', () => {
  const r = AE().findAlertEventCopies(ROOT);
  assert.ok(r.scanned >= 100, `扫描面只有 ${r.scanned} 个文件 —— 分母不足时"0 份副本"没有意义`);
  assert.deepEqual(r.copies.map((c) => `${c.file}:${c.line} ${c.key}`), [],
    `又出现手写事件表（第二份必然漂）：\n${r.copies.map((c) => `  ${c.file}:${c.line} ${c.key}`).join('\n')}`);
  for (const f of ['api/_alerts.js', 'server/services/alerts.js', 'server/routes/health.js', 'api/[...slug].js']) {
    assert.ok(r.consumers.includes(f), `${f} 没引用 lib/alert-events —— "唯一实现"成了空话`);
  }
});

test('V2 负向自证：塞一份手写事件表必须红并点名；只写在注释/字符串里不许红', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b109-bad-'));
  try {
    write(dir, 'api/_alerts.js', 'const T = {\n  source_error: true,\n  source_slow: true,\n};\nmodule.exports = T;\n');
    const r = AE().findAlertEventCopies(dir);
    assert.ok(r.copies.length >= 2, `手写表没被判出来（恒真判据）：${JSON.stringify(r.copies)}`);
    assert.equal(r.copies[0].file, 'api/_alerts.js', `没点名文件：${JSON.stringify(r.copies[0])}`);
    assert.equal(r.copies[0].line, 2, `没点名行号（应 2，实得 ${r.copies[0].line}）`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'b109-ok-'));
  try {
    write(dir2, 'server/services/x.js', [
      '// 注释里写一份表：source_error: true, source_paused: true —— 注释不算（坑 #63）',
      "const s = 'source_error: true, daily_failed: true'; // 字符串里的形状也不算（判的是代码）",
      "module.exports = { s };",
    ].join('\n'));
    const r2 = AE().findAlertEventCopies(dir2);
    assert.deepEqual(r2.copies, [], `注释/字符串里的事件键被当成手写表：${JSON.stringify(r2.copies)}`);
  } finally { fs.rmSync(dir2, { recursive: true, force: true }); }
});

// 这条锁住判据第一版的假红：`mybrief:` 在 api/[...slug].js 出现两次，但那是 settings 命名空间
// 的响应字段（相距 700 行），不是一份表。**"同一文件里出现过两个事件键"不等于"抄了两份表"**。
test('V3 反向：分散在两处的单键成员不许算成第二份表（判据第一版就是这么假红的）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b109-far-'));
  try {
    const lines = [];
    lines.push('function a() {');
    lines.push('  return { mybrief: 1, other: 2 };');
    lines.push('}');
    for (let i = 0; i < 40; i++) lines.push(`const pad${i} = ${i};`);
    lines.push('function b() {');
    lines.push('  return { source_error: 1 };');
    lines.push('}');
    write(dir, 'api/far.js', lines.join('\n') + '\n');
    const r = AE().findAlertEventCopies(dir);
    assert.deepEqual(r.copies, [], `相距很远的两个单键被拼成"一份表"（分组窗口失效）：${JSON.stringify(r.copies)}`);
    // 同一份文件里真写一份表（相邻成员）仍然必须红 —— 证明上面那条不是因为"检测能力为零"
    write(dir, 'api/real.js', 'const T = {\n  mybrief: 1,\n  source_error: 2,\n};\nmodule.exports = T;\n');
    assert.ok(AE().findAlertEventCopies(dir).copies.length >= 2, '相邻成员写成的真表也漏了 = V3 变成恒绿');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('V4 表本身的形状：并集 8 键、默认全开、说明齐全（不许有事件没说明）', () => {
  const ae = AE();
  assert.deepEqual(ae.eventKeys(), [
    'source_error', 'source_paused', 'source_slow', 'daily_failed', 'collect_stalled', 'ai_failed', 'frozen_digest', 'mybrief',
  ], '事件键集变了 —— 这是三端与后台共同的表，改动必须同步文档（37-2 边界：取并集，不许删本地独有键）');
  assert.ok(ae.eventKeys().includes('source_slow'), '本地独有的 source_slow 必须保留（37-2 边界条款）');
  assert.ok(ae.eventKeys().includes('mybrief'), '云端独有的 mybrief 必须保留');
  for (const k of ae.eventKeys()) {
    const v = ae.ALERT_EVENTS[k];
    assert.ok(v.title && v.desc, `${k} 缺标题或说明 —— 后台第 4 份说明就是靠这个字段消失的`);
    assert.equal(v.defaultOn, true, `${k} 默认值不再是"开"（改默认值＝改产品行为，需单独拍板）`);
  }
  assert.equal(Object.keys(ae.defaultEvents()).length, 8);
});

test('V5 幽灵键不外露：落库里的 wemp_down 不进状态表，也不许有真事件被它顶掉（B109，零配置写）', () => {
  const ae = AE();
  const st = ae.eventsState({ source_error: false, wemp_down: true, wemp_cookie_expired: false });
  assert.deepEqual(Object.keys(st), ae.eventKeys(), '响应键集不等于表 —— 幽灵键又漏进来了');
  assert.equal(st.source_error, false, '存储的"关"必须被尊重');
  assert.equal(st.daily_failed, true, '表内键缺存储值时取默认开');
  assert.ok(!('wemp_down' in st), '幽灵键仍在外露');
  assert.equal(ae.isKnownEvent('wemp_down'), false);
  assert.equal(ae.isKnownEvent('mybrief'), true);
  // 存储值各种假值形态都不能变成"关"以外的解释（只有显式 false 才是关）
  for (const v of [0, null, 'false', undefined]) {
    assert.equal(ae.eventsState({ source_error: v }).source_error, true, `存储值 ${JSON.stringify(v)} 被当成关`);
  }
});

test('V6 两端同源（B45 行为锁）：本地与云端 /api/alerts/config 的 eventMeta 键集都等于表，且开关改一个立刻跟着变', async () => {
  const express = require('express');
  const { db } = require('../server/db');
  const ae = AE();
  // 造一份"最坏情况"的落库：真事件只留一个关、外加两个幽灵键、再加一个表里不存在的假标题覆盖
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('alerts',?)").run(JSON.stringify({
    channels: [], events: { source_error: false, wemp_down: true, wemp_cookie_expired: true },
    cooldownMin: 60, eventMeta: { source_paused: '自定义熔断标题' },
  }));

  const app = express();
  app.use('/api/alerts', require('../server/routes/alerts.js'));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  let local;
  try {
    local = await (await fetch(`http://127.0.0.1:${srv.address().port}/api/alerts/config`)).json();
  } finally { srv.close(); }
  assert.deepEqual(Object.keys(local.eventMeta).sort(), [...ae.eventKeys()].sort(),
    '本地 eventMeta 键集不等于表（B45 那类"响应里硬写一份"的复发形状）');
  assert.deepEqual(Object.keys(local.events).sort(), [...ae.eventKeys()].sort(), '本地 events 键集不等于表');
  assert.equal(local.events.source_error, false, '落库的"关"没透出来 = 勾选不生效（B45 症状）');
  assert.equal(local.events.wemp_down, undefined, '幽灵键又进响应了');
  assert.equal(local.eventMeta.source_paused.title, '自定义熔断标题', '落库覆盖值没被读（改前必红的那条）');
  assert.ok(local.eventMeta.source_error.desc, '说明没随响应一次带来（前端还要自带第 4 份）');
  assert.ok(!JSON.stringify(local).includes('fuse'), '响应里还留着 fuse/stall/queue 那四个假键');

  // 云端读层：同一份表 + 同一份落库语义（隔离库，绝不碰生产 Turso）
  const file = path.join(os.tmpdir(), `b109-cloud-${process.pid}.db`).replace(/\\/g, '/');
  process.env.TURSO_DATABASE_URL = 'file:' + file;
  process.env.TURSO_AUTH_TOKEN = '';
  process.env.AUTH_SECRET = 'local-test-secret';
  const jwt = require('jsonwebtoken');
  const libdb = require('../lib/db.js');
  await libdb.ensureSchema();
  await libdb.dbRun('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', 'alerts', JSON.stringify({
    channels: [], events: { source_error: false, wemp_down: true }, eventMeta: { source_paused: '自定义熔断标题' },
  }));
  const handler = require('../api/[...slug].js');
  const token = jwt.sign({ sub: 'admin', role: 'admin' }, 'local-test-secret');
  const res = { _status: 200, _body: null };
  res.setHeader = () => res; res.status = (s) => { res._status = s; return res; };
  res.json = (b) => { res._body = b; return res; }; res.send = (b) => { res._body = b; return res; }; res.end = () => res;
  await handler({ method: 'GET', url: '/api/alerts/config', query: {}, body: {}, headers: { authorization: 'Bearer ' + token } }, res);
  await libdb.close();
  try { fs.rmSync(file, { force: true }); } catch { /* Windows 句柄，交给系统回收 */ }
  assert.equal(res._status, 200, `云端 config 返回 ${res._status}：${JSON.stringify(res._body)}`);
  const cloud = res._body;
  assert.deepEqual(Object.keys(cloud.eventMeta).sort(), Object.keys(local.eventMeta).sort(),
    '云端与本地的 eventMeta 键集分叉（正是 B45/B109 的成因形态）');
  assert.deepEqual(Object.keys(cloud.events).sort(), Object.keys(local.events).sort(), '两端 events 键集分叉');
  assert.equal(cloud.events.source_error, false, '云端落库的"关"没透出来');
  assert.equal(cloud.eventMeta.source_paused.title, '自定义熔断标题', '云端不读落库覆盖值');
});

test('V7 分发真的读这份开关：勾掉的事件 dispatch 必须停在 disabled，没勾的必须走下一步（B45 另一半）', async () => {
  const { db } = require('../server/db');
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('alerts',?)").run(JSON.stringify({
    channels: [], events: { source_error: false },
  }));
  const alerts = require('../server/services/alerts.js');
  // 用 dispatch 而不是 sourceError()：后者自带"连续失败≥2 次"的次数门槛，会先返回
  // `below-threshold`，那样这条断言根本看不见开关（第一版就是这么误判的）。
  const off = await alerts.dispatch('source_error', { title: 'V7 关着的', text: 'x' });
  assert.equal(off.skipped, 'disabled', `勾掉的事件没被开关拦住：${JSON.stringify(off)}`);
  const on = await alerts.dispatch('source_paused', { title: 'V7 默认开的', text: 'x' });
  assert.equal(on.skipped, 'no-channels',
    `默认开的事件应越过开关进入下一步（渠道为空才停）：${JSON.stringify(on)}`);
  const st = alerts.getConfig().events;
  assert.equal(st.source_error, false, '落库的"关"没透到 getConfig');
  assert.equal(st.source_paused, true, '没勾过的键应取表里的默认开');
  assert.equal(Object.keys(st).length, 8, 'getConfig 的键集不等于表');
});
