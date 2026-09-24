// stats 字面量顶层键提取器（回归锁 P12 的判据来源）
// 为什么要单独一个文件而不写在测试里：这是一段**手工的源码扫描**，按本项目踩过的老规矩
// （`docs/eval/` 里多条"静态形态判据第一版必错"的记录），它自己必须有坏样本喂着才可信 —— 能单独 require 才能单独喂样本。
// 已知边界（09-24 第四轮审查后重写 —— 原话"展开按设计跳过"与本文件的实现相反，是一句会误导人的注释）：
//   · 裸展开 `...x`（标识符/成员访问）拿不到键，确实跳过；
//   · **条件展开 `...(c ? { a } : { b })` 的两个分支对象第一层键会被收进来** —— 这是 P12 需要的行为
//     （runner 的 `...(theme ? {} : { themeSkip: … })` 必须被看得见），但对 T6 就是**假绿来源**；
//   · 不求值、不解析计算属性名 `[k]:`、不认访问器/方法简写（`get theme(){}`、`fmt(){}`）⇒ 真值有、提取器没有（会假红）。
//   这些洞中只有"值取错来源/写死"这一类在执行锁 I4 上有牙，且**只对 stats 带非默认值的臂有牙**（新鲜/过期两支）；
//   关键词档那几臂 stats 本来就没 theme ⇒ 写死 null 照样过（09-24 自己 F2P 出来的，见 I4 注释），不许当已收口。
'use strict';

function skipString(t, i) {
  const q = t[i];
  for (let j = i + 1; j < t.length; j++) {
    if (t[j] === '\\') { j++; continue; }
    if (t[j] === q) return j;
  }
  return t.length;
}

// 从 `{` 下标起做括号配对（跳过字符串与注释），返回含首尾花括号的原文
function objectLiteralAt(text, braceIdx) {
  let depth = 0;
  for (let i = braceIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === '`') { i = skipString(text, i); continue; }
    if (ch === '/' && text[i + 1] === '/') { const nl = text.indexOf('\n', i); i = nl < 0 ? text.length : nl - 1; continue; }
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i); if (e < 0) return null; i = e + 1; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(braceIdx, i + 1); }
  }
  return null;
}

// 顶层键：只在深度 1、且上一个有效字符是 `{` 或 `,` 时认；键名后面必须紧跟 `:`（正常属性）
// 或 `,` / `}`（ES6 简写属性，如 `{ gateDropped, }`）—— 少认简写会漏键，多认三元里的 `a ? b : c` 的 b 会造出假键。
function topLevelKeys(objText) {
  const keys = [];
  let depth = 0, prev = '';
  for (let i = 0; i < objText.length; i++) {
    const ch = objText[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      // 带引号的键（`"themeSkip": …`）同样是本层写出去的字段 —— 直接当字符串跳过会**静漏键**，
      // 而这条锁存在的理由就是"不许静默"（09-24 审查喂出的坏样本）。只在"该出现键的位置"上认它。
      if (depth === 1 && (prev === '{' || prev === ',')) {
        const close = skipString(objText, i);
        const name = objText.slice(i + 1, close);
        if (/^\s*:/.test(objText.slice(close + 1)) && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
          keys.push(name);
          i = close;
          prev = ':';
          continue;
        }
      }
      i = skipString(objText, i); prev = 'v'; continue;
    }
    if (ch === '/' && objText[i + 1] === '/') { const nl = objText.indexOf('\n', i); i = nl < 0 ? objText.length : nl - 1; continue; }
    if (ch === '/' && objText[i + 1] === '*') { const e = objText.indexOf('*/', i); if (e < 0) break; i = e + 1; continue; }
    if (/\s/.test(ch)) continue;
    // 展开写法 `...(cond ? {} : { k: 1 })` 里的键**同样是本层写出去的字段**（日报 AI 档的 themeSkip 就是这么来的）。
    // 只取每个分支对象的第一层，展开式本身吃掉 —— 否则嵌套值的键会被当成顶层键混进来。
    if (ch === '.' && objText[i + 1] === '.' && objText[i + 2] === '.' && depth === 1) {
      let j = i + 3, d = 0;
      while (j < objText.length) {
        const c = objText[j];
        if (c === "'" || c === '"' || c === '`') { j = skipString(objText, j); }
        else if (c === '(' || c === '[' || c === '{') d++;
        else if (c === ')' || c === ']' || c === '}') d--;
        else if (c === ',' && d === 0) break;
        j++;
      }
      const expr = objText.slice(i + 3, j);
      // 逐个找"分支对象"：展开式常写成 `...(cond ? {} : { k: 1 })`，**圆括号要当透明**
      // （否则括号一入栈，分支对象就永远在"深度 1"，键会被漏掉 —— 09-24 第一版就是这么漏的 themeSkip）
      let d2 = 0;
      for (let k = 0; k < expr.length; k++) {
        const c = expr[k];
        if (c === "'" || c === '"' || c === '`') { k = skipString(expr, k); continue; }
        if (c === '[') d2++;
        else if (c === ']') d2--;
        else if (c === '{' && d2 === 0) {
          const inner = objectLiteralAt(expr, k);
          if (inner) { keys.push(...topLevelKeys(inner)); k += inner.length - 1; }
        }
      }
      i = j - 1; prev = ','; continue;
    }
    if ('{[('.includes(ch)) { depth++; prev = ch; continue; }
    if ('}])'.includes(ch)) { if (depth > 0) depth--; prev = ch; continue; }
    if (ch === ',') { prev = ch; continue; }
    if (depth === 1 && (prev === '{' || prev === ',') && /[A-Za-z_$]/.test(ch)) {
      const m = /^([A-Za-z_$][A-Za-z0-9_$]*)/.exec(objText.slice(i));
      if (m) {
        const rest = objText.slice(i + m[1].length);
        const nm = /^\s*([,:}])/.exec(rest);
        if (nm) keys.push(m[1]);
        i += m[1].length + (nm ? nm[0].length - 1 : 0);
        prev = nm ? nm[1] : 'v';
        continue;
      }
    }
    prev = ch;
  }
  return keys;
}

