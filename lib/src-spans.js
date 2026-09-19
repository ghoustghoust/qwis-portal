// 源码文本切分 —— 文本型锁（tests I10/I13/I15、whitebox W14/W15）的唯一实现。
// 为什么单独成文件：本轮三类假结果都出在"自己手写函数边界/注释剥离"上——
//  ① 拿"第一个行首 }"当右边界，被函数内的 catch/循环闭合括号截断 → 把自己的合法 SQL 判成逃逸（假红）；
//  ② 用 replace('{\n') 注入探针样本，而仓库源码是 CRLF，模式永不命中 → "注入未生效"被读成"锁没拦住"（假绿，坑 #57）；
//  ③ 剥注释的状态机把**正则字面量里的引号**当字符串开头（`src.replace(/\ssrc=(["']).*?\1/g,'')` 之后
//     整行行尾注释被"吃进字符串"留下 → 注释里的 applyDailyQualityGate 算成已接线），
//     以及**反引号字符类**（md-inline.js 的 /[`]/）开一个假模板态一路吃掉后面的真代码。
//     第三轮对抗审查实测：50/231 个源文件受影响（坑 #63）。
// 所以现在只有一个词法扫描器 scan()，三种视图都从它来：
//   code   —— 注释与字符串内容都去掉（判"代码里真写了这句调用"）
//   masked —— 与原文**等长**、注释与字符串内容打成空格（保留引号与模板插值），于是原文的偏移量可直接用
//   strings—— 字符串/模板字面量的内容与位置（判 SQL 写在字符串里的那种）
// 自检由 tools/_probe-strip-selftest.cjs 双向证明：masked 仍能 node --check（没吃掉代码）
//        且真注释确实消失（没把注释当代码）。单向自检等于没自检。
'use strict';

