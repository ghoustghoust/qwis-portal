// 判据地基的回归锁（B104）—— 坑 #62 / #63 / #64 各自钉成**行为锁**。
// 为什么必须有这个文件：这三条坑都长在"负责发现问题的工具"上，上一轮它们只有实现与一次性自证
// （`tools/eval-e2e.cjs` 的 resolveSrc、`tools/_probe-strip-selftest.cjs`），`npm test` 一条都不跑；
// 白盒 W9 因此判红，而 W9 红又顺着让 `tests/regression-20260919g.test.js` 的 G3（断言 whitebox 退 0）
// 必现红 —— 回归网失去了"没弄坏东西"的判定能力。
// 取证口径（坑 #64 规则②）：本文件是"基线里根本没有对应形态"的新增门禁，**不适用 F2P 的改前红**；
// 它的取证是下面每条里的负向样本：把坏形态喂给判据，必须逐个翻转，并且都断言"样本本身有区分度"
// （坑 #45：只补注释让 W9 转绿 = 绿得不干活，正是本坑禁止的动作）。
// 依赖纪律：被测模块一律惰性取（本文件自己就得守坑 #64/#67 的形态）。
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const linesOf = (...p) => read(...p).split('\n');

/**
 * 判「某个 `require('../lib/X')` 是不是**加载期就求值**」——这才是坑 #64 的病。
 * 不用缩进、也不用单行正则（独立审查指出：单行正则躲得过跨行解构，缩进判据躲得过任何排版改动）。
 * 两条合起来判：
 *   ① 花括号深度 > 0 → 它在某个函数/用例体里，属于"调用时才取"，放过；
 *      深度用 lib/src-spans 的 **masked 视图**数（与原文逐字符等长 = 坑 #63 的那条不变量），
 *      所以注释与字符串里的括号不会参与计数；
 *   ② 深度 0 时，从本条语句起点往回找，**切片里出现 `=>` 即放过** ——
 *      `const tw = () => require('../lib/x')` 的括号深度也是 0（箭头参数括号在 require 之前就闭合了），
 *      只看深度会把它错判成违规（第一版就错在这，把三份惰性锁全报了红）。
 */
function topLevelLibRequires(text, modPattern) {
  const { scan } = require('../lib/src-spans');
  const one = scan(text);
  const depthAt = new Int32Array(text.length + 1);
  let d = 0;
  for (let i = 0; i < text.length; i++) {
    const c = one.masked[i];
    if (c === '{') d++;
    else if (c === '}') d--;
    depthAt[i] = d;
  }
  // 语句起点：往回找到最近一个"深度 0 处的 `;` 或 `}`"（找不到就是文件开头）
  const stmtStart = (pos) => {
    let dd = 0;
    for (let i = pos - 1; i >= 0; i--) {
      const c = one.masked[i];
      if (c === '}') dd++;
      else if (c === '{') dd--;
      else if (dd <= 0 && (c === ';' || c === '}')) return i + 1;
    }
    return 0;
  };
  const hits = [];
  for (const m of text.matchAll(new RegExp(`require\\(['"]\\.\\./lib/(${modPattern})['"]\\)`, 'g'))) {
    const depth = depthAt[m.index] ?? 0;
    if (depth > 0) continue;
    if (text.slice(stmtStart(m.index), m.index).includes('=>')) continue;
    hits.push(m[1]);
  }
  return hits;
}

// ───────────────────────── 坑 #62：出处锚点的行号必须现算，坏锚点必须点名 ─────────────────────────

// 从 eval-e2e 自己的源码里取出锚点字面量。用 stripComments 后的视图取 ——
// 否则**注释里举的反例锚点**会被当成真锚点（坑 #63 的教训直接咬合在这里）。
function anchorsInTool() {
  const { stripComments } = require('../lib/src-spans');
  const code = stripComments(read('tools', 'eval-e2e.cjs'));
  const out = [];
  for (const m of code.matchAll(/(\w+):\s*'([^']*#[^']*)'/g)) out.push([m[1], m[2]]);
  return out;
}

// 独立于被测实现的另一条路：从函数声明行扫到首个顶格 `}`。不复用 lib/src-spans 的 spans()
// （否则"用被测实现验证被测实现"，正是坑 #63 说的两套事实会分叉的那个形状）。
function fnBodyLines(lines, fnName) {
  const from = lines.findIndex((l) => new RegExp(`function\\s+${fnName}\\s*\\(`).test(l));
  if (from < 0) return null;
  let to = from;
  for (let i = from + 1; i < lines.length; i++) { to = i; if (/^\}/.test(lines[i])) break; }
  return [from + 1, to + 1];
}

