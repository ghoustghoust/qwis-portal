// B131（P0-2）：两份建表源可建列集不许分叉 + ALTERS 补的列必须并进 SCHEMA 本体
// 判据本体：lib/schema-columns.js（与 whitebox W21 共用）
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
// 惰性取：F2P 回基线时本模块不存在，顶层 require 会让整份锁加载即崩，读不出"改前红"（#64-1）
const schemaColumns = () => require('../lib/schema-columns');

const ROOT = path.join(__dirname, '..');
const mk = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-cols-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
};
const LIB_OK = 'const SCHEMA = `CREATE TABLE IF NOT EXISTS articles (\n  id INTEGER PRIMARY KEY,\n  title TEXT,\n  translated_title TEXT\n);`;\n';
const SRV_OK = 'db.exec(`CREATE TABLE IF NOT EXISTS articles (\n  id INTEGER PRIMARY KEY,\n  title TEXT,\n  translated_title TEXT\n)`);\n';

test('SC1 真库两份建表源零缺口，且分母非空（B131）', () => {
  const r = schemaColumns().findSchemaGaps(ROOT);
  assert.deepEqual(r.violations, [], '真库出缺口：' + r.violations.join('；'));
  assert.ok(r.tables >= 8, `只比对了 ${r.tables} 张同名表，判据覆盖面可疑`);
});

test('SC2 负向：server 可建而 lib 建不出的列必须被点名（B131 原始事故形状）', () => {
  const dir = mk({
    'lib/db.js': LIB_OK.replace(',\n  translated_title TEXT', ''),
    'server/db.js': SRV_OK,
  });
  const r = schemaColumns().findSchemaGaps(dir);
  assert.ok(r.violations.some((v) => v.includes('articles.translated_title')), '缺口没被抓到：' + JSON.stringify(r.violations));
});

test('SC3 负向：只在 ALTERS 补、没并进 SCHEMA 本体的列必须被抓（fresh-create 与迁移后不同形）', () => {
  const dir = mk({
    'lib/db.js': LIB_OK + "const ALTERS = ['ALTER TABLE articles ADD COLUMN translated_content TEXT'];\n",
    'server/db.js': SRV_OK.replace(',\n  translated_title TEXT', ''),
  });
  const r = schemaColumns().findSchemaGaps(dir);
  assert.ok(r.violations.some((v) => v.includes('translated_content') && v.includes('ALTERS')), 'ALTERS-only 列没被抓：' + JSON.stringify(r.violations));
});

test('SC4 反向不误伤：端独有的表不判（本地灾备面可以有私表）', () => {
  const dir = mk({
    'lib/db.js': LIB_OK,
    'server/db.js': SRV_OK + 'db.exec(`CREATE TABLE IF NOT EXISTS local_only (id INTEGER PRIMARY KEY, note TEXT)`);\n',
  });
  const r = schemaColumns().findSchemaGaps(dir);
  assert.deepEqual(r.violations, [], '端独有表被误伤：' + JSON.stringify(r.violations));
});

test('SC5 一份 DDL 都解析不出 = 判据被架空，按违规处理（不许静默空扫）', () => {
  const dir = mk({ 'lib/db.js': '// 空文件\n', 'server/db.js': '// 空文件\n' });
  const r = schemaColumns().findSchemaGaps(dir);
  assert.ok(r.violations.length >= 2, '空 DDL 没有判红：' + JSON.stringify(r.violations));
});
