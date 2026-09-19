// 浏览器侧的「北京日历日」——lib/time-window.js 的 ESM 对端（B99，2026-09-20）
// 为什么单独成文件、而且是 .mjs：
//   1. 前端不能 require CJS 的 lib/time-window.js，但筛选参数（from/to）是浏览器算出来的，
//      它必须和服务端**同一个日历**——否则北京 08:00 前"今天"这个 chip 传的是昨天的日子；
//   2. 命名成 .mjs 后，回归测试可以直接 `import()` 它，与 lib 那份**逐时刻比对行为**
//      （不是比对字符串），两份实现一旦漂移测试就红。
// 服务端日期边界一律走 lib/time-window.js 的 beijingDayRangeIso，不在这里做。
const BJ_OFFSET_MS = 8 * 3600e3;

const pad2 = (n) => String(n).padStart(2, '0');

// 把某个时刻"看成的北京墙上时间"（用 getUTC* 读出的就是北京的年月日）
export function beijingNow(nowMs = Date.now()) {
  return new Date(nowMs + BJ_OFFSET_MS);
}

// 北京日历日 `YYYY-MM-DD`（发给自己算 from/to 用）
export function beijingDateStr(nowMs = Date.now()) {
  const d = beijingNow(nowMs);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// 北京本周一 `YYYY-MM-DD`（"本周"预设的 from）
export function beijingWeekStartStr(nowMs = Date.now()) {
  const d = beijingNow(nowMs);
  const wd = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // 周一=1 … 周日=7
  return beijingDateStr(nowMs - (wd - 1) * 86400e3);
}

// 北京本月一日 `YYYY-MM-DD`（"本月"预设的 from）
export function beijingMonthStartStr(nowMs = Date.now()) {
  const d = beijingNow(nowMs);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-01`;
}
