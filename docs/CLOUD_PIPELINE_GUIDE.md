# 云端实时信息流 · 交付文档（下一个 Agent 必读）

> **这份文档的目的**：让任何接手的 Agent 在改代码之前，先理解"网页数据为什么会自动更新"，
> 避免改功能时把采集/调度链路碰断而又不自知（本系统已经因此静默停摆过 2 天）。
> 最后更新：2026-09-23（§3 检查清单按新交付链改写：验收以 AGENTS §3 为准，eval 类降级为按需工具，新增 ci.yml 检查项；**另：cron-job.org 主力触发器 8430047 已停用待处理，见 `docs/ISSUES.md` 🔵 表 09-23 新行**——不变量 9 的双保险目前只剩 schedule 一档在撑。上轮：§AI 配置写入口径那条原指向 39 号 spec，该批 spec 已作废删除、锚点见 `docs/ISSUES.md`，裁决本身仍有效）
> 上轮（09-19 夜·图下加注「04:13 清理当前不生效」的实测依据 + 用 `cloud.collect.history[].mode` 判触发真假的口径，见 B101/37-5；09-18 文档清洁轮：测试基线不再写死数字；调度图 09-14 已对齐 collect.yml 的**表达式**——表达式真、触发未成立）

---

## 0. 阅读优先级（按顺序读，再动手）

| 优先级 | 文档 | 为什么先读它 |
|---|---|---|
| **P0 必读** | **本文档** | 实时链路的完整地图 + 不可破坏的不变量 |
| **P0 必读** | `docs/changes/2026-09-11-runner-direct-collect.md` | 上一次"不更新"事故的完整根因链——所有坑都在里面 |
| **P1 必读** | `ARCHITECTURE.md` §0/§1/§3/§5 | 架构决策与 22 条血泪坑（§5 每条都对应过一次线上事故） |
| **P2 建议** | `docs/RUNBOOK.md` §10 | 云端运维操作手册 |
| **P2 建议** | `docs/ISSUES.md` | 当前未解决问题的活清单 |
| **P3 参考** | `docs/HANDOVER.md` | 凭据速查（⚠️ 含密钥，本地文件，已 gitignore，**永远不要提交**） |

---

## 1. 一张图看懂实时链路

```
┌─────────────────────────────────────────────────────────────┐
│ GitHub Actions（.github/workflows/collect.yml）              │
│                                                             │
│  每 15min :07/:22/:37/:52 ──► collect-turso.js collect（采集）│
│                             │  └─ 尾部：热搜事件预聚合 + quickscore 即时补分│
│                             └─► translate（AI 翻译）         │
│  每天 09:03 日报 daily ｜ 每天 00:32 daily-ai（兜底补跑）      │
│  每天 21:30 晚间生成主批（daily-ai + mybrief，rolling24h）     │
│  周五 18:03 周刊 weekly ｜ 每天 09:33 快照 ｜ 04:13 清理       │
│                          （时间均为北京时间）                  │
│  触发双保险：cron-job.org（jobId 8430047）每 15min POST        │
│  workflow_dispatch 叫醒 collect job——GH schedule 会丢任务，    │
│  此为实际主力触发器（不变量 9；Key 见 HANDOVER §1.5）          │
└──────────────────────────┬──────────────────────────────────┘
                           │ @libsql/client 直写（不经任何 Vercel 函数）
                           ▼
                  ┌─────────────────┐
                  │  Turso（东京）   │  ← 唯一云数据源
                  └────────┬────────┘
                           │ 读（无缓存，写入即所见）
                           ▼
              qwis-intel.vercel.app（Vercel 读层，push 自动部署）
              api/[...slug].js → 前端页面
```

**关键认知**：Vercel 函数**不参与**定时采集。Vercel 只是读层。数据新不新，取决于
GH Actions → Turso 这条链，和 Vercel 部署本身无关。

> ⚠️ 上面图里的「04:13 清理」**当前不生效**（2026-09-19 实测,详情 B101）：`cleanup` job 只认 `github.event.schedule == '13 20 * * *'`,而主力触发是 cron-job.org 的 `workflow_dispatch`（`mode` 选项无 cleanup）→ 该 job 在每个 dispatch 批次里都是 `skipped`;生产上此刻还有 **10,733 条**已满足删除谓词的文章未被删除。**"有 cron 表达式"≠"会执行"**,判据要看心跳里该 mode 有没有出现过（`settings['cloud.collect'].history[].mode`,见 37-5 拟新增的 `scheduler_gap` 事件）。