test('#62-1 SRC/QUERY_SRC 每条锚点解析出的行号，必须真的落在含该片段的同一行（行号不许是手写的）', () => {
  const e2e = require('../tools/eval-e2e.cjs');
  const anchors = anchorsInTool();
  assert.ok(anchors.length >= 5, `只取出 ${anchors.length} 条锚点，本锁等于没判（样本太少，没有区分度）`);
  // 只断"没有一条真实锚点被记名"。ANCHOR_ERRORS 是模块级数组，#62-2 会往里推 3 条 ——
  // 断"整数组为空"就把本锁变成执行顺序依赖（独立审查指出：颠倒顺序或用 --test-name-pattern 单跑即假红）
  const keys = new Set(anchors.map(([k]) => k));
  assert.deepStrictEqual(e2e.ANCHOR_ERRORS.filter((e) => keys.has(String(e).split('→')[0])), [],
    '出处表在当轮就有解析失败的锚点，先把它们修掉再谈本锁：\n' + e2e.ANCHOR_ERRORS.join('\n'));
  const bad = [];
  for (const [key, anchor] of anchors) {
    const resolved = e2e.SRC[key] || e2e.QUERY_SRC[key];
    assert.ok(resolved, `锚点 ${key} 既不在 SRC 也不在 QUERY_SRC —— 出处表形态变了，本锁要跟着改`);
    // file 里带 `/` 与 `[...slug]`，所以按**最后一个冒号**切，不用正则（正则字面量里那个 `/`
    // 不转义就会把字面量截断 —— 坑 #63 说的正是这类形态）
    const sep = resolved.lastIndexOf(':');
    assert.ok(sep > 0 && /^\d+$/.test(resolved.slice(sep + 1)),
      `${key} 的解析结果不是 file:line 形态：${resolved}`);
    const file = resolved.slice(0, sep);
    const lineStr = Number(resolved.slice(sep + 1));
    const frag = anchor.includes('#fn=') ? anchor.slice(anchor.indexOf('::') + 2) : anchor.slice(anchor.indexOf('#') + 1);
    const lines = linesOf(file);
    const at = lines[lineStr - 1] || '';
    if (!at.includes(frag)) bad.push(`${key}：解析到 ${file}:${lineStr}，那一行不含片段 ${JSON.stringify(frag)}`);
    // 两条独立复算，**不许只在全文件唯一命中时才生效**（独立审查实测：13 条锚里有 5 条多命中，
    // 旧写法对它们直接跳过判据 → 把锚点指到别的函数的同名行也检不出）
    const hits = lines.map((l, i) => (l.includes(frag) ? i + 1 : 0)).filter(Boolean);
    if (hits.length === 1 && hits[0] !== lineStr) bad.push(`${key}：全文件唯一命中在第 ${hits[0]} 行，解析却给 ${lineStr}`);
    if (anchor.includes('#fn=')) {
      const fn = /#fn=(\w+)::/.exec(anchor)[1];
      const range = fnBodyLines(lines, fn);
      if (!range) bad.push(`${key}：找不到函数声明 ${fn}（改名/搬家了，换名字，别改判据）`);
      else if (!(range[0] <= lineStr && lineStr <= range[1]))
        bad.push(`${key}：解析行 ${lineStr} 不在 ${fn} 的体内 ${range.join('-')} —— 跨函数错取未被发现`);
    }
    // 幂等：再解析一次必须得到同一个行号（现算而不是"第一次算完存起来"）
    if (e2e.resolveSrc(key, anchor) !== resolved) bad.push(`${key}：重复解析结果变了（${e2e.resolveSrc(key, anchor)} ≠ ${resolved}）`);
  }
  assert.deepStrictEqual(bad, [], '锚点与代码已经对不上：\n' + bad.join('\n'));
});

