// 「今日/本周」这类时间窗的唯一口径（B90，2026-09-20）
// 为什么需要它：`new Date(); d.setHours(0,0,0,0)` 取的是**容器本地时区**的 0 点。
// 本地开发机是 Asia/Shanghai，Vercel 跑 UTC → 同一个 `/api/status` 在两端算出的「今日新增」
// 是两个不同的日子。线上同刻实测（09-19）：UTC 日 todayNew=3554，北京日 todayNew=9626。
// 全站的产品语义都是北京日（日报窗口本来就是"北京昨日 06:00 → 今日 06:00"），
// 所以「今日」的唯一口径是**北京 0 点**，不是容器 0 点，也不是让用户去配 TZ。
const BJ_OFFSET_MS = 8 * 3600e3;

// 北京今日 0 点，返回 UTC 毫秒（可直接和 created_at 的 ISO 比较）
function beijingDayStartMs(nowMs = Date.now()) {
  const bj = new Date(nowMs + BJ_OFFSET_MS);
  return Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate()) - BJ_OFFSET_MS;
}

const beijingDayStartIso = (nowMs = Date.now()) => new Date(beijingDayStartMs(nowMs)).toISOString();

// 把"此刻"表示成**北京墙上时钟**：返回的 Date 用 getUTC* 读出来的就是北京的年/月/日/时。
// 为什么不用 getHours()：那又是容器时区（B90 的根因）。全库只许这一处做 +8h 换算。
const beijingNow = (nowMs = Date.now()) => new Date(nowMs + BJ_OFFSET_MS);

// 北京日历日期串 `YYYY-MM-DD`（期号、早报日期用）。
// ⚠️ 它是"标签"不是"时刻"：拿它拼 `T00:00:00.000Z` 当查询边界就是 B96（见 ISSUES）——
// 那种地方要用 beijingDayStartIso。
const beijingDateStr = (nowMs = Date.now()) => beijingNow(nowMs).toISOString().slice(0, 10);

// 「近 7 天」是**滚动** 7 天（不含时区），刻意不做日界对齐：
// 阅读器统计轨的文案是"近 7 天更新"，改成对齐会把已经在用的数字换个口径，属另一件事。
const weekAgoIso = (nowMs = Date.now()) => new Date(nowMs - 7 * 86400e3).toISOString();

// 日报采集窗口：北京昨日 00:00 → 北京今日 06:00。
// 原来这段算术在 3 处各抄一遍（api/daily-generate.js、api/[...slug].js、tools/collect-turso.js），
// 每处都要手搓"+8h 后 setUTCHours(0,0,0,0) 再减回 8h"，写错一个符号就把窗口整体挪 8 小时。
function dailyReportWindowIso(nowMs = Date.now()) {
  const dayStart = beijingDayStartMs(nowMs);
  return {
    startIso: new Date(dayStart - 86400e3).toISOString(),
    endIso: new Date(dayStart + 6 * 3600e3).toISOString(),
  };
}

// 用户/前端传来的日历日期串（`YYYY-MM-DD`，按**北京日**理解）→ 该北京日的 UTC ISO 区间。
// 为什么不能直接拼 `${dateStr}T00:00:00.000Z`：那是把这个日历日当 UTC 日，整条筛选往后挪 8 小时
// —— 北京 00:00~08:00 发的文章被算进前一天（B99：阅读器日期筛选差 8 小时，两端 18 处同一写法）。
// endIso 取"闭区间上界"（次日 0 点 -1ms），这样 SQL 里 `<= ?` 的写法不用改。
function beijingDayRangeIso(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) throw new Error(`beijingDayRangeIso 要 YYYY-MM-DD，收到 ${JSON.stringify(dateStr)}`);
  const startMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - BJ_OFFSET_MS;
  return { startIso: new Date(startMs).toISOString(), endIso: new Date(startMs + 86400e3 - 1).toISOString() };
}

module.exports = {
  BJ_OFFSET_MS, beijingNow, beijingDateStr,
  beijingDayStartMs, beijingDayStartIso, beijingDayRangeIso, weekAgoIso, dailyReportWindowIso,
};
