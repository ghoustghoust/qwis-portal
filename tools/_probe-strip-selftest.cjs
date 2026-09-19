// lib/src-spans.js 的 scan() 自检 —— **双向**证明，运行：node tools/_probe-strip-selftest.cjs
// 上一版只会证明一个方向（剥完仍能 node --check = 没吃掉代码），于是漏掉另一个方向
// （注释根本没被剥掉）——第三轮对抗审查就是从这里抓出来的：状态机把正则字面量里的引号
// 当字符串开头，之后整行行尾注释以"字符串内容"的身份留在结果里，
// 注释里的 applyDailyQualityGate 就被判成"已接线"（假绿）。坑 #63。
// 现在两个方向都判：
//   A 不破坏代码：masked（注释与字符串都抹平）与 stripComments（只抹注释）都要能过 node --check
//   B 真抹掉注释：原文里每个 `// …` 的**首个词**，在 masked 里必须找不到（在 stripComments 里也找不到）
//   C 不吞字符串内容：stripComments 必须原样保留字面量（SQL 判据靠它）
// 临时文件名用「相对路径 + 序号」散列，不再用 basename（上一版 basename 冲突让 20 个文件从未被检查）。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { scan, stripComments, stripStrings } = require('../lib/src-spans');

const ROOT = path.join(__dirname, '..');
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'data', 'archive', 'trash', '.next', 'coverage']);

const files = [];
(function sweep(dir) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name)) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) { sweep(rel); continue; }
    if (/\.(js|cjs|mjs|jsx)$/.test(e.name)) files.push(rel);
  }
})('');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'strip-selftest-'));
const check = (tag, text, ext) => {
  // 唯一临时名：上一版用 basename 散列，11 组同名（8 个 index.js 挤成一个 index.mjs）→ 20 个文件从未被检查
  const f = path.join(tmp, `${tag}.${ext}`);
  fs.writeFileSync(f, text);
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); return null; }
  catch (e) { return String(e.stderr || e.message).split('\n').slice(0, 3).join(' | '); }
};

const bad = { syntax: [], commentLeft: [], stringEaten: [] };
let withComments = 0;
for (const [idx, rel] of files.entries()) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const ext = rel.endsWith('.jsx') ? 'jsx.js' : rel.split('.').pop();
  const one = scan(src); // 一次扫描，三处判据共用（每处再 scan 会把脚本拖垮）
  // A) 不破坏代码：两个视图都要能过 node --check
  //    masked（等长，注释+字符串→空格）与 code（判"接线"用的那一版）——只测 masked 的话，
  //    code 视图坏了没人知道，而 W14 的门槛判定用的正是 code。
  const codeView = stripStrings(src);
  const e1 = check(`${idx}-a`, one.masked, ext);
  if (e1) bad.syntax.push(`${rel}（masked 语法坏）：${e1}`);
  const e2 = check(`${idx}-b`, codeView, ext);
  if (e2) bad.syntax.push(`${rel}（code 语法坏）：${e2}`);
  // B) 真抹掉注释：挑「只出现在注释里、代码与字符串里都没有」的词，
  //    它若还留在 stripStrings（注释+字符串都抹）的结果里，就是注释没抹干净。
  //    ⚠️ 判"注释之外有没有这个词"必须用同一套词法（scan 的 comments 区间）。
  //    上一版用天真正则 `\/\/[^\n]*` 去注释，把字符串里的 URL（https://…）也当注释删了，
  //    于是把 Schema / category 这类**代码里本来就有**的词报成漏剥 —— 判据自己造了假阳。
  const noComments = stripComments(src); // 注释→空格，字符串原样（等长，同坐标）
  const codeOnly = stripStrings(src); // 注释 + 字符串都抹
  if (one.comments.length) withComments++;
  for (const m of src.matchAll(/\/\/([^\n]*)/g)) {
    const word = (m[1].match(/[A-Za-z_$][\w$]{5,}/) || [])[0];
    if (!word) continue;
    const re = new RegExp(`\\b${word}\\b`);
    if (re.test(noComments)) continue; // 注释之外也有 = 无法区分，跳过（不误报）
    if (re.test(codeOnly)) bad.commentLeft.push(`${rel}：注释词 ${word} 仍留在剥注释结果里（注释没抹干净）`);
  }
  // C) stripComments 保留字符串内容（SQL 判据要用）。两边都按 LF 归一再比，
  //    否则 CRLF 文件里凡是多行模板必然"看起来丢了"（坑 #57 又踩一次）
  const lf = (s) => s.replace(/\r\n/g, '\n');
  const strs = one.strings.map((s) => lf(s.s)).filter((s) => s.length > 12 && /\w{6}/.test(s));
  const kept = stripComments(src);
  const missing = strs.filter((s) => !kept.includes(s));
  if (missing.length) bad.stringEaten.push(`${rel}：stripComments 丢了 ${missing.length} 段字符串内容，例如 ${JSON.stringify(missing[0].slice(0, 40))}`);
}

// D) 两个已知杀手（正则里的引号 / 反引号字符类）——必须在这份合成样本上直接判对
const KILLERS = [
  ["const src = html.replace(/\\ssrc=([\"']).*?\\1/gi, ''); // 去掉占位 src\n", '去掉占位'],
  ['export const RE = /[`~]/;\n// 这段注释必须被剥掉 MARKER_WORD\nfunction f() { return 1; } // MARKER_WORD_2\n', 'MARKER_WORD'],
  ['const t = `a${ 1 + 2 }b`; // TAIL_COMMENT_X\n', 'TAIL_COMMENT_X'],
];
for (const [code, marker] of KILLERS) {
  if (stripStrings(code).includes(marker)) bad.syntax.push(`杀手样本未剥净：${JSON.stringify(code.slice(0, 50))}`);
  if (stripComments(code).includes(marker) && !code.split('//')[0].includes(marker)) {
    bad.syntax.push(`杀手样本 stripComments 未剥净：${marker}`);
  }
  if (check(`killer-${marker}`, stripStrings(code), 'js')) bad.syntax.push(`杀手样本剥完语法坏：${marker}`);
}

console.log(`扫了 ${files.length} 个源文件（含注释的 ${withComments} 个），杀手样本 ${KILLERS.length} 个`);
for (const [k, v] of Object.entries(bad)) console.log(`  ${k}: ${v.length}`);
for (const v of Object.values(bad)) for (const line of v.slice(0, 12)) console.log('   -', line);
if (Object.values(bad).some((v) => v.length)) {
  console.log('FAIL：剥注释/剥字符串不忠实');
  process.exitCode = 1;
} else {
  console.log('OK：两个方向都对每个真实源文件成立');
}
fs.rmSync(tmp, { recursive: true, force: true });
