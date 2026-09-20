// 坑号 ↔ 测试锁 的覆盖判据（白盒 **W9 收紧**，放行清单 §三 #12 的第三条）。
// 与 `tools/eval-whitebox.cjs` 的 W9 和锁 `tests/regression-pitfall-coverage.test.js` **共用这一份**
// （坑 #58/#59：判据与自证各写一套 = 没有判据）。
//
// 为什么要收紧（09-21 实测，不是推测）：旧判据是 `testText.includes('#N')` —— 整份 tests/ 文本
// 里出现一次 `#N` 就算"这条坑有锁"，于是要么写在注释里、要么**根本是别处的编号**都算覆盖。
// 本轮亲眼见到两种：
//   · `tests/regression-eval-substrate.test.js` 的 #64/#63/#62 一度只靠两份锁文件的**头注**被算成已锁
//     （白盒当时只报 62/63 不报 64，即为此 —— 已记在 `docs/EVAL_GUIDE.md` §4.2 与 B104）；
//   · 我自己新写的 `tests/regression-doc-lint-rules.test.js` 头注里写「放行清单 §三 **#12**」，
//     被旧判据当成「坑 #12 有锁」——**一个台账行号冒充了坑号**。
// 所以新判据只认**字符串字面量**里的 `#N`（注释、正文代码、模板里的裸文本都不算），
// 并把"是不是别处的 #N"这一层交给调用方：命中位置一并回传，供人工/锁面复核。
'use strict';

const { stringParts } = require('./src-spans');
// 判据自己的回归锁：里面的  全是样本，不是产品守卫
const SELF_EXCLUDED = new Set(['tests/regression-pitfall-coverage.test.js']);

/** 从 pitfalls/*.md 抽出所有 `### #N` 坑号 */
function pitfallIds(mdTexts) {
  const ids = new Set();
  for (const t of mdTexts) for (const m of t.matchAll(/^### #(\w+)/gm)) ids.add(m[1]);
  return [...ids].filter((x) => /^\d+$/.test(x)).map(Number).sort((a, b) => a - b);
}

/**
 * 逐份测试文件算覆盖。
 * @param {Array<{file:string, src:string}>} testFiles
 * @param {number[]} ids 坑号全集
 * @returns {{covered, outsideStrings, none}}
 */
function findPitfallCoverage(testFiles, ids) {
  const { stripComments } = require('./src-spans');
  const covered = new Map();
  const outsideStrings = new Map();
  const push = (map, id, where) => {
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(where);
  };
  for (const { file, src } of testFiles) {
    // 守判据本身的锁里全是 `#N` 形态的字面量（那是判据的样本，不是产品行为的守卫）——
    // 让它参与对账等于自己给自己发覆盖（坑 #63 同族：自我命中）。
    if (SELF_EXCLUDED.has(file)) continue;
    const strings = stringParts(src).map((p) => (typeof p === 'string' ? p : p.s));
    // 注意别用 `stripStrings`：它把字符串**和注释**一起抹掉（实测头两行注释直接变空行），
    // 那样就分不出"只写在注释里"和"根本没提"。这里用 stripComments（留代码+字符串）作对照。
    const codeAndStrings = stripComments(src);
    for (const id of ids) {
      const re = new RegExp('#' + id + '(?!\\d)');
      if (strings.some((s) => re.test(s))) push(covered, id, file);
      else if (re.test(codeAndStrings) || re.test(src)) push(outsideStrings, id, file);
    }
  }
  const none = ids.filter((id) => !covered.has(id) && !outsideStrings.has(id));
  return { covered, outsideStrings, none };
}

module.exports = { pitfallIds, findPitfallCoverage, SELF_EXCLUDED };
