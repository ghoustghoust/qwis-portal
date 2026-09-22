// B87（P3-1）：B 站上游形状哨兵——上游字段漂移时 audit-cloud 先红（而不是等采集静默失败）
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'tools', 'audit-cloud.js'), 'utf8');

test('BP1 audit-cloud 含「B站上游 nav 形状」探针且指真实上游（B87）', () => {
  assert.ok(SRC.includes('B站上游 nav 形状'), '探针不在');
  assert.ok(SRC.includes('https://api.bilibili.com/x/web-interface/nav'), '探针没指真实上游');
  assert.ok(SRC.includes('typeof b.code') && SRC.includes('typeof b.data'), '形状判据没了（code/data 契约）');
});

test('BP2 probe() 支持绝对 URL（上游探针的前提；云端相对路径不受影响）（B87）', () => {
  assert.ok(/\/\^https\?/.test(SRC) && /\.test\(url\)/.test(SRC), 'probe 不支持绝对 URL');
  const { verdictToResult } = require('../tools/audit-cloud.js');
  assert.deepEqual(verdictToResult(true), { pass: true, note: '', skip: '' });
  assert.equal(verdictToResult('上游 nav 形状变了：x').pass, false, '失败理由不应算通过（坑 #43）');
});
