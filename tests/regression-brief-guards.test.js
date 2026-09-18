// 回归测试：早报/周刊 AI 守卫（2026-09-18 事故——每日早报 AI 增强被非 AI 批次遮蔽、周刊空覆盖）
// 纯逻辑，不连库。对应 lib/brief-guards.js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  pickDailyReport, isAiDailyReport, canPublishWeekly, DAILY_AI_MAX_AGE_HOURS,
} = require('../lib/brief-guards.js');

// 线上真实数据（/api/brief/history 2026-09-18）：
//   id 100 generatedAt 2026-09-18T05:41Z window_hours=30 theme=null  → runDaily 非 AI
//   id  99 generatedAt 2026-09-17T21:14Z window_hours=24 theme 有值   → daily-ai AI 增强
const AI_ROW = {
  id: 99, generated_at: '2026-09-17T21:14:49.272Z', window_hours: 24,
  stats: JSON.stringify({ schemaVersion: 2, theme: '保留真正有科技价值的部分', degraded: false, themes: [{ name: 't' }] }),
};
const BARE_ROW = {
  id: 100, generated_at: '2026-09-18T05:41:26.603Z', window_hours: 30,
  stats: JSON.stringify({ candidates: 500, articles: 500, sections: 4, totalItems: 41 }),
};
// 事故时刻：北京 09-18 13:41（= 05:41Z）之后有人打开早报页
const NOW = Date.parse('2026-09-18T06:00:00.000Z');

test('1. isAiDailyReport 认 schemaVersion>=2（stats 为 JSON 字符串/对象/坏值三态）', () => {
  assert.equal(isAiDailyReport(AI_ROW), true);
  assert.equal(isAiDailyReport(BARE_ROW), false);
  assert.equal(isAiDailyReport({ stats: { schemaVersion: 2 } }), true);
  assert.equal(isAiDailyReport({ stats: '{bad json' }), false);
  assert.equal(isAiDailyReport(undefined), false);
});

test('2.【事故复现】裸报告比 AI 报告新时，仍选 AI 增强版（每日早报不再丢 AI 区）', () => {
  const picked = pickDailyReport([BARE_ROW, AI_ROW], NOW);
  assert.equal(picked.id, 99, '应优先返回 30h 内的 AI 报告，而不是更新的裸报告');
  assert.equal(isAiDailyReport(picked), true);
});

test('3. 无 AI 报告时回退最新裸报告（兜底能力不许被修没）', () => {
  const picked = pickDailyReport([BARE_ROW], NOW);
  assert.equal(picked.id, 100);
});

test('4. AI 报告超过时效窗后不再锁死，回退最新行', () => {
  const staleAi = { ...AI_ROW, generated_at: new Date(NOW - (DAILY_AI_MAX_AGE_HOURS + 5) * 3600e3).toISOString() };
  const picked = pickDailyReport([BARE_ROW, staleAi], NOW);
  assert.equal(picked.id, 100, '超窗的 AI 报告不该继续遮蔽新内容');
});

test('5. 空/非法输入返回 null（读层据此才走内联兜底生成）', () => {
  assert.equal(pickDailyReport([], NOW), null);
  assert.equal(pickDailyReport(undefined, NOW), null);
  assert.equal(pickDailyReport(null, NOW), null);
});

test('6. canPublishWeekly：0 条与不足 4 条一律拒发布（防降级/空产物覆盖上一期好内容）', () => {
  assert.equal(canPublishWeekly([]), false);
  assert.equal(canPublishWeekly(undefined), false);
  assert.equal(canPublishWeekly(null), false);
  assert.equal(canPublishWeekly([{ id: 1 }, { id: 2 }, { id: 3 }]), false);
});

test('7. canPublishWeekly：达到 4 条才发布（与周刊杂志化门槛同口径）', () => {
  const four = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  assert.equal(canPublishWeekly(four), true);
  assert.equal(canPublishWeekly(Array.from({ length: 25 }, (_, i) => ({ id: i }))), true);
});