## 2. 不可破坏的不变量（动了就会"不更新"）

改任何代码前对照此表。违反任意一条 = 信息流停摆，且**没有任何报警**：

1. **三处密钥必须一致**：`COLLECT_KEY` / `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`
   同时存在于 ① 本地 `.env` ② Vercel 项目 env ③ GitHub repo Secrets。
   改一边不改其余 → 静默 403/失败（2026-09-11 事故直接原因）。
2. **采集必须带浏览器 UA**：newsnow 热榜 API 对自定义 UA 一律 403。
   UA 字符串在 `tools/collect-turso.js` 和 `api/collect.js` 各一份，改要同步。
3. **熔断阈值**：youtube=10（反爬假 404/500 会误杀活源），其他类型=3。
   不要把 youtube 改回 3。
4. **`tools/collect-turso.js` 不许依赖 `server/db.js`（better-sqlite3）**：
   runner 上 `npm ci --ignore-scripts` 不编译原生模块。脚本必须只用
   `@libsql/client` + `rss-parser` + 全局 `fetch`（+可选 undici）。
5. **workflow 必须保留 `permissions: contents: write`**：snapshot job 要 push 快照 commit。
6. **vercel.json 不要加回 `crons` 块**：Vercel Cron 用 GET 且不插值 `${VAR}`，
   与只收 POST 的 collect.js 天然不兼容（历史上写了等于没写）。定时任务只走 GH Actions。
7. **进程退出**：脚本末尾用 `process.exitCode = 0` 自然退出，不要 `process.exit(0)`
   （Windows 上触发 libuv UV_HANDLE_CLOSING 断言 → exit 127）。
8. **本地代理**：`HTTPS_PROXY` 存在时必须用 undici 包自带的 `fetch` + `ProxyAgent`
   配套使用，不能把外部 undici 的 Agent 喂给 Node 内置 fetch（符号不兼容，全部 fetch failed）。
11. **精选即时补分（quickscore）**：六维评分此前只在早报批次（21:30/00:32/09:03）跑，
   白天新文章 score 全空 → 热点榜「AI 精选」白天无今日内容（2026-09-14 用户验收发现）。
   现 collect 批次尾部追加 `runQuickScore`：近 24h 未评分、自有源、AI 相关文章每轮补 8 篇
   （QUICKSCORE_LIMIT 可调；生成保护窗内让路，同翻译 R0b）。

10. **热搜事件预聚合**：`/api/hot/events` 的聚合（3000 行窗口采样 + Jaccard 聚类）在 serverless 冷启动
   超 30s 上限必 504（2026-09-14 实测连续超时）。主路径 = runner collect 批次尾部 `runHotEventsCache`
   预聚合写 `settings['hot.eventsCache']`（15min 刷新），云端读层直读缓存（>45min 视为 runner 异常才内联兜底）。
   聚合逻辑唯一实现：`lib/hot-events.js`（纯函数，runner 与云端兜底共用，勿再写第三份）。

12. **早报/周刊落库守卫（2026-09-18 事故后新增，详见坑 #32；写入者数目 2026-09-19 实测订正）**：
    `daily_reports` 的**代码写入函数有 5 个**（不是三个）——`tools/collect-turso.js#runDailyAi`（AI，由
    `daily-ai-evening` 北京 21:30 / `daily-ai` 00:32 备跑两个 job 调）、同文件 `#runDaily`（**非 AI 裸报告**，
    由 `daily-report` 09:03 调）、`api/daily-generate.js#generateDaily`（云端手动/定时生成）、
    `server/services/ai/daily.js#generate`（本地灾备）、`api/[...slug].js#generateDailyInline`（**读层内联兜底**）。
    读层**必须按 `schemaVersion` 档位优先，不能按 `generated_at` 最新优先**，
    否则 09:03 的裸报每天把 AI 增强版整体遮蔽（线上实测 id99 被 id100 顶掉）。
    守卫唯一实现 `lib/brief-guards.js`（`pickDailyReport` / `canPublishWeekly` / `passesDailyQualityGate`），
    runner 与云端读层共用——**任何一端都不许重写这条规则**；入报门槛**必须 5 个写入函数逐个接**，
    漏一个的表现就是"大部分天正常、个别天混进低质条目"（B20 实测：`id=103` 混进 29/22 分两条，
    来源正是最后补上门槛的读层内联兜底）。对账锁 = 白盒 **W14**（从 `INSERT INTO daily_reports` 反查宿主函数，
    不靠人记清单，见坑 #58/#59）。`stats.candidates` 五份统一为**进门槛前的候选数**，门槛剔掉的条数写进
    **`stats.gateDropped`**（此前同一键在 AI 版里是"池子大小"、在另外四份里是"门槛后剩余"——
    统计卡读的是同一个字段名，两种群体，2026-09-19 独立审查查出后统一）。
    周刊不足 4 条一律不发布（宁缺毋滥，不得用空/降级产物覆盖上一期）。

