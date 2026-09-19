// 一次性自检：证明 I10 的判据不是"永远绿"。三种注入都必须让 I10 变红，恢复后必须绿。
// 教训（本轮第一版探针就栽在这）：仓库源码是 CRLF，replace 的模式串里写 '{\n' 永不命中，
// 于是"注入失败 → 测试通过"被误读成"锁没拦住"。探针必须自己先断言"改动真的落进文件里"。
const { execFileSync } = require('child_process');
const fs = require('fs');
const F = 'api/[...slug].js';
const orig = fs.readFileSync(F, 'utf8');
const EOL = orig.includes('\r\n') ? '\r\n' : '\n';

const cases = [
  ['① 直接内联回 handleStatus', (s) => s.replace(/async function handleStatus\(req\) \{/,
    (m) => `${m}${EOL}  const _inj = await qAll('SELECT sections FROM daily_reports LIMIT 7');`),
    '_inj'],
  ['② 藏进被 handleStatus 调用的辅助函数', (s) => s.replace(/async function handleStatus\(req\) \{/,
    (m) => `function _helperHeavy() { return qAll('SELECT sections FROM daily_reports'); }${EOL}${m}${EOL}  _helperHeavy();`),
    '_helperHeavy'],
  ['③ 把重统计从按需端点里删掉（拆了没接上）', (s) => s.replace(
    'SELECT sections FROM daily_reports WHERE generated_at >= ? ORDER BY id DESC LIMIT 7',
    'SELECT name FROM sources WHERE 1=0'), 'WHERE 1=0'],
];

function runI10() {
  let out = '';
  try {
    out = execFileSync(process.execPath, ['--test', '--test-concurrency=1', 'tests/regression-20260919i.test.js'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return 'pass';
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    return /\bI10\b/.test(out) ? 'fail:I10' : 'fail:other';
  }
}

let bad = 0;
for (const [name, mut, mark] of cases) {
  const next = mut(orig);
  if (!next.includes(mark)) {
    console.log(`${name} -> 注入未生效（探针自身失效，结论不可用）`);
    bad++;
    continue;
  }
  if (next === orig) { console.log(`${name} -> 注入未生效（内容无变化）`); bad++; continue; }
  fs.writeFileSync(F, next);
  const r = runI10();
  if (r !== 'fail:I10') bad++;
  console.log(`${name} -> ${r}`);
}
fs.writeFileSync(F, orig);
console.log(`恢复原状 -> ${runI10()}`);
console.log(bad ? `探针不成立：${bad} 例未按预期变红` : '探针成立：三例全红、复原后全绿');