test('#62-2 坏锚点必须逐条点名、并且原样返回（不许静默降级成"指向第 1 行"）', () => {
  const e2e = require('../tools/eval-e2e.cjs');
  // 前提：下面那条"命中多处"的样本必须真的多处 —— 否则三条里少推一条，报错信息会指向判据而不是样本。
  // 作用域用与 #62-1 同一条独立路子（fnBodyLines），声明形态改名时点名"换名字别改判据"，
  // 而不是悄悄数到整个文件的 const 行
  const hotLines = linesOf('api', '[...slug].js');
  const range = fnBodyLines(hotLines, 'handleHot');
  assert.ok(range, '找不到 handleHot 的函数声明 —— 它改名或搬家了，换名字，别改判据');
  const multi = hotLines.slice(range[0] - 1, range[1]).filter((l) => l.includes('const')).length;
  assert.ok(multi >= 2, `handleHot 内只剩 ${multi} 行含 const，"命中多处"样本失去前提 —— 换一个片段，别改判据`);
  const before = e2e.ANCHOR_ERRORS.length;
  const CASES = [
    ['probe-frag-gone', 'api/[...slug].js#fn=handleHot::这段文字全仓不可能存在-B104', /命中 0 处/],
    ['probe-ambiguous', 'api/[...slug].js#fn=handleHot::const', /命中 \d+ 处.*不[够唯]*唯一/],
    ['probe-fn-renamed', 'api/[...slug].js#fn=handleDefinitelyNotHere::const', /找不到函数/],
  ];
  for (const [key, anchor, reason] of CASES) {
    const got = e2e.resolveSrc(key, anchor);
    assert.equal(got, anchor, `${key}：解析失败却改写了返回值（${got}）—— 静默指到别处比报红更坏（坑 #62 的原始病）`);
  }
  const pushed = e2e.ANCHOR_ERRORS.slice(before);
  assert.equal(pushed.length, CASES.length, `坏锚点应各记一条，实得 ${pushed.length} 条：\n${pushed.join('\n')}`);
  for (const [[key, , reason], i] of CASES.map((c, i) => [c, i])) {
    assert.match(pushed[i], new RegExp(`^${key}→`), `${key} 的报错没点名（坑 #45：不点名等于没抓）`);
    assert.match(pushed[i], reason, `${key} 的报错形态不对：${pushed[i]}`);
  }
  // 反向对照：一条真锚点走同一条路，必须一条都不记 —— 否则上面三条是恒真的
  const good = anchorsInTool()[0];
  e2e.resolveSrc(good[0], good[1]);
  assert.equal(e2e.ANCHOR_ERRORS.length, before + CASES.length,
    '真锚点也被记进 ANCHOR_ERRORS —— 上一组的红是判据坏，不是样本坏');
});

// ───────────────────────── 坑 #63：词法视图必须"抹得掉注释、吃不掉代码" ─────────────────────────

const KILLER = [
  {
    name: '正则字面量里带引号（上一版在这里开假字符串，之后整行行尾注释以"字符串内容"留下）',
    // String.raw 保留 \s 与 \1 的字面形态，样例本身就是一个真实出现过的写法
    src: String.raw`const s = t.replace(/\ssrc=(["']).*?\1/gi, ''); // 门槛已接 applyDailyQualityGate` + '\n',
    marker: 'applyDailyQualityGate',
    mustKeep: 'ssrc=(',
  },
  {
    name: '反引号字符类（开一个假模板态，一路吃掉后面十几行的真注释与真代码）',
    src: 'const cls = /[`~]/; // 尾注释标记-B63B\nconst kept = 1;\n',
    marker: 'B63B',
    mustKeep: 'const kept = 1;',
  },
  {
    name: '模板插值里的块注释 + 行尾注释（${} 里是真代码，不许当字符串整段抹）',
    src: 'const s = `a${ b /* 插值内注释-B63C */ }c`; // 行尾-B63D\n',
    marker: 'B63D',
    mustKeep: '`a${ b',
  },
];

