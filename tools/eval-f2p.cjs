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
 *   node tools/eval-f2p.cjs --auto-base --tests <file[,file…]> [--cases <名字子串>] [--json]
 *   node tools/eval-f2p.cjs --base <ref>  --tests <file[,file…]> [--cases <名字子串>] [--json]
 *   --auto-base 的基线由"这些锁是在哪个提交引入的"反查得到，不用人记 sha（人会记错，本轮记错过一次）
 * 退出码：0 = 该锁确实"改前红、改后绿"；1 = 不成立（假锁，必须删或重写）；2 = 用法/基线/环境错误
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RECORD_DIR = 'docs/eval/f2p';

// 注意：这里刻意不提供"拼 shell 字符串"的辅助函数。上一版用 execSync 传命令，
// Windows 下走 cmd.exe，`^ & | < > %` 全是元字符，`git rev-parse ca42cd5^` 的脱字符被吃掉，
// 于是"改前"和"改后"跑成同一个 commit，取证结论整个反过来（踩坑记录 docs/pitfalls/testing.md #40）。
// 一律用 execFileSync + 数组参数。

// 区分两种 "Cannot find module"（本轮实测出来的）：
//   裸包名（better-sqlite3 一类）→ 依赖没解析，是环境红，不能当证据
//   相对路径（../lib/reading-filters）→ **本次修复新建的文件在旧树里本来就没有**，那是产品红
// 早先一律判成环境红，结果收敛型修复（把 6 份副本并成 1 个共享模块）永远取不到证据。
function isBarePackageName(spec) {
  return !/^[./\\]/.test(spec) && !/^[a-zA-Z]:[\\/]/.test(spec);
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
  const missing = [...new Set([...String(text || '').matchAll(/Cannot find module '([^']+)'/g)].map((m) => m[1]))];
  const missingDeps = missing.filter(isBarePackageName);
  const missingOwn = missing.filter((s) => !isBarePackageName(s));
  const envBroken = missingDeps.length > 0 || /ENOENT|EACCES/.test(text || '');
  return { tests, pass, fail, failedNames: [...new Set(failedNames)], envBroken, missingDeps, missingOwn };
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
  const own = (base.missingOwn || []).length ? `；改前缺本次修复新建的文件 ${base.missingOwn.join(', ')}` : '';
  return { ok: true, why: `改前红 ${base.fail} 条${wantNames.length ? `（命中 ${hit.length} 条目标）` : ''}，改后 ${head.tests} 条全绿${own}` };
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
    return relMissing(parseSummary(out) || { tests: 0, pass: 0, fail: 0, failedNames: [], envBroken: false, unparsed: String(out).slice(0, 400) }, cwd);
  } catch (e) {
    const out = String((e && e.stdout) || '') + String((e && e.stderr) || '');
    const p = parseSummary(out);
    if (p) return relMissing(p, cwd);
    return relMissing({ tests: 0, pass: 0, fail: 0, failedNames: [], envBroken: true, missingDeps: [], missingOwn: [], unparsed: out.slice(0, 400) }, cwd);
  }
}

// 证据要进 git：把 `D:\\.wt-f2p-1789776782282\tools\…` 这种一次性临时树的绝对路径折成仓库相对路径，
// 否则每轮证据里都多一份随机目录名，既读不动也可能被文档门禁当成引用去解析。
// 分隔符按"一段"匹配（`\\`、`\/`、`//` 都出现过：Node 报的 specifier 会带上 join 出来的双反斜杠）。
function relMissing(p, cwd) {
  if (!p || !Array.isArray(p.missingOwn)) return p;
  const parts = String(cwd).split(/[\\/]+/).filter(Boolean);
  const preRe = new RegExp('^' + parts.map(rxEscape).join('[\\\\/]+') + '[\\\\/]+', 'i');
  p.missingOwn = [...new Set(p.missingOwn.map((m) => String(m).replace(preRe, '').replace(/\\/g, '/').replace(/\/{2,}/g, '/')))];
  return p;
}

// ── 基线守卫 ───────────────────────────────────────────────────────
// 本轮实测踩到：手工记的 base 其实是修复提交的**子孙**，base 树里早就带着修复，
// 于是三条真锁被判成"改前也全绿 = 假锁"。按 EVAL_GUIDE §6 那条判据的下一步动作是**删锁**——
// 选错基线的代价是杀掉一个能抓 bug 的用例，比漏一条更糟。所以这里把"基线是否可能是错的"变成机器判据。
// 一条锁的引入提交 = 它所守护的那次修复；base 若已包含它，"改前必红"在这棵树上不可能成立。
function rxEscape(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function testNamesIn(file) {
  let src = '';
  try { src = fs.readFileSync(path.join(ROOT, file), 'utf8'); } catch { return []; }
  return [...src.matchAll(/^\s*test\(\s*'([^']+)'/gm)].map((m) => m[1]);
}

// -S 找"这段文本被增删过的提交"，最老那条即引入提交（git log 默认新在前）
function lockIntroCommit(file, name) {
  try {
    const out = gitRaw(['log', '--format=%H', `-S${name}`, '--', file]);
    const shas = String(out).split('\n').map((s) => s.trim()).filter(Boolean);
    return shas.length ? shas[shas.length - 1] : null;
  } catch { return null; }
}

function isAncestor(a, b) {
  try { gitRaw(['merge-base', '--is-ancestor', a, b]); return true; } catch { return false; }
}

// target（锁名或其子串）→ 各锁的引入提交
function lockIntros(files, targets) {
  const map = {};
  for (const t of targets) {
    for (const f of files) {
      const hit = testNamesIn(f).find((n) => n.includes(t));
      if (!hit) continue;
      const c = lockIntroCommit(f, hit);
      if (c) (map[t] = map[t] || []).push(c);
    }
  }
  return map;
}

// 建议基线 = 所有引入提交里最靠前的那个的父提交（这样每条目标锁在 base 上都还没被修）
// 返回解析后的完整 sha，不把 "xxx^" 这种字面串往外传：拼进 rev-parse 参数会变成 xxx^^（差一整代）
// 判据方向注意：isAncestor(c, earliest) 为真表示 c 比 earliest 更老，才替换（第一版写反过，
// 反了会挑到**最新**那条引入提交，随后所有更老的锁都被判成"基线已含修复"，一次取证都发不出去）
function suggestBase(intros) {
  const cs = [...new Set(Object.values(intros).flat())];
  if (!cs.length) return null;
  let earliest = cs[0];
  for (const c of cs) if (isAncestor(c, earliest)) earliest = c;
  return git(['rev-parse', earliest + '^']);
}

function baseIsStale(intros, baseSha) {
  const bad = [];
  for (const [name, cs] of Object.entries(intros)) {
    if (cs.some((c) => isAncestor(c, baseSha))) bad.push(name);
  }
  return bad;
}

function main(argv) {
  const get = (k) => { const i = argv.indexOf(k); return i < 0 ? null : argv[i + 1]; };
  let base = get('--base');
  const testsArg = get('--tests');
  const casesArg = get('--cases');
  if (!testsArg || (!base && !argv.includes('--auto-base'))) {
    console.error('用法：node tools/eval-f2p.cjs (--base <ref> | --auto-base) --tests <file[,file…]> [--cases <名字子串>] [--json]');
    return 2;
  }
  const files = testsArg.split(',').map((s) => s.trim()).filter(Boolean);
  const missing = files.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length) { console.error('测试文件不存在：' + missing.join(', ')); return 2; }

  const wantNames = casesArg ? casesArg.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const targets = wantNames.length ? wantNames : files.flatMap((f) => testNamesIn(f));
  const intros = lockIntros(files, targets);
  if (!Object.keys(intros).length) {
    console.error('没能在指定测试文件里定位到任何一条锁的引入提交（锁名对不上？先跑 --tests 单文件不带 --cases）');
    return 2;
  }
  if (!base) {
    base = suggestBase(intros);
    console.error(`自动基线：--base ${base}`);
  }
  const baseSha = git(['rev-parse', base + '^{commit}']);
  const headSha = git(['rev-parse', 'HEAD']);
  if (baseSha === headSha) { console.error('base 与 HEAD 同一个 commit，取证无意义'); return 2; }
  const stale = baseIsStale(intros, baseSha);
  if (stale.length) {
    console.error(`基线选错：base ${base} 已包含下面这些锁的修复提交，"改前必红"在这棵树上不可能成立——这是取证输入错了，不是锁假了，**不要按 §6 删用例**：\n  - `
      + stale.join('\n  - ') + `\n建议 --base ${suggestBase(intros)}`);
    return 2;
  }

  const wt = path.join(path.dirname(ROOT), `.wt-f2p-${Date.now()}`);

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
    const pattern = wantNames.length ? wantNames.map(rxEscape).join('|') : null;
    baseRun = runTestFiles(wt, files, pattern);
    headRun = runTestFiles(ROOT, files, pattern);
  } finally {
    try { gitRaw(['worktree', 'remove', wt, '--force']); gitRaw(['worktree', 'prune']); } catch { /* 残留由 git 自管 */ }
  }

  const v = verdict(baseRun, headRun, wantNames);
  const rec = {
    at: new Date().toISOString(),
    baseRef: base, headRef: 'HEAD', baseSha, headSha,
    files, wantNames, lockIntros: intros,
    base: baseRun, head: headRun, ok: v.ok, why: v.why,
  };
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
  // 基线守卫用真实历史自测：B60-1 的锁与它的修复同提交，所以 HEAD 上做"改前红"必然失败
  const f1 = 'tests/regression-20260919c.test.js';
  const f2 = 'tests/regression-20260919d.test.js';
  const intro = lockIntroCommit(f1, 'B60-1');
  const intro2 = lockIntroCommit(f2, 'F6-1');
  const headSha = git(['rev-parse', 'HEAD']);
  const probes = [
    ['解析汇总', !!p1 && p1.tests === 10 && p1.fail === 3 && p1.failedNames.length === 3],
    ['缺汇总行时返回 null（不许当成通过）', parseSummary('nope') === null],
    ['环境类失败要标出来', parseSummary(broken).envBroken === true],
    ['真锁判成立', verdict(p1, parseSummary(clean), ['B28']).ok === true],
    ['改前也绿 = 假锁', verdict(parseSummary(clean), parseSummary(clean), ['B28']).ok === false],
    ['base 侧 Cannot find module 不算证据', verdict(parseSummary(broken), parseSummary(clean), ['t1']).ok === false],
    ['缺依赖=环境红、缺本项目新文件=产品红（收敛型修复唯一能取到证据的形态）', (() => {
      const own = "ℹ tests 3\nℹ pass 0\nℹ fail 3\n✖ B60-1 x (1ms)\nError: Cannot find module '../lib/reading-filters'\n";
      const p = parseSummary(own);
      return p && p.envBroken === false && p.missingOwn.length === 1 && parseSummary(broken).missingDeps.length === 1;
    })()],
    ['改后仍有红 = 未修好', verdict(p1, p1, ['B28']).ok === false],
    ['指定的锁在 base 没红 = 断言没打中', verdict(p1, parseSummary(clean), ['B99']).ok === false],
    ['查得到锁的引入提交', !!intro && /^[0-9a-f]{40}$/.test(intro)],
    ['base 已含该修复 → 判"基线选错"而不是"锁假了"', baseIsStale({ 'B60-1': [intro] }, headSha).length === 1],
    ['base 在修复之前 → 放行（正向探针，防守卫永远说错）', intro ? baseIsStale({ 'B60-1': [intro] }, git(['rev-parse', intro + '^'])) .length === 0 : false],
    ['自动基线 = 最靠前引入提交的父提交（解析成完整 sha，不带 ^ 字面串）', intro ? /^[0-9a-f]{40}$/.test(suggestBase({ 'B60-1': [intro] })) : false],
    ['自动基线取"最老"而不是"最新"，且与传入顺序无关（方向写反过一次：更老的锁全被判成基线已含修复）', (() => {
      if (!intro || !intro2 || intro === intro2) return false;
      const want = git(['rev-parse', (isAncestor(intro, intro2) ? intro : intro2) + '^']);
      const a = suggestBase({ x: [intro2], y: [intro] });
      const b = suggestBase({ x: [intro], y: [intro2] });
      return a === want && b === want;
    })()],
    ['测试名解析出真用例名', testNamesIn(f1).length >= 8],
    ['证据里的 worktree 绝对路径折成仓库相对（含 Node 报出的双反斜杠形态）', (() => {
      const r = relMissing({ missingOwn: ['D:\\\\.wt-1\\\\tools\\\\x.cjs', '../tools/y.cjs', '../lib/foo'] }, 'D:\\.wt-1');
      return r.missingOwn[0] === 'tools/x.cjs' && r.missingOwn[1] === '../tools/y.cjs' && r.missingOwn[2] === '../lib/foo';
    })()],
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

module.exports = {
  parseSummary, verdict, git, runTestFiles,
  testNamesIn, lockIntroCommit, lockIntros, isAncestor, baseIsStale, suggestBase, rxEscape,
};
