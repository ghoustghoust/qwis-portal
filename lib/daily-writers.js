// 日报写入点清单的**派生**实现（不是清单！）—— 白盒 W14 与负向探针 tools/_probe-w14-selftest.cjs 共用。
// 为什么单独成文件：坑 #58 的教训是"手工维护的清单必然漏"，而上一版的负向探针又把 5 个写入函数
// 硬编码了一遍——判据与取证用了两套事实，等于门禁仍然靠人记。现在两边都从这里取。
const fs = require('fs');
const path = require('path');
const { spans } = require('./src-spans');

// 排除：非运行代码（依赖/产物/归档）+ tests/（测试夹具是"造数据"，不是产品写入点）
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'data', 'archive', 'trash', '.next', 'coverage', 'tests']);
// 排除：本文件与白盒判据自身——它们的注释/正则里会出现这个字面量（自检探针必须排除自身）
const SKIP_FILE = new Set(['lib/daily-writers.js', 'tools/eval-whitebox.cjs']);

// "接上了"= 门槛结果被赋回变量；只写一句调用扔掉返回值不算接
const GATE_USE = /=\s*[\w.]*applyDailyQualityGate\s*\(/;
const MARK = 'INSERT INTO daily_reports';

// → [{ file, fn, ok, occurrences }]：ok=false 即"这一处写入点没接门槛"
function findDailyReportWriters(root) {
  const out = [];
  (function sweep(dir) {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (SKIP_DIR.has(e.name)) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) { sweep(rel); continue; }
      if (!/\.(js|cjs|mjs)$/.test(e.name) || SKIP_FILE.has(rel)) continue;
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      if (!src.includes(MARK)) continue;
      for (const s of spans(src)) {
        let from = 0, n = 0;
        for (;;) {
          const at = s.body.indexOf(MARK, from);
          if (at < 0) break;
          n++;
          from = at + 1;
        }
        if (n) out.push({ file: rel, fn: s.name, occurrences: n, ok: GATE_USE.test(s.body.slice(0, s.body.indexOf(MARK))) });
      }
    }
  })('');
  return out;
}

module.exports = { findDailyReportWriters, GATE_USE, MARK };