test('#63-1 三种杀手形态：注释抹净、代码与字符串内容留下、masked 与原文等长', () => {
  const { scan, stripComments, stripStrings } = require('../lib/src-spans');
  for (const k of KILLER) {
    assert.ok(k.src.includes(k.marker), `${k.name}：样本本身不含 marker，判据恒真`);
    const stripped = stripComments(k.src);
    assert.ok(!stripped.includes(k.marker), `${k.name}：注释没被抹净 → "注释里写一句已接线"就又算接了（坑 #63 原病）`);
    assert.ok(stripped.includes(k.mustKeep), `${k.name}：真代码/字符串主体被吃掉了（判 SQL 要用它）`);
    const one = scan(k.src);
    assert.equal(one.masked.length, k.src.length, `${k.name}：masked 与原文不等长，偏移量对账作废`);
    assert.ok(!stripStrings(k.src).includes(k.marker), `${k.name}：code 视图留着注释（W14 判接线用的正是这一版）`);
    // 注释区间清单必须真的把它记进去（三视图互相对得上，而不是各自再扫一遍）。
    // 独立审查指出上一版这里写了 `|| 没有块注释就算过`，对 3 个样本里的 2 个恒真 —— 逃生口删掉
    assert.ok(one.comments.length >= 1, `${k.name}：注释区间清单为空 —— marker 被当成了别的东西，视图之间已经不自洽`);
  }
});

test('#63-2 区分度：不认正则字面量的那版状态机，在同一个样本上必须"把注释当字符串留下"（证明样本真能抓 bug）', () => {
  // 这份 naive 就是坑 #63 之前那版的行为：引号一律当字符串开头，没有"正则 vs 除法"的判别；
  // 而 stripComments 的语义是**字符串内容原样保留**，所以假字符串里的 `// …` 就整段活了下来。
  // （上一版我把它写成"字符串内容也删"，于是 naive 反而"抹干净了"，对照恒真 —— 判据自己造假阳。）
  // 断言的不是本项目代码，而是**样本有牙**：哪天有人把杀手样本换成温和样例，本条立刻红。
  const naiveStripComments = (text) => {
    let out = '', i = 0, str = null;
    while (i < text.length) {
      const c = text[i];
      if (str) { out += c; if (c === str && text[i - 1] !== '\\') str = null; i++; continue; }
      if (c === '"' || c === "'" || c === '`') { str = c; out += c; i++; continue; }
      if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
      out += c; i++;
    }
    return out;
  };
  const { stripComments } = require('../lib/src-spans');
  const sample = KILLER[0].src;
  assert.ok(naiveStripComments(sample).includes('applyDailyQualityGate'),
    'naive 那版居然也抹干净了 → 这个样本已失去区分度，换一个真带引号的正则字面量');
  assert.ok(!stripComments(sample).includes('applyDailyQualityGate'), '现实现退了回到坑 #63 的形态');
});

const SELFTEST_LIMIT = 60; // 只在这一处出现；下面按变量断言，改数字不会留下一个假绿的第二处

test('#63-3 那条自证必须真的跑在 npm test 里（等距抽样真实源文件，双向读数全 0、样本非空）', () => {
  const out = execFileSync(process.execPath, ['tools/_probe-strip-selftest.cjs'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, STRIP_SELFTEST_LIMIT: String(SELFTEST_LIMIT) },
  });
  assert.ok(out.includes(`扫了 ${SELFTEST_LIMIT} 个源文件`), `抽样没生效或文件数变了：\n${out}`);
  assert.match(out, /含注释的 [1-9]\d* 个/, '抽到的样本里没有带注释的文件 = 两个方向都没测到');
  assert.match(out, /杀手样本 \d+ 个/, '杀手样本计数行不见了 —— 判据换了形态，本锁要跟着改');
  // 逐键取数，不按输出行序做正则（上一版依赖 `bad` 的键序，换键序即假红/假绿）
  const counts = {};
  for (const m of out.matchAll(/^\s{2}(\w+): (\d+)$/gm)) counts[m[1]] = Number(m[2]);
  for (const k of ['syntax', 'commentLeft', 'stringEaten']) {
    assert.ok(k in counts, `自证没有报出 ${k} 这一项 —— 三个方向少一个都不算双向证明`);
    assert.equal(counts[k], 0, `自证判红：${k}=${counts[k]}\n${out}`);
  }
  assert.match(out, /^OK/m, '自证最后一行不是 OK');
  // 全量（328 个 ≈52s）必须还有**一条命令**能跑，不能只靠注释承诺（独立审查指出）
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['eval:strip-selftest'], 'node tools/_probe-strip-selftest.cjs',
    'npm run eval:strip-selftest 不在 —— "全量留门禁轮"是句空话');
});