13. **早报「视频与播客」栏有**三份**实现，字段必须一起改（B84，2026-09-19）**：
    `api/[...slug].js`（云端日报）、`tools/collect-turso.js` 日报批、同文件 mybrief 批各写一份
    `mediaItems`，形状由 `lib/media.js` 的口径决定（播客：`audio_url=cover`、`cover=null`）。
    显示层的兜底头像走 `source_avatar`（`s.avatar`）——**加/改这一栏的字段必须三处同步**，
    漏一处的表现是"某些天有图标某些天没有"，看不出是没同步。
    对账锁：`tests/regression-20260919i.test.js` I3 + 白盒 **W12**（全仓库扫 `mediaItems.push`，
    少字段即红；构造点数量 <6 会判"判据抓不到东西了"，防清单被删空后假绿）。
    本地 Express 侧的日报条目构造在 `server/services/ai/daily.js`（**没有 mediaItems 这一栏**，
    见 B86：本地端结构性缺播客），但它同样带 `source_avatar`，以便补齐那一栏时不再分叉。

14. **新增云端 GET 端点必须同一次改三处**（B26 拆分时实测踩过，坑 #56）：
    路由表 `api/[...slug].js` 的 `if (path === …)`、鉴权白名单 `PUBLIC_GET_PATHS`（**精确匹配**，不是前缀）、
    消费方。只改前两处 → 线上 401；只改一处 → 404。本地 Express 是单用户放行，**测不到这层**，
    所以新端点必须有一次真打线上。成对断言见锁 I10。
    本轮产出：`GET /api/status` 只回轻投影（未读/今日/本周/启用源/暂停数），
    重统计移到 `GET /api/status/daily-sources`（近 7 天入报条目数 + Top5 来源，60s 独立缓存）——
    因为前者原先把三组计数合并成一条无 WHERE 的 CASE 全扫（79.8k 行，实测 11.8s）并 SELECT 了
    从未消费的 `daily_reports.stats`（214KB），冷态 12~30s 顶到 Hobby 30s 预算（曾 504）。

15. **日报栏目表只许一份实现**（B10，坑 #55）：`lib/daily-columns.js` 是唯一出处，
    三端生成器与读层设置段都 require 它。此前有 5 份副本，且读层那份会被
    后台「恢复默认栏目」**写进 `settings.daily.columns`** —— 副本一漂，脏默认值就落进生产库。
    全仓库按内容特征对账：白盒 W13；`desc` 不许复述 `keywords`：锁 I8（带历史脏值正向探针）。

16. **XML 实体解码只许一份实现，且只作用于"标题类"字段**（B94，2026-09-20）：
    唯一实现 `lib/text-clean.js#decodeXmlEntities`；标题/源名一律走 `cleanTitle`
    （三端共 5 处构造点：`server/services/collectors/rss`、`api/collect.js`、`tools/collect-turso.js`）。
    此前全库有 **9 处**各自解实体 —— 4 处自己抄了映射表（每张都少几个实体：wechat 适配器漏数字实体、
    云端 `parseOpml` 漏 `&apos;`…），5 处只解 `&amp;` 给 URL 属性用。**这就是源名/标题带 `&quot;` 上屏的成因**。
    两条硬边界：① **只解一次**（`&amp;apos;` 这类双重转义留给数据订正，不在采集层连解两次）；
    ② **summary / content_html 故意不解** —— 那里 `&lt;b&gt;` 是"被转义的内容"，解一次就变成真标签，
    会被 B8 的"像不像 HTML"分流判据误判成 HTML 分支（等于用一个 bug 换另一个 bug）。
    对账锁：`tests/regression-20260920a.test.js` A1~A4（A3 不设豁免，任何 `.replace(/&实体/` 重现即红）。

