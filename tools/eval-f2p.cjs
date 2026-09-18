#!/usr/bin/env node
/**
 * 41-3 F2P/P2P「改前必红」取证器（要求正文 docs/EVAL_GUIDE.md §6，小 spec docs/specs/41-e2e-whitebox-eval/spec.md 41-3）
 *
 * 为什么要有它：本轮每条修复都得证明"这个测试在没修之前会红"。手工做连踩两个坑——
 *   ① 第一版探针脚本把判定写反了（改前也通过却打印"改前就通过"）；
 *   ② worktree 里没有 node_modules，凡 require server/db 的用例以 Cannot find module 红，
 *      那是 fail_env 却长得像"改前红"（EVAL_GUIDE §6 已记）。
 * 这两类错误正是"评测器自己骗人"，所以固化成工具：红绿都由脚本判定，人只读结论。
 *
 * 用法：
 *   node tools/eval-f2p.cjs --base <ref> --tests <file[,file…]> [--cases <名字子串>] [--json]
 * 退出码：0 = 该锁确实"改前红、改后绿"；1 = 不成立（假锁，必须删或重写）；2 = 用法/环境错误
 */
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RECORD_DIR = 'docs/eval/f2p';

function sh(cmd, opt = {}) {
  return execSync(cmd, { cwd: opt.cwd || ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opt });
}

