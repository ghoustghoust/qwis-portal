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

- **代码零改动**。文档侧：本文件、`docs/ISSUES.md`（本域相关登记从 B101 起，最新编号见该文件顶部"活跃 B8~B1xx"一行——**不在这里复制条数**）、`FEATURE_MATRIX.md`、三处调度文档的更正，均为本地提交、**未 push**（用户指令仍是「不要 push」；提交只为防这些规格文件在并行会话里被误清）。**未 push 提交以 `git log --oneline origin/main..HEAD` 为准**（本文件与 `docs/ISSUES.md` 放行表第 11 行都不复制编号——易变事实只写取法，AGENTS §2.5）。工作区里我的代码改动仍只有 `api/[...slug].js` 两处读侧 `NULLIF(…,'null')`（:232、:1448）**未提交**，与未跟踪的 `lib/dirty-columns.js` 半成品。
- ✅ 已更正（本轮）：已 push 的文档写「W15 的污染列由 `lib/dirty-columns.js` 派生，附 5 种躲法自证探针」——实际 W15 仍是手写 `const POLLUTED = ['last_fetched_at']`，自证探针不存在。`FEATURE_MATRIX.md` 与 `ISSUES.md` 两处均已按实测改写成"未交付"。仍欠的实现（把 W15 真接上 DDL 派生 + 补躲法自证）在"不许改代码"令解除后再做。
- ✅ 已记为未验收（本轮）：`npm run eval:e2e` 的 10/10×3（`acceptance.ok=true`）**不覆盖数据保留面**——剧本只断言"页面有内容 / 接口到达 / 无 pageerror"，从不断言"老数据没被误删"。`FEATURE_MATRIX.md` 该行已把这一面显式列进「未覆盖」。**同轮补判据**：`docs/specs/41-e2e-whitebox-eval/coverage-matrix-20260919.md` 手工核对 39 个功能格 → ✅3 / ◐8 / ⛔28，并查明 `tools/eval-e2e.cjs:1023` 的 `KNOWN_GAPS` 实测是 `{}`、`uncoveredKinds` 只统计剧本内断言类别，**两者都不是覆盖分母**，此前把 `knownGaps=[]` 读成"没有缺口"是误读。
- ⛔ **同轮复跑新查出的第二处不实（B104）**：`npm run eval:whitebox` 在最终 HEAD 上复跑 **W9 红**——坑 #62/#63/#64 在 `tests/` 里没有任何 `#NN` 字面引用（判据面只扫 `tests/`，而三处实现/自证分别落在 `tools/eval-e2e.cjs`、`tools/_probe-strip-selftest.cjs` 与 `docs/EVAL_GUIDE.md`）。此前文档写"whitebox W1~W16 全过"是**照抄旧轮、未复跑**的结果，已更正。**不走 `whitebox-baseline.json` 豁免**：那是历史债账本，用来豁免当轮新造的缺口＝自我放行（坑 #45/#59 禁止的正是这个动作）。

## 六、测试侧写入面全量清点（09-20 凌晨，回答「线上数据到底有没有被测试删过」）

**背景**：用户叫停令的第 4 问是"这些改动有没有把删除逻辑推到线上执行过"。本轮先把**测试套件**这一侧
一次性查清（静态清点 49 份 `tests/*.test.js`，逐份看四件事：require 了哪份 db 实现、有没有把
`TURSO_DATABASE_URL` 指到 `file:` 临时库、有没有 `APP_DATA_DIR` 隔离、出现了什么写语义）。
清点脚本：`tools/_test-write-exposure.cjs`（一次性、未跟踪；正式版应并入 41 域门禁，见放行表 #12）。
**判据与人工复核的分工要写清**：脚本按"碰云端层却没指 `file:` 临时库"标出 **5 份**，人工逐份读代码后排除了 2 份——
`regression-daily-ai`（只 `require('../api/_ai')`，那是 AI 客户端、不碰 db）与 `regression-bc`（第 9 行
`require('./helpers')` 已把 `APP_DATA_DIR` 指到临时目录，它的 `INSERT INTO sources` 落临时库）。
**剩 3 份**真绑在生产 Turso 上，即下表。**光看脚本会多报 2 份、光靠 grep 关键字会漏报隔离方式**——
将来若把它做成门禁，判据必须是"require 了 `api/[...slug].js` 且既无 `TURSO_DATABASE_URL='file:'`、
也无 `require('./helpers')`"两个条件同时成立。

### 结论：**没有任何测试写过或删过生产数据**，但"B83 已全部搬完"这句说满了

| 判据 | 结果 |
|---|---|
| 生产 Turso 被测试**执行写 SQL** | **0 处** |
| 生产 `settings` 被测试**写回** | **0 处**（BL7 那次是**历史事故**，肇事测试 `regression-cloud-alerts` 现已改指 `file:` 临时库并自带隔离断言） |
| 仍绑在生产 Turso 上的测试 | **3 份**（下表）——`regression-20260913` / `20260913b` / `20260918` |

### 三份"仍在生产上跑"的逐份判定（为什么仍然安全，以及哪里是隐患）

