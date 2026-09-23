#!/usr/bin/env node
/**
 * 41-3 F2P/P2P「改前必红」取证器（要求正文 docs/EVAL_GUIDE.md §6 —— 该节即现行唯一事实源；「41-3」现为历史编号，其小 spec 已于 09-23 作废删除，锚点见 docs/ISSUES.md）
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
// `cwd` 决定 ENOENT 的归类：路径落在这棵树里（修复新增的文件/目录）→ 产品红；落在树外 → 环境红。
function parseSummary(text, cwd) {
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
  // 只认单行形态 `ENOENT ... '路径'`。Node 抛的对象 dump 里有 `code: 'ENOENT',` + 下一行 `syscall: 'spawn python3'`，
  // 跨行匹配会捕获出 ",\n    syscall: " 这种假路径，把一次合法取证判成环境失败（本轮实测）。
  const enoent = [...new Set([...String(text || '').matchAll(/ENOENT[^'\n]*'([^'\n]+)'/g)].map((m) => m[1]))];
  const ownEnoent = [...new Set(enoent.map((p) => repoRel(p, cwd)).filter(Boolean))];
  const envPaths = [...new Set([...missingDeps, ...enoent.filter((p) => repoRel(p, cwd) === null)])];
  const envBroken = envPaths.length > 0;
  return { tests, pass, fail, failedNames: [...new Set(failedNames)], envBroken,
    envPaths, missingDeps, missingOwn: [...new Set([...missingOwn, ...ownEnoent])] };
}

// 在 cwd 之下 → 返回仓库相对路径；不在 → null（不知道树在哪时一律按"树外"处理，保守）。
// 分隔符要按"一段"折叠：Node 报出的路径有 `D:\\.wt-…\tools` 这种双反斜杠形态（本轮实测），
// 不折叠就会把"树内新增文件"误判成树外，进而把一次合法取证判成环境失败。
function repoRel(p, cwd) {
  if (!cwd) return null;
  const pre = String(cwd).split(/[\\/]+/).filter(Boolean).join('/') + '/';
  const n = String(p).replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  return n.toLowerCase().startsWith(pre.toLowerCase()) ? n.slice(pre.length) : null;
}

/**
 * 判一次锁是否成立。三态，退出码不混用（EVAL_GUIDE §9：2=fail_env，视为未评测）：
 *   state='ok'    → 退 0：每条目标锁改前都红、改后全绿
 *   state='product' → 退 1：锁真的抓不到 bug / 没修好 —— 只有这一档才允许"删或重写用例"
 *   state='env'   → 退 2：输入错、没跑到、依赖缺 —— **禁止据此删用例**（坑 #41）
 * 判据要点（本轮对抗性审查指出后收紧）：
 *   ①**逐条目标**都要在改前红，"文件里有任意一条红"不成立（旧版会把无关老用例的红当证据）；
 *   ②没点名目标一律拒判（旧版 wantNames 为空时用 base.failedNames 自证，等于循环论证）；
 *   ③任何一侧一条都没跑到 = 没跑，不许当成"改后 0 红 = 全绿"。
 */
