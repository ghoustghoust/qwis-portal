// 2026-09-20 批次 B：B90「今日新增」随部署地漂移的锁
// 运行：node --test tests/regression-20260920b.test.js
// 缺陷实测（09-19）：同刻线上（容器 UTC）todayNew=3554，按北京日算是 9626 —— 同一个端点、
// 同一次请求，"今日"取决于代码跑在哪台机器的时区里。修法是把日界收成一份 lib/time-window.js，
// 两端都按**北京 0 点**算（全站语义本来就是北京日：日报窗口是"北京昨日 06:00 → 今日 06:00"）。
// 本文件钉的是行为：**同一份数据在 TZ=UTC 与 TZ=Asia/Shanghai 两种容器下必须给同一个数**。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
// 惰性取被测模块：F2P 要在**改前的基线**上逐条点名报红，若在这里顶层 require，
// 基线上没有 lib/time-window.js → 整个文件加载崩，用例名一个都不出现，
// F2P 只能报"改前不红"（本轮实测踩过：13 条锁全被判成抓不到 bug）。
const tw = () => require('../lib/time-window');

// B1 的断言写成"对一份 tw 模块跑一遍、返回红灯清单"的形式，这样 B5 能把同一套断言
// 打在**改坏的副本**上自证：判据真的依赖 BJ_OFFSET_MS 这个常数（第三轮审查：原写法
// `const BJ_OFFSET_MS = 0` 之后 B1 仍然绿 —— 因为断言里根本没有依赖偏移的项）。
function dayChecks(tw) {
  const red = [];
  const eq = (got, want, msg) => { if (got !== want) red.push(`${msg}：期望 ${want}，实得 ${got}`); };
  // 09-19T23:30Z = 北京 09-20 07:30 → "今日"从 09-19T16:00Z 起
  eq(tw.beijingDayStartIso(Date.parse('2026-09-19T23:30:00Z')), '2026-09-19T16:00:00.000Z', '北京 0 点日界');
  // 09-20T00:30Z = 北京 09-20 08:30（同一北京日）→ 日界必须相同
  eq(tw.beijingDayStartIso(Date.parse('2026-09-20T00:30:00Z')), '2026-09-19T16:00:00.000Z', '同一北京日第二时刻');
  eq(tw.beijingDayStartIso(Date.parse('2026-09-19T23:30:00Z')),
    tw.beijingDayStartIso(Date.parse('2026-09-20T00:30:00Z')),
    '同一北京日的两个 UTC 时刻必须落在同一个日界（这就是线上那两个数字不一致的根因）');
  // 跨到北京 0 点之后必须是新的一天
  eq(tw.beijingDayStartIso(Date.parse('2026-09-20T16:00:00Z')), '2026-09-20T16:00:00.000Z', '新北京日');
  // 日报窗口：北京昨日 00:00 → 北京今日 06:00
  const win = tw.dailyReportWindowIso(Date.parse('2026-09-19T19:00:00Z'));
  eq(win.startIso, '2026-09-18T16:00:00.000Z', '日报窗口左端');
  eq(win.endIso, '2026-09-19T22:00:00.000Z', '日报窗口右端');
  // 日期串与"日界"必须是两回事（B96 就是把前者当后者用）
  eq(tw.beijingDateStr(Date.parse('2026-09-19T19:00:00Z')), '2026-09-20', '北京日期串');
  const rng = tw.beijingDayRangeIso('2026-09-20');
  eq(rng.startIso, '2026-09-19T16:00:00.000Z', '北京日区间左端（日期串 ≠ UTC 零点）');
  eq(rng.endIso, '2026-09-20T15:59:59.999Z', '北京日区间右端');
  if (!(tw.beijingDayStartMs() <= Date.now())) red.push('日界不可能在未来');
  return red;
}

test('B1 日界/窗口/日期串计算本身：两个方向都要钉（北京日 ≠ 容器日）', () => {
  const reds = () => dayChecks(tw());
  assert.deepStrictEqual(reds(), [], 'lib/time-window 的口径不成立：\n' + reds().join('\n'));
});

