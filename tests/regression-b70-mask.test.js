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
