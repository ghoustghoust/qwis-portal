# 40-1 · 生成历史纠偏与投影 —— 小 Spec（本轮复核：读层与前端分档已交付，残余两条）

> 总框架：`spec.md`（40，G1/G3）。状态：✅ **主体已交付**，残余见文末。
> 最后更新：2026-09-19（复核轮：读层代码 + 线上存储 + 前端消费三处都实测）

## 复核：原 40-1 清单逐条对现状

| 原计划 | 现在 | 证据 |
|---|---|---|
| 「`ORDER BY id DESC LIMIT 7` 冒充 7 天窗，20 行永久不可见」 | ✅ 已修（B39 那批）：读层走 `briefGuards.DAILY_HISTORY_SQL` + `historySinceIso()`，响应带 `windowDays` | `api/[...slug].js:1716-1726` |
| 不投影 `schemaVersion`/档位 | ✅ 已投影：`aiEnhanced` + `tier: 'ai'\|'keyword'\|'degraded'`，另有 `windowHours/totalItems/elapsedMin/degraded` | 同左 `:1717-1725` |
| 「类型列硬编码『每日早报』」→ 裸版显示绿色"正常" | ✅ 已修：前端按 `r.tier` 分三档文案 | `web/src/components/BriefCenterTab.jsx:91`（`每日早报 · AI 增强 / · 降级 / · 裸关键词版`） |
| 周刊与我的早报不进同一时间线 | ✅ 已并：一个响应里含 `daily / weekly / mybrief / digest / profile / domainQuotas` | `api/[...slug].js:1727-1741` |
| 「阅读足迹永不出现（云端没有 `reading.digest`）」 | ✅ **已不成立**：线上实读 `reading.digest` = **558 字节**（B14 补齐 `qOne` 后 runner 开始产出） | 本轮只读实测 |

**线上真实数字（本轮重算，替换 总 spec 里不可复现的旧数）**：`daily_reports` 总 **98 行**（旧记 93），近 7 天 **32 行**（旧记 27）；近 14 天按 `schemaVersion` 分档 = **无版本 48 / v2 19 / "1" 1** → 裸关键词版仍是多数。

## 残余两件事（这才是要做的）

1. **档位字段类型混杂**：同一字段 `json_extract(stats,'$.schemaVersion')` 实测出现 `(无)`、数字 `2`、字符串 `"1"` 三种形态 → "哪一版"只能靠 `isAiDailyReport()` 兜（已存在），但**落库侧仍按各自的写法**：要在 `lib/brief-guards.js` 定一份"写日报时 schemaVersion 必须是整数常量"的构造函数，三处写入器共用（与 W14 同一批钉）。
2. **归档列表仍是"全量解析换摘要"**：`handleBriefHistory` 每次都把 `weekly.archive`（107,918 字节）整块解析并 `map`，虽然 `map` 后只留 6 字段 → 属 40-2 的范围，本条只登记依赖关系。

## 判据（防复发型）

- 历史窗口必须是**时间条件**而非行数：配一条锁，塞 8 条"窗口外"的行进去，断言响应条数不变（旧版会直接少显示）。
- 三档显示必须由 `tier` 驱动：断言"裸版行不许出现『正常/绿色』样式"，并把这条做成 DOM 断言（端到端 E 组剧本）。
