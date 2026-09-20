// W23 的回归锁（B117 / spec43 §六）：测试里的"写方法 + 真碰云端层"必须指隔离库。
// 判据本体在 `lib/test-isolation.js`，白盒 W23 与这条锁同源（坑 #58/#59）。
// 为什么这份锁的重点全在**样本**上（坑 #45/#62）：一条"扫全库 0 红"的断言既可能因为真干净，
// 也可能因为正则写空而恒绿 —— 所以每一条都要配一个"喂坏形态必须翻红"的对照，
// 而且要配**反向样本**（把合法隔离形态喂进去必须不红），否则就是把安全网收紧成恒红再被人加 ignore 绕过。
'use strict';
require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert');
// 惰性取（`#64-1` 那条锁的口径）：F2P 会在"基线树里还没有 lib/test-isolation.js"的 worktree 里跑本文件，
// 顶层 require 会让整份文件加载失败，取证工具就只能读成"锁假了"而不是"锁没跑到"（坑 #64/#66）。
const lib = () => require('../lib/test-isolation');
const classify = (...a) => lib().classify(...a);
const scan = () => lib().findWriteWithoutIsolation(process.cwd());

// 四种形态都从"历史真事故"的最小化版本长出来，别用假得像的字符串糊弄自己
const BAD_PROD_WRITE = `
const handler = require('../api/[...slug].js');
async function t() { return call('DELETE', '/api/weekly/archive/999999'); }
`;
const GOOD_FILE_ISOLATED = `
process.env.TURSO_DATABASE_URL = 'file:' + process.argv[3];
const handler = require('../api/[...slug].js');
async function t() { return call('DELETE', '/api/weekly/archive/7'); }
`;
const GOOD_HELPERS = `
require('./helpers');
const handler = require('../api/[...slug].js');
async function t() { return call('POST', '/api/data/cleanup/preview', { days: 7 }); }
`;
const GOOD_READ_ONLY = `
const handler = require('../api/[...slug].js');
async function t() { return call('GET', '/api/reading?type=video'); }
`;
// 误伤反证（判据第一版就是把这两份判成红的）：只是把路径与 'POST' 当**字符串**读的静态形状锁
const GOOD_STATIC_SHAPE_SCAN = `
const src = fs.readFileSync('api/[...slug].js', 'utf8');
assert.match(src, /'\\/api\\/daily\\/regenerate' && method === 'POST'/);
`;
// 注释里的写方法不许算（坑 #63：反例写在注释里把自己判红）
const GOOD_COMMENT_ONLY = `
// 旧版曾对生产发 'DELETE' / 'POST'，现已搬走
const handler = require('../api/[...slug].js');
async function t() { return call('GET', '/api/weekly'); }
`;

test('T1 现役全库扫描必须 0 红，且分母非空（防空跑式假绿）', () => {
  const r = scan();
  assert.ok(r.scanned >= 50, `只扫到 ${r.scanned} 份测试，分母不对就是判据写空了（坑 #41）`);
  assert.deepEqual(r.violations, [], `仍有测试在生产上发写方法：${JSON.stringify(r.violations)}`);
  assert.ok(r.isolated.length >= 4, `已隔离的写方法测试应有数份（B83 搬完 4 份 + B117 新增），实得 ${r.isolated.length}`);
  assert.ok(r.readOnlyOnCloud.length >= 5, `只读碰云端那一批也要有数（证明判据真的在分类，不是恒红也不是恒绿）`);
});

test('T2 坏形态必须红：写方法 + require 读层 + 无 file: 无 helpers', () => {
  assert.equal(classify('tests/x.test.js', BAD_PROD_WRITE).kind, 'violation', '生产写没被判出来 = 假闸');
});

test('T3 三种合法形态必须不红（收紧成恒红，三天后就被人加 ignore 绕过）', () => {
  assert.equal(classify('tests/a.test.js', GOOD_FILE_ISOLATED).kind, 'isolated-write');
  assert.equal(classify('tests/b.test.js', GOOD_HELPERS).kind, 'isolated-write');
  assert.equal(classify('tests/c.test.js', GOOD_READ_ONLY).kind, 'read-only-on-cloud');
});

test('T4 误伤反证：把 api/[...slug] 与 POST 当字符串读的静态形状锁不算碰云端层', () => {
  assert.equal(classify('tests/d.test.js', GOOD_STATIC_SHAPE_SCAN).kind, 'no-cloud',
    '静态形状锁被当成"打生产的测试"＝ W23 会把 `npm test` 的守卫本身判红');
});

test('T5 注释里的写方法不算（stripComments 必须真生效）', () => {
  assert.equal(classify('tests/e.test.js', GOOD_COMMENT_ONLY).kind, 'read-only-on-cloud',
    '注释里的反例把自己判成红，就是坑 #63 的复发');
});

test('T6 搬走的两条历史事故形态，逐条按原判据复现必须红', () => {
  // 09-20 实测清点原样搬来：这两份文件今天就躺在 tests/ 里，但形态已经改掉了
  const weeklyDelete = `
const handler = require('../api/[...slug].js');
const r = await call('DELETE', '/api/weekly/archive/999999');`;
  const cleanupPreview = `
const handler = require('../api/[...slug].js');
const d = await call('POST', '/api/data/cleanup/preview', { days: 7 });`;
  assert.equal(classify('tests/old-20260918.test.js', weeklyDelete).kind, 'violation');
  assert.equal(classify('tests/old-20260913b.test.js', cleanupPreview).kind, 'violation');
  // 现文件里不许再出现这两种形态（读文件本体，而不是读上面这两段样本）
  const fs = require('fs'); const path = require('path');
  for (const f of ['regression-20260918', 'regression-20260913b']) {
    const src = fs.readFileSync(path.join(__dirname, `${f}.test.js`), 'utf8');
    assert.doesNotMatch(src, /call\(\s*['"](POST|DELETE|PUT)['"]/, `${f} 仍然在本进程内直接发写方法（B117 未收口）`);
  }
});

test('T7 自证：这份锁自己带坏样本，必须被排除在扫描面外（否则 W23 永远红）', () => {
  const r = scan();
  assert.ok(r.selfExcluded.includes('tests/regression-test-isolation.test.js'),
    '没排除自身 → 本文件的 BAD_PROD_WRITE 会把 W23 永远判红');
  assert.ok(!r.violations.some((v) => v.file.includes('test-isolation')), '排除没生效，本文件仍被判红');
  // 反向自证：本文件里既有坏样本也有"合法形态"的样本，所以判据按**整文件**给安全标记（局限见
  // `lib/test-isolation.js` 末段）。把两处安全标记一起摘掉之后必须翻红 —— 否则说明判据根本没看见坏样本。
  const fs = require('fs'); const path = require('path');
  const self = fs.readFileSync(path.join(__dirname, 'regression-test-isolation.test.js'), 'utf8');
  assert.equal(classify('tests/regression-test-isolation.test.js', self).kind, 'isolated-write',
    '本文件应当因为 require(./helpers) 被判为已隔离，否则 T3 的正向对照是假的');
  const stripped = self
    .replace(/require\(['"]\.\/helpers['"]\)\s*;?/g, '')
    .replace(/TURSO_DATABASE_URL\s*=\s*'file:'/g, "TURSO_DATABASE_URL = 'https://example.db'");
  assert.equal(classify('tests/regression-test-isolation.test.js', stripped).kind, 'violation',
    '摘掉 helpers 与 file: 两处标记后必须翻红 —— 不然 T2 的"坏样本会红"是自说自话');
});