// 解析 node:test 的汇总行；缺任何一行都返回 null（宁可报"没跑到"也不要猜）
function parseSummary(text) {
  const num = (re) => {
    const m = String(text || '').match(re);
    return m ? Number(m[1]) : null;
  };
  const tests = num(/^ℹ tests (\d+)$/m);
  const pass = num(/^ℹ pass (\d+)$/m);
  const fail = num(/^ℹ fail (\d+)$/m);
  if (tests === null || pass === null || fail === null) return null;
  const failedNames = [...String(text || '').matchAll(/^✖ (\S[^\n(]*?)\s*\(/gm)].map((m) => m[1].trim());
  const envBroken = /Cannot find module|ENOENT|EACCES/.test(text || '');
  return { tests, pass, fail, failedNames: [...new Set(failedNames)], envBroken };
}

/**
 * 判一次锁是否成立。
 * base = 改动之前，期望目标用例红；head = 改动之后，期望全绿。
 * envBroken（模块找不到一类）绝不能当成"改前红"，那是假证据。
 */
function verdict(base, head, wantNames = []) {
  if (!base || !head) return { ok: false, why: '没有解析到 node:test 汇总行，等于没跑' };
  if (base.envBroken) return { ok: false, why: 'base 侧有环境类失败（Cannot find module 等），不能当改前红证据' };
  if (head.envBroken) return { ok: false, why: 'head 侧有环境类失败，先修环境再谈证据' };
  if (head.fail !== 0) return { ok: false, why: `改后仍有 ${head.fail} 条红，未修好` };
  const hit = wantNames.length ? base.failedNames.filter((n) => wantNames.some((w) => n.includes(w))) : base.failedNames;
  if (!base.fail) return { ok: false, why: '改前也全绿 —— 这条锁抓不到 bug，按 §6 应删掉或重写断言' };
  if (wantNames.length && !hit.length) {
    return { ok: false, why: `改前红的用例里没有指定的目标锁（目标 ${wantNames.join(', ')}；实际红 ${base.failedNames.slice(0, 6).join(' | ') || '无'}）` };
  }
  return { ok: true, why: `改前红 ${base.fail} 条${wantNames.length ? `（命中 ${hit.length} 条目标）` : ''}，改后 ${head.tests} 条全绿` };
}

// worktree 里必须能解析依赖：把主树 node_modules 挂进 NODE_PATH（本轮踩过才知道）
function nodePathFor() {
  return path.join(ROOT, 'node_modules');
}

// Windows 上 execSync 走 cmd.exe，`^ & | < > %` 都是元字符：
// `git rev-parse ca42cd5^` 里的脱字符会被 cmd 吃掉 → base 静默变成"改动本身"，
// 于是"改前红"永远不成立，取证结论整个反过来（本工具第一版就栽在这，报出 base 3/3 全绿）。
// 所以凡带 ref / 路径 / 用户输入的命令一律走 execFile：不经 shell，参数原样送达。
function gitRaw(args, opt = {}) {
  return execFileSync('git', args, {
    cwd: opt.cwd || ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function git(args, opt = {}) { return gitRaw(args, opt).trim(); }

function runTestFiles(cwd, files, namePattern) {
  const args = ['--test', '--test-concurrency=1'];
  if (namePattern) args.push('--test-name-pattern=' + namePattern);
  args.push(...files);
  const env = { ...process.env, NODE_PATH: nodePathFor() };
  try {
    const out = execFileSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env, stdio: ['ignore', 'pipe', 'pipe'] });
    return parseSummary(out) || { tests: 0, pass: 0, fail: 0, failedNames: [], envBroken: false, unparsed: String(out).slice(0, 400) };
  } catch (e) {
    const out = String((e && e.stdout) || '') + String((e && e.stderr) || '');
    const p = parseSummary(out);
    if (p) return p;
    return { tests: 0, pass: 0, fail: 0, failedNames: [], envBroken: /Cannot find module|ENOENT/.test(out), unparsed: out.slice(0, 400) };
  }
}

function main(argv) {
  const get = (k) => { const i = argv.indexOf(k); return i < 0 ? null : argv[i + 1]; };
  const base = get('--base');
  const testsArg = get('--tests');
  const casesArg = get('--cases');
  if (!base || !testsArg) {
    console.error('用法：node tools/eval-f2p.cjs --base <ref> --tests <file[,file…]> [--cases <名字子串>] [--json]');
    return 2;
  }
  const files = testsArg.split(',').map((s) => s.trim()).filter(Boolean);
  const missing = files.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length) { console.error('测试文件不存在：' + missing.join(', ')); return 2; }

  const wantNames = casesArg ? casesArg.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const wt = path.join(path.dirname(ROOT), `.wt-f2p-${Date.now()}`);
  const baseSha = git(['rev-parse', base + '^{commit}']);
  const headSha = git(['rev-parse', 'HEAD']);
  if (baseSha === headSha) { console.error('base 与 HEAD 同一个 commit，取证无意义'); return 2; }

  let baseRun = null, headRun = null;
  try {
    gitRaw(['worktree', 'add', wt, baseSha]);
    // 只把"新写的锁"带进旧代码里跑：锁是本轮交付物，旧树里没有
    for (const f of files) {
      const dst = path.join(wt, f);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(ROOT, f), dst);
    }

    // --cases 也用在 base 侧：只跑目标锁，避免同文件里**其它**用例因引用的新工具/新 lib
    // 在旧树里不存在而报 Cannot find module，把一次本来干净的取证搅成环境失败
    const pattern = wantNames.length ? wantNames.join('|') : null;
    baseRun = runTestFiles(wt, files, pattern);
    headRun = runTestFiles(ROOT, files, pattern);
  } finally {
    try { gitRaw(['worktree', 'remove', wt, '--force']); gitRaw(['worktree', 'prune']); } catch { /* 残留由 git 自管 */ }
  }

  const v = verdict(baseRun, headRun, wantNames);
  const rec = { at: new Date().toISOString(), base: baseSha.slice(0, 9), head: headSha.slice(0, 9), baseSha, headSha, files, wantNames, base: baseRun, head: headRun, ok: v.ok, why: v.why };
  fs.mkdirSync(path.join(ROOT, RECORD_DIR), { recursive: true });
  const file = path.join(RECORD_DIR, `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`);
  fs.writeFileSync(file, JSON.stringify(rec, null, 1) + '\n');

  if (argv.includes('--json')) console.log(JSON.stringify(rec, null, 1));
  else {
    console.log(`  base ${rec.baseSha.slice(0, 9)} 红 ${baseRun.fail}/${baseRun.tests}（失败：${baseRun.failedNames.slice(0, 6).join(' | ') || '无'}${baseRun.envBroken ? '；含环境类失败' : ''}）`);
    console.log(`  head ${rec.headSha.slice(0, 9)} 红 ${headRun.fail}/${headRun.tests}`);
    console.log(`${v.ok ? '✓ F2P 成立' : '✗ F2P 不成立'} — ${v.why}`);
    console.log(`  证据：${file}`);
  }
  return v.ok ? 0 : 1;
}

// 自检（EVAL_GUIDE §4.1：禁止型断言必须配正向探针）——保证解析器/判据不是"永远说好"
function selfTest() {
  const good = 'x\nℹ tests 10\nℹ pass 7\nℹ fail 3\n✖ B28 加括号 (1ms)\n✖ B29 口径 (1ms)\n✖ B60 副本 (1ms)\n';
  const clean = 'ℹ tests 10\nℹ pass 10\nℹ fail 0\n';
  const broken = 'ℹ tests 3\nℹ pass 0\nℹ fail 3\n✖ t1 (1ms)\nError: Cannot find module \'better-sqlite3\'\n';
  const p1 = parseSummary(good);
  const probes = [
    ['解析汇总', !!p1 && p1.tests === 10 && p1.fail === 3 && p1.failedNames.length === 3],
    ['缺汇总行时返回 null（不许当成通过）', parseSummary('nope') === null],
    ['环境类失败要标出来', parseSummary(broken).envBroken === true],
    ['真锁判成立', verdict(p1, parseSummary(clean), ['B28']).ok === true],
    ['改前也绿 = 假锁', verdict(parseSummary(clean), parseSummary(clean), ['B28']).ok === false],
    ['base 侧 Cannot find module 不算证据', verdict(parseSummary(broken), parseSummary(clean), ['t1']).ok === false],
    ['改后仍有红 = 未修好', verdict(p1, p1, ['B28']).ok === false],
    ['指定的锁在 base 没红 = 断言没打中', verdict(p1, parseSummary(clean), ['B99']).ok === false],
  ];
  for (const [n, ok] of probes) console.log(`  ${ok ? '✓' : '✗'} ${n}`);
  const bad = probes.filter(([, ok]) => !ok);
  console.log(`f2p 自检：${probes.length - bad.length}/${probes.length} 通过`);
  return bad.length ? 1 : 0;
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) process.exitCode = selfTest();
  else process.exitCode = main(process.argv);
}

module.exports = { parseSummary, verdict, git, runTestFiles };
