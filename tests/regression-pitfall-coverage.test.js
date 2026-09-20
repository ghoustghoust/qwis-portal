// W9 收紧后的回归锁（放行清单 §三 #12 第三条）。判据本体 `lib/pitfall-coverage.js`，同源。
// 这条锁要守的是**判据本身**：旧 W9 用「tests/ 全文里有没有 `#N` 这个子串」判覆盖，
// 于是 ① 注释里写一句就算锁（B104 实测：#64 一度只靠两份锁文件的头注被算成已锁），
// ② 别的编号含这个子串也算锁（本轮实测：我头注里写「放行清单 §三 #12」被当成「坑 #12 有锁」，
//    而 `#1` 更是被 `#12`、`#19` 之类白送覆盖）。两种都是"往绿灯方向漂"。
'use strict';
require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const pc = () => require('../lib/pitfall-coverage');

const ROOT = path.join(__dirname, '..');
const cov = (src) => pc().findPitfallCoverage([{ file: 'tests/x.test.js', src }], [1, 12, 45]);

test('P1 真库对账：坑号全集与覆盖都必须有数（"0 缺口"必须同时报分母）', () => {
  const mdTexts = fs.readdirSync(path.join(ROOT, 'docs/pitfalls'))
    .filter((x) => x.endsWith('.md') && x !== 'README.md')
    .map((f) => fs.readFileSync(path.join(ROOT, 'docs/pitfalls', f), 'utf8'));
  const ids = pc().pitfallIds(mdTexts);
  assert.ok(ids.length >= 60, `只认出 ${ids.length} 条数字坑号，抽取本身可疑`);
  const files = fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.test.js'))
    .map((f) => ({ file: 'tests/' + f, src: fs.readFileSync(path.join(ROOT, 'tests', f), 'utf8') }));
  const r = pc().findPitfallCoverage(files, ids);
  assert.ok(r.covered.size >= 30, `字符串命中的覆盖只有 ${r.covered.size} 条，判据覆盖面可疑`);
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/eval/whitebox-baseline.json'), 'utf8'));
  const known = new Set((base.w9_pitfalls_without_test_lock || []).map(String));
  const fresh = ids.filter((id) => !r.covered.has(id) && !known.has(String(id)));
  assert.deepEqual(fresh, [], `收紧后新翻红且没记账的坑号：${JSON.stringify(fresh)}`);
});

test('P2 注释里的 #N 不算覆盖（这是本次收紧的全部意义）', () => {
  const r = cov('// 本文件即坑 #45 的回归锁\nconst x = 1;\n');
  assert.equal(r.covered.has(45), false, '注释里的引用又被算成锁了');
  assert.ok(r.outsideStrings.has(45), '至少要能报出"它在注释里提过"，否则历史债无法逐步收口');
});

test('P3 test() 标题与断言消息里的 #N 算覆盖', () => {
  assert.ok(cov("test('I9 坑 #45：分流必须是可测行为', () => {});\n").covered.has(45));
  assert.ok(cov("test('x', () => assert.ok(1, '坑 #45 的断言消息')););\n").covered.has(45));
});

test('P4 前缀陷阱：#12 与 #1 不许互相顶替', () => {
  const r = cov("test('放行清单 §三 #12 的锁', () => {});\n");
  assert.ok(r.covered.has(12), '#12 应当算覆盖');
  assert.equal(r.covered.has(1), false, '#1 被 #12 白送覆盖 = 旧判据的第二个洞');
});

test('P5 残留的宽松面必须写清，不许假装已解决：字符串里有 #N 就算，不判语义', () => {
  // 「放行清单 §三 #12」这种**台账行号**在字符串里同样会被算成覆盖 —— 判据不做语义识别，
  // 但会把命中文件回传（covered: Map<id, file[]>）供人工/后续锁面复核。这里把该行为钉死，
  // 免得下一轮有人以为"已经能区分坑号与行号"而据它做决策。
  const r = cov("test('见 放行清单 §三 #12', () => {});\n");
  assert.ok(r.covered.has(12), '判据按字面匹配，命中就报命中');
  assert.deepEqual(r.covered.get(12), ['tests/x.test.js'], '命中位置必须回传，否则无法复核');
});

test('P6 判据自己的锁不参与对账（否则这份文件里的样本会给自己发覆盖）', () => {
  assert.ok(pc().SELF_EXCLUDED.has('tests/regression-pitfall-coverage.test.js'), '没排除自身');
  const body = "test('坑 #45 的样本', () => {});\n";
  const self = pc().findPitfallCoverage(
    [{ file: 'tests/regression-pitfall-coverage.test.js', src: body }], [45]);
  const other = pc().findPitfallCoverage([{ file: 'tests/real-guard.test.js', src: body }], [45]);
  assert.equal(self.covered.has(45), false, '自己给自己发覆盖 = 判据白写');
  assert.equal(other.covered.has(45), true, '排除逻辑顺手把正常文件也放过了');
});
