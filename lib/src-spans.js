// 顶层函数切分 —— 文本型锁（tests I10 / whitebox W14）的唯一实现。
// 为什么单独成文件：本轮两类假结果都出在"自己手写函数边界"上——
//  ① 拿"第一个行首 }"当右边界，被函数内的 catch/循环闭合括号截断 → 把自己的合法 SQL 判成逃逸（假红）；
//  ② 用 replace('{\n') 注入探针样本，而仓库源码是 CRLF，模式永不命中 → "注入未生效"被读成"锁没拦住"（假绿，坑 #57）。
// 所以边界只由"下一个顶层声明"决定，且一切按 /\r?\n/ 分行，不假设行尾风格。
// 顶层"可被调用的声明"：`function foo(` / `async function foo(` / `const foo = (` / `const foo = async (`。
// 为什么把 const 箭头函数也算进来（2026-09-19 独立对抗审查）：只认 `function` 的话，
// 把重统计写成 `const heavy = () => db.query('… daily_reports')` 就完全不在切分视野里，
// 调用闭包对账会漏掉整类宿主。
const DECL_RE = /^(?:async )?function (\w+)\(|^const (\w+) = (?:async )?(?:function)?\s*\(/gm;
const nameOf = (m) => m[1] || m[2];

// 剥注释：判据看的是**代码**，不是说明文字。行首 `// ...`、块注释、以及**行尾** `// ...` 都要剥
// （只剥整行的话，"把门槛调用写进行尾注释"就能伪装成已接线——本轮负向探针实测抓出来的）。
// 用字符状态机而不是正则：注释里带引号（`// Number('') === 0`）时，任何"看起来像注释"的正则都会误判。
function stripComments(text) {
  let out = '';
  let str = null; // 当前字符串定界符：' " `
  let mode = null; // 'line' | 'block'
  for (let i = 0; i < text.length; i++) {
    const c = text[i], d = text[i + 1];
    if (mode === 'line') { if (c === '\n') { mode = null; out += c; } continue; }
    if (mode === 'block') { if (c === '*' && d === '/') { mode = null; i++; } continue; }
    if (str) {
      if (c === '\\') { out += c + (d ?? ''); i++; continue; }
      if (c === str) str = null;
      else if (str !== '`' && c === '\n') str = null; // 未闭合的单行串：不当注释吃后面的代码
      out += c; continue;
    }
    if (c === '/' && d === '/' && text[i - 1] !== '\\') { mode = 'line'; i++; continue; }
    if (c === '/' && d === '*') { mode = 'block'; i++; continue; }
    if (c === "'" || c === '"' || c === '`') str = c;
    out += c;
  }
  // 行尾风格归一：同一份内容按 CRLF 还是 LF 存，切出来的 body 必须逐字相等，
  // 否则判据会随文件行尾变（坑 #57 的另一半）
  return out.replace(/\r\n/g, '\n');
}

// → [{ name, start, end, body }]，按声明顺序；最后一个函数的 end 是文件尾
function spans(src) {
  const decls = [...src.matchAll(DECL_RE)];
  return decls.map((d, i) => ({
    name: nameOf(d),
    start: d.index,
    end: i + 1 < decls.length ? decls[i + 1].index : src.length,
    body: stripComments(src.slice(d.index, i + 1 < decls.length ? decls[i + 1].index : src.length)),
  }));
}

// 偏移量落在哪个顶层函数里（不在任何函数内 → null）
function ownerAt(src, offset) {
  const list = spans(src);
  const hit = list.find((f) => offset >= f.start && offset < f.end);
  return hit ? hit.name : null;
}

module.exports = { spans, ownerAt, stripComments };
