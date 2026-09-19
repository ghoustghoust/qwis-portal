# 43 · 采集保留与删除语义安全（P0 排查后的决策包）

> 状态：**待批准，未动工**——本文件只落事实与判据，**没有任何代码改动，没有提交，没有 push**（用户 2026-09-19 指令：「不要 push，不要改，先把事实告诉我」）。
> 起因：用户指出「云端采集把 24 小时以前的文章删掉，而本地采集没有删除逻辑」。实测结论见 §1：**该描述与代码不符**，但顺着查出了三个真问题（§2）。
> 取证时间：2026-09-19T21:57Z ~ 22:12Z；探针全部只读（`SELECT` / better-sqlite3 `readonly:true`），留在 `%TEMP%/factcheck/read-only-audit*.cjs`，未进仓库。

## 一、先纠正前提（一手读数）

| 断言 | 实测 | 出处 |
|---|---|---|
| 「云端删 24h 前的文章」 | **不存在**。全仓 `DELETE FROM articles` 只有三处语义，窗口都是 **7 天**，且都带豁免 | `tools/collect-turso.js:687-710`、`api/collect.js:396-404`、`api/[...slug].js:2009-2015` |
| 「24 小时」在采集路径里的含义 | 全部是**读取窗口**：quickscore 取近 24h 未评分文章（`:585`）、日报滚动 24h 窗口（`:974/:987`）、事件兜底 SELECT（`api/[...slug].js:598`）；唯一的 24h 删除是 `job_queue` 历史任务（`server/services/queue/taskQueue.js:225`），不碰文章 | 同左 |
| 「本轮改动把删除逻辑推上线了」 | **没有**：`git rev-list --left-right --count origin/main...HEAD` = `0 0`（无在途提交）；`/api/meta` 实测 `commit=961fec04…` == `origin/main` == `HEAD`；本轮 09-17 以后碰 `tools/collect-turso.js` 的提交里，落在 `runCleanup/DELETE/hotCutoff/retentionDays` 的 hunk **计数 0**；`runCleanup` 段最近一次改动是 `9c4f21e`（2026-09-13） | git 实测 |
| 「线上数据被真删了」 | **没有**：生产 81.6k 文章，最早 `2001-01-01`；7 天前仍存 32,461 条（热榜 17,936 条）；`/api/status` 实测 `todayNew 667 / weekNew 30,879`。若真在删 24h 前的数据，`weekNew` 不可能比 `todayNew` 大 46 倍 | Turso 只读 / 线上端点 |

## 二、顺带查出的三个真问题

**N1（文档说谎，P1）**：`ARCHITECTURE.md:22`、`docs/CLOUD_PIPELINE_GUIDE.md:33`、`docs/RUNBOOK.md:98` 都写死「每天 04:13 清理」。实测**它没在跑**：
- `cleanup` job 唯一触发口是 `if: github.event.schedule == '13 20 * * *'`（`.github/workflows/collect.yml:246`），而主力触发器 cron-job.org 走 `workflow_dispatch`，其 `mode` 选项里**没有 cleanup**（`collect.yml:41-48`）→ dispatch 永远跑不到；
- 216 条 scheduled run 全量里**没有一条**落在 20:13 前后（只有延迟的 :07/:22/:37/:52 落点 20:08/20:43/20:52/20:59）；
- 生产心跳 `settings['cloud.collect']` 近 168 轮（`2026-09-18T22:51Z → 2026-09-19T22:06Z`）mode 分布 `{collect:102, translate:63, daily:1, daily-ai:2}`，**cleanup = 0**；
- 决定性一条：用 runner 那两条 DELETE 的**原样谓词**做 COUNT（`cutoff=2026-09-12T22:09Z`）→ **保留清理命中 8,616 + 热榜命中 2,117 = 10,733 条待删**。跑过一次这个数就该归零。
- 附：`published_at IS NULL` 有 47 行，谓词用 `published_at < ?` → 这些**永远删不掉**（B93 脏值族的删除面）。

**N2（真正的删数据弹药在本地那一份，P0 风险）**：`server/services/datamgr.js:12-17` 的 `CLEAN_TABLES` 含 `articles` 与 `videos`，`:90-103` 的 `cleanup()` **无任何豁免**；`server/services/scheduler/jobs/maintenance.js:9-13` 每 24h 调它（`retentionDays ?? 7`，下限 1），`server/services/scheduler/index.js:138-141` 是 `setInterval` → **本地服务一起满 24 小时就开火**。对本地 `data/app.db` 只读实测：一次会删 **37,593 / 40,775 文章（92%）+ 1,161 / 1,161 视频播客（全部）**。直接违反 2026-09-13 用户决策「视频/播客永不清理」，也是 AGENTS §1「采集语义三份必须同步」的缺口。此刻 3000 端口无响应（调度器没活着），所以还没发生。

**N3（回滚底牌：本地过期、云端压根没有内容备份，P0 前置）**：
- 本地 `data/backups/` 最新一份 **2026-09-06 20:13**（397MB），当前 `app.db` 703MB → 近 13 天无快照；
- 云端 `POST /api/backup`（`api/[...slug].js:1965-1972`）只导出 `sources`/`groups`/`settings` 三张**配置表**，`handleBackupRestore`（`:1984-1993`）也只 upsert 这三张表 —— **`articles`/`videos` 不在任何备份里**。
⇒ 保留清理一旦被点亮且删错，线上文章**没有任何可回路径**（上游 RSS 早已翻页，重采不回来）。这条改变风险排序：**先建内容级转储，再谈任何删除**。

