// W16 / B4 的负向自检：判据必须**每个被禁形态都能抓到**，且不被注释/字符串误伤。
// 运行：node tools/_probe-time-caliber-selftest.cjs
// 为什么必须有它（坑 #50/#59）：一条"全仓扫描 0 违规"的判据，如果扫的面是空的、
// 或正则根本匹配不到真实写法，它就永远绿——绿得没有任何信息量。这里造 6 种真形状逐一验证。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findTimeCaliberViolations } = require('../lib/time-caliber');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'time-caliber-'));
const w = (rel, body) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};

// 六种被禁写法（每种都取自本轮真实修过的代码：B90/B96/B97/B99 与三份手搓窗口算术）
const CASES = [
  ['server/a.js', "const d = new Date(); d.setHours(0, 0, 0, 0);\n", '容器本地 0 点'],
  ['server/b.js', "const t = new Date(Date.now() + 8 * 3600e3); t.setUTCHours(0, 0, 0, 0);\n", '手搓日界 + 偏移'],
  ['server/c.js', "const bj = new Date(Date.now() + 8 * 3600e3);\n", '手写偏移'],
  ['server/d.js', 'if (a.toDateString() === b.toDateString()) return 1;\n', 'toDateString 比同一天'],
  ['server/e.js', "args.push(`${q.from}T00:00:00.000Z`);\n", '日期串当时刻'],
  ['web/src/f.jsx', "const today = new Date().toISOString().slice(0, 10);\n", 'UTC 日当今天'],
];
for (const [rel, body] of CASES) w(rel, body);
// 反例：同样这些写法出现在**注释**里，不许判红（判据看代码不看说明，坑 #59）
w('server/g-comment.js', '// 这里说明为什么不能用 setHours(0, 0, 0, 0) 和 8 * 3600e3\nconst x = 1;\n');
// 反例：允许清单内的两份实现本身带偏移，不算违规
w('lib/time-window.js', 'const BJ_OFFSET_MS = 8 * 3600e3;\n');
// 反例：合法消费点（引用实现、不自己算）
w('server/h-ok.js', "const { beijingDayStartIso } = require('../../lib/time-window');\nmodule.exports = beijingDayStartIso;\n");

const r = findTimeCaliberViolations(root);
const hit = new Set(r.violations.map((v) => v.file));
let bad = 0;
console.log(`扫 ${r.scanned} 个文件，报出 ${r.violations.length} 条`);
for (const [rel, , desc] of CASES) {
  const on = hit.has(rel);
  if (!on) bad++;
  console.log(`  ${on ? '抓到' : '漏了！'} ${rel} —— ${desc}`);
}
for (const rel of ['server/g-comment.js', 'lib/time-window.js', 'server/h-ok.js']) {
  const on = hit.has(rel);
  if (on) bad++;
  console.log(`  ${on ? '误伤！' : '放过'} ${rel}`);
}
// 消费点清单必须真的在判据里起作用（把 MUST_IMPORT 里某个文件改成不引用，missingImport 必须点名）
// 样本里**不许出现** lib/time-window 这个字样 —— 上一版把这三个词写进了"故意不引用"的注释里，
// 判据按文件全文找引用，于是永远点不到名（探针自己把被测点涂掉了）
w('server/routes/status.js', 'module.exports = {}; // 故意不引用那份时间口径实现\n');
const r2 = findTimeCaliberViolations(root);
const named = r2.missingImport.some((f) => /status\.js$/.test(f));
if (!named) bad++;
console.log(`  ${named ? '抓到' : '漏了！'} 消费点不再引用 lib/time-window → missingImport 点名`);
fs.rmSync(root, { recursive: true, force: true });
console.log(bad ? `自检不成立：${bad} 处` : '自检成立：6 种被禁形态全抓到，3 个反例不误伤，消费点清单有效');
process.exitCode = bad ? 1 : 0;
