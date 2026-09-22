// 早报/周刊生成守卫（2026-09-18 AI 功能缺失事故）
// 纯函数，runner（tools/collect-turso.js）与云端读层（api/[...slug].js）共用，勿再写第二份。
// 同 lib/hot-events.js / lib/source-axes.js 的约定：唯一实现，双端引用。

const DAILY_AI_MAX_AGE_HOURS = 30;
const WEEKLY_MIN_ITEMS = 4;

// 日报产物档位（B112）：**写入侧只许用这两个常量**。
// 为什么要收成常量：今天 5 个生成写入点里只有 `runDailyAi` 写对了（数字 2），
// `runDaily` 的降级路径用 `json_set(stats,'$.schemaVersion','1')` 写成了**字符串**，
// 另外三份（云端内联 / 云端 cron / 本地引擎）**根本不写**这个字段 →
// 近 14 天实测分布 = `(无)` 48 行 / 数字 2 19 行 / 字符串 "1" 1 行。
// 读侧 `isAiDailyReport` 用 Number() 兜住了三种形态，所以今天看不出问题；
// 但"哪一版可用"这件事从此不能只靠字段存在判 —— 而 `pickDailyReport` 恰恰依赖它。
const DAILY_SCHEMA_VERSION = { KEYWORD: 1, AI: 2 };

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
  // 只认"真的是数字"为已评分。Number(null) === 0，而库里 articles.score 允许 NULL
  // （B20 把门槛接到裸报告/内联兜底那几份后实测：NULL 列被当成 0 分整条剔除，正常条目全没了）
  const raw = item.totalScore ?? item.score;
  const s = typeof raw === 'number' ? raw : (typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN);
  if (!Number.isFinite(s)) return true;   // 未评分（NULL 列 / 降级关键词版）不误杀
  return s >= normalizeMinScore(minScore);
}

// 门槛值本身也要兜底：`ai.dailyMinScore` 被存成非数字（空串 / 打字错误 / null）时，
// 旧写法 `s >= Number('')`＝`s >= 0` 让门槛**静默失效**，而 `s >= Number('abc')`＝`s >= NaN` 恒 false
// → **所有已评分条目一起被剔**，整期只剩无分条目。两种都当"配置不可用"退回默认值，
// 并由调用方用 dailyMinScoreOf 出声（静默降级 = 没人知道，坑 #38 同族）。
function normalizeMinScore(v) {
  // 空串 / null / false / 空白都会被 Number() 变成 0，而 0 的意思是"门槛关了"——
  // 这种"配置缺失"绝不能读成"故意设为 0"，一律回默认值。
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return DAILY_MIN_SCORE;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : DAILY_MIN_SCORE;
}

// 读配置用的同一个归一：坏配置回默认值，调用方可比对 `dailyMinScoreOf(cfg) !== Number(cfg)` 来出声
function dailyMinScoreOf(rawSetting) {
  return normalizeMinScore(rawSetting ?? DAILY_MIN_SCORE);
}

// 五份日报写入器共用的这一步：读门槛配置（坏值回默认）→ 过滤 → 回报剔了多少。
// 为什么把这整段收进来（B20，2026-09-19 独立对抗审查）：五份各自写过一遍"读 ai.dailyMinScore → filter"，
// 于是出现过两类只在一份里修的漂移——① 门槛只接在 3/5 份里；② 配置写成非数字时
// `s >= NaN` 恒 false（已评分条目全被剔）而 `Number('')`＝0（门槛静默失效）。
// 现在这份唯一实现的判据由 W14 反查：每个 `INSERT INTO daily_reports` 的宿主函数必须调它。
function applyDailyQualityGate(items, rawMinScore, log) {
  const minScore = dailyMinScoreOf(rawMinScore);
  const list = Array.isArray(items) ? items : [];
  const kept = list.filter((a) => passesDailyQualityGate(a, minScore));
  const dropped = list.length - kept.length;
  const fellBack = rawMinScore !== undefined && rawMinScore !== null && Number(rawMinScore) !== minScore;
  if (typeof log === 'function') {
    // 静默降级 = 没人知道（坑 #38 同族）：坏配置必须单独出声，不能混在"剔了几条"里
    if (fellBack) log(`入报门槛配置不可用（ai.dailyMinScore=${JSON.stringify(rawMinScore)}），按默认 ${minScore} 分执行`);
    if (dropped) log(`入报门槛(≥${minScore} 分): 剔除 ${dropped} 条 / 保留 ${kept.length} 条`);
  }
  return { kept, dropped, minScore, fellBack };
}