function verdict(base, head, wantNames = []) {
  const envFail = (why) => ({ state: 'env', ok: false, why });
  if (!base || !head) return envFail('没有解析到 node:test 汇总行，等于没跑（不算证据，也不算锁假）');
  if (base.envBroken) return envFail(`base 侧有环境类失败，不能当改前红证据（元凶：${(base.envPaths || []).join(', ') || '未记名'}）`);
  if (head.envBroken) return envFail(`head 侧有环境类失败，先修环境再谈证据（${(head.envPaths || []).join(', ')}）`);
  if (!head.tests) return envFail('head 侧一条测试都没跑到（多半是 node:test 输出格式变了或 reporter 被改），绝不记成"改后全绿"');
  if (!base.tests) return envFail('base 侧一条测试都没跑到，等于没取证');
  if (!wantNames.length) return envFail('没点名目标锁：不给 --cases 时按锁文件里的用例名逐条要求，空目标集不许自证成立');
  if (head.fail !== 0) return { state: 'product', ok: false, why: `改后仍有 ${head.fail} 条红，未修好` };
  const miss = wantNames.filter((w) => !base.failedNames.some((n) => n.includes(w)));
  const hit = wantNames.length - miss.length;
  // 注意**不要**把"基线缺本轮新建的文件"单独判成 env：`docs/EVAL_GUIDE.md` §6 明写那是收敛型修复
  // （6 份副本并成 1 个共享模块）**唯一能取到证据的形态**，一律判 env 会让这类修复永远出不了 F2P。
  // 它的代价是红得粗，所以报告里必须原样打印"改前缺本次修复新建的文件 …"，由读证据的人判归因。
  // B106（09-20 复查明出的三条里最危险的一条）：base 侧**一条目标用例名都没点到**，而红项全是
  // `xxx.test.js` 这种**文件名**形态（或报"缺本项目文件"）⇒ 那是"整份文件在基线树上跑不起来"，
  // 不是"锁抓不到 bug"。node --test 在加载崩时照样记 tests=1/fail=1，所以只看 `base.fail` 会把它
  // 读成"改前不红 → 按 §6 删掉或重写" —— 判据方向是**删安全网**，比漏判危险（四份误判样本全这个形态）。
  // 按坑 #41：这只能是 env/退 2（只许修输入），**禁止据此删用例**。
  const fileLevelOnly = base.failedNames.length > 0
    && base.failedNames.every((n) => /\.test\.[cm]?[jt]sx?$/i.test(String(n).trim()));
  if (hit === 0 && (fileLevelOnly || (base.missingOwn || []).length)) {
    return envFail('base 侧红项里没有一条是目标用例名'
      + `（红项=${base.failedNames.join(' | ') || '无'}`
      + `；基线缺的本项目文件=${(base.missingOwn || []).join(' | ') || '无'}）`
      + '—— 这是"整份文件在基线上跑不起来"，不是"锁假了"。按坑 #41 只能退 2 修输入（换基线/补惰性 require/去掉顶层 .env 读），禁止删用例');
  }
  if (!base.fail) return { state: 'product', ok: false, why: `改前也全绿 —— ${wantNames.length} 条锁一条都抓不到 bug，按 §6 应删掉或重写断言` };
  if (miss.length) {
    return { state: 'product', ok: false, why: `${miss.length}/${wantNames.length} 条目标锁改前不红（${miss.slice(0, 5).join(' | ')}${miss.length > 5 ? ' …' : ''}）—— 它们抓不到本轮改动：要么用 --cases 只点本轮的锁，要么按 §6 重写；已红的 ${hit} 条不构成本次取证` };
  }
  const own = (base.missingOwn || []).length ? `；改前缺本次修复新建的文件 ${base.missingOwn.join(', ')}` : '';
  const matched = [...new Set(base.failedNames.filter((n) => wantNames.some((w) => n.includes(w))))];
  return { state: 'ok', ok: true, why: `改前红 ${base.fail} 条（${wantNames.length} 个目标全中，实指 ${matched.length} 条锁），改后 ${head.tests} 条全绿${own}`, perCase: matched };
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
    return relMissing(parseSummary(out, cwd) || { tests: 0, pass: 0, fail: 0, failedNames: [], envBroken: true, missingOwn: [], unparsed: String(out).slice(0, 400) }, cwd);
  } catch (e) {
    const out = String((e && e.stdout) || '') + String((e && e.stderr) || '');
    const p = parseSummary(out, cwd);
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
  const rel = (s) => String(s).replace(preRe, '').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  p.missingOwn = [...new Set(p.missingOwn.map(rel))];
  // 环境类失败也要脱掉临时树前缀：证据是要进 git 的，不该留一次性目录名
  if (Array.isArray(p.envPaths)) p.envPaths = [...new Set(p.envPaths.map(rel))];
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

// --tests 参数收敛到仓库内（越界一律拒，防止"声称跑隔离树实际写主树"）
function scopeFiles(testsArg) {
  const list = String(testsArg || '').split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const f of list) {
    if (path.isAbsolute(f)) return { error: `--tests 不许绝对路径：${f}` };
    const abs = path.resolve(ROOT, f);
    if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return { error: `--tests 越界（必须在仓库内）：${f}` };
    out.push(path.relative(ROOT, abs).split(path.sep).join('/'));
  }
  return { files: out };
}