9. **触发双保险（cron-job.org）**：云端采集的**实际主力触发器**是 cron-job.org 任务
   **8430047**（每 15min `POST /actions/workflows/345928986/dispatches`，body `{"ref":"main"}`；
   dispatch 只跑 collect job，日报/快照/清理不会被 15min 刷）。GH schedule 仅为备份
   （2026-09-11 高负载曾连丢五轮且无告警）。该任务配置内嵌 GitHub PAT 做鉴权
   （值见 `docs/HANDOVER.md` §1.5）——**PAT 轮换/失效时必须同步更新 cron-job 配置**，
   否则主力触发静默停摆，只剩会丢任务的备份。控制台 <https://console.cron-job.org/dashboard>，
   管理用 API Key 同见 HANDOVER §1.5。
   **2026-09-18 追加**：`workflow_dispatch` 现在带 `inputs.mode`（choice，默认 `collect`）。
   cron-job.org 不传 inputs → 取默认 `collect` → **仍然只跑 collect job，本不变量不被破坏**。
   AI 批次 job 的 `if` 都要求 mode 精确等于各自名字才会触发，取值缺失/为空时恒不成立（fail-safe）。
   人工「Run workflow」选 `daily-ai` / `daily-ai-evening` / `mybrief` / `weekly` 即可单独补跑
   ——周刊此前每周只有周五那一次 schedule 且完全不可补跑，是本周断更的直接成因。

17. **「今日 / 北京日界」只许一份实现**（B90 同族 B96/B97/B99，2026-09-20）：全站的产品语义都是**北京日**，
    而 Vercel 容器是 UTC、本地开发机恰好是东八区 —— 所以任何"各自算一下今天"的写法都会在云端错位 8 小时。
    唯一口径是 `lib/time-window.js`：日界 `beijingDayStartIso/Ms`、日历日 `beijingDateStr`、
    日历日→时刻区间 `beijingDayRangeIso`（**日期串是标签不是时刻**，拼 `T00:00:00.000Z` 就是 B96/B99）、
    日报窗口 `dailyReportWindowIso`（北京昨日 00:00 → 今日 06:00，五份写入器共用）、
    墙上时钟 `beijingNow`（读北京小时数用）。浏览器不能 require CJS，因此有且仅有一份对端
    `web/src/beijing-date.mjs`，它的正确性由回归锁 **C5 逐时刻跑数**比对（不是比文本）。
    消费点：本地 `/api/status`、云端 `handleStatus`、日期筛选 `buildWhere`（本地/云端 ×文章/视频/播客）、
    `handleDailyRegenerate` 的删除区间、`handleDaily` 的"同一天"判定与补生成门槛、runner 的自然日窗口与期号。
    判据：白盒 **W16** 与回归锁 **B4** 共用 `lib/time-caliber.js` 那一份派生扫描（六种被禁形态），
    新增反向自证 `node tools/_probe-time-caliber-selftest.cjs`。**故意保留的一处例外**：
    `server/services/ai/daily.js` 的 `genAt` 用本机钟点判断"到点了没有"——它是本地灾备端的调度触发器，
    语义就是"这台机器的墙上时间"，跨时区部署才需要换。
18. **文本型判据只许一份词法扫描**（坑 #63，2026-09-20 第三轮审查）：判"代码里真写了这句话"必须用
    `lib/src-spans.js` 的 `stripStrings`/`maskText`（注释**和**字符串内容都抹），判"SQL 写了什么"才用
    `stripComments`（保留字符串）。`stripComments` 不是第二套状态机，它复用 `scan()` 的注释区间 ——
    两条路径各自判断"这是不是注释"必然分叉（上一版正则字面量里的引号开假字符串，231 个文件里 50 个受影响，
    注释里的 `applyDailyQualityGate` 因此算"已接线"）。自检必须**双向**：
    `node tools/_probe-strip-selftest.cjs`（291 个真实文件：抹完仍可 `node --check` ＋ 只在注释里的词确实消失 ＋ 字符串内容不许丢）。
    派生清单类判据（W14 的日报写入点、W15 的污染列）一律从**事实**反查：SQL 只在字符串字面量里找、
    逐条 INSERT 各自判定、动态表名单独记账（不许隐身），列名由 DDL 派生而不是手写一行 `['last_fetched_at']`。

