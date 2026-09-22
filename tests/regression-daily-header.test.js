// B123（P2-4）：早报页头排序文案必须读产物真实档位（schemaVersion/degraded），
// 不许无条件写「关键词规则排序」（AI 策展版也这么显示 = 页面对用户撒谎）
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'DailyHeader.jsx'), 'utf8');

test('DH1 排序文案由 stats.schemaVersion 决定（B123）', () => {
  assert.match(SRC, /schemaVersion/, '页头不再读 schemaVersion');
  assert.match(SRC, /sv\s*>=\s*2\s*\?\s*'AI 策展排序'\s*:\s*'关键词规则排序'/, '两档文案的分支不在');
});

test('DH2 无条件拼接已拆：meta 里不许再出现字面量直写（B123）', () => {
  // 坏形态：meta = `… 生成 · 关键词规则排序 · …`（无条件）
  assert.ok(!/生成 · 关键词规则排序/.test(SRC), 'meta 仍无条件写死「关键词规则排序」');
  assert.match(SRC, /degraded[\s\S]{0,40}降级/, '降级标记不在');
});