// 清单参数的取法。旧版 `argv[i+1]` 只取一个 token：`--cases B1 B2 … C6` 会被静默截成只点名 B1，
// 于是"13 条目标锁"变成"1 条"，结论照样打印"✓ F2P 成立"（09-20 实测就这么错的）。
// **多出来的参数一律算输入错误退 2**，不许悄悄丢 —— 丢参数等于把取证范围改小，
// 与坑 #41"输入错只能退 2、禁止据此删用例"同族。
function parseFlagLists(argv) {
  const out = { values: {}, stray: [] };
  for (const k of ['--tests', '--cases', '--base']) {
    const i = argv.indexOf(k);
    if (i < 0) continue;
    const vals = [];
    for (let j = i + 1; j < argv.length && !String(argv[j]).startsWith('--'); j++) vals.push(argv[j]);
    out.values[k] = vals[0] ?? '';
    if (vals.length > 1) out.stray.push({ flag: k, extra: vals.slice(1) });
  }
  return out;
}

function main(argv) {
  const flags = parseFlagLists(argv);
  if (flags.stray.length) {
    console.error('清单参数必须用**逗号**分隔（本工具不认空格分隔，见下方用法）。多出来的参数会被静默丢弃 = 取证范围被改小：');
    for (const s of flags.stray) console.error(`  ${s.flag} 后面多出 ${s.extra.length} 个：${s.extra.join(' ')}`);
    console.error('用法：node tools/eval-f2p.cjs (--base <ref> | --auto-base) --tests <file[,file…]> [--cases <名字子串[,子串…]>] [--json]');
    return 2;
  }
  const get = (k) => (k in flags.values ? flags.values[k] : null);
  let base = get('--base');
  const testsArg = get('--tests');
  const casesArg = get('--cases');
  if (!testsArg || (!base && !argv.includes('--auto-base'))) {
    console.error('用法：node tools/eval-f2p.cjs (--base <ref> | --auto-base) --tests <file[,file…]> [--cases <名字子串>] [--json]');
    return 2;
  }
  // --tests 必须落在仓库内：旧版只做 existsSync(path.join(ROOT,f))，`../…/AGENTS.md` 能过检查，
  // 而 copy 目标 path.join(wt,f) 会解析回**主树** → 取证声称跑隔离树，实际改的是工作区（对抗性审查 I9）
  const scoped = scopeFiles(testsArg);
  if (scoped.error) { console.error(scoped.error + ' —— 取证输入错了，不是锁假了'); return 2; }
  const files = scoped.files;
  const missing = files.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length) { console.error('测试文件不存在：' + missing.join(', ')); return 2; }

  const wantNames = casesArg ? casesArg.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const targets = wantNames.length ? wantNames : files.flatMap((f) => testNamesIn(f));
  const intros = lockIntros(files, targets);
  if (!Object.keys(intros).length) {
    console.error('没能在指定测试文件里定位到任何一条锁的引入提交（锁名对不上？）');
    return 2;
  }
  if (!base) {
    base = suggestBase(intros);
    if (!base) { console.error('目标锁的引入提交里有根提交，没有"改前树"可用 —— 换基线或只点可取证的锁'); return 2; }
    console.error(`自动基线：--base ${base}`);
  }
  let baseSha, headSha;
  try {
    baseSha = git(['rev-parse', base + '^{commit}']);
    headSha = git(['rev-parse', 'HEAD']);
  } catch (e) {
    console.error(`基线 ref 解析失败（${base}）：${String(e.message || e).split('\n')[0]} —— 这是取证输入错了，**不是锁假了，不要删用例**`);
    return 2;
  }
  if (baseSha === headSha) { console.error('base 与 HEAD 同一个 commit，取证无意义'); return 2; }
  const stale = baseIsStale(intros, baseSha);
  if (stale.length) {
    console.error(`基线选错：base ${base} 已包含下面这些锁的修复提交，"改前必红"在这棵树上不可能成立——这是取证输入错了，不是锁假了，**不要按 §6 删用例**：\n  - `
      + stale.join('\n  - ') + `\n建议 --base ${suggestBase(intros)}`);
    return 2;
  }

  // head 侧跑的是**工作区**：有未提交改动时证据不可从 HEAD 复现 → 如实记进 rec 并大声提示（不阻塞，
  // 因为用户常有在途改动；但"改后绿"从此带着 dirty 标记，读证据的人知道自己在看什么）
  const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean);

  const wt = path.join(path.dirname(ROOT), `.wt-f2p-${Date.now()}`);
  let baseRun = null, headRun = null;
  const dropWt = () => { try { gitRaw(['worktree', 'remove', wt, '--force']); gitRaw(['worktree', 'prune']); } catch { /* 残留由 git 自管 */ } };
  process.on('SIGINT', () => { dropWt(); process.exit(130); });   // Ctrl-C 时 finally 不跑，worktree 会留在那
  try {
    gitRaw(['worktree', 'prune']);
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
    dropWt();
  }

  const v = verdict(baseRun, headRun, targets);
  const rec = {
    at: new Date().toISOString(),
    baseRef: base, headRef: 'HEAD', baseSha, headSha,
    files, wantNames, targets, lockIntros: intros,
    headDirty: dirty, headDirtyCount: dirty.length,
    base: baseRun, head: headRun, state: v.state, ok: v.ok, why: v.why,
  };
  fs.mkdirSync(path.join(ROOT, RECORD_DIR), { recursive: true });
  const file = path.join(ROOT, RECORD_DIR, `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`);
  fs.writeFileSync(file, JSON.stringify(rec, null, 1) + '\n');

  if (argv.includes('--json')) console.log(JSON.stringify(rec, null, 1));
  else {
    console.log(`  base ${rec.baseSha.slice(0, 9)} 红 ${baseRun.fail}/${baseRun.tests}（失败：${baseRun.failedNames.slice(0, 6).join(' | ') || '无'}${baseRun.envBroken ? '；含环境类失败' : ''}）`);
    console.log(`  head ${rec.headSha.slice(0, 9)} 红 ${headRun.fail}/${headRun.tests}${dirty.length ? `｜工作区有 ${dirty.length} 个未提交文件（证据不可从 HEAD 复现）` : ''}`);
    console.log(`${v.state === 'ok' ? '✓ F2P 成立' : v.state === 'product' ? '✗ F2P 不成立（锁抓不到 bug，按 §6 处理）' : '⛔ 未取证（输入/环境问题，禁止据此删用例）'} — ${v.why}`);
    console.log(`  证据：${path.relative(ROOT, file)}`);
  }
  // 只有"锁真的抓不到 bug"才退 1（§6 的处置动作是删/重写）；环境类一律退 2（视为未评测）
  return v.state === 'ok' ? 0 : v.state === 'product' ? 1 : 2;
}