**已经排除的一个假警报**：云端删除端点**有鉴权**——无 token POST `/api/data/cleanup/preview` 实测 `HTTP=401`；`requireAuth`（`api/[...slug].js:103-119`）在 `dispatch` 之前统一执行（`:2919`），写方法不在 `PUBLIC_GET_PATHS` 豁免里。所以不存在"公网可触发删库"的口子。

**我自己中途的一次误读（记此防复犯）**：曾把「7 天以前未读占比从 99% 掉到 2~5%」当成删除执行过的签名；按 `read_at` 拆列后不成立——09-02 那天的 2,650 条里 2,525 条已读、09-06 的 1,845 条里 1,793 条已读，是阅读器批量标记已读让老数据落进豁免集。**不要引用成结论。**

## 三、待你点头的四个决策点

| # | 决策 | 我的建议 |
|---|---|---|
| D1 | 本地 `CLEAN_TABLES` 与云端语义对齐的方向 | 把云端已批准的豁免搬下来（`read/later/featured` 不删 + `videos` `skip:true`），**不要**反过来放宽本地 |
| D2 | `cleanup` 触发口 | ✅ **前半已做（09-19 夜）**：三处文档（`ARCHITECTURE.md`、`CLOUD_PIPELINE_GUIDE.md`、`RUNBOOK.md`）已加注"当前未触发 + 用 `cloud.collect.history[].mode` 判真假"；`collect.yml` **未动**——是否恢复每日删除属 D4，不在本轮偷偷接上 |
| D3 | 动手前的安全动作 | **先补内容级转储**（本地一份新快照 + 一份 `articles`/`videos` 的可导出转储；云端现有 `/api/backup` 只存配置三表，覆盖不到内容，见 N3），再谈任何"执行删除"。在此之前的所有验证**只跑 preview/COUNT，不跑 DELETE** |
| D4 | 那 10,733 条待删（>7d 未读未标记）到底删不删 | 你的决策。我不替你选：现有注释写的是「用户决策 2026-09-13：默认 7 天」，但同一份决策说视频永不删，而本地实现两条都没照做 |

## 四、验收判据（批准后才写实现，改前必须先红）

1. **单实现**：删除谓词收进 `lib/retention.js`，三端（`server/`、`api/`、`tools/`）引用同一份 SQL 片段；白盒新增 **W17**——从 DDL/字面量派生"存在不止一份删除谓词"即红（按坑 #58/#59：判据派生自事实、排除自身、剥注释、只认字符串字面量）。
2. **回归锁（F2P，改前必红）**：造 4 行样本——已读 / 稍后读 / 精选 / 纯未读——断言本地 `cleanup()` 只删最后一行；再造 1 行 7 天前视频，断言删除数为 0。
3. **负向自证探针**：`tools/_probe-w17-selftest.cjs` 三种摘法（删豁免 / 把 videos 放回 CLEAN_TABLES / 只在注释里留"已豁免"）必须全红且点名。
4. **文档同步**：`ARCHITECTURE.md`、`CLOUD_PIPELINE_GUIDE.md`、`RUNBOOK.md`、`FEATURE_MATRIX.md` 四处「04:13 清理」按实测口径改；`ISSUES.md` 立 N1/N2/N3 三条；`npm run lint:docs` 零错。
5. **交付链**：本文件涉及的改动落地后，按 AGENTS §3 十一条逐条跑并如实标注「跑了/没跑」。

## 五、本文件明确没有做的

- **代码零改动**。文档侧：本文件、`docs/ISSUES.md`（B101~B112）、`FEATURE_MATRIX.md`、三处调度文档的更正，已于 2026-09-19 夜**本地提交 `530a5f4`，未 push**（用户指令仍是「不要 push」；提交只为防这些规格文件在并行会话里被误清）。工作区里我的代码改动仍只有 `api/[...slug].js` 两处读侧 `NULLIF(…,'null')`（:232、:1448）**未提交**，与未跟踪的 `lib/dirty-columns.js` 半成品。
- ✅ 已更正（本轮）：已 push 的文档写「W15 的污染列由 `lib/dirty-columns.js` 派生，附 5 种躲法自证探针」——实际 W15 仍是手写 `const POLLUTED = ['last_fetched_at']`，自证探针不存在。`FEATURE_MATRIX.md` 与 `ISSUES.md` 两处均已按实测改写成"未交付"。仍欠的实现（把 W15 真接上 DDL 派生 + 补躲法自证）在"不许改代码"令解除后再做。
- ✅ 已记为未验收（本轮）：`npm run eval:e2e` 的 10/10×3（`acceptance.ok=true`）**不覆盖数据保留面**——剧本只断言"页面有内容 / 接口到达 / 无 pageerror"，从不断言"老数据没被误删"。`FEATURE_MATRIX.md` 该行已把这一面显式列进「未覆盖」。
- ⛔ **同轮复跑新查出的第二处不实（B104）**：`npm run eval:whitebox` 在最终 HEAD 上复跑 **W9 红**——坑 #62/#63/#64 在 `tests/` 里没有任何 `#NN` 字面引用（判据面只扫 `tests/`，而三处实现/自证分别落在 `tools/eval-e2e.cjs`、`tools/_probe-strip-selftest.cjs` 与 `docs/EVAL_GUIDE.md`）。此前文档写"whitebox W1~W16 全过"是**照抄旧轮、未复跑**的结果，已更正。**不走 `whitebox-baseline.json` 豁免**：那是历史债账本，用来豁免当轮新造的缺口＝自我放行（坑 #45/#59 禁止的正是这个动作）。
