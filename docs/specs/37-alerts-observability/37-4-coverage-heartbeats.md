# 37-4 · 覆盖面扩展："每个功能一条心跳" —— 小 Spec

> 总框架：`spec.md`（37，G3）。状态：**待批准，未动工**。用户诉求（批注⑳）：报警要覆盖 采集失效 / 源抓取失败 / 源熔断 / AI 失效（没翻译·没摘要·没总结）/ GH Actions 触发与重构报错，每条带参数·代码位置·建议动作。
> 最后更新：2026-09-19（本轮实测复核）

## 现状（实测：哪些功能现在是哑的）

| 功能 | 现在有没有检测点 | 证据 |
|---|---|---|
| 源抓取失败 / 熔断 | ✅ 有（`source_error` / `source_paused`，`api/_alerts.js:234`） | 读码 |
| 采集停滞 | ✅ 有（`collect_stalled`，`:258`），但**受 B14 影响的分支曾整段被 ReferenceError 跳过**（已修，待跑批验证） | ISSUES B14 |
| 日报生成失败 | ✅ 有（`daily_failed`） | 读码 |
| 熔断待办汇总 | ✅ 有（`frozen_digest`）；线上实读最后一条即 `frozen_digest`「186 个源」 | `settings.alerts.recentLog` |
| **翻译批次失败** | ◐ 部分：`ai_failed` 只覆盖深析/摘要批次失败；**"该翻的没翻"（缺失）无人报** | `api/_alerts.js:40-44` 无 translate 事件 |
| **摘要/导读缺失** | ✗ 无 | grep 无相关检测点 |
| **周刊降级**（初筛预算截断、只策展了前缀） | ✗ 无（B17 实测：`runWeekly` 初筛窗只有 24 分钟，候选要 2.2 小时 → **每天都在截断，但只在日志里**） | ISSUES B16/B17 |
| **我的早报降级/空态** | ✗ 无独立事件（`mybrief` 事件名存在但只是推送开关） | `api/_alerts.js:44` |
| **AI 配额与限速** | ✗ **`ai.stats` 里实测 261 条失败记录没有任何端点暴露**（全仓 grep `/api/ai/stats` → 0 命中） | 本轮 grep 实测 |
| **渠道投递失败本身** | ◐ 有记录（`recentLog.results[].ok=false`）但**没有"报警发不出去"这个报警**——BL7 停摆 2 天无人知就是这么来的 | 读码 + BL7 |
| **CI（GitHub Actions）失败** | ✗ 零集成（全仓无 `actions/runs` / `GITHUB_TOKEN` 调用） | 本轮 grep 实测 |

## 目标

G3 每个功能一条心跳：**产出得报，缺失也要得报**。现有事件只报"我尝试了且失败"，缺"我该产出却没产出"这一整类（这才是用户看到的"今天没翻译/没摘要/周刊没更新"）。

## 检测点清单（批准后才写实现）

| 事件（拟） | 判据（缺失型） | 建议动作字段来源 |
|---|---|---|
| `translate_missing` | 近 24h 自有源外语文章 > N 条，但 `translated_title` 覆盖率为 0 | 配额 / 模型 / 保护窗让路 |
| `summary_missing` | 近 24h 入库文章 `summary` 空率 > 阈值 | 采集正文过薄 vs AI 未跑，两种归因分开 |
| `weekly_truncated` | `runWeekly` 记过"初筛预算截断"（B17 每天都在发生） | 直接给"提配额/改批量初筛"三选项 |
| `mybrief_degraded` | 早报三态里落到 `no-content` 或无 AI 增强版 | 与 B76 的三态契约对齐 |
| `ai_quota` | `ai.stats` 失败率/限速命中超阈值（**前提是 39-4 先把 `/api/ai/stats` 建出来**） | 与 BL8 `minIntervalMs` 联动 |
| `delivery_failed` | 连续 N 次所有渠道 `ok:false`（BL7 的常驻哨兵） | 指向 `tools/sync-alerts-config.js` |

## 判据与验收

- AC1 每个新事件都要有**一条人为制造的负样本**在 15 分钟内产生可查事件（AC4 of 37 总 spec）：翻译批次全失败、周刊截断、渠道全跪三种至少各验一次。
- AC2 缺失型判据必须**先证明真值来源存在**：例如 `translate_missing` 的分母要来自与阅读器同一个 `lib/reading-filters.js`/`lib/ai-relevance.js` 口径，不许在检测点里再手写一份"什么算该翻的"（同 B107 的病根）。
- AC3 `delivery_failed` 的判据必须复用 `lib/alert-channels.js#deliveryState`（dispatched ≠ delivered 那套），不许新写一份"看起来发出去了"的判定。
- AC4 回归锁 + F2P 同批（B106 构造规则）；端到端把"缺失型事件在后台可见"列入 P2P 集合。

## 边界

- 不做自动重试（自愈归 35A）；不做分级 oncall。
- 阈值全部走 settings，**每个阈值都要有默认值 + 下限保护**（防误配把报警打成噪音或永远沉默，同 `retentionDays` 下限 1 的既有做法）。
- 与 39-4（AI 运行台）互为依赖：`ai.stats` 的读取端点先有，`ai_quota` 才不是自嗨判据。
