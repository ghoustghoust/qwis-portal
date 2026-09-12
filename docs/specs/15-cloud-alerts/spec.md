# 云端报警引擎（15-cloud-alerts）Spec

## 背景

云端（Vercel + GH runner + Turso）目前没有报警触发引擎：采集停滞、源熔断、日报失败、AI 失败都不会通知，本次"GH Actions 全灭 2 天无人发现"事故的直接教训。本地有成熟报警引擎（7 渠道 + 冷却 + 静默 + 脱敏），但依赖本地开机。

2026-09-11 实证的三类报警质量问题（用户亲历）：YouTube 反爬假 404 被当真死误报熔断；熔断后永久沉默；文案只有"HTTP 404"不可诊断。

需求澄清结论：**无开放问题**——渠道/冷却/静默语义直接镜像本地；渠道配置从本地 settings 一次性同步到 Turso 作为初始值（部署任务的一部分）。

## 目标

- 云端独立完成「检测 → 报警 → 渠道推送」闭环，不依赖本地开机
- 报警可诊断（原因分类 + 处置建议）、不误报（反爬区分）、不沉默（熔断待办汇总）

## 功能需求

- **F1**：云端报警分发引擎（`api/_alerts.js`）：7 渠道发送器（钉钉/企微/飞书/Server酱/Bark/TG/自定义 webhook）+ 事件开关 + 同源同事件冷却（120min 默认，存 Turso settings）+ 静默规则 + 渠道密钥脱敏 + 触发日志（recentLog ≤50）
- **F2**：云端报警配置写端点：`PUT /api/alerts/config`（含掩码合并语义——掩码/空值保留旧密钥）、`POST /api/alerts/test`（向启用渠道发测试消息）、`POST /api/alerts/clear-cooldowns`
- **F3**：runner 检测点（collect-turso.js 每轮尾部）：本轮失败源 fail_count≥2 → source_error；本轮新熔断 → source_paused；过去 1h 无成功采集 → collect_stalled；日报生成失败 → daily_failed；翻译批次失败 → ai_failed（新事件类型）
- **F4**：报警文案可诊断：错误分类（反爬封锁 / HTTP 错误 / 超时 / DNS / 解析失败）+ 处置建议（如"YouTube 反爬掷骰，下轮自动重试，无需处理"）；同步修本地 alerts.js 的 sourceError 文案（同一份分类逻辑）
- **F5**：熔断不沉默：每日清理任务（北京 04:13）附带「当前熔断待处理源清单」汇总推送（frozen_digest 事件，仅当存在熔断源时发）
- **F6**：一次性迁移：本地 settings.alerts（渠道配置）同步到 Turso 作为云端初始配置

## 非功能需求

- N1：runner 环境无 10s 限制，渠道发送串行即可；单渠道失败不影响其它渠道
- N2：冷却/日志写 Turso settings（`alerts.cooldowns` / settings.alerts.recentLog），与本地同键位（语义一致）
- N3：报警发送失败本身绝不导致采集任务失败（try/catch 隔离）
- N4：双端一致——同一渠道配置在两端发出格式一致的消息

## 不做的事

- 不做本地调度器报警触发点的改动（本地已有）
- 不做报警规则自定义编辑器（沿用现有事件开关）
- 不移植 source_slow（耗时报警，云端 runner 无意义）
- Vercel 函数内不挂实时检测（报警检测全部在 runner 批次尾部）

## 验收标准

- AC1：云端配置渠道后 `POST /api/alerts/test` → 真实渠道收到测试消息
- AC2：人为制造停滞（或直接调检测函数）→ collect_stalled 报警按预期发出/被冷却抑制
- AC3：runner 采集轮中某源连续失败 → source_error 报警文案含原因分类与处置建议
- AC4：同一源同事件 120min 内第二次触发 → 被冷却抑制（日志可见 skipped:cooldown）
- AC5：存在熔断源时，清理任务后收到 frozen_digest 汇总；无熔断源时不发
- AC6：渠道密钥经 GET /api/alerts/config 读取时为掩码；PUT 回写掩码不覆盖真实密钥
- AC7：渠道全部不可达时采集任务正常完成（报警失败隔离）
- AC8：回归测试全绿
