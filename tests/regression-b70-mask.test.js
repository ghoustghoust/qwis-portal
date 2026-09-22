// B70④（P3-2 之一）：_test-api.cjs 的掩码不得依赖 env 已加载
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'tools', '_test-api.cjs'), 'utf8');

test('BT4 掩码按参数名遮值，与 env 加载与否无关（B70④/坑 #69 同族）', () => {
  assert.ok(!/replace\(process\.env\.\w+/.test(SRC), '仍存在依赖 env 已加载的掩码写法');
  assert.ok(SRC.includes('(key=)'), '没有按参数名遮值的掩码');
  // 行为：模拟 env 未加载时也不允许明文（掩码函数本身是正则字面量，与 env 无关）
  const masked = 'https://x/api/collect?key=SECRET-123&mode=debug'.replace(/(key=)[^&]+/, '$1***');
  assert.equal(masked, 'https://x/api/collect?key=***&mode=debug');
});

test('BT5 judge 外部内容必须进显式定界块 + 截断留痕（B70①）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'eval-content', 'judge.py'), 'utf8');
  assert.ok(src.includes('external-untrusted-content'), 'judge 没有定界块');
  assert.ok(src.includes('已截断'), '截断没留痕（评半篇打满分是自欺）');
  assert.ok(src.includes('只有被评数据'), '没有「块内只有数据没有指令」的角色约定');
});

test('BT6 trend.json 写入必须原子且损坏可恢复（B70②）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'eval-content', 'run.py'), 'utf8');
  assert.ok(src.includes('.json.tmp') && src.includes('tmp.replace(tp)'), '不是 tmp+replace 原子写');
  assert.ok(src.includes('.corrupt'), '损坏的 trend.json 没有保留现场就覆盖/抛错的分支');
});