19. **Turso 是链路的单点，且配额是墙钟事件**（B118，2026-09-20 整站挂 6 小时的直接教训）：
    `api/` 读层**没有任何降级路径** —— 快照（`public/data/`、`static-data/`）是**产物级**离线导出，
    运行时的 `/api/*` 不会去读它们，所以"Turso 一挂全站挂"是结构而非偶发。三条推论都不可破：
    ①**每轮交付必须做一次线上活体探测**，哪怕本轮零部署 —— 配额耗尽不看代码有没有动；
    ②**旧库永不自作主张删**（读封锁会随配额重置解除，它是唯一的回读来源；本轮 `weekly.archive` 就是这么丢的）；
    ③换存储 = **不变量 1 的三处同步**（`.env` / Vercel env / GH Secrets）外加**一次 workflow_dispatch 复验 runner 真写进新库**，
    只验 `/api/meta` 会漏掉整条写链路。排查与止血步骤见 `docs/RUNBOOK.md` §10.9。

20. **早报候选层的每源配额只许一份实现**（44 号 spec 步1，2026-09-24）：`lib/prescreen.js`
    （`applySourceQuota` / `prescreenCapOf` / `prescreenStats`）是部署面四份日报生成器
    （`runDailyAi`、`runDaily`、`api/daily-generate.js`、读层内联兜底）共用的唯一出处，
    配额值唯一写死处是 `settings['prescreen.perSourceCap']`（缺省 2，坏值回默认并出声）。
    **为什么收成一条**：实测 `ORDER BY published_at DESC LIMIT 500` 在 24h 窗口 2,688 篇 / 469 源的池子里
    只覆盖 94 源——500 个坑里 352 个是同一批高频源的"第 3 篇以后"；这一刀不削减 AI 调用量，只把覆盖换回来。
    两条附带硬约束：① 宽池 2000 行**不许携带 `content_html`**（同不变量里 weekly 那条 libsql HTTP 掐断教训），
    正文一律到深析阶段按 id 单取；② `stats.prescreen` 必须落库，否则"配额有没有生效"又变成不可判别
    （P0-2 那一族）。本地灾备端 `server/` **不在本面内**（不在部署面，见 `docs/ISSUES.md` H22），
    但入报门槛照旧必接。对账锁：`tests/regression-prescreen.test.js` P6/P6b/P8 + 执行锁 E1~E3。

## 3. 改代码时的检查清单

- [ ] 改了采集语义（过滤/清洗/去重/熔断/UA）？→ **四处同步检查**：
      `server/services/collectors/*`（本地）、`api/collect.js`（Vercel 备份）、
      `tools/collect-turso.js`（云端主链路）。三者是独立实现，会漂移。
- [ ] 改了日报逻辑？→ 同步检查 `server/services/ai/daily.js`、
      `api/daily-generate.js`、`tools/collect-turso.js` 的 `runDaily()`、`api/[...slug].js` 的 getOrGenerate 兜底；
      **读取侧档位守卫在 `lib/brief-guards.js`（不变量 12），四个写入者共用，勿在任一端重写**。
- [ ] 改了 Turso schema？→ 四处采集实现 + `tools/generate-snapshots.js` + `api/[...slug].js` 全部要对齐。
- [ ] 改了 workflow 的 cron？→ 注意 GH Actions 是 **UTC**，且整点拥挤，用错峰分钟（:07/:37 风格）。
- [ ] 改完必须跑：`npm test`（**条数以命令输出为准，本档不写死**；基线状态见 `docs/FEATURE_MATRIX.md` §1.5）。不许新增失败。**2026-09-23 起**：验收与交付链以 `AGENTS.md` §3 为唯一准绳（`eval:whitebox`/`eval:e2e` 等降级为按需工具，改到其守护区域时建议运行）；push 后查 `ci.yml` push-CI 是否绿（09-23 新增）。
- [ ] 涉及云端的改动 → 部署后跑一次 `workflow_dispatch` 验证 4 个 job 全绿（见 §4）。

## 3.1 部署方式（2026-09-11 晚更新）

✅ **Vercel 已连接 GitHub 集成**（qwis-intel ↔ ghoustghoust/qwis-portal，productionBranch=main）：
**`git push origin main` → Vercel 自动构建部署**，快照 job 的每日 push 也会随推随上线。

历史背景：2026-09-11 之前项目 `link: null`（从未连接），所有部署都是 CLI 手动
（`vercel --prod --scope kwei888 --yes`），曾导致"以为部署了实际没部署"的误判。
CLI 手动部署仍可用作兜底。

