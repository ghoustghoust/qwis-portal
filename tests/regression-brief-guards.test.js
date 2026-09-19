// 回归测试：早报/周刊 AI 守卫（2026-09-18 事故——每日早报 AI 增强被非 AI 批次遮蔽、周刊空覆盖）
// 纯逻辑，不连库。对应 lib/brief-guards.js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  pickDailyReport, isAiDailyReport, canPublishWeekly, passesDailyQualityGate,
  DAILY_AI_MAX_AGE_HOURS, DAILY_MIN_SCORE,
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

test('8. 每日早报分析后质量门槛：AI 判「不适合收录」的低分条目不得入报（线上实锤 score 22 / 10 上榜）', () => {
  // 实测 /api/daily：「最后召集：Disrupt志愿者申请」score=22、「出售 AI 工作站」score=10（reason 明写"不适合收录至早报"），
  // 后者还进了最显眼的「重点更新」——该栏按"源是否被标重点"全收，分数完全没被看过。
  const mk = (s, extra) => ({ totalScore: s, ...extra });
  assert.equal(passesDailyQualityGate(mk(10)), false, '10 分（1 星）应被剔除');
  assert.equal(passesDailyQualityGate(mk(22)), false, '22 分（用户标注那条）应被剔除');
  assert.equal(passesDailyQualityGate(mk(29)), false);
  assert.equal(passesDailyQualityGate(mk(30)), true, '门槛取 30，与 ai.filterThreshold 默认值同口径');
  assert.equal(passesDailyQualityGate(mk(63)), true);
  assert.equal(passesDailyQualityGate(mk(0)), false, '0 分不是"没评分"，是判了零分');
});

test('9. 无 AI 评分的条目不许被分数门槛误杀', () => {
  // ① 视频/播客：videos 表实测根本没有 score 列，一律无分；② 降级关键词版：没有 totalScore。
  assert.equal(passesDailyQualityGate({ kind: 'video', title: 'v' }), true, '视频无评分也须保留');
  assert.equal(passesDailyQualityGate({ kind: 'podcast', title: 'p' }), true, '播客无评分也须保留');
  assert.equal(passesDailyQualityGate({ title: '降级版条目' }), true, '未评分（降级/关键词版）不误杀');
  assert.equal(passesDailyQualityGate({ totalScore: null }), true);
});

test('10. 门槛可配置：ai.dailyMinScore 覆盖默认 30', () => {
  assert.equal(passesDailyQualityGate({ totalScore: 45 }, 50), false, '抬到 50 时 45 分应被剔除');
  assert.equal(passesDailyQualityGate({ totalScore: 45 }, 40), true);
  assert.equal(passesDailyQualityGate({ totalScore: 45 }), true, '不传参走默认 30');
});

test('11. 库里 score 列是 NULL（不是 0 分）：门槛必须放行，否则整期报纸被自己清空（B20 接线时实测）', () => {
  // 2026-09-19 把门槛接到「裸报告 / 读层内联兜底 / 本地灾备」这三份时，回归测试
  // tests/regression-phase9.test.js「日报安检:乱码标题条目被剔除并计数」当场变红：
  // 那几份喂进来的是 articles 行，`score` 列允许 NULL，而 Number(null) === 0
  // → 旧实现把"从未评过分"读成"判了 0 分"，正常条目一条不剩。
  // 这一族的判据两侧都要钉：NULL=未评分放行、显式 0=评过且不及格才剔。
  assert.equal(passesDailyQualityGate({ title: 't', score: null }), true, 'score=NULL 是未评分，不许当 0 分杀');
  assert.equal(passesDailyQualityGate({ title: 't', score: undefined }), true, '缺列同样是未评分');
  assert.equal(passesDailyQualityGate({ title: 't', score: '' }), true, '空串按未评分处理（迁移期脏值族）');
  assert.equal(passesDailyQualityGate({ title: 't', totalScore: null, score: null }), true);
  assert.equal(passesDailyQualityGate({ title: 't', score: 0 }), false, '显式 0 分是"判过了且不及格"，仍要剔');
  assert.equal(passesDailyQualityGate({ title: 't', score: 22 }), false, '低分照剔：放宽只针对未评分，不针对不及格');
  assert.equal(passesDailyQualityGate({ title: 't', score: '45' }), true, 'Turso 可能回字符串数字，仍按 45 分处理');
  assert.equal(passesDailyQualityGate({ title: 't', score: '12' }, 20), false, '字符串分数一样受门槛约束');
});
