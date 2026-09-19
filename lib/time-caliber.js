// 「时间口径只许一份实现」的**派生**判据 —— 白盒 W16 与回归锁 tests/regression-20260920b B4 共用。
// 为什么单独成文件：同一条判据在门禁与测试里各写一遍，两边就会各自漂移（本轮已发生过：
// 测试里加了 setUTCHours、白盒里没加）。这里给事实，两边只写"怎么报"。
//
// 判据来自 B90/B96/B97/B99 四类真实缺陷的形态归纳，不是凭空禁写法。
// 每条标明看的是**代码**还是**字符串字面量**：
//   ① setHours(0,0,0,0)         代码 —— 容器本地 0 点（Vercel 是 UTC，"今日新增"差一天）
//   ② setUTCHours(0,0,0,0)      代码 —— 手搓北京日界（三处各写一遍，迟早不一致）
//   ③ 8 * 3600e3                代码 —— 同一个时区偏移散落各处
//   ④ toDateString() === …      代码 —— 又是容器时区（B97：同一天重复生成日报）
//   ⑤ …T00:00:00.000Z           字符串 —— 把"日期标签"当"时刻"（B96 删不掉凌晨那期、B99 筛选差 8 小时）
//   ⑥ new Date().toISOString().slice(0,10)  代码 —— 拿 UTC 日当"今天的日期串"（北京 08:00 前是昨天）
const fs = require('fs');
const path = require('path');
const { scan, stripStrings } = require('./src-spans');

const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'data', 'archive', 'trash', '.next', 'coverage', 'tests']);
const SCAN_DIRS = ['server', 'api', 'web/src', 'lib', 'tools'];
const SCAN_EXT = /\.(js|cjs|mjs|jsx)$/;
// 两份**允许**的实现：服务端那份 + 浏览器那份（前端不能 require CJS，只能另写 ESM）。
// 浏览器那份的正确性不靠文本比对，由 tests/regression-20260920c C5 逐时刻跑数钉住。
const ALLOWED = new Map([
  ['lib/time-window.js', '服务端唯一实现'],
  ['web/src/beijing-date.mjs', '浏览器对端（回归锁 C5 逐时刻比对）'],
]);
const BANNED = [
  { where: 'code', re: /setHours\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/, label: '容器本地 0 点 setHours(0,0,0,0)' },
  { where: 'code', re: /setUTCHours\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/, label: '手搓日界 setUTCHours(0,0,0,0)' },
  { where: 'code', re: /\b8\s*\*\s*3600e3\b/, label: '手写北京时区偏移 8 * 3600e3' },
  { where: 'code', re: /toDateString\(\)\s*===/, label: '用 toDateString() 比"同一天"（读的是容器时区）' },
  { where: 'code', re: /new Date\((?:|Date\.now\(\))\)\s*\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/, label: '拿 UTC 日当"今天的日期串"' },
  { where: 'string', re: /T00:00:00\.000Z|T23:59:59\.999Z/, label: '把日期串拼成 UTC 边界当时刻用' },
];
// 生产消费点必须引用服务端那份（否则"唯一实现"是空话）；只会随功能增加
const MUST_IMPORT = ['server/routes/status.js', 'server/routes/articles.js', 'server/routes/videos.js',
  'server/services/ai/daily.js', 'api/[...slug].js', 'api/daily-generate.js', 'tools/collect-turso.js'];
// 判据自身的代码不算违规：tools/eval-*、tools/_* 是"判据与探针"，它们的字符串里
// 本来就写着被禁形状（负向样本）。这类文件由各自的 self-test 保证（_probe-time-caliber-selftest），
// 不参与产品扫描 —— 自检探针必须排除自身（坑 #59）。
const SKIP_TOOL = /^tools\/(?:eval-|_|doc-lint)/;

function walk(root, dir, out) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name)) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) walk(root, rel, out);
    else if (SCAN_EXT.test(e.name)) out.push(rel);
  }
  return out;
}

// → { violations:[{file,line,label,code}], missingImport:[], scanned, allowed }
function findTimeCaliberViolations(root) {
  const files = [];
  for (const top of SCAN_DIRS) {
    if (fs.existsSync(path.join(root, top))) walk(root, top, files);
  }
  const targets = files.filter((rel) => !ALLOWED.has(rel) && !SKIP_TOOL.test(rel));
  const violations = [];
  for (const rel of targets) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    const { masked, strings } = scan(src);
    // 代码视图用 masked（与原文等长）：判"接线"的字符串内容已被抹平，而行号必须仍然对得上原文。
    // 不能用 stripStrings 的 code 视图 —— 它会压缩长度，行号就废了。
    masked.split('\n').forEach((line, i) => {
      for (const b of BANNED) {
        if (b.where !== 'code') continue;
        if (b.re.test(line)) violations.push({ file: rel, line: i + 1, label: b.label, code: line.trim().slice(0, 70) });
      }
    });
    // 字符串视图：字面量内容里出现"日期串 + UTC 边界"（这类写法只可能出现在字符串里）
    const lineOf = (at) => src.slice(0, at).split('\n').length;
    for (const s of strings) {
      for (const b of BANNED) {
        if (b.where !== 'string') continue;
        if (b.re.test(s.s)) {
          violations.push({ file: rel, line: lineOf(s.from), label: b.label, code: s.s.trim().slice(0, 70) });
        }
      }
    }
  }
  const missingImport = MUST_IMPORT.filter((f) => {
    const p = path.join(root, f);
    return !fs.existsSync(p) || !/lib\/time-window/.test(fs.readFileSync(p, 'utf8'));
  });
  return {
    violations,
    missingImport,
    scanned: targets.length,
    allowed: [...ALLOWED.entries()].map(([f, why]) => `${f}（${why}）`),
  };
}

module.exports = { findTimeCaliberViolations, BANNED, ALLOWED, MUST_IMPORT };
