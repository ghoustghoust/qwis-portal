// B127 的回归锁：评测产物的 schema 事实（`lib/eval-artifacts.js`，写方 `eval-e2e` / 读方 `eval-process-checks` 共用）。
// 起因是 09-20 夜实测的两条假红：拿 e2e 的轮次 `report.json` 去喂 `eval-process-checks --report`，
// `check_screenshot_taken`（e2e 的图在同级 screens/）与 `check_report_generated`（它要 runs/<ts>.json 那套）
// 双双报红、`code` 还是 `fail_env` —— 读起来像"评测产物不诚实"，真相是喂错了文件。
// 一条只判"输入对不对"的判据最容易写歪的地方是：**喂错了却退 0/1**（前者放过、后者把人引去改判据）。
// 所以两侧都要样本：错的必须退 2 且说清认成了什么，对的不许退 2。
'use strict';
require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'tools', 'eval-process-checks.cjs');
// 惰性取（#64-1 口径）：本锁与 `lib/eval-artifacts.js` 同批落地，F2P 会把本文件复制进没有该模块的
// 基线树里跑，顶层 require 会让整份文件加载崩，取证工具只能读成"锁假了"（坑 #64/#66）。
const ea = () => require('../lib/eval-artifacts');
// 基址不许写死在这份锁里（B64-1：云端基址全库只许 `lib/cloud-site.js` 一份）
const SITE = () => require('../lib/cloud-site').CLOUD_SITE;

const goodRun = () => ({
  schema: ea().RUN_SCHEMA,
  startedAt: new Date().toISOString(),
  reportPath: 'docs/eval/runs/x.json',
  plan: ['E1'],
  cases: [{ id: 'E1', status: 'pass', assertions: 3, renderedText: 'x'.repeat(900), evidence: ['a.png'], requests: [] }],
  commands: [{ cmd: 'node tools/eval-e2e.cjs', exitCode: 0, exitCodeSource: '本进程 return 值直接赋 process.exitCode，无管道' }],
  events: [],
  root: ROOT,
});
// 上一轮真被喂错的那类文件：e2e 的轮次报告（有 summary/cases，无 commands/events）
const e2eReport = () => ({
  schema: ea().E2E_REPORT_SCHEMA, target: SITE(),
  startedAt: new Date().toISOString(), acceptance: { ok: true },
  summary: { total: 10, pass: 9, failProduct: 1 },
  cases: [{ id: 'E1', status: 'pass', assertions: 4 }],
});

function cli(reportPath) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, '--report', reportPath], { cwd: ROOT, encoding: 'utf8', env, timeout: 120000 }) };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

test('A1 输入 schema 判据：run 产物必须齐 commands/cases/reportPath', () => {
  assert.equal(ea().checkInputShape(goodRun()).ok, true);
  for (const k of ['commands', 'cases', 'reportPath']) {
    const bad = JSON.parse(JSON.stringify(goodRun()));
    delete bad[k];
    const r = ea().checkInputShape(bad);
    assert.equal(r.ok, false, `缺 ${k} 竟然算合法`);
    assert.ok(r.missing.some((m) => m.startsWith(k)), `原因没点名缺的是 ${k}：${r.why}`);
  }
});

test('A2 认错的产物要说清"认成了什么"（上一轮就是栽在把它当 run 产物）', () => {
  const r = ea().checkInputShape(e2eReport());
  assert.equal(r.ok, false);
  assert.match(r.why, /e2e 的轮次报告|e2e 的 <轮次>\/report\.json/, r.why);
  assert.match(r.why, /screens/, '要顺带说清 e2e 的图在同级 screens/，否则下轮又会去改 check_screenshot_taken');
});

test('A3 空输入 / 非对象都不许当合法', () => {
  for (const v of [null, undefined, 'text', 42]) {
    assert.equal(ea().checkInputShape(v).ok, false, `${JSON.stringify(v)} 被当合法输入`);
  }
  assert.equal(ea().checkInputShape({ commands: [], cases: [] }).ok, false, '空数组不算有内容');
});

test('A4 `--report` 的退出码：喂错退 2（未评测），不许伪装成产品红 1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b127-'));
  const wrong = path.join(dir, 'e2e-report.json');
  fs.writeFileSync(wrong, JSON.stringify(e2eReport()));
  const r = cli(wrong);
  assert.equal(r.code, 2, `喂错文件应退 2，实退 ${r.code}：\n${r.out}`);
  assert.match(r.out, /喂错了文件|schema 不符/, r.out);
  assert.match(r.out, /docs\/eval\/runs/, '要指路正确的输入形态');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('A5 反向样本：形态正确的输入不许被 schema 判据挡掉（否则这条判据会把真评测也退 2）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b127-ok-'));
  const p = path.join(dir, 'run.json');
  fs.writeFileSync(p, JSON.stringify(goodRun()));
  const r = cli(p);
  assert.notEqual(r.code, 2, `合法输入被 schema 判据挡住了：\n${r.out}`);
  assert.match(r.out, /F[1-8]|check_|过程检查/, `没跑检查器就返回，判据可能是空壳：\n${r.out}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('A6 过程段落账：全绿也要留下逐条读数（B127 的原病是全绿时什么都不写）', () => {
  const allPass = Object.fromEntries(['F1', 'F2', 'F3'].map((n) => [n, { ok: true, why: '好' }]));
  const s = ea().buildProcessSection(Object.entries(allPass), 0);
  assert.deepEqual({ t: s.total, p: s.passed, fp: s.failProduct, fe: s.failEnv }, { t: 3, p: 3, fp: 0, fe: 0 });
  assert.equal(s.ran, true);
  assert.equal(s.finalExitCode, 0);
  assert.equal(s.results.length, 3, '逐条结果必须留在产物里，不许只留计数');
  // 混一类产品红 + 一类环境红：两侧计数分开，且失败项点名
  const mixed = ea().buildProcessSection([
    ['F1', { ok: true, why: '好' }],
    ['F2', { ok: false, code: 'fail_product', why: '占位文案' }],
    ['F3', { ok: false, code: 'fail_env', why: '代理不通' }],
  ], 1);
  assert.deepEqual({ p: mixed.passed, fp: mixed.failProduct, fe: mixed.failEnv }, { p: 1, fp: 1, fe: 1 });
  assert.deepEqual(mixed.failedNames, ['F2', 'F3']);
});

test('A7 读回判据：没有 process 字段的产物一律不算"过程层跑过"', () => {
  assert.equal(ea().readProcessSection(e2eReport()).ok, false, '旧轮次报告（无 process）被当成跑过');
  assert.match(ea().readProcessSection(e2eReport()).why, /没落账|没有 process/, '要说清缺的是落账，不是检查失败');
  const oneBad = { process: ea().buildProcessSection([['F1', { ok: false, code: 'fail_product', why: 'x' }]], 1) };
  assert.equal(ea().readProcessSection(oneBad).ok, false);
  const good = { process: ea().buildProcessSection([['F1', { ok: true, why: '好' }]], 0) };
  assert.equal(ea().readProcessSection(good).ok, true);
});
