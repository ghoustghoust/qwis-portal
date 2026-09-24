// stats 字面量顶层键提取器（回归锁 P12 的判据来源）
// 为什么要单独一个文件而不写在测试里：这是一段**手工的源码扫描**，按本项目踩过的老规矩
// （`docs/eval/` 里多条"静态形态判据第一版必错"的记录），它自己必须有坏样本喂着才可信 —— 能单独 require 才能单独喂样本。
// 已知不做的：不求值、不解析 ES6 计算属性名（`[k]:`）与展开（`...x`，按设计跳过），
// 只回答"这个对象字面量写了哪些顶层键"。
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

module.exports = { skipString, objectLiteralAt, topLevelKeys, statsLiterals };