// 常驻账本（B114 的第二半：取证结论与文档数字脱钩）。原先是一次性 `tools/_f2p-ledger.cjs`，
// 跑完就没人再跑 —— 那样"哪条锁真被改前红证明过"仍要靠人记，下一轮照样漂。
function ledger() {
  const dir = path.join(ROOT, RECORD_DIR);
  if (!fs.existsSync(dir)) { console.log(`${RECORD_DIR} 不存在 —— 没有取证轮`); return 2; }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const rows = [];
  for (const f of files) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { rows.push({ f, state: 'unreadable' }); continue; }
    const b = j.base || {};
    const fileLevelOnly = (b.failedNames || []).length > 0
      && b.failedNames.every((n) => /\.test\.[cm]?[jt]sx?$/i.test(String(n).trim()));
    rows.push({
      f, base: String(j.baseRef || j.baseSha || '').slice(0, 9), state: j.state, ok: j.ok,
      want: (j.wantNames || []).length, baseRed: `${b.fail ?? '?'}/${b.tests ?? '?'}`,
      headRed: `${(j.head || {}).fail ?? '?'}/${(j.head || {}).tests ?? '?'}`,
      why: String(j.why || '').replace(/\s+/g, ' ').slice(0, 58),
    });
    // 已入库的旧证据按**新判据**重算一遍分类：旧轮判成 product 的，若其实是"文件级崩"就标出来
    if (j.state === 'product' && fileLevelOnly) rows[rows.length - 1].misclassified = 'B106 形态（文件级崩被判成锁假）';
    if ((j.base || {}).missingOwn && (j.base || {}).missingOwn.length && j.state === 'product')
      rows[rows.length - 1].misclassified = rows[rows.length - 1].misclassified || 'B106 形态（基线缺本项目文件被算成产品红）';
  }
  console.log(`F2P 账本（${RECORD_DIR}，共 ${files.length} 份）`);
  console.log('证据文件 | base | state | ok | 点名数 | base红/跑 | head红/跑 | 结论摘要');
  for (const r of rows) {
    console.log(`${r.f} | ${r.base || '-'} | ${r.state} | ${r.ok} | ${r.want ?? '-'} | ${r.baseRed || '-'} | ${r.headRed || '-'} | ${r.why || ''}${r.misclassified ? ` ⟵ ${r.misclassified}` : ''}`);
  }
  const bad = rows.filter((r) => r.misclassified);
  const okCount = rows.filter((r) => r.ok === true).length;
  console.log(`\nok ${okCount} / 不成立 ${rows.length - okCount}；按新判据重算后标出旧账里的 B106 形态 ${bad.length} 份`);
  console.log('口径：只有 state=ok 且点名到用例名的证据才算"这条锁被改前红证明过"；'
    + 'state=product 且 base 红项是文件名 ⇒ 属未取证（B106），文档里引用条数必须带证据文件名（坑 #45/B114）。');
  return bad.length ? 2 : 0;
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
    ['ENOENT 也要分树内/树外：新增文件类修复的报错是产品红，不是环境红', (() => {
      const inside = "ℹ tests 1\nℹ pass 0\nℹ fail 1\n✖ t (1ms)\nError: ENOENT: no such file or directory, scandir 'D:\\wt\\tools\\eval-content'\n";
      const outside = "ℹ tests 1\nℹ pass 0\nℹ fail 1\n✖ t (1ms)\nError: ENOENT: no such file or directory, open 'C:\\Windows\\whatever'\n";
      const pi = parseSummary(inside, 'D:\\wt');
      const po = parseSummary(outside, 'D:\\wt');
      return pi.envBroken === false && pi.missingOwn.includes('tools/eval-content')
        && po.envBroken === true && parseSummary(inside).envBroken === true;   // 不给 cwd 时保守判环境红
    })()],
    ['双反斜杠形态的树内路径不许被判成环境红（本轮 f 锁取证当场踩到）', (() => {
      const dbl = "ℹ tests 1\nℹ pass 0\nℹ fail 1\n✖ t (1ms)\nError: ENOENT: no such file or directory, scandir 'D:\\\\.wt-9\\\\tools\\\\eval-content'\n";
      const p = parseSummary(dbl, 'D:\\.wt-9');
      return p.envBroken === false && p.missingOwn.includes('tools/eval-content');
    })()],
    ['Node 的对象 dump（code: ENOENT 跨行）不许被当成缺失路径', (() => {
      const dump = "ℹ tests 1\nℹ pass 0\nℹ fail 1\n✖ t (1ms)\nError: spawnSync python3 ENOENT\n  code: 'ENOENT',\n  syscall: 'spawn python3',\n  path: 'python3',\n";
      const p = parseSummary(dump, 'D:\\wt');
      return p.envPaths.length === 0 && p.fail === 1;
    })()],
    ['判"环境红"时必须点出是哪个路径（不许只说"有环境问题"让人瞎猜）', (() => {
      const v = verdict(parseSummary("ℹ tests 1\nℹ pass 0\nℹ fail 1\n✖ t (1ms)\nError: Cannot find module 'left-pad'\n", 'D:\\wt'),
        parseSummary(clean), ['t']);
      return v.ok === false && /left-pad/.test(v.why);
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
    // 对抗性审查（本轮）指出三条"工具自己会说谎"的路径，逐条钉住
    ['没点名目标时不许自证成立（旧版：文件里任意一条红就判 ✓）', (() => {
      const unrelated = parseSummary('ℹ tests 6\nℹ pass 1\nℹ fail 5\n✖ 无关老用例A (1ms)\n✖ B (1ms)\n✖ C (1ms)\n✖ D (1ms)\n✖ E (1ms)\n');
      const v = verdict(unrelated, parseSummary(clean), []);
      return v.ok === false && v.state === 'env';
    })()],
    ['部分目标改前不红 = 不成立（旧版命中 1 条就报 ✓ 并把 3 条目标全记进 wantNames）', (() => {
      const one = parseSummary('ℹ tests 6\nℹ pass 5\nℹ fail 1\n✖ 锁X (1ms)\n');
      const v = verdict(one, parseSummary(clean), ['锁X', '锁Y', '锁Z']);
      return v.ok === false && v.state === 'product' && /3 条目标锁改前不红/.test(v.why);
    })()],
    ['空格分隔的清单参数必须报出来，不许静默只点名第一条（09-20 实测就这么错过一次）', (() => {
      const sp = parseFlagLists(['node', 'x', '--cases', 'B1', 'B2', 'B3']);
      const cm = parseFlagLists(['node', 'x', '--cases', 'B1,B2,B3', '--json']);
      return sp.values['--cases'] === 'B1' && sp.stray.length === 1 && sp.stray[0].extra.join(' ') === 'B2 B3'
        && cm.values['--cases'] === 'B1,B2,B3' && cm.stray.length === 0;
    })()],
    // B106：四份误判样本的形态必须落到 env（退 2），不许再授权"删掉 13 条好锁"
    ['base 只有文件名级红 = 没跑到（判 env，不判 product）', (() => {
      // 样本刻意**不带** "Cannot find module"，让它走"文件级崩"那条分支（另一条分支有独立探针）
      const crash = parseSummary('ℹ tests 13\nℹ pass 0\nℹ fail 13\n✖ tests/regression-20260920b.test.js (1ms)\n✖ tests/regression-20260920c.test.js (1ms)\n');
      const v = verdict(crash, parseSummary(clean), ['B1', 'B2', 'C6']);
      return v.ok === false && v.state === 'env' && /禁止删用例/.test(v.why);
    })()],
    ['同一条判据不许误伤真·改前不红（用例名级红仍判 product）', (() => {
      const named = parseSummary('ℹ tests 13\nℹ pass 12\nℹ fail 1\n✖ B3 别的用例 (1ms)\n');
      const v = verdict(named, parseSummary(clean), ['B1', 'B2']);
      return v.ok === false && v.state === 'product' && /2 条目标锁改前不红/.test(v.why);
    })()],
    ['基线缺本轮新建文件、但用例名级红 = 仍判成立（收敛型修复唯一取证形态，不许一律 env 掉）', (() => {
      const ownMissing = 'ℹ tests 13\nℹ pass 0\nℹ fail 13\n✖ B1 日界 (1ms)\nError: Cannot find module \'../lib/time-window\'\n';
      const v = verdict(parseSummary(ownMissing, ROOT), parseSummary(clean), ['B1']);
      return v.ok === true && v.state === 'ok' && /改前缺本次修复新建的文件/.test(v.why);
    })()],
    ['文件名级红但有目标命中 = 不套文件级 env 规则（缺文件的那条另有判据）', (() => {
      const mixed = parseSummary('ℹ tests 13\nℹ pass 11\nℹ fail 2\n✖ B1 时区窗 (1ms)\n✖ tests/regression-20260920c.test.js (1ms)\n');
      const v = verdict(mixed, parseSummary(clean), ['B1', 'B2']);
      return v.ok === false && v.state === 'product' && /1\/2 条目标锁改前不红/.test(v.why);
    })()],
    ['解析不到汇总时不许凭空造出"改后 0 红 = 全绿"', (() => {
      const red = parseSummary('ℹ tests 3\nℹ pass 0\nℹ fail 3\n✖ B28 x (1ms)\n✖ B29 y (1ms)\n✖ B60 z (1ms)\n');
      const v = verdict(red, { tests: 0, pass: 0, fail: 0, failedNames: [], envBroken: false }, ['B28']);
      return v.ok === false && v.state === 'env' && /没跑到/.test(v.why);
    })()],
    ['--tests 越出仓库必须拒；能折回仓库内的要先归一（旧版 `../…/AGENTS.md` 会让 copy 目标解析回主树）', (() => {
      const okPath = scopeFiles('tests/regression-20260919c.test.js');
      // 折回路径与绝对路径都不能写死主机形态：本机目录叫「全网情报系统」、CI 检出叫 qwis-portal；
      // 'D:/…' 在 Linux 上不是绝对路径。都从运行时环境现算。
      const norm = scopeFiles(`../${path.basename(ROOT)}/AGENTS.md`);
      const esc = scopeFiles('../../outside/x.test.js');
      const abs = scopeFiles(path.join(require('os').tmpdir(), 'f2p-outside-x.test.js'));
      return okPath.files[0] === 'tests/regression-20260919c.test.js'
        && norm.files && norm.files[0] === 'AGENTS.md'
        && !!esc.error && !!abs.error;
    })()],
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
  else if (process.argv.includes('--ledger')) process.exitCode = ledger();
  else process.exitCode = main(process.argv);
}

module.exports = {
  parseSummary, verdict, git, runTestFiles, ledger, parseFlagLists,
  testNamesIn, lockIntroCommit, lockIntros, isAncestor, baseIsStale, suggestBase, rxEscape, scopeFiles, repoRel,
};
