// 临时脚本：扫描 server/ 下所有 .js 文件，找出引用了 log.* 但未导入的
const fs = require('fs');
const path = require('path');
const bad = [];
function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (f === 'node_modules') continue;
      walk(p);
    } else if (f.endsWith('.js')) {
      const c = fs.readFileSync(p, 'utf8');
      const uses = /\blog\.(info|warn|error|mask)\(/.test(c) || /\{[^}]*mask[^}]*\}\s*=\s*require/.test(c);
      const imported = /require\(['"].*util\/log['"]\)/.test(c);
      if (uses && !imported) bad.push(p);
    }
  }
}
walk(path.join(__dirname, '..', 'server'));
walk(path.join(__dirname, '..', 'tools'));
console.log(bad.length ? '缺少 log 导入的文件:\n' + bad.join('\n') : '全部文件均有 log 导入');
