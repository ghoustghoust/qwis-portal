// B81/B128（你 09-22 裁决：摘掉 + 删，同批）：三处零引用资产清除
// ① lib/collectors/{fetcher,repo}.js（生产零调用，却被 W1 当第四份比对 → 单独制造假红的能力）
// ② web/src/snapshot.js（portal 时代迁移期残留，无任何 import）
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GONE = ['lib/collectors/fetcher.js', 'lib/collectors/repo.js', 'web/src/snapshot.js'];

test('DC128 三个死文件已删除（B81/B128）', () => {
  for (const f of GONE) {
    assert.ok(!fs.existsSync(path.join(ROOT, f)), `${f} 还在仓库里（摘清单与删文件必须同批，只做一半就是悬空）`);
  }
});

test('DC128b W1 清单与引用面不再提及死文件（B81/B128：清单与删除同批的另一半）', () => {
  const wb = fs.readFileSync(path.join(ROOT, 'tools', 'eval-whitebox.cjs'), 'utf8');
  assert.ok(!/'lib\/collectors\/fetcher\.js'/.test(wb), 'W1 清单还挂着已删文件（只删文件不摘清单 = 清单悬空）');
  const b = fs.readFileSync(path.join(ROOT, 'tests', 'regression-20260919b.test.js'), 'utf8');
  assert.ok(!b.includes('lib/collectors/fetcher.js'), '测试引用面还挂着已删文件');
  // 全仓无生产 require（防"删了又有人悄悄引回来"）——只判 require/import 形态，
  // 注释里记录「已删」字样不算引用（eval-whitebox.cjs 的头注就是正当记录）
  const { spawnSync } = require('child_process');
  const r = spawnSync('grep', ['-rEn', '--include=*.js', '--include=*.cjs', '--include=*.jsx',
    "require\\(['\"'][^'\"']*lib/collectors/(fetcher|repo)", 'tools/', 'api/', 'server/', 'web/src/', 'lib/'],
    { encoding: 'utf8' });
  assert.equal(String(r.stdout || '').trim(), '', '还有文件引用已删的 collectors：\n' + r.stdout);
});