| 测试 | 对生产做了什么 | 为什么没造成写 | 残留隐患 |
|---|---|---|---|
| `regression-20260913` | `require('../api/[...slug].js')` 且把 `.env` 读进 `process.env` → **真连生产 Turso**；但 `mockReq` 只造 `method:'GET'` | 全 GET，读路径 | 无（读生产是可接受的取证方式） |
| 同上，F2 段 | `db.prepare('DELETE FROM articles WHERE url IN (?,?)')` | `server/db.js` 是 `better-sqlite3`，**不读 `TURSO_*`**；且第 10 行 `require('./helpers')` 早于第 83 行 require db → 落 `os.tmpdir()` 临时库，删的是它自己刚插的两条 `test-clamp-*` 夹具 | 无（本轮已复核，见 `docs/ISSUES.md` B115 的假警报段） |
| `regression-20260913b` | `GET /api/reading` 若干 + **`POST /api/data/cleanup/preview {days:7}`** | `handleDataCleanupPreview` 实测只做 `SELECT COUNT(*)` 与 `cleanupArticles(cutoff,{preview:true})`，函数体内 **0 个 `DELETE FROM` / 0 个 `setSetting`**；且未带 token 时该端点回 401 | "预览"端点用 POST 且真打生产，语义上仍是**写方法的形状**——将来有人把 preview/execute 合并就会变成真删 |
| `regression-20260918` | **`DELETE /api/weekly/archive/999999`，带 `.env` 里的真 Bearer token** | `handleWeeklyArchiveDelete` 的顺序是：读 `weekly.archive` → `filter` → **`next.length === archive.length` 即先 return 404「第 999999 期不存在」**，`setSetting` 在其后，所以未写 | ⚠️ **这是本轮查到的真实隐患**：测试的安全性完全押在"999999 这个期号不存在"这一个夹具选择上，而不是押在隔离上。它测的又只是"路由可达"（断言 = 不是通用 `Not Found` + 状态 404），**一个打生产的 DELETE 换到的只是可达性信息** |

### 因此本域追加一条待办（登记为 B117，属代码改动等放行）

1. `regression-20260918` 的"路由可达"改成**不需要打生产**的形态：在 `file:` 临时库里种一期归档，
   断言"存在 → 删掉并回 `removed`；不存在 → 404 期号不存在"两种行为（正向 + 负向各一条），
   与同族 8 份一样带"子进程必须被指到本地文件库"断言。
2. `regression-20260913b` 的 `POST /api/data/cleanup/preview` 改走隔离库；顺带给 spec 41 的白盒加一条判据：
   **测试里出现 `method:'DELETE'`/`'POST'` 且未设 `TURSO_DATABASE_URL='file:'` 即红**——这条正是本轮
   靠人肉清点才发现的形态，应当自动化（并入放行表 #12 的文档/门禁扩面一起做）。
3. `handleDataCleanupPreview` 建议改 `GET`（或 `POST` 但显式 `?execute=0`），别让"只数不删"的语义
   靠方法名约定维持。**此项属行为变更，需单独拍板。**

## 七、09-21 放行后的落地进度（用户整表放行，按 D3 顺序开工）

| 决策点 | 状态 | 一手读数与残余 |
|---|---|---|
| D3 内容级转储 | ✅ **已交付** | `lib/content-dump.js`（纯逻辑）+ `tools/dump-content.cjs`（`--full`/增量/`--verify`/`--gate`/`--restore`/`--mktarget`）。云端 59,832 文章 + 1,291 视频 = 161.6MB/154 片，逐片 sha256 校验通过；**真回放**进 `data/rehearse/app.db` 17.6s 放回全量、抽样 12 行 × 23 列逐字段 0 不一致；本地 `data/backups/app-20260921-014112.db`（715MB / 43,512 文章，逐表核非空）补上"本地一份新快照"。锁 `tests/regression-content-dump.test.js` D1~D10。**按坑 #64 规则②不套 F2P 改前红**（新增门禁无旧形态），证据 = D2~D6 五组突变对照必须红 |
| D1/B102 残余 | 待做 | `api/[...slug].js:2010` 的第三份谓词仍未收进 `lib/retention.js`（W17 按整文件豁免它）；**本轮新查第四份**：`tools/archive-articles.js` 搬完 `articles_archive` 后按 id 删，绕开 W17 的形状判据，且少 `featured` 豁免 → 登记 B132 |
| D2/B101 触发口 + 删除接闸 | 待做（**先把数摆清再接**） | `collect.yml` 的 `cleanup` 触发口仍缺；**`deleteGate` 目前只是工具，不是强制路径**——runner `runCleanup` 与云端手动端点 DELETE 前调它、并配白盒判据（"有 DELETE 而未过闸即红"），随这一步一起做。**09-21 按现役库重算待删量：50,636 条 = 全库 84.6%**（热榜 26,361 / 普通 24,275 含 667MB 正文），而不是 §二 N1 登记的 10,733——旧数属被换掉的旧库。读数与取法：`docs/eval/bl10-null-audit-20260921.md` §三 |
| 附带查出（本域之外） | 新登记 | **B131**：`lib/db.js` 的 `SCHEMA`（新建库路径）里 `articles` 少 `translated_title`/`translated_content`/`translation_provider` 三列 → 第一次真回放被逐列校验**正确挡下**；转储清单已改为自带源库 DDL（`--mktarget`）绕过，**真修（列并进 SCHEMA + 白盒"生产列集 == ensureSchema 列集"判据）待做** |

