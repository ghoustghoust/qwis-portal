// 一次性自检（不提交）：证明 lib/src-spans#stripComments 只吃注释、不吃代码。
// 做法：对全仓 .js/.cjs/.mjs 逐文件剥注释，然后 `node --check` 剥完的文本 ——
// 语法被破坏 = 剥掉了真代码（判据从此瞎）。ESM 用 .mjs 后缀才检得出，别用 vm.Script（那会假红一片）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { stripComments } = require('../lib/src-spans');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'dist', 'data', 'archive', 'trash', '.next', 'coverage']);
const files = [];
(function sweep(dir) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) { sweep(rel); continue; }
    if (!/\.(js|cjs|mjs)$/.test(e.name)) continue;
    if (rel.includes('.verify-dist') || rel.includes('web/web/')) continue; // 构建残留，不是源码
    files.push(rel);
  }
})('');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'strip-check-'));
let bad = 0;
for (const rel of files) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  if (!src.trim()) continue;
  const out = path.join(tmp, path.basename(rel).replace(/\.(js|cjs)$/, '.mjs'));
  fs.writeFileSync(out, stripComments(src));
  try {
    execFileSync(process.execPath, ['--check', out], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    bad++;
    console.log(`剥注释后语法被破坏：${rel}\n  ${(String(e.stderr || e.message).split('\n')[1] || '').trim().slice(0, 100)}`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`扫了 ${files.length} 个源文件；剥注释破坏代码的 ${bad} 个`);
