// 早报/周刊生成守卫（2026-09-18 AI 功能缺失事故）
// 纯函数，runner（tools/collect-turso.js）与云端读层（api/[...slug].js）共用，勿再写第二份。
// 同 lib/hot-events.js / lib/source-axes.js 的约定：唯一实现，双端引用。

const DAILY_AI_MAX_AGE_HOURS = 30;
const WEEKLY_MIN_ITEMS = 4;

function parseStats(row) {
  if (!row) return {};
  if (typeof row.stats === 'object' && row.stats !== null) return row.stats;
  try { return JSON.parse(row.stats || '{}') || {}; } catch { return {}; }
}

// 日报是否为 AI 增强版（六维评分/导语/主题全景随 schemaVersion:2 一起写入）
function isAiDailyReport(row) {
  return Number(parseStats(row).schemaVersion) >= 2;
}

function ageHours(row, nowMs) {
  const t = Date.parse(row.generated_at);
  if (!Number.isFinite(t)) return Infinity;
  return (nowMs - t) / 3600e3;
}

// 选日报：AI 增强版优先于「更新的裸报告」。
// 2026-09-18 事故：collect.yml 的 daily-report（非 AI，09:03 北京）与读层内联兜底都会在此之后
// 插入 window_hours=30 / 无 theme·themes·六维 的裸报告，而读层按 generated_at DESC LIMIT 1 取行
// → 每天早上的读者拿到的都是裸报告，每日早报 AI 区整体消失。
function pickDailyReport(rows, nowMs = Date.now(), aiMaxAgeHours = DAILY_AI_MAX_AGE_HOURS) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const ai = rows.find((r) => isAiDailyReport(r) && ageHours(r, nowMs) <= aiMaxAgeHours);
  return ai || rows[0];
}

// 周刊发布守卫：条目不足一律不发布（saveWeekly 会覆盖 weekly.latest）。
// 降级/空产物只在深析全败但初筛有货时才有内容；候选为 0 时 items 为 []，
// 原先无守卫 → 一次失败跑批直接把上一期好内容抹掉，且 degraded 仍写 false 无任何提示。
// 门槛与杂志化结构（api/_ai.js generateWeeklyMagazine 的 items.length>=4）同口径。
function canPublishWeekly(items, minItems = WEEKLY_MIN_ITEMS) {
  return Array.isArray(items) && items.length >= minItems;
}

// 每日早报分析后的质量门槛。默认 30 不是新拍的数：与初筛 ai.filterThreshold 的默认值同口径，
// 保证"初筛说 30 分以下不收"和"深析打完分还能塞进来"这两件事不再自相矛盾。
const DAILY_MIN_SCORE = 30;

// 深析此前完全没有否决权：analyzeArticle 的返回契约里没有 ignore/veto 字段，
// 模型只能把"不适合收录"写进 reason 散文里，而组装阶段从不读 reason——
// 线上实测 score=10 的二手交易帖因此坐进了最显眼的「重点更新」栏（该栏只看"源"有没有被标重点，不看分）。
function passesDailyQualityGate(item, minScore = DAILY_MIN_SCORE) {
  if (!item) return false;
  // 视频/播客：videos 表实测既无 score 也无 translated_title 列，一律无 AI 分，不参与分数门槛
  if (item.kind === 'video' || item.kind === 'podcast' || item.kind === 'tweet') return true;
  const s = Number(item.totalScore ?? item.score);
  if (!Number.isFinite(s)) return true;   // 未评分（降级关键词版）不误杀
  return s >= minScore;
}

module.exports = {
  DAILY_AI_MAX_AGE_HOURS, WEEKLY_MIN_ITEMS, DAILY_MIN_SCORE,
  parseStats, isAiDailyReport, ageHours, pickDailyReport, canPublishWeekly, passesDailyQualityGate,
};