// ───────────────────────── 坑 #64：顶层依赖 → 整文件加载崩，与"用例红"必须可分辨 ─────────────────────────

// 扫描面**派生自 `tests/` 全量**，不写死宿主名单（独立审查指出：上一版只盯 5 份，而 `tests/` 里有
// 38 份 `regression-*.test.js`，33 份在面外 —— 下一轮新建的锁文件顶层 require 根本检不到，
// 那恰好是坑 #64 的原形态，而锁恒绿）。白名单是一份**被双向校验的集合**：出现新违规即红；
// 把某份清干净了也红（提醒收回豁免），不许悄悄漂移。
const TOPLEVEL_LIB_ALLOW = {
  'regression-20260919h.test.js': ['source-axes'],
  'regression-20260919i.test.js': ['src-spans'],
  // ⚠ 这份是 #64 的**潜伏形态**：锁与 `lib/text-clean` 同批落地，F2P 把它复制进基线树时模块不在 →
  // 整文件加载崩。列在这里是记账，不是赦免（#67 已把同一族写进禁形清单，动作在放行表 #10）。
  'regression-20260920a.test.js': ['text-clean'],
  'regression-20260920c.test.js': ['brief-guards'],
  'regression-brief-guards.test.js': ['brief-guards'], // 模块（09-18）早于该锁落地，基线上有 → 不触发 #64
  'source-axes.test.js': ['source-axes'],
};
// 坑 #67 点名的那份（顶层读 `.env` + require `api/_ai`）：它永远不能当契约锁的宿主。
// 下面三份是本轮把扫描面扩到全量后**新抓出来的既存实例** —— 它们读 `.env` 是为了拿打云端 Turso 的
// token，正是 B117/放行表 #13 那三份"仍绑生产"的测试；搬到隔离库是那条待办的动作，本轮不顺手改。
const ENV_READ_ALLOW = ['regression-daily-ai.test.js', 'regression-20260913.test.js',
  'regression-20260913b.test.js', 'regression-20260918.test.js'];
const LAZY_HOSTS = ['regression-20260920b.test.js', 'regression-20260920c.test.js', 'regression-ai-throttle.test.js'];