// 早报中心「生成历史」窗口（B39，2026-09-19）：标题写「近 7 天」而实现是 `ORDER BY id DESC LIMIT 7`
// → 线上近 7 天实有 59 行，只露 7 行，列表最旧停在 09-16（承诺 7 天、实际 3 天）。
// SQL 放这里而不是留在接口里，是为了能被回归测试拿真库跑一遍（B60 的教训：看不见 = 测不到）。
const HISTORY_WINDOW_DAYS = 7;
const HISTORY_MAX_ROWS = 200; // 窗口自身已限界，这里只防爆量（实测单日最多 31 次生成）

function historySinceIso(nowMs = Date.now(), days = HISTORY_WINDOW_DAYS) {
  return new Date(nowMs - days * 864e5).toISOString();
}

const DAILY_HISTORY_SQL = `SELECT id, generated_at, window_hours, stats FROM daily_reports
   WHERE generated_at >= ? ORDER BY id DESC LIMIT ${HISTORY_MAX_ROWS}`;

// ─── 周刊骨架与期号（B121，2026-09-20）───
// 为什么放在这一份里：`canPublishWeekly` 已经在这，周刊"能不能发/发成什么样"的判定只该有一处；
// 而 B121 的病恰恰是"深析 20 条齐全、主线骨架全丢、却写 `degraded=false`"——
// 状态灯与端到端剧本（E6 断言 storylines ≥3 出现在页面上）各判各的，绿灯就成了假绿。
const WEEKLY_MIN_STORYLINES = 3;

/** 周刊骨架完整性：导语 + 封面主题词 + 主线（≥3 条）。缺任一 = spineMissing */
function weeklySpine({ theme, magazine } = {}) {
  const storylines = (magazine && Array.isArray(magazine.storylines) ? magazine.storylines : []).filter(Boolean);
  const missing = [];
  if (!theme || !String(theme).trim()) missing.push('theme');
  if (!magazine || !magazine.coverTheme) missing.push('coverTheme');
  if (storylines.length < WEEKLY_MIN_STORYLINES) missing.push(`storylines<${WEEKLY_MIN_STORYLINES}`);
  return { spineMissing: missing.length > 0, missing, storylines: storylines.length };
}

/** 期号按**内容窗口**定，不按"归档里第几条"定：换库把归档清空过，旧算法则同一窗口重跑会算出新期（B121③） */
function weeklyWindowKey({ dateStart, dateEnd }) {
  return `${dateStart || '?'}~${dateEnd || '?'}`;
}

/**
 * 返回 { issue, replaceIndex }：同一窗口已在归档里 → 复用它的期号并原地替换；
 * 全新窗口 → 取最大期号 +1（不是 length+1，那样删过一期就会串号）。
 */
function resolveWeeklyIssue(archive, win) {
  const list = Array.isArray(archive) ? archive : [];
  const key = weeklyWindowKey(win);
  const idx = list.findIndex((x) => weeklyWindowKey(x) === key);
  if (idx >= 0) return { issue: list[idx].issue || idx + 1, replaceIndex: idx };
  const maxIssue = list.reduce((m, x) => Math.max(m, Number(x.issue) || 0), 0);
  return { issue: maxIssue + 1, replaceIndex: -1 };
}

// H13：我的早报期号解析（与周刊 resolveWeeklyIssue 同语义，窗口=北京日）——
// 同一天重跑原地替换（期号不变，修码后重跑不另算新期）；新的一天 = max+1。
// 空态（no-subscription/no-content）不进归档、不占期号（那是状态不是期）。
function resolveMyBriefIssue(archive, dateStr) {
  const list = Array.isArray(archive) ? archive : [];
  const idx = list.findIndex((x) => x && x.date === dateStr);
  if (idx >= 0) return { issue: list[idx].issue || idx + 1, replaceIndex: idx };
  const maxIssue = list.reduce((m, x) => Math.max(m, Number(x && x.issue) || 0), 0);
  return { issue: maxIssue + 1, replaceIndex: -1 };
}

module.exports = {
  resolveMyBriefIssue,
  DAILY_AI_MAX_AGE_HOURS, WEEKLY_MIN_ITEMS, WEEKLY_MIN_STORYLINES, DAILY_MIN_SCORE,
  parseStats, isAiDailyReport, DAILY_SCHEMA_VERSION, ageHours, pickDailyReport, canPublishWeekly, passesDailyQualityGate,
  dailyMinScoreOf, applyDailyQualityGate, normalizeMinScore,
  weeklySpine, weeklyWindowKey, resolveWeeklyIssue,
  HISTORY_WINDOW_DAYS, HISTORY_MAX_ROWS, historySinceIso, DAILY_HISTORY_SQL,
};