Vercel CLI 红线：禁止 `vercel env pull`（会覆盖本地 .env 丢失 PORT/HTTPS_PROXY 等本地变量）、禁止交互式 login 流程

## 4. 验证管线是否活着（30 秒自检）

```bash
# ① 看 GH Actions 最近运行（全绿 = 正常）
#    https://github.com/ghoustghoust/qwis-portal/actions

# ② 看采集心跳（Turso settings 表，每轮采集都写）
#    key = 'cloud.collect'，value 里有 lastRunAt 和 stats
#    lastRunAt 距现在 > 1 小时 = 链路断了

# ③ 看线上最新数据时间（需代理）
curl "https://qwis-intel.vercel.app/api/articles?limit=1&sort=new&include_hot=1"
#    created_at 应在 1 小时内

# ④ 手动触发一轮完整管线
#    GitHub → Actions → collect → Run workflow（四个 job 全跑）

# ⑤ 看 cron-job.org 外置触发器（主力）是否在准点敲门
#    控制台 https://console.cron-job.org/dashboard → job 8430047 执行历史
#    或 API：curl -H "Authorization: Bearer <CRONJOB_API_KEY>" \
#      "https://api.cron-job.org/jobs/8430047/history"（Key 见 HANDOVER §1.5）
#    近轮 httpStatus=204 且间隔 15min = 正常；GH 侧应对应为 workflow_dispatch 事件
```

## 5. 故障决策树

```
网页数据不更新
  ├─ /api/articles 最新 created_at 是旧的？
  │    ├─ 是 → 采集链断：查 GH Actions 是否全红
  │    │    ├─ 403 → Secrets 值错了（不变量 1）
  │    │    ├─ 热榜 403 → UA 被改回去了（不变量 2）
  │    │    └─ 其他 → 看 job 日志里 collect-turso.js 的输出
  │    └─ 否 → 数据是新的但页面旧 → 前端/缓存问题，与采集无关
  ├─ 日报没生成 → 查 daily-report job 日志；窗口是"前一天 00:00 ~ 当天 06:00 北京"
  ├─ 某源不更新 → 查 sources 表 enabled/fail_count/extra.lastError；youtube 间歇失败属正常（反爬掷骰）
  └─ GH Actions 绿但数据旧 → 查心跳 settings cloud.collect 的 stats 字段
```

## 6. 云端独立性矩阵（2026-09-11 实测审计：本地关机后哪些还活着）

| 能力 | 本地关机后 | 运行在 | 原因/备注 |
|------|:---:|------|------|
| 热榜 30min 准实时 | ✅ | GH runner | tools/collect-turso.js collect |
| 公众号/RSS 每小时 1 轮 | ✅ | GH runner | 到期驱动（60min 间隔） |
| 数据存储 | ✅ | Turso | 云数据库 |
| 网页读取/搜索/已读标记 | ✅ | Vercel | api/[...slug].js |
| 管理后台登录 | ✅ | Vercel | 2026-09-11 修复中间件死锁 |
| 每日日报 09:03 | ✅ | GH runner | collect-turso.js daily（仅 schedule；dispatch 只跑采集） |
| 静态快照 | ✅ | GH runner | push 后自动部署上线（仅 schedule） |
| **AI 翻译** | ✅ 已上线 | GH runner | collect-turso.js translate；Agnes 401 真根因=settings.ai 污染，已修复（2026-09-11 晚），实测近 1 小时翻译 110 篇 |
| **AI 对话/摘要（手动触发）** | ✅ 已上线 | Vercel | /api/ai/chat 供应商链 Agnes 优先；**AI 配置写入口径见下方 §5.1（2026-09-19 决策，旧「env 唯一来源」表述已作废）** |
| YouTube/X | ⚠️ 间歇 | GH runner | 反爬掷骰，阈值已放宽 |
| B站 | ✅ | runner | `api/_bilibili.js` 三链路（wbi 主链 + 合集 + 搜索兜底），匿名可用（2026-09-12 上云，见 FEATURE_MATRIX）；播放直链仍本地 |
| 抖音 | ❌ | 仅本地 | 需 Playwright 登录态，永远本地 |
| 云端队列 poller（手机提交链接） | ⚠️ 手动 | Vercel 手动 / 本地自动 | 云端已可 `POST /api/queue/sync` 手动拉取；自动轮询仍在本地调度器 |
| OPML 源清单同步 | ⚠️ 手动 | Vercel 手动 / 本地自动 | 云端已可 `POST /api/opml/sync`；12h 自动同步仍本地 |
| 采集停滞报警 | ✅ | runner + 本地 | 心跳埋点 `settings.cloud.collect`；报警引擎已上云（`api/_alerts.js`，15-cloud-alerts 09-12 交付；runner 每轮 `postRunAlerts` 调停滞/熔断/批量失败检测，见 `collect-turso.js:556`） |
| 页面内自动刷新 | ✅ 已上线 | Vercel | 60s 增量轮询 /api/articles/since（2026-09-11 替代废弃的 SSE） |