test('B5 反向自证：把 BJ_OFFSET_MS 改成 0，B1 的断言必须逐条变红（否则锁与常数无关）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b90-offset-'));
  const src = read('lib', 'time-window.js');
  const mutated = src.replace('const BJ_OFFSET_MS = 8 * 3600e3', 'const BJ_OFFSET_MS = 0');
  assert.notEqual(mutated, src, '变异未生效（常数写法变了，本探针要跟着改）');
  const file = path.join(dir, 'tw-zero.cjs');
  fs.writeFileSync(file, mutated);
  let reds = [];
  try {
    reds = dayChecks(require(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(reds.length >= 6,
    `偏移改成 0 后只有 ${reds.length} 条断言变红（应至少 6 条）→ 这些断言其实不依赖时区偏移，是空跑：\n${reds.join('\n')}`);
});

test('B6 反向自证：判"同一天"的写法必须用日界而不是日期串（B96 的形状要能被 dayChecks 抓到）', () => {
  const tw = require('../lib/time-window');
  const ms = Date.parse('2026-09-19T16:30:00Z'); // 北京 09-20 00:30
  // 正确：该时刻落在"北京 09-20"这个日界区间内
  const dayStart = Date.parse(tw.beijingDayStartIso(ms));
  assert.ok(ms >= dayStart && ms < dayStart + 86400e3, '北京日区间没覆盖凌晨那一期');
  // 错误写法（B96 原样）：把北京日期串拼成 UTC 零点当边界
  const wrongStart = Date.parse(`${tw.beijingDateStr(ms)}T00:00:00.000Z`);
  assert.ok(!(ms >= wrongStart && ms < wrongStart + 86400e3),
    '样本不够强：错误写法也能覆盖它，这条判据没有区分度');
});

// 两端各自起子进程跑同一份夹具数据，分别在 TZ=UTC / TZ=Asia/Shanghai 下读 todayNew
function runCloud(tz) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b90-cloud-'));
  const dbFile = path.join(dir, 'b.db').replace(/\\/g, '/');
  const driver = path.join(ROOT, `.b90-cloud-${process.pid}.cjs`);
  fs.writeFileSync(driver, `
    process.env.TURSO_DATABASE_URL = 'file:' + ${JSON.stringify(dbFile)};
    process.env.TURSO_AUTH_TOKEN = '';
    const { ensureSchema, dbRun, dbGet, close } = require(${JSON.stringify(path.join(ROOT, 'lib', 'db.js'))});
    const handler = require(${JSON.stringify(path.join(ROOT, 'api', '[...slug].js'))});
    (async () => {
      await ensureSchema();
      const { beijingDayStartIso } = require(${JSON.stringify(path.join(ROOT, 'lib', 'time-window.js'))});
      const bj = Date.parse(beijingDayStartIso());
      await dbRun("INSERT INTO sources(type,name,url,enabled) VALUES('rss','B90 源','https://b90.example/f',1)");
      const sid = Number((await dbGet("SELECT id FROM sources WHERE name='B90 源'")).id);
      // 三条：北京日内两条、北京日之前一条（按 UTC 日界会把那条旧的一起算成"今天" → 数字变 3）
      const ins = (u, off) => dbRun('INSERT INTO articles(source_id,title,url,created_at) VALUES(?,?,?,?)',
        sid, u, 'https://b90.example/' + u, new Date(bj + off).toISOString());
      await ins('in1', 3600e3); await ins('in2', 7200e3); await ins('old', -3600e3);
      const res = { _body: null };
      res.setHeader = () => res; res.status = () => res; res.json = (b) => { res._body = b; return res; };
      await handler({ method: 'GET', url: '/api/status', query: {}, headers: {} }, res);
      const o = (res._body || {}).overview || {};
      console.log('OUT ' + JSON.stringify({ today: o.todayNew, keys: Object.keys(o).join(','), err: (res._body || {}).error }));
      await close();
    })().catch((e) => { console.log('OUT ' + JSON.stringify({ err: e.message })); process.exitCode = 3; });
  `);
  try {
    const out = execFileSync(process.execPath, [driver], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, TZ: tz }, timeout: 120000 });
    const m = /^OUT (.+)$/m.exec(out);
    assert.ok(m, `子进程没打印读数（TZ=${tz}）：\n${out.slice(-400)}`);
    return JSON.parse(m[1]);
  } finally {
    try { fs.unlinkSync(driver); } catch { /* 已清 */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runLocal(tz) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b90-local-'));
  const driver = path.join(ROOT, `.b90-local-${process.pid}.cjs`);
  fs.writeFileSync(driver, `
    const express = require('express');
    const { db } = require(${JSON.stringify(path.join(ROOT, 'server', 'db.js'))});
    const { beijingDayStartIso } = require(${JSON.stringify(path.join(ROOT, 'lib', 'time-window.js'))});
    const bj = Date.parse(beijingDayStartIso());
    const sid = db.prepare("INSERT INTO sources(type,name,url,enabled) VALUES('rss','B90 源','https://b90.example/f',1)").run().lastInsertRowid;
    const ins = db.prepare('INSERT INTO articles(source_id,title,url,created_at) VALUES(?,?,?,?)');
    ins.run(sid, 'in1', 'https://b90.example/a', new Date(bj + 3600e3).toISOString());
    ins.run(sid, 'in2', 'https://b90.example/b', new Date(bj + 7200e3).toISOString());
    ins.run(sid, 'old', 'https://b90.example/c', new Date(bj - 3600e3).toISOString());
    const app = express();
    app.use('/api/status', require(${JSON.stringify(path.join(ROOT, 'server', 'routes', 'status.js'))}));
    const srv = app.listen(0, '127.0.0.1', async () => {
      const d = await (await fetch('http://127.0.0.1:' + srv.address().port + '/api/status')).json();
      console.log('OUT ' + JSON.stringify({ today: d.overview.todayNew }));
      srv.close(); process.exit(0);
    });
  `);
  try {
    const out = execFileSync(process.execPath, [driver],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, TZ: tz, APP_DATA_DIR: dir }, timeout: 120000 });
    const m = /^OUT (.+)$/m.exec(out);
    assert.ok(m, `本地端子进程没打印读数（TZ=${tz}）：\n${out.slice(-400)}`);
    return JSON.parse(m[1]);
  } finally {
    try { fs.unlinkSync(driver); } catch { /* 已清 */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('B2 云端读层：同一份数据在 TZ=UTC 与 TZ=Asia/Shanghai 下 todayNew 必须相同（且=2）', () => {
  const utc = runCloud('UTC');
  const sh = runCloud('Asia/Shanghai');
  assert.ok(!utc.err && !sh.err, `端点直接报错（这就是没有云端路由测试的代价）：${JSON.stringify([utc, sh])}`);
  assert.equal(utc.today, 2, `TZ=UTC 下算错了日子：${JSON.stringify(utc)}`);
  assert.equal(sh.today, 2, `TZ=Asia/Shanghai 下算错了日子：${JSON.stringify(sh)}`);
  assert.equal(utc.today, sh.today, '「今日新增」随容器时区漂动（B90 原样复发）');
});

test('B3 本地端 /api/status 同样两端一致（两端各写一遍日界 = 迟早漂）', () => {
  const utc = runLocal('UTC');
  const sh = runLocal('Asia/Shanghai');
  assert.equal(utc.today, 2, JSON.stringify(utc));
  assert.equal(sh.today, 2, JSON.stringify(sh));
  assert.equal(utc.today, sh.today, '本地端也漂移了');
});

// B4 的判据实现挪到了 lib/time-caliber.js —— 白盒 W16 用同一份。
// 为什么不能两边各写一遍：本轮就发生过"测试里加了 setUTCHours、白盒里没加"，两条门禁各自漂移。

test('B4 日界/北京时区只许一份实现：全仓派生扫描 + 判据自身要被绕过样本抓到', () => {
  const { findTimeCaliberViolations, BANNED } = require('../lib/time-caliber');
  const r = findTimeCaliberViolations(ROOT);
  assert.ok(r.scanned > 100, `扫描面只有 ${r.scanned} 个文件，等于没扫（目录/排除表写坏了）`);
  assert.deepStrictEqual(r.violations.slice(0, 12), [],
    '时间口径出现第二份实现：\n' + r.violations.map((v) => `${v.file}:${v.line} ${v.label} → ${v.code}`).join('\n'));
  assert.deepStrictEqual(r.missingImport, [],
    `这些生产点不再引用 lib/time-window（唯一口径成了空话）：${JSON.stringify(r.missingImport)}`);
  // 反向自证：每条被禁写法都要能被自己的正则抓到（否则"0 违规"可能只是正则写空了）
  const SAMPLE = {
    'setHours(0, 0, 0, 0)': 'd.setHours(0, 0, 0, 0);',
    'setUTCHours(0, 0, 0, 0)': 'd.setUTCHours(0, 0, 0, 0);',
    '8 * 3600e3': 'const bj = new Date(Date.now() + 8 * 3600e3);',
    'toDateString': 'if (a.toDateString() === b.toDateString()) {}',
    'new Date().toISOString': "const s = new Date().toISOString().slice(0, 10);",
    'T00:00:00.000Z': "args.push(`${q.from}T00:00:00.000Z`);",
  };
  for (const b of BANNED) {
    const key = Object.keys(SAMPLE).find((k) => b.label.includes(k) || b.re.test(SAMPLE[k]));
    assert.ok(key, `被禁规则「${b.label}」没有对应的样本，判不到东西`);
    assert.ok(b.re.test(SAMPLE[key]), `被禁规则「${b.label}」连自己的样本都匹配不到（正则写空了）`);
  }
});
