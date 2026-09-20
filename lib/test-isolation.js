// 测试侧"写方法必须指隔离库"的唯一判据（B117 / spec43 §六，2026-09-21）。
// 白盒 **W23**（`tools/eval-whitebox.cjs`）与回归锁 `tests/regression-test-isolation.test.js`
// 共用这一份实现（坑 #58/#59：判据与自证各写一套 = 没有判据）。
//
// 病根（09-20 人工清点 49 份测试得到，不是推测；见 spec43 §六）：
//   · `tests/regression-20260918` 曾对**生产 Turso** 发 `DELETE /api/weekly/archive/999999`，带 `.env`
//     里的真 Bearer token；它没删成东西**只因为** handler 的顺序是"读归档 → filter → 长度没变就先 404"，
//     也就是安全性押在"999999 这个期号恰好不存在"的夹具选择上，而不是押在隔离上。
//   · `tests/regression-20260913b` R6 曾对生产发 `POST /api/data/cleanup/preview` —— 用**写方法**表达"只数不删"。
//   同族事故已经翻过一次车（坑 #17：一条测试把线上 8 个订阅源清零），所以这条必须自动化 ——
//   B83 那句"全部搬完"就是因为没人复扫而被 B117 推翻的。
//
// 判据方向（三个条件同时成立才红，缺一即不红）：
//   ① 有写方法；② **真的**碰云端层（require 读层本体 / 自建 libsql 客户端）；
//   ③ 既没把 `TURSO_DATABASE_URL` 指成 `file:`，也没 `require('./helpers')`（后者把 APP_DATA_DIR
//      指到临时目录，server/db 走 better-sqlite3 且不读 TURSO_*）。
// 只看①会误伤大量"用 POST 打本地临时库"的测试；只按关键字认②会误伤纯静态形状锁
// （第一版就是把 `regression-20260919e`、`regression-bc` 两份源码扫描锁判成红的，它们只是在字符串里
//  提到了 `api/[...slug].js` 和 `'POST'`）。读生产不判红：spec43 §六明写"读生产是可接受的取证方式"。
'use strict';

const fs = require('fs');
const path = require('path');

const WRITE_METHOD = /['"](?:POST|PUT|PATCH|DELETE)['"]/;
const CLOUD_REQUIRE = /require\([^)]{0,90}\[\.\.\.slug\]/;
const CREATE_CLIENT = /createClient\s*\(/;
const ISOLATED = /TURSO_DATABASE_URL\s*=\s*['"`]file:/;
const HELPERS = /require\([^)]{0,40}['"]\.\/helpers['"]\)/;
// 负向样本住在锁自己这份文件里 —— 扫它会把"我写的反例"判成产品红（坑 #63 同族：自我命中）
const SELF_EXCLUDED = new Set(['tests/regression-test-isolation.test.js']);

function testFiles(root) {
  const dir = path.join(root, 'tests');
  return fs.readdirSync(dir).filter((f) => /\.test\.c?js$/.test(f)).map((f) => `tests/${f}`);
}

// **已知空洞（必须写清，别读成"逐调用点判据"）**：`ISOLATED`/`HELPERS` 是**整文件**粒度的 ——
// 一份测试只要在某个子进程驱动里写过一次 `TURSO_DATABASE_URL = 'file:'`，同一文件里另一处真打生产的
// `DELETE` 也会被一起放过。这与 W17 对 `api/[...slug].js` 的整文件豁免是同一族洞（坑 #62）。
// 做到调用点粒度要跑数据流分析，不在本判据范围内；本判据的定位是"别再让一份新测试悄悄绑到生产上"
// （B83/B117 两轮都靠人肉清点才发现），真约束力来自 W23 每轮复扫 + 隔离库那份锁的行为断言。
function classify(rel, src) {
  const { stripComments } = require('./src-spans');
  const code = stripComments(src);
  const touchesCloud = CLOUD_REQUIRE.test(code) || CREATE_CLIENT.test(code);
  const writes = WRITE_METHOD.test(code);
  const safe = ISOLATED.test(code) || HELPERS.test(code);
  if (!touchesCloud) return { rel, kind: 'no-cloud' };
  if (!writes) return { rel, kind: 'read-only-on-cloud' };
  return safe ? { rel, kind: 'isolated-write' } : { rel, kind: 'violation' };
}

function findWriteWithoutIsolation(root, readFn) {
  const read = readFn || ((rel) => fs.readFileSync(path.join(root, rel), 'utf8'));
  const violations = [];
  const isolated = [];
  const readOnlyOnCloud = [];
  const files = testFiles(root);
  for (const rel of files) {
    if (SELF_EXCLUDED.has(rel)) continue;
    let src;
    try { src = read(rel); } catch { continue; }
    const c = classify(rel, src);
    if (c.kind === 'violation') violations.push({ file: rel, why: "写方法 + 真碰云端层 + 既未指 TURSO_DATABASE_URL='file:' 也未 require('./helpers')" });
    else if (c.kind === 'isolated-write') isolated.push(rel);
    else if (c.kind === 'read-only-on-cloud') readOnlyOnCloud.push(rel);
  }
  return { scanned: files.length, violations, isolated, readOnlyOnCloud, selfExcluded: [...SELF_EXCLUDED] };
}

module.exports = {
  findWriteWithoutIsolation, classify, testFiles,
  WRITE_METHOD, CLOUD_REQUIRE, CREATE_CLIENT, ISOLATED, HELPERS, SELF_EXCLUDED,
};