> 结论：**本地关机，信息流、日报、翻译、阅读全部正常运转**。仅 B站/抖音采集、手机提交队列、OPML 增量同步依赖本地开机。

## 6.1 AI 配置写入口径（2026-09-19 决策，取代旧「env 唯一来源」表述）

**已作废的旧表述**（本文与 `api/[...slug].js:2135` 注释原话）：「云端 AI 配置锁定为环境变量（AGNES_*），settings.ai 已清空」。
作废理由：**它与实际实现不一致已 8 天**——`/api/settings` 确实拒写 `ai` 键（`:2135-2138` 返回 400），但后台 AI 能力页走的是另一个端点 `PUT /api/ai/config`（`:1428`），它直接把 `settings.ai.{enabled,apiKey,apiBase,model}` 写进库里；线上实测该键现在就存在且值与 env 同。纸面禁令挡不住真实通道，于是"不变量"退化成没人核对的假声明（记 `docs/ISSUES.md` BL9 / B50）。

**现行口径（用户 2026-09-19 拍板：保留可写 + 审计 + 变更告警）**：

1. 优先级不变：`settings.ai` **高于** env（坑 #24）。改 env 永远修不好 settings 覆盖问题，排查顺序仍是先 `SELECT value FROM settings WHERE key='ai'`。
2. 允许从后台写 `model` / `apiBase` / `apiKey`，但每次写必须：①写审计记录（何时、改了哪几项、旧值指纹→新值指纹，**不落明文**）；②推一条变更告警到报警渠道；③写后立即做一次轻量连通探测，失败即回滚并在 UI 报错（防止把线上打成 401）。
3. 读侧永不回显明文 Key，只回显指纹（前 4 后 4）。
4. `/api/settings` 对 `ai` 键的 400 拦截**保留**（两个写入口只留一个真写入口，避免绕过审计）。
5. 落地位置：原 39 号域（AI 能力台）spec 的 39-1/39-3 —— **该批 spec 已于 09-23 作废删除，逐字反查锚点见 `docs/ISSUES.md`「specs 35~43 作废」行**。本条的裁决本身仍有效（保留可写 + 强制审计 + 变更告警 + 写后探测失败即回滚），但**实施进度不能再按"39-1/39-3 已排"读** —— 需重新对代码核四项各自落到哪一步。且因 B44 报警渠道当前无出口，第 ② 条要等报警出口恢复后才真正成立。

## 7. 关键文件速查

| 文件 | 角色 |
|------|------|
| `tools/collect-turso.js` | **云端采集主链路**（collect/daily/cleanup/daily-ai/translate/weekly/mybrief 七模式；mybrief=手动重生成我的早报） |
| `lib/source-axes.js` | 源四轴唯一实现（27b）：迁移/订阅集合解析/轴 action SQL，server/Vercel/runner 三端共用（勿再写第二份） |
| `.github/workflows/collect.yml` | 定时调度定义（全部北京时间见注释） |
| `api/collect.js` / `api/daily-generate.js` | Vercel 手动备份端点（Hobby 10s 限 2 源，仅救急） |
| `api/[...slug].js` | 读 API（含日报 getOrGenerate 兜底） |
| `tools/generate-snapshots.js` | 静态快照导出（首屏兜底 public/data/） |
| `vercel.json` | 仅 rewrites/headers/functions，**无 crons** |
| cron-job.org 任务 8430047（非仓库文件） | **采集主力触发器**：每 15min POST workflow_dispatch 叫醒 collect job（GH schedule 为备份）；控制台 <https://console.cron-job.org/dashboard>，API Key 见 `docs/HANDOVER.md` §1.5 |