// 找出源码里所有 `const stats = {…}` 字面量原文（日报四份写入器共用这个形状）
function statsLiterals(text) {
  const out = [];
  const anchor = 'const stats = {';
  for (let i = text.indexOf(anchor); i >= 0; i = text.indexOf(anchor, i + 1)) {
    const lit = objectLiteralAt(text, i + anchor.length - 1);
    if (lit) out.push(lit);
  }
  return out;
}

// 找出源码里所有 `report: {…}` / `report = {…}` 这类"某个名字的对象字面量"的**顶层**键。
// 为什么单独要这份：读层"响应同形"判据第一版是"取锚点后 700 字符看有没有 `theme:` 字样" ——
// 注释里写一句就满足，字段嵌进子对象也满足，而紧邻的下一处返回点的字段会被算进这一处（09-24 第三轮审查实测）。
// 复用 objectLiteralAt（括号配平、跳字符串/注释）+ topLevelKeys（只取深度 1），这三条假绿一次堵掉。
//
// ⚠️ 已知盲区（09-24 第四轮审查实测 + 自己 F2P 复测，别把这把锁当"证明"）：
//   ① 条件展开 `...(c ? {} : { theme… })` 的假绿：topLevelKeys 会把分支对象的键算进来（P12 需要的正是这个行为）；
//   ② `get theme(){}` / 方法简写：真 `Object.keys` 有这一项而提取器给不出 ⇒ **会假红**；
//   ③ 值里带正则字面量 `/a}/`：括号配平被截断 ⇒ **会假红**。
//   执行锁 I4 只在"stats 有非默认值"的臂上能兜住①那类（新鲜/过期两支）；关键词档三支的 stats 本来就没 theme，
//   写死 `theme: null` 在 I4 上也过得去（09-24 实测：改第 5 处 → I4 仍绿）⇒ ①②③ 目前**无人兜**，不许当已收口。
function nonCodeRanges(text) {
  // 单遍扫描：注释（`//`、块注释）与**字符串/模板串本体**都算"非代码区间"——
  // 字符串里的 `report: {…}` 也不是返回点（`"https://x/report: {a}"` 实测会被当成一处 0 键的假站点）。
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === '`') { const end = skipString(text, i); out.push([i, end + 1]); i = end; continue; }
    if (ch === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? text.length : end;
      out.push([i, stop]); i = stop; continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out.push([i, stop]); i = stop - 1; continue;
    }
  }
  return out;
}

function objectLiteralKeysAt(text, anchor) {
  const out = [];
  const dead = nonCodeRanges(text);
  const inDead = (pos) => dead.some(([a, b]) => pos >= a && pos < b);
  for (let i = text.indexOf(anchor); i >= 0; i = text.indexOf(anchor, i + 1)) {
    if (inDead(i)) continue; // 注释/字符串里的 `report: {` 不是返回点（否则 sites 计数能被注释凑够，也会把"旧写法"示例判红）
    const lit = objectLiteralAt(text, i + anchor.length - 1);
    if (lit) out.push({ line: text.slice(0, i).split('\n').length, keys: topLevelKeys(lit) });
  }
  return out;
}

module.exports = { skipString, objectLiteralAt, topLevelKeys, statsLiterals, objectLiteralKeysAt, nonCodeRanges };
