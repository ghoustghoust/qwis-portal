// B17（P2-5）：周刊预筛降量——全周高分内容不被时间序挤掉，低分非最新被裁
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// 惰性取（#64-1）：F2P 回基线时本模块不存在，顶层 require 会让整份锁加载即崩
const WP = () => require('../lib/weekly-prefilter');
const prefilterWeekly = (...a) => WP().prefilterWeekly(...a);

const mk = (n, score) => ({ id: n, score, published_at: new Date(Date.now() - n * 3600e3).toISOString() });

test('WP1 全周高分不被时间序挤掉：最旧的 ≥60 分也在，最新的低分被裁（B17 本体）', () => {
  const old_hi = [{ id: 999, score: 88, published_at: '2026-09-14T00:00:00Z' }];
  const freshLo = Array.from({ length: 500 }, (_, i) => ({ id: i, score: 10, published_at: new Date(Date.now() - i * 60000).toISOString() }));
  const { scoped, droppedCount } = prefilterWeekly([...freshLo, ...old_hi], { maxFilter: 100 });
  assert.ok(scoped.some((a) => a.id === 999), '七天前的高分被时间序挤掉了——B17 没修到');
  assert.equal(scoped.length, 100);
  assert.ok(droppedCount > 0);
});

test('WP2 高分数量超预算时高分优先于预算（宁超预算不丢高分）', () => {
  const hi = Array.from({ length: 300 }, (_, i) => mk(i, 80));
  const { scoped } = prefilterWeekly(hi, { maxFilter: 50 });
  assert.equal(scoped.length, 300, '高分被预算裁掉了（拍板：六维分门槛是全收）');
});

test('WP3 视频条目全收（kind=video 本身就是 LIMIT 预筛过的）', () => {
  const vids = Array.from({ length: 15 }, (_, i) => ({ id: 'v' + i, kind: 'video', score: null }));
  const { scoped } = prefilterWeekly([...vids, ...Array.from({ length: 500 }, (_, i) => mk(i, 0))], { maxFilter: 50 });
  assert.equal(scoped.filter((a) => a.kind === 'video').length, 15, '视频被裁了');
});

test('WP4 runWeekly 接线：调 prefilterWeekly 且初筛循环用预筛结果（源码形态）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'collect-turso.js'), 'utf8');
  assert.ok(src.includes("require('../lib/weekly-prefilter')"), '没引唯一实现');
  assert.ok(/for \(const a of pre\.scoped\)/.test(src), '初筛循环没用预筛结果');
  assert.ok(!/for \(const a of valid\) \{\n    if \(Date\.now\(\) - t0 > BUDGET_MS \* 0\.4\)/.test(src), '初筛还在直接跑全量 valid');
});
