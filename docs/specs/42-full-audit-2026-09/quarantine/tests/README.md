# `tests/` — 回归锁与单元测试

44 个 `*.test.js` + `fixtures/`（2 件）。跑法 `npm test`（`node --test --test-concurrency=1`）。命名约定 `regression-<YYYYMMDD><字母>.test.js`，对应 `docs/ISSUES.md` 的 B 编号批次；每个线上修过的 bug 都必须在这里有一把锁（AGENTS.md §3）。

## ⚠️ 先读这条：本目录会连生产库

`regression-cloud-alerts.test.js:7-11` **自己读根 `.env`** 注入 `TURSO_DATABASE_URL`，第 17 行建真 Turso 客户端，用例 4/6/7 执行 `INSERT OR REPLACE INTO settings('alerts.cooldowns', …)`。

它靠"污染守卫"兜住（`needsCleanProd`，第 62 行）：生产渠道 id 以 `test-` 开头、或 url 是回环地址 → 判污染 → 这 3 个用例 `skip`。**当前生产恰好就是 `test-ch` / `127.0.0.1:1`（BL7），所以每次 `npm test` 它们都在 skip。**

推论（spec 42 AU-12）：**一旦 BL7 被修好、换成真 webhook，`npm test` 就变成一条每次运行都写生产 `settings.alerts.cooldowns` 的通道。** 同族事故已经发生过：B44（回归测试把生产报警渠道写坏，链路哑了两天）、坑 #13（云端测试直打生产库）、坑 #52（测试留下的最坏形态是悬空引用）。

SQLite 侧是干净的：`helpers.js` 用 `APP_DATA_DIR` 把库指到临时目录，**凡引用 `server/*` 的测试文件必须先 require 它**，否则会污染 `data/app.db`。

## 索引（按主题分组）

| 主题 | 文件 |
|---|---|
| 采集与源 | `aihot-parse.test.js` `hotlist.test.js` `regression-bilibili.test.js` `regression-wemp-retire.test.js` `regression-cloud-sources.test.js` `regression-sourcelib.test.js` `source-axes.test.js` |
| 熔断与批量恢复 | `regression-bc.test.js`（A9/A10/B15/B18 锚点已于 09-19 重锚到根树真文件） |
| 正文与清洗 | `rss-content-encoded.test.js` `md-inline.test.js` `columns.test.js` `matchers.test.js` |
| 阅读与筛选 | `regression-views-filter.test.js` `events.test.js` |
| 日报 / 早报 / 周刊 | `regression-daily-ai.test.js` `regression-my-brief.test.js` `regression-weekly.test.js` `regression-brief-guards.test.js` `daily-dedup.test.js` `datamgr.test.js` |
| AI 能力 | `regression-ai-infra.test.js` `regression-translate.test.js` `classify.test.js` |
| 报警与可观测 | `alerts.test.js` `regression-cloud-alerts.test.js`（⚠ 见上） |
| 云端配置 | `regression-cloud-settings.test.js` |
| 任务队列 | `queue.test.js` `task-queue.test.js` |
| 数据与界面 | `regression-ui-data.test.js` |
| 期次回归（09-05 → 09-19） | `regression-20260905.test.js` `regression-20260905b.test.js` `regression-20260913.test.js` `regression-20260913b.test.js` `regression-20260918.test.js` `regression-20260919b.test.js` `regression-20260919c.test.js` `regression-20260919d.test.js` `regression-20260919e.test.js` `regression-20260919f.test.js` `regression-20260919g.test.js` `regression-20260919h.test.js` |
| 历史 phase 与 A 类 | `regression-aclass.test.js` `regression-phase6.test.js` `regression-phase9.test.js` |
| spec 42 审计轮 | `regression-audit42-portal-channel.test.js`（门户同步通道不得默认注册） |
| 夹具 | `fixtures/` |

## 已知不稳定

`regression-my-brief.test.js` 的「3. 有订阅但无报告 → no-content」在**全量顺序下偶发红、单跑 4/4 绿**（AU-08）。遇到先按 flaky 处理，别当成自己改坏了；根因未查。

**不放什么**：需要无头浏览器或打线上端点的端到端（在 `tools/eval-e2e.cjs`，那是独立验收层级）；任何写生产库的用例——先改成本地文件库并加显式守卫，别指望"恢复现场"。

**状态**：active
