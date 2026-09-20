// 文档门禁扩面的回归锁（放行清单 §三 #12：B114② / B115① / B116 / B126④ + 新加的编号唯一判据）。
// 为什么要把 `doc-lint` 的判据再包一层锁（坑 #45/#58）：`npm run lint:docs` 只在交付链里手工跑，
// 一轮忘了就没人知道判据还在不在；而判据最容易死的方式不是报错，是**写空**——
// 正则退化成永远不命中，门禁照样"0 错"。所以这里两件事都要钉住：
//   ① 双向自证必须过（坏样本必须红、好样本必须不红）→ 跑 `--self-test`；
//   ② 分母必须非空（扫到了多少条锚点/多少张表），否则"0 错"等于"没看"。
// 子进程必须删掉 NODE_TEST_CONTEXT，否则嵌套 node 被静默跳过（那会让这条锁恒绿）。
'use strict';
require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'tools', 'doc-lint.cjs');

function lint(args = []) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  try {
    return { out: execFileSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', env, timeout: 180000 }), code: 0 };
  } catch (e) {
    return { out: `${e.stdout || ''}${e.stderr || ''}`, code: e.status === undefined ? -1 : e.status };
  }
}

test('L1 `--self-test` 必须全过且真的跑了双向样本（不是空转）', () => {
  const r = lint(['--self-test']);
  assert.match(r.out, /判据双向自证通过/, r.out);
  const n = Number((/（(\d+) 例/.exec(r.out) || [])[1] || 0);
  assert.ok(n >= 20, `自证样本只有 ${n} 例 —— 扩面的四条判据没被样本覆盖就等于没交付`);
  assert.equal(r.code, 0, `自证不通过：${r.out}`);
});

test('L2 真实文档必须过新加的三条判据（表格超格 / 锚点越界 / F2P 条数无出处 / 编号撞号）', () => {
  const r = lint([]);
  const mine = r.out.split('\n').filter((l) => /\[表格\]|\[锚点越界\]|\[F2P出处\]|\[编号撞号\]/.test(l));
  assert.deepEqual(mine, [], `门禁扩面抓到未收口的存量：\n${mine.join('\n')}`);
});

test('L3 分母可见：锚点判据确实看了上百条，不是写空（坑 #41「0 个问题必须报看了多少个」）', () => {
  const r = lint([]);
  const m = /看到 (\d+) 条指向存在的 file:line 锚点，其中 (\d+) 条按/.exec(r.out);
  assert.ok(m, `没打印锚点分母：${r.out.split('\n')[0]}`);
  assert.ok(Number(m[1]) >= 100, `只扫到 ${m[1]} 条锚点，判据覆盖面可疑`);
  assert.ok(Number(m[2]) >= 1 && Number(m[2]) < Number(m[1]),
    `放过的条数(${m[2]})不在 (0, 总数) 区间内 —— 要么死锚点豁免形同虚设，要么把所有锚点都放过了`);
});

test('L4 判据不许被"整份文件加 ignore"绕过：ignore 只在行内生效', () => {
  const fs = require('fs');
  const src = fs.readFileSync(CLI, 'utf8');
  // 每条判据都必须逐行看 ignore 标记；出现"文件级 skip"就是给自己留了后门
  assert.ok(!/if \(text\.includes\(IGNORE_MARK\)\) continue/.test(src), '存在文件级 ignore 短路');
  assert.match(src, /row\.includes\(IGNORE_MARK\)/, '表格判据没做行级 ignore');
  assert.match(src, /raw\.includes\(IGNORE_MARK\)/, '锚点判据没做行级 ignore');
});
