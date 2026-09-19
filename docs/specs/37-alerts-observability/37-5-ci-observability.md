# 37-5 · CI（GitHub Actions）可观测接入 —— 小 Spec

> 总框架：`spec.md`（37，G4）。状态：**待批准，未动工**。
> 最后更新：2026-09-19（本轮实测复核）

## 现状（实测）

| 事实 | 证据 |
|---|---|
| 全仓**没有任何** Actions API 调用 | grep `actions/runs` / `GITHUB_TOKEN` → **0 命中**（`api/` `server/` `tools/` `lib/`） |
| 没有 push-CI：`npm test` / `lint:docs` 只在本地跑，AGENTS §3 交付链里"GitHub Actions 检查"这一环**当前无可查对象** | `FEATURE_MATRIX.md` §1.5 末行缺口注记；仓库只有 `collect.yml` |
| 本仓定时任务**大量被 GH 丢弃/延迟**已被实测证明：216 条 scheduled run 里没有一条落在清理 cron 的 20:13 前后；主力触发是 cron-job.org 的 `workflow_dispatch`（PAT 失效即静默停摆） | spec 43 §二 N1；`docs/CLOUD_PIPELINE_GUIDE.md` 不变量 9 |
| 也就是说：**"采集停摆"这类事故现在只能靠人打开 Actions 页面发现**，而这正是本项目历史上"云端停摆 2 天无人发现"的成因 | AGENTS §2 前言 |

## 目标

G4 CI 失败进入同一报警面（与 37-3 的 `alert_events` 同表），带 **job 名 / run 链接 / 失败步骤 / 日志尾部摘要**，并且能区分两类失败：
① 采集链路失败（product）；② **调度器根本没触发**（env/scheduler）——后者是今晚 B101 抓到的真实故障形态，必须能自动发现而不是靠人查 cron 表达式。

## 改动点（批准后才写）

1. **触发健康自检（不需新权限）**：runner 每轮把 `github.event_name` / `github.event.schedule` / run_id 写进 `settings.cloud.collect` 心跳（现在只写 mode/stats/历史）；再由一条每日判据说：**"最近 24h 内每种期望的 mode 是否都出现过"**。缺哪个 mode 就报 `scheduler_gap`。
   —— 这条能在**零 API 调用**的前提下抓到 B101 那类"job 被永久 skip"的事故。
2. `ci_failed` 事件：在 runner 的**尾部**（已有 `GITHUB_TOKEN` 默认权限，无需新 Secret）调用
   `GET /repos/{owner}/{repo}/actions/runs?per_page=5`，对**非本轮**的失败 run 发事件；限每个 run 只报一次（去重键 `run_id + job`）。
3. 日志摘要：只在失败时拉 `/repos/.../jobs/{job_id}/logs`，截尾 200 行 + 掩码（复用 `util/log.js` 脱敏与 `lib/alert-channels.js#maskEndpointUrl`）。
4. Vercel 侧**只读展示**（不新增写路径）：后台监控页加一节"CI 最近运行"，数据来自 settings 里 runner 写的投影，避免让 Vercel 函数去访问 GitHub API（超时预算不允许）。
5. 若同时决定补 `.github/workflows/ci.yml`（AGENTS 交付链那一步的可查对象）：ci job 的失败也走同一 `ci_failed` 事件，**不要**另立一套通知。

## 判据与验收

- AC1 `scheduler_gap` 的**当前状态就能验**：接入后第一次跑，必须报出"cleanup 从未触发"（即复现已知的 B101），这是一条天然的改前红/改后绿证据。
- AC2 故意让 runner 一个 job 失败（在隔离分支），`ci_failed` 带 job 名、run 链接、失败步骤名，且**同一 run 不重复报**。
- AC3 权限最小化：只读 Actions API；不许新建 PAT、不许往 Vercel env 加 GitHub 凭据（凭据三处同步义务的增量要算清楚）。
- AC4 日志摘要落库前必须过脱敏（PAT / Turso token / webhook token 一律掩码），并配一条锁：把 `GITHUB_TOKEN` 值塞进假日志，断言它不出现在事件载荷里。
- AC5 端到端：后台"CI 最近运行"节有真实数据（DOM↔响应对账）。

## 边界

- 不引入外部 CI/监控栈；不改现有 `collect.yml` 的 cron 结构（要不要恢复 cleanup 触发口属 spec 43 的 D2）。
- 不在 Vercel 读层调用 GitHub API（60s 预算 + 冷启动，历史上这类聚合就是 504 源）。
- 不自动重跑失败的 workflow（只报警；重跑属自愈决策）。
