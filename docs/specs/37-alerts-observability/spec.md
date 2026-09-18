# 37 · 报警与可观测体系 —— 总 Spec

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
| 37-2 | 事件模型统一：三端事件表（本地多 `source_slow`）对齐为一份 `lib/alert-events.js`；`eventMeta` 落库并驱动 UI（前端不再硬编码） | 三端收敛 | M |
| 37-3 | 结构化 payload：`{event, sourceId?, runId?, mode, errKind, errParam, codeRef, suggestion, selfHealState}`；`audit_log` 换成独立 `alert_events` 表（50 条上限的 `recentLog` 只作缓存） | 数据模型 | M |
| 37-4 | 覆盖面扩展：翻译缺失/摘要缺失/深析失败/早报周刊我的早报降级/AI 配额与限速（读 `ai.stats`）/渠道投递失败，各出一个检测点 + 事件 | 能力补齐 | L |
| 37-5 | CI 可观测：runner 内用默认 `GITHUB_TOKEN` 抓本仓 `actions/runs`+jobs 摘要，发 `ci_failed`（含 job 名、run 链接、失败步骤、日志尾 200 行）；Vercel 侧只读展示 | 新对接 | M |
| 37-6 | 报警台 UI：时间线 + 按事件/源筛选 + 一键跳自愈记录 + 静默管理（当前 silence 只有 sourceId 维度） | 前端 | M |
| 37-7 | 监控面板纠偏：任务队列面板下线（B47 恒 0，真值在 `settings.cloud.collect` 与 workflow run）；健康概览改为后台首页可点击跳转（用户批注⑰）；`AlertsTab.jsx:591` JSX 转义字面串修复（B48） | 小刺打包 | S |

## 边界

**不做**：不引入外部监控栈（Prometheus/Grafana/Sentry）；不做告警分级 oncall/排班；不自动执行任何"需授权"的修复动作（自愈只做重试与冷却，见 35A）；不删 `recentLog`（保持兼容一个周期）。
**依赖**：35A 的自愈事件流是本板块 37-3 `selfHealState` 字段的来源；37-1 不依赖任何 spec，可单独立即执行。

## 验收标准

- AC1（37-1）：线上 `settings.alerts.channels` 恢复为真渠道且 `url` 非空；跑一次 `POST /api/alerts/test` 收到飞书消息；`npm test` 全跑完后再次读取该键**仍为真渠道**（测试隔离生效）。
- AC2（37-2）：后台 4 个事件勾选框对应的事件名与 `lib/alert-events.js` 一致，勾选后重启读层仍生效（落库回读）。
- AC3（37-3）：任选一条 `source_paused` 事件，能在报警详情里看到源 id、URL、错误类别、上次成功距今、建议动作、系统是否已自动重试过（≥1 条真实样本，不是构造数据）。
- AC4（37-4）：人为制造一次"翻译批次全失败"与一次"周刊降级"，两者都在 15 分钟内产生事件并可查。
- AC5（37-5）：故意让 runner 一个 job 失败，`ci_failed` 事件带 run/job 链接与失败步骤名。
- AC6（37-7）：任务队列面板不再显示恒 0 数字；报警日志无 `\uff08` 字面串。
- AC7：以上场景全部纳入 spec 41 的端到端剧本（P2P 集合），并在白盒评测里加"事件表三端一致"常量断言。
