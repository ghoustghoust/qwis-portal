# CI / 配额边界一览（09-24 17:16Z · 官方口径 + 本仓实测对账）

> 为什么要这张表（用户 09-24）：「我们只有从多个地方了解他们的边界才能找到我们这个系统的平衡」，
> 以及同一批问题里的「你需要测试 GitHub Action 的风控，如果推送过多会不会封号，合理的区间」。
> **每一行都标了出处**：官方文档原文（引用句）或本仓只读实测。没测的不写。

## 一、GitHub Actions 侧的硬边界

| 边界 | 官方值 | 我们的实际值 / 余量 | 出处 |
|---|---|---|---|
| 单 job 最长执行 | **6 小时** | `daily-ai*` 两个 job 的 `timeout-minutes: 330`（5.5h）⇒ **距硬顶只剩 30min**；job 内自限 `BUDGET_MS=300min` 才是真正会先碰到的（留 30min 收尾缓冲） | [Actions limits](https://docs.github.com/en/actions/reference/limits) "Each job in a workflow can run for up to 6 hours"；值写死在 `.github/workflows/collect.yml:111,136`（锁 F6 钉三者自洽） |
| 单次 workflow run 上限 | 35 天 | 用不到（最长 run ≈6h） | 同上 |
| Free 档并发 job | **20** | 峰值同刻 ≈2（collect + translate 串行在一个 job 内，AI 批独立）⇒ 2 个数量级余量 | 同上 "Total concurrent jobs 20" |
| 触发事件速率 | **1500 events / 10s / 仓库** | cron-job.org 每 15min 一次 `workflow_dispatch` = **96 次/日**；我这一轮 push ≈每分钟 1 次峰值 ⇒ 距 150 倍余量。**"推太多会不会封号"的答案：这个量级根本不接近任何门槛** | 同上 "Workflow trigger event rate limit 1500 events / 10 seconds / repository" |
| schedule 最小间隔 | 5 分钟 | 我们的 collect 线是 15 分钟（4 条错峰 :07/:22/:37/:52） | [events-that-trigger-workflows](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows) "The shortest interval you can run scheduled workflows is once every 5 minutes." |
| 公开仓无活动 60 天 | schedule 自动停用 | 不适用（每天必有 push）；**但这条是"云端停摆 2 天没人发现"那类事故的潜在叠加项**，登记备查 | 同上 "scheduled workflows are automatically disabled when no repository activity has occurred in 60 days" |

## 二、真正咬到我们的那条：schedule 会**延迟**，且错过的点位会**合并成一次投递**

官方原文只有两句，但它们正好是 H27 的机制解释：

> "The `schedule` event can be delayed during periods of high loads of GitHub Actions workflow runs."
> "To decrease the chance of delay, schedule your workflow to run at a different time of the hour."

配合本仓两条实测（H27-补）：

- 期望 ≈100 次/日的 schedule 事件，实际 `event=schedule` 的 run **只有 11~13 次/日（≈12%）**；
- `run 35964359306`：**06:24:47Z 到达的 schedule 事件，`github.event.schedule` 挂的是 `'33 1 * * *'`（凌晨 01:33 那条）** ⇒ 那一轮只跑了 `snapshot`，其余 7 个 job 全 skipped；
- 对照组 `run 35963578415`（06:14:52Z）归属正确（:07 线迟到约 7 分钟）。

⇒ **机制**：一个文件里挂 7 条 cron 时，延迟/合并后的**一次投递只携带一条串**，而我们每个 job 的门是"串等值"——
所以"每日一根的批"（daily-ai-evening / daily-ai / cleanup / daily-report / snapshot / weekly）
要么这一次不是它的串（全体 skipped），要么整条投递没来。**门开对 ≠ 时刻开对**。
这也说明官方那句"换个分钟数能降低延迟概率"救不了我们：**问题不是我们选的时刻挤，是一次投递只能兑现一条线**。

## 三、Turso 侧边界（详见 `docs/eval/2026-09-24-turso-read-amp.md`）

| 维度 | 官方值（免费档） | 实测与本仓关系 |
|---|---|---|
| rows read / 月 | 5 亿 | 现役一次全扫 = 35,446 行读 ⇒ ≈14,100 次全扫/月；三个 UI 入口在付这个价 |
| rows written / 月 | 1,000 万 | 日增 ≈11k 行（×30 ≈ 33 万）⇒ 远不到；**但每行正文平均 16 KB 才是瓶颈所在的另一维** |
| storage | 5 GB | 逻辑文件 1.1 GB（含 453 MB 空闲页）、控制台显示 170 MB（压缩帧）；日增正文 ≈100 MB |
| 超限行为 | 任一维度越限都 `BLOCKED` | 09-20 事故文案 `SQL read operations are forbidden`；**⚠️ 因此"哪一维先超限"不可推断**，且本仓无平台 token ⇒ 配额不可程序化观测（B119 ④） |

## 四、AI 调用侧边界（本会话测得）

- 一夜深析 + 初筛 ≈ **337~500 次调用**；初筛实测 **8.0~11.8 s/篇**、深析 **12.6~18.6 s/篇** ⇒ 按上一轮预算重排取的"峰值日 3,381 篇"算最坏串形 ≈199min（该读数的出处与推导见 `docs/changes/2026-09-23-rss-pipeline-discussion-handoff.md` 09-24 13:00Z 段；本轮没有重测峰值日，只重测了近 24h = 10,916 行落库），`BUDGET_MS=300min` 有缓冲、夜窗 540min 更有。
- 节流 `ai.minIntervalMs` 缺省 4000ms —— **云端改不动**（`ai` 段 env-only，零写点，H28）⇒ "压 gap 换时间"目前不是可用选项。
- 三臂统计层的安全工作点（`eval-prescreen-behavior`）：误砍 ≤3% ⇒ 最多砍 10%；砍 50% 会连带干掉你读过的 26~28%。

## 五、这张表给出的"平衡点"读法（不改代码，只说结论）

1. **别再加 cron 线到同一个文件里**：每加一条，就把其余线的兑现概率再稀释一次（§二机制）。要新增批，**开新文件**（一文件一线）。
2. **每日一根的批不该指望 schedule**：改挂 `workflow_dispatch`（实测 6 天 96 次/日全 success）+ 库内幂等 claim，比调 cron 表达式有用（H27 待拍板 b）。
3. **删除闸的 48h TTL 与 7 天保留钟不可再靠人工续**（H29）：这条决定了"表有多大"，而表大小直接决定"一次全扫多少行" ⇒ 它是 §三 rows-read 的上游。
4. **体积优先序**：正文自压（实测 5.90×）> 放行清理（235 MB）> 截断（13.6%）> 砍腹泻源（1.6%）。
5. **job 超时 330min 已贴近 6h 硬顶**：以后要抬 `BUDGET_MS` 必须同时知道自己没多少余量可抬了（锁 F6 会挡）。

## 六、未测 / 不许被当成已测

- 未测：GitHub **secondary rate limit** 的具体触发阈值（官方只说会限，未给数字）——但我们的调用频率与它差两个数量级，本轮不为它做危险实验（不拿账号去撞风控）。
- 未测：Actions 队列在高负载下"合并错过点位"的官方规则细节（文档只说会 delay；我们的读数是间接证据）。
- 未测：VACUUM 在 Turso/libsql HTTP 面能否跑、耗时多少。
- 未测：FTS5 在 Turso 上是否可用（搜索改造的前置）。