test('#64-1 锁文件不许在顶层 require 近期新建的模块（必须惰性取，否则 F2P 只能读成"锁假了"）', () => {
  const { stripComments } = require('../lib/src-spans');
  const norm = (m) => m.replace(/\.js$/, '');
  const files = fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.test.js'));
  assert.ok(files.length >= 38, `只扫到 ${files.length} 份 .test.js —— 扫描面自己缩水了，本锁就失去覆盖面`);
  const hits = [];
  const seen = {};
  for (const f of files) {
    const code = stripComments(read('tests', f));
    const top = topLevelLibRequires(code, '[\\w.-]+').map(norm).sort();
    if (top.length) seen[f] = top;
    for (const m of top) {
      if (!(TOPLEVEL_LIB_ALLOW[f] || []).includes(m)) {
        hits.push(`${f} 顶层 require ../lib/${m}（改惰性：const x = () => require('../lib/${m}')）`);
      }
    }
    const topLevelLines = code.split('\n').filter((l) => !/^\s/.test(l)).join('\n');
    if (/\breadFileSync\([^)]*\.env/.test(topLevelLines) && !ENV_READ_ALLOW.includes(f)) {
      hits.push(`${f} 顶层读 .env（坑 #67：基线树里没有 .env，它被 gitignore）`);
    }
  }
  assert.deepStrictEqual(hits, [], '回归锁的宿主形态退化了：\n' + hits.join('\n'));
  assert.deepStrictEqual(seen, TOPLEVEL_LIB_ALLOW,
    '顶层 require `lib/` 的实测集合与豁免清单不一致 —— 要么新增了违规（红得有道理），'
    + '要么有人清掉了旧豁免（那就把白名单收短，别留着当装饰）');
  for (const f of LAZY_HOSTS) {
    assert.ok(/\)\s*=>\s*require\(['"]\.\.\/lib\//.test(stripComments(read('tests', f))),
      `${f} 不再用惰性 require —— 坑 #64 规则①在这个宿主上没人守了`);
  }
  // 反向自证（坑 #45）：六种形态逐个喂给同一条判据，各自必须给对的答案。
  // 上一版是单行正则，跨行解构直接躲得过（独立审查实测）
  const probe = (body) => topLevelLibRequires(stripComments(body), '[\\w.-]+');
  assert.deepStrictEqual(probe("const tw = require('../lib/time-window');\n"), ['time-window'], '标准坏样本都没抓到 = 判据恒绿');
  assert.deepStrictEqual(probe("const {\n  beijingDateStr,\n} = require('../lib/time-window');\n"), ['time-window'],
    '跨行解构躲得过判据');
  assert.deepStrictEqual(probe("test('x', () => { const m = require('../lib/time-window'); assert.ok(m); });\n"), [],
    '用例体内的 require 被算成违规（那正是本坑要求的正确形态）');
  assert.deepStrictEqual(probe("const tw = () => require('../lib/time-window');\n"), [],
    '惰性形态被误判红，会把好锁删掉');
  assert.deepStrictEqual(probe("/*\nconst tw = require('../lib/time-window');\n*/\n"), [],
    '块注释里的反例被算成违规（坑 #63 与 #64 在这里咬合）');
  assert.deepStrictEqual(probe("const s = '}{)( '; const tw = () => require('../lib/time-window');\n"), [],
    '字符串里的括号把深度数搅乱 —— masked 等长不变量没起作用');
});

test('#64-2 顶层依赖 vs 惰性依赖：同一句断言必须给出"文件名级红"与"用例名级红"两态（可归因是分界）', () => {
  const { parseSummary } = require('../tools/eval-f2p.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b104-f2p-shape-'));
  try {
    const aName = 'a-toplevel-require.test.cjs';
    const bName = 'b-lazy-require.test.cjs';
    // A：坑 #64 出事时的形态 —— 顶层 require 基线里不存在的模块，整份文件加载崩
    fs.writeFileSync(path.join(dir, aName),
      "const m = require('./nope-not-in-baseline');\nconst { test } = require('node:test');\ntest('case-A-never-runs', () => { throw new Error('unreachable'); });\n");
    // B：本坑的规则① —— 模块惰性取，让**这条用例**各自报红
    fs.writeFileSync(path.join(dir, bName),
      "const { test } = require('node:test');\nconst m = () => require('./nope-not-in-baseline');\ntest('case-B-lazy-red', () => { m(); });\n");
    const run = (f) => {
      // 必须摘掉 NODE_TEST_CONTEXT：本锁自己跑在 `node --test` 里，父进程带着该变量时，
      // 子进程会打印"run() is being called recursively … skipping running files"并**交出空 stdout**
      // （node 24 实测），于是 parseSummary 得 null —— 又一型"跑不起来被当成没红"（正是本坑的形状）。
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const r = spawnSync(process.execPath, ['--test', f], { cwd: dir, encoding: 'utf8', env });
      return `${r.stdout || ''}\n${r.stderr || ''}`;
    };
    const crashText = run(aName);
    const lazyText = run(bName);
    assert.ok(/ℹ tests \d+/.test(crashText), `A 侧子进程没有产出汇总行（嵌套 node --test 被跳过？）：\n${crashText.slice(0, 300)}`);
    const crash = parseSummary(crashText, dir);
    const lazy = parseSummary(lazyText, dir);
    assert.ok(crash, 'A 侧没解析到 node:test 汇总行（输出格式变了？本锁与 F2P 都要跟着改）');
    assert.ok(lazy, 'B 侧没解析到 node:test 汇总行');
    assert.equal(crash.fail, 1, '夹具 A 应当红');
    assert.equal(lazy.fail, 1, '夹具 B 应当红 —— 它红了才说明惰性形态把失败留在了用例级');
    assert.ok(!crash.failedNames.includes('case-A-never-runs'),
      `加载崩却产出了用例名（${crash.failedNames.join(' | ')}）—— 坑 #64 的成因没了，本锁与 F2P 的归因前提要一起重写`);
    assert.ok(crash.failedNames.some((n) => /\.test\.cjs$/.test(n)),
      `加载崩的失败项应当是**文件名**，实得：${crash.failedNames.join(' | ')}`);
    assert.ok(lazy.failedNames.includes('case-B-lazy-red'),
      `惰性形态必须点到用例名，实得：${lazy.failedNames.join(' | ')}`);
    // 两态的输入信号必须齐：文件级崩时 tests 仍是 1 —— "跑了几条"不等于"点名了没"，
    // 这正是 B106 要拿去分 env/product 的依据。本锁只钉"可分辨"，**不改 eval-f2p 的分类**（放行表 #2 待批）。
    assert.ok(crash.tests >= 1 && crash.missingOwn.length >= 1, '文件级崩的读数形态变了（missingOwn 应当非空）');
    assert.notDeepStrictEqual(crash.failedNames, lazy.failedNames, '两态读不出差别 = F2P 的归因地基没了');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ───────────────────────── 坑 #65（B106 预留号位）：取证工具的输入面不许比它声称的窄 ─────────────────────────

test('#65-1 工具必须把"没跑到"与"锁假了"分家，且不静默截断清单参数（四态逐个翻转）', () => {
  const { verdict, parseSummary, parseFlagLists, ledger } = require('../tools/eval-f2p.cjs');
  const green = parseSummary('ℹ tests 13\nℹ pass 13\nℹ fail 0\n');
  // ① 四份误判样本的真实形态：红项是**文件名**、一条目标用例名都没产出 ⇒ env/退 2（禁止删用例）
  const crash = parseSummary('ℹ tests 13\nℹ pass 0\nℹ fail 13\n✖ tests/regression-20260920b.test.js (1ms)\n✖ tests/regression-20260920c.test.js (1ms)\n');
  const v1 = verdict(crash, green, ['B1', 'C6']);
  assert.equal(v1.state, 'env', `文件级崩被判成 ${v1.state} —— 退 1 等于授权删掉 13 条好锁（B106 的原事故）`);
  assert.match(v1.why, /禁止删用例/, 'env 的结论文案没写明"禁止据此删用例"，下个人还会去删');
  // ② 反向：用例名级红仍是 product —— 不许为省事把判据改成"永远 env"，那等于取消这条判据
  const named = parseSummary('ℹ tests 13\nℹ pass 12\nℹ fail 1\n✖ B9 无关老用例 (1ms)\n');
  assert.equal(verdict(named, green, ['B1', 'B2']).state, 'product',
    '真·改前不红被豁免了 = 判据不再抓假锁');
  // ③ 收敛型修复（6 份副本并成 1 个共享模块）：基线缺本轮新建文件 + 用例名级红 = 合法证据，
  //    我上一版的过度修正（把 missingOwn 单独判 env）正是被这条抓住的 —— 见 EVAL_GUIDE §6
  const conv = parseSummary("ℹ tests 1\nℹ pass 0\nℹ fail 1\n✖ B1 日界 (1ms)\nError: Cannot find module '../lib/time-window'\n");
  const v3 = verdict(conv, green, ['B1']);
  assert.equal(v3.state, 'ok', `收敛型取证被判成 ${v3.state} —— 这类修复将永远出不了 F2P（§6 明令禁止）：${v3.why}`);
  assert.match(v3.why, /改前缺本次修复新建的文件/, '粗粒度的红必须原样写给读证据的人看（§6）');
  // ④ 空格分隔的清单参数：旧版 argv[i+1] 只取一个，13 条目标被静默截成 1 条还报 ✓
  const sp = parseFlagLists(['node', 'eval-f2p.cjs', '--cases', 'B1', 'B2', 'B3']);
  assert.equal(sp.values['--cases'], 'B1');
  assert.deepEqual(sp.stray, [{ flag: '--cases', extra: ['B2', 'B3'] }], '多余参数没被报出来 = 范围被改小');
  assert.deepEqual(parseFlagLists(['node', 'x', '--cases', 'B1,B2,B3']).stray, [], '逗号形态被误伤');
  // ⑤ --ledger 必须常驻可调（B114 的"结论与文档数字脱钩"靠它对账，不靠人记）
  assert.equal(typeof ledger, 'function', 'eval:f2p --ledger 不在了 —— 那 B114 的账又只剩一次性脚本');
});
