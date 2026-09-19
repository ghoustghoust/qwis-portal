# 37 · 报警与可观测体系 —— 总 Spec（链路层）

> **层级**：链路层｜**父**：无（后端根节点）｜**子**：37-1~37-7｜**UI 呈现归** `docs/specs/38-admin-ia-refactor/spec.md` 的 **38-B 后台首页** 与 **38-G 监控·报警台**（本文件不另立界面 spec）

> 状态：**待批准，未动工**（但 37-1 是 P0 止血，建议与它分开立即批准）。来源：用户 2026-09-19 批注 ⑲⑳ + 只读实测。
> 缺陷清单见 `docs/ISSUES.md` B44~B48、B47、BL7；与 `docs/specs/35-selfheal-admin-console/`（自愈 + 源健康度）互为前提。
> 最后更新：2026-09-19

## 背景：系统现在是"哑"的

实测三件事，任何一件都足以让"无人值守"变成"无人知晓"：

1. **报警链路自 09-17 起没有出口**（P0）：线上 `settings.alerts.channels` 只剩 `{id:'test-ch',name:'TEST',url:undefined,enabled:true}`，silence 里还有 `sourceId:777777`——这个 777777 **只存在于 `tests/regression-cloud-alerts.test.js:81-83`**。即回归测试直连生产 Turso 覆盖写坏了配置，`after()` 恢复未生效；`audit_log` 最近三条真实事件都是 `sent:0/total:1`。这是踩坑 #13/#T1「云端测试直打生产库」的又一次成真，且这次打死了链路。
2. **事件开关是假的**：云端 `settings.alerts.eventMeta` 实测为**空对象**，而前端渲染的 4 个事件名（`fuse/stall/queue/error`）在系统里根本不存在 → 勾选不生效、日志徽章显示原始 key。
3. **报警信息量不足以定位**：只有 7 类事件（`_alerts.js:40-44`），payload 是"人话标题 + 一句 120 字错误摘要"；`audit_log` 的 detail 只有 `{event,title,sent,total}`——**没有源 id、没有参数、没有堆栈、没有代码位置、没有建议动作、没有自愈状态**。`ai.stats` 里实测 261 条失败记录**没有任何端点暴露**。GH Actions 失败面**零集成**（全仓无 `actions/runs` 调用）。

用户诉求（批注⑳原文要点）：报警要覆盖 **GH Actions 触发/重构报错、AI 失效（没翻译/没摘要/没总结）、采集失效、源抓取失败、源熔断**，每条带**具体报错参数 + 解决方案 + 是哪里的代码**，并且**与系统自愈搭配使用**。

## 目标

- G1 报警链路恢复且**永不再被测试写坏**（配置隔离 + 写路径守卫）。
- G2 每条报警可定位到"哪个源/哪次运行/哪段代码/建议做什么/系统已自动做了什么"。
- G3 覆盖面从 7 类扩到"每个功能一条心跳"：采集、翻译、摘要、深析、早报、周刊、我的早报、AI 配额、渠道投递、CI。
- G4 CI（GitHub Actions）失败进入同一报警面，带 run/job 链接与日志摘要。
- G5 报警与自愈闭环：自愈动作产生事件、事件驱动自愈重试，二者共享同一份结构化记录。

## 板块拆分（每块各出 mew-spec 小 spec）

