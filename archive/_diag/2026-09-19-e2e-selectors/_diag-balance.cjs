// 一次性诊断脚本：找 tools/eval-e2e.cjs 的括号/引号失配位置
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || 'tools/eval-e2e.cjs', 'utf8');
let i = 0, depth = 0, line = 1, q = null, cmt = null;
const stack = [];
while (i < src.length) {
  const ch = src[i], nx = src[i + 1];
  if (ch === '\n') line++;
  if (cmt === 'sl') { if (ch === '\n') cmt = null; i++; continue; }
  if (cmt === 'ml') { if (ch === '*' && nx === '/') { cmt = null; i += 2; continue; } i++; continue; }
  if (q) {
    if (ch === '\\') { i += 2; continue; }
    if (ch === q) { q = null; i++; continue; }
    if (q === '`' && ch === '$' && nx === '{') {   // 模板插值：跳到配平的 }
      let d = 1; i += 2;
      while (i < src.length && d > 0) { const c2 = src[i]; if (c2 === '{') d++; else if (c2 === '}') d--; else if (c2 === '\n') line++; i++; }
      continue;
    }
    i++; continue;
  }
  if (ch === '/' && nx === '/') { cmt = 'sl'; i += 2; continue; }
  if (ch === '/' && nx === '*') { cmt = 'ml'; i += 2; continue; }
  if (ch === "'" || ch === '"' || ch === '`') { q = ch; i++; continue; }
  if (ch === '(' || ch === '{' || ch === '[') { stack.push({ ch, line }); i++; continue; }
  if (ch === ')' || ch === '}' || ch === ']') {
    const want = { ')': '(', '}': '{', ']': '[' }[ch];
    const top = stack[stack.length - 1];
    if (!top || top.ch !== want) { console.log(`失配：第 ${line} 行出现 ${ch}，栈顶是 ${top ? top.ch + '@' + top.line : '空'}`); break; }
    stack.pop(); i++; continue;
  }
  i++;
}
console.log('结束：引号状态 =', q || 'none', '未闭合栈深 =', stack.length, stack.length ? '最早未闭合 @ 行 ' + stack[0].line + ' (' + stack[0].ch + ')' : '');