// 顶层"可被调用"的声明形状。为什么要覆盖到赋值式与方法简写（第三轮审查）：
// 只认 `function foo(` / `const foo = (` 时，写在 `module.exports.save = async function (){}内`、
// 类方法、IIFE 里的写入点根本不落在任何 span 内 —— 判据看不见就等于没有，
// 而"少一个成员"正是制造绿灯的方向。
// 每项的捕获组 1 = 可选名字（无名时用整段匹配文本当名字）。
const DECL_PATTERNS = [
  /^(?:async )?function (\w+)\(/gm,
  /^(?:export )?(?:const|let|var) (\w+) = (?:async )?(?:function\s*\(|\()/gm,
  /^(?:module\.)?exports\.(\w+) = (?:async )?(?:function\s*\(|\()/gm,
  /^[A-Za-z_$][\w$]*\.prototype\.\w+ = (?:async )?(?:function\s*\(|\()/gm,
  /^this\.\w+ = (?:async )?(?:function\s*\(|\()/gm,
  /^[ \t]+(?:async )?(\w+)\([^)]*\)\s*\{/gm, // 类方法 / 对象方法简写（有缩进）
];
const nameOf = (m) => m[1] || m[0].trim().slice(0, 40);

// `/` 之后是否可能是正则字面量：只有前一个有效字符不是「值结尾」时才是。
// 判错方向很要命：把除法当正则会把整行吃掉（制造假绿），所以这里保守 ——
// 只有明确处在运算符/括号/关键字后面的 `/` 才当正则处理。
const REGEX_OK = /[([{,;:!&|?+\-*%~^=/]$/;
const KEYWORD_BEFORE = /(?:^|[^.\w$])(?:return|typeof|instanceof|in|of|new|delete|void|yield|await|case|do|else)\s+$/;

// 正则字面量：返回 {close, end}（close=闭合斜杠位置，end=最后一个标志位）；找不到闭合就不当正则
function regexSpan(text, from) {
  let cls = false;
  for (let i = from + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') { i++; continue; }
    if (c === '\n') return null;
    if (c === '[') cls = true;
    else if (c === ']') cls = false;
    else if (c === '/' && !cls) {
      let j = i;
      while (/[gimsuvyd]/.test(text[j + 1] || '')) j++; // 标志位
      return { close: i, end: j };
    }
  }
  return null;
}

// 抹平但**保留换行**（含 \r）：masked 必须与原文等长等行，且 CRLF/LF 两份同一内容的结果
// 要在归一化后逐字相等（回归锁 I13 判的就是这件事；把 \r 也抹成空格会让两种行尾差一个字符）。
const blankTo = (s) => s.replace(/[^\r\n]/g, ' ');

// → { code, masked, strings:[{from,to,s,quoted}], comments:[[from,to]] }
//   masked 与入参**等长**（注释与字符串内容→空格），所以原文偏移在 masked 上照样能用；
//   comments 是注释区间，供 stripComments（保留字符串、只抹注释）复用同一套词法。
function scan(text) {
  let code = '';
  let masked = '';
  const strings = [];
  const comments = [];
  // lastSig：masked 上「最后一个非空白字符」，增量维护。
  // 曾经写成 `masked.replace(/\s+$/,'').slice(-1)` —— 那是对**整个累积串**跑正则，
  // 400KB 的文件直接 O(n²)，自检脚本跑到被 kill。
  let lastSig = '';
  let lastSig2 = ''; // 倒数第二个有效字符（用来区分 `=>` 后面是正则 与 `a > b` 后面是除法）
  const prevWordTail = () => masked.slice(-30);
  const emitMasked = (s) => {
    masked += s;
    // 逐字符推进"最后两个有效字符"：一次只喂一个字符时，不能只在 s 内部找第二个
    //（否则 lastSig2 永远停在早先的值 → `=> /re/` 认不出正则，正则里的 // 又被当注释吃掉）
    let a = lastSig, b = lastSig2;
    for (let k = 0; k < s.length; k++) {
      const ch = s[k];
      if (/\s/.test(ch)) continue;
      b = a; a = ch;
    }
    lastSig = a; lastSig2 = b;
  };
  const takeComment = (from, to) => { comments.push([from, to]); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i], d = text[i + 1];
    // ── 注释：整段打空格，换行原样保留（行号不能变）
    if (c === '/' && d === '/' && !/['"`/]$/.test(lastSig || ' ')) {
      let j = i; while (j < text.length && text[j] !== '\n') j++;
      takeComment(i, j);
      emitMasked(blankTo(text.slice(i, j))); i = j - 1; continue;
    }
    if (c === '/' && d === '*') {
      let j = text.indexOf('*/', i + 2); if (j < 0) j = text.length - 2;
      const seg = text.slice(i, j + 2);
      takeComment(i, j + 2);
      emitMasked(seg.replace(/[^\n]/g, ' ')); i = j + 1; continue;
    }
    // ── 正则字面量：内容换成一个同长度的占位正则，绝不让里面的引号开字符串态。
    //    注意不能整段抹成空格 —— `.replace(/re/, '')` 抹成 `.replace(     , '')` 是**语法错误**
    //    （空实参），自检 A 方向会误判成"吃掉了代码"。
    if (c === '/' && (REGEX_OK.test(lastSig || ' ')
      || (lastSig === '>' && lastSig2 === '=') // 箭头函数体以正则开头：(x) => /re/.test(x)
      || KEYWORD_BEFORE.test(prevWordTail()))) {
      const span = regexSpan(text, i);
      if (span) {
        const len = span.end - i + 1;
        emitMasked('/x/' + blankTo(text.slice(i + 3, span.end + 1)).slice(0, Math.max(0, len - 3)));
        code += '/x/'; i = span.end; continue;
      }
    }
    // ── 单/双引号字符串
    if (c === "'" || c === '"') {
      let j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] === '\\') { j++; continue; }
        if (text[j] === c) break;
        if (text[j] === '\n') break; // 未闭合：不当字符串（否则吃掉后面整行）
      }
      const closed = text[j] === c;
      strings.push({ from: i + 1, to: j, s: text.slice(i + 1, j), quoted: true });
      emitMasked(c + blankTo(text.slice(i + 1, j)) + (closed ? c : ''));
      code += "''";
      i = closed ? j : j - 1;
      continue;
    }
    // ── 模板字符串：字面段抹掉，插值里的代码保留（它是真代码，还要递归剥一遍）
    if (c === '`') {
      let j = i + 1; let out = '`'; const codeOut = ["''"]; let segFrom = i + 1;
      for (; j < text.length; j++) {
        if (text[j] === '\\') { j++; continue; }
        if (text[j] === '`') break;
        if (text[j] === '$' && text[j + 1] === '{') {
          strings.push({ from: segFrom, to: j, s: text.slice(segFrom, j), quoted: true });
          codeOut.push("''");
          out += blankTo(text.slice(segFrom, j)) + '${';
          let depth = 1; j += 2; // 跳过美元符+左花括号，j 现在指向插值表达式的第一个字符
          const innerFrom = j;
          for (; j < text.length && depth > 0; j++) {
            if (text[j] === '{') depth++;
            else if (text[j] === '}') depth--;
          }
          const inner = text.slice(innerFrom, j - 1);
          out += inner + '}';
          codeOut.push('(' + scan(inner).code + ')'); // 插值里是真代码：模板里的函数调用不能被抹成字符串。
          // 外面包一层括号是为了「插值里带 ?? / || / &&」这种：不包的话拼成
          // '' + a ?? b + '' 会因优先级成语法错误（自检 A 方向实测抓到）
          segFrom = j;
          j--;
          continue;
        }
      }
      strings.push({ from: segFrom, to: j, s: text.slice(segFrom, j), quoted: true });
      out += blankTo(text.slice(segFrom, j)) + '`';
      emitMasked(out);
      codeOut.push("''");
      // 片段之间必须能拼成一个合法表达式：并排的空串（四个引号）在 code 视图里是语法错误，
      // 会把自检 A 方向带沟里；用 + 串起来（插值本身是代码，两边都有 + 不会与它粘连）
      code += '(' + codeOut.join(' + ') + ')';
      i = j;
      continue;
    }
    emitMasked(c);
    code += c;
  }
  // ⚠️ masked 必须与入参**逐字符等长**（含 CRLF 原样）：daily-writers 用 strings 的原文偏移去切它，
  // 这里若把 \r\n 归一成 \n，偏移就整体左移，判据会看错位置（坑 #57 的另一半）。
  // code 不参与偏移换算，归一成 LF 让判据与行尾风格无关。
  return { code: code.replace(/\r\n/g, '\n'), masked, strings, comments };
}

// 判"代码里真的写了这句调用"：注释与字符串内容都不算
// （否则 `log('TODO: const g = applyDailyQualityGate(…)')` 会被算成已接线——坑 #50 的字符串版）
function stripStrings(text) { return scan(text).code; }
// 与原文等长的遮蔽版：注释与字符串内容→空格。用 maskOffset(src, at) 把原文偏移换算到它上面。
function maskText(text) { return scan(text).masked; }

// 字符串字面量清单（含原文偏移），供"SQL 写在字符串里"这类判据用
function stringParts(text) { return scan(text).strings; }

// 方法简写那条模式会把 `if (x) {` / `for (...) {` 也匹配成"声明"，于是函数体被切成一堆假 span，
// 门槛判定的窗口就被切碎（实测 I15 因此把已接门槛的写入点判成未接）。控制流关键字一律不当声明。
const NOT_A_DECL = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else',
  'do', 'try', 'finally', 'new', 'class', 'var', 'let', 'const', 'typeof', 'delete', 'void', 'case', 'in', 'of']);

// 顶层函数切分
function spans(src) {
  const decls = [];
  for (const re of DECL_PATTERNS) {
    re.lastIndex = 0;
    for (const m of src.matchAll(re)) {
      const nm = nameOf(m);
      if (NOT_A_DECL.has(nm)) continue;
      decls.push({ index: m.index, name: nm });
    }
  }
  decls.sort((a, b) => a.index - b.index);
  const uniq = decls.filter((d, i) => i === 0 || d.index !== decls[i - 1].index);
  return uniq.map((d, i) => {
    const end = i + 1 < uniq.length ? uniq[i + 1].index : src.length;
    const slice = src.slice(d.index, end);
    const { code, masked } = scan(slice);
    return { name: d.name, start: d.index, end, body: stripComments(slice), code: code, masked };
  });
}

// 旧 API（保持不变）：**只剥注释、保留字符串内容** —— SQL 判据要用它（`'INSERT INTO daily_reports'`
// 就写在字符串里）。剥注释靠与原文等长的 mask 版：注释段→空格，字符串原样。
function stripComments(text) { return sqlText(text); }

// 保留字符串内容的剥注释版（真实现；stripComments 是它的别名）。
// 复用 scan() 的同一套词法：**只**把 scan 认定的注释区间打成空格（换行保留），字符串原样。
// 为什么不用第二个手写扫描器：那正是坑 #63 的成因 —— 两条路径对"这是不是注释"的意见会分叉。
function sqlText(text) {
  // 先在 **LF 归一后的副本**上定位注释并抹除：这样同一份内容存成 CRLF 或 LF，剥出来的 body 逐字相等
  // （回归锁 I13 判的就是这个）。offset 换算请改用 masked —— 它是等长的。
  const t = text.replace(/\r\n/g, '\n');
  const { comments } = scan(t);
  if (!comments.length) return t;
  const arr = t.split('');
  for (const [a, b] of comments) for (let i = a; i < b && i < arr.length; i++) if (arr[i] !== '\n') arr[i] = ' ';
  return arr.join('');
}

// 包含某偏移的**最内层**声明（方法简写会嵌套在函数里；取最外层会把整段算给宿主）
function ownerAt(src, offset) {
  const hit = spans(src).filter((f) => offset >= f.start && offset < f.end).pop();
  return hit ? hit.name : null;
}
function innerSpan(src, offset) {
  return spans(src).filter((f) => offset >= f.start && offset < f.end).pop() || null;
}

module.exports = {
  scan, spans, ownerAt, innerSpan,
  stripComments, stripStrings, sqlText, maskText, stringParts,
};