| 小 spec | 内容 | 类型 | 规模 |
|---|---|---|---|
| **37-1** | **P0 止血**：从本地恢复真渠道（`tools/sync-alerts-config.js --force`）；把 `regression-cloud-alerts.test.js` 改为隔离 settings 快照/还原并断言恢复；给 `PUT /api/settings/alerts` 加"测试指纹禁止写入"守卫 | 事故修复 | S，需授权写生产 |
| 37-2 | 事件模型统一：**事件表实际是两份代码 + 两份落库 + 两处前端/响应硬写**（键集互不相同，详见小 spec 现状表）；收成 `lib/alert-events.js`（拟建）一份 | 三端收敛 | M ⏸ 小 spec 已出：`37-2-alert-event-model-unify.md`。**根因比 §背景 #2 更硬**：`api/[...slug].js:1575-1577` 的 `eventMeta` 是**字面量硬写**、压根不读 `cfg.eventMeta` → 落不落库都看不到真值；另本地 settings 残留 `wemp_down/wemp_cookie_expired` 两个**代码里已删除**的幽灵键（B109） | <!-- doc-lint:ignore -->
| 37-3 | 结构化 payload + `alert_events` 表（现 `recentLog` 只 50 条、无源 id/参数/代码位置/建议/自愈状态） | 数据模型 | M ⏸ 小 spec 已出：`37-3-structured-alert-payload.md`（实测：`alert_events` 在两端 DDL 里**不存在**；线上 `recentLog=50` 条，最后一条 `2026-09-19T22:20:31` `frozen_digest` 186 源熔断 `ok:false fetch failed`） |
| 37-4 | 覆盖面扩展：翻译/摘要**缺失型**、周刊截断、我的早报降级、AI 配额、渠道投递失败 | 能力补齐 | L ⏸ 小 spec 已出：`37-4-coverage-heartbeats.md`（实测哑点清单：`/api/ai/stats` 全仓 0 命中；B17 的初筛截断每天都在发生但只进日志；BL7 型"报警发不出去"目前没有报警） |
| 37-5 | CI 可观测：`ci_failed` + **`scheduler_gap`（最近 24h 每种期望 mode 是否都出现过）** | 新对接 | M ⏸ 小 spec 已出：`37-5-ci-observability.md`（实测：全仓无 `actions/runs`/`GITHUB_TOKEN` 调用；216 条 scheduled run 无 20:13 那条 = B101，正是 `scheduler_gap` 该自动抓到的形态） |
| 37-6 | 报警台**数据契约**（过滤分页、静默加维度且必须带过期、自愈联动字段）；界面归 38-G | 前端/契约 | M ⏸ 小 spec 已出：`37-6-alerts-console-data.md` |
| 37-7 | 监控面板纠偏打包：①队列面板 B47 已修（`MonitorTab.jsx:51` 读 `queueStats.overall`）→ **保留还是下线待拍板**；②健康概览跳转**前置 B26 未解**；③B48 已完成；④新增"启用/全量源数"口径提示 | 小刺打包 + 三项待决策 | S ⏸ 小 spec 已出：`37-7-monitor-panel-fixes.md` |

## 边界

**不做**：不引入外部监控栈（Prometheus/Grafana/Sentry）；不做告警分级 oncall/排班；不自动执行任何"需授权"的修复动作（自愈只做重试与冷却，见 35A）；不删 `recentLog`（保持兼容一个周期）。
**依赖**：35A 的自愈事件流是本板块 37-3 `selfHealState` 字段的来源；37-1 不依赖任何 spec，可单独立即执行。

## 验收标准

- AC1（37-1）：线上 `settings.alerts.channels` 恢复为真渠道且 `url` 非空；跑一次 `POST /api/alerts/test` 收到飞书消息；`npm test` 全跑完后再次读取该键**仍为真渠道**（测试隔离生效）。
- AC2（37-2）：后台 4 个事件勾选框对应的事件名与 `lib/alert-events.js`（拟建）一致，勾选后重启读层仍生效（落库回读）。 <!-- doc-lint:ignore -->
- AC3（37-3）：任选一条 `source_paused` 事件，能在报警详情里看到源 id、URL、错误类别、上次成功距今、建议动作、系统是否已自动重试过（≥1 条真实样本，不是构造数据）。
- AC4（37-4）：人为制造一次"翻译批次全失败"与一次"周刊降级"，两者都在 15 分钟内产生事件并可查。
- AC5（37-5）：故意让 runner 一个 job 失败，`ci_failed` 事件带 run/job 链接与失败步骤名。
- AC6（37-7）：任务队列面板不再显示恒 0 数字；报警日志无 `\uff08` 字面串。
- AC7：以上场景全部纳入 spec 41 的端到端剧本（P2P 集合），并在白盒评测里加"事件表三端一致"常量断言。
