// 一次性负向探针（不提交）：证明白盒 W14 抓的是"这一处写入点有没有真用上门槛"，
// 而不是"这个文件里出现过门槛字面量"。三种摘法都必须红：
//   ① cut      ：整段门槛调用删掉
//   ② discard  ：调用留着但扔掉返回值（`x = g.applyDailyQualityGate(…)` → `g.applyDailyQualityGate(…)`）
//   ③ commented：门槛真没了，只在行尾注释里留一句"applyDailyQualityGate 已接"
// 目标清单从 lib/daily-writers 派生 —— 与判据**同一套事实**（上一版探针自己硬编码 5 个函数名，
// 那正是坑 #58 禁止的写法：取证与判据不许两套事实）。
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { findDailyReportWriters } = require('../lib/daily-writers');
const { spans } = require('../lib/src-spans');

const ROOT = path.join(__dirname, '..');
const ASSIGN_GATE = /[\w{},\s]+=\s*[\w.]+\.applyDailyQualityGate\(/;

function whitebox() {
  try {
    return { out: execFileSync(process.execPath, ['tools/eval-whitebox.cjs'], { cwd: ROOT, encoding: 'utf8' }), red: false };
  } catch (e) {
    return { out: String((e.stdout || '') + (e.stderr || '')), red: true };
  }
}

// 只在宿主函数区间内动手术，别的一份写入器不许被牵连
function mutate(src, fnName, kind) {
  const host = spans(src).find((s) => s.name === fnName);
  if (!host) throw new Error(`找不到 ${fnName}`);
  const slice = src.slice(host.start, host.end);
  const m = ASSIGN_GATE.exec(slice);
  if (!m) throw new Error('宿主函数里没有"赋值式门槛调用"（前提不成立）');
  const abs = host.start + m.index;
  const stmtEnd = src.indexOf('\n', src.indexOf('(', abs)); // 本仓这几行都是单行语句
  const stmt = src.slice(abs, stmtEnd);
  if (!stmt.includes('applyDailyQualityGate')) throw new Error('语句边界取错，跳过以免误判');
  const next = kind === 'cut'
    ? src.slice(0, abs) + 'void 0; // 门槛被摘掉' + src.slice(abs + stmt.length, stmtEnd) + src.slice(stmtEnd)
    : kind === 'discard'
      ? src.slice(0, abs) + stmt.replace(ASSIGN_GATE, (s) => s.replace(/^[\w{},\s]+=\s*/, '')) + src.slice(stmtEnd)
      : src.slice(0, abs) + `void 0; // ${stmt.trim()}` + src.slice(stmtEnd);
  if (next === src) throw new Error('摘法未生效');
  return next;
}

const writers = findDailyReportWriters(ROOT).filter((w) => w.ok);
console.log(`派生自 lib/daily-writers（与 W14 同一实现）：${writers.length} 处已接门槛的写入点`);
const originals = new Map(writers.map((w) => [w.file, fs.readFileSync(path.join(ROOT, w.file), 'utf8')]));
let bad = 0;
for (const kind of ['cut', 'discard', 'commented']) {
  for (const w of writers) {
    const orig = originals.get(w.file);
    let next;
    try { next = mutate(orig, w.fn, kind); } catch (e) { console.log(`  ${kind} ${w.fn}@${w.file} -> 跳过：${e.message}`); bad++; continue; }
    fs.writeFileSync(path.join(ROOT, w.file), next);
    const r = whitebox();
    const named = r.out.includes(w.fn);
    if (!r.red || !named) bad++;
    console.log(`  ${kind.padEnd(9)} ${w.fn}@${w.file} -> ${r.red ? (named ? '红且点名' : '红但没点名本函数') : '未红（判据抓不到）'}`);
    fs.writeFileSync(path.join(ROOT, w.file), orig);
  }
}
const back = whitebox();
if (back.red) bad++;
console.log(`全部复原 -> ${back.red ? '仍红（复原失败）' : 'W14 绿'}`);
console.log(bad ? `探针不成立：${bad} 例未按预期` : `探针成立：${writers.length} 处写入点 × 3 种摘法全红且点名，复原后绿`);
