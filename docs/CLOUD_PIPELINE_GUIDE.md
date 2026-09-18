# 云端实时信息流 · 交付文档（下一个 Agent 必读）

> **这份文档的目的**：让任何接手的 Agent 在改代码之前，先理解"网页数据为什么会自动更新"，
> 避免改功能时把采集/调度链路碰断而又不自知（本系统已经因此静默停摆过 2 天）。
> 最后更新：2026-09-14（调度图对齐 collect.yml 真实值 15min + 补 cron-job.org 触发器注解与不变量 9）

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

12. **早报/周刊落库守卫（2026-09-18 事故后新增，详见坑 #32）**：`daily_reports` 有三个写入者
    ——`daily-ai-evening`（北京 21:30，AI）、`daily-ai`（00:32 备跑，AI）、`daily-report`（09:03，**非 AI**），
    外加读层 `getOrGenerate` 内联兜底。读层**必须按 `schemaVersion` 档位优先，不能按 `generated_at` 最新优先**，
    否则 09:03 的裸报每天把 AI 增强版整体遮蔽（线上实测 id99 被 id100 顶掉）。
    守卫唯一实现 `lib/brief-guards.js`（`pickDailyReport` / `canPublishWeekly`），runner 与云端读层共用——
    **任何一端都不许重写这条规则**。周刊不足 4 条一律不发布（宁缺毋滥，不得用空/降级产物覆盖上一期）。

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

## 3. 改代码时的检查清单

- [ ] 改了采集语义（过滤/清洗/去重/熔断/UA）？→ **四处同步检查**：
      `server/services/collectors/*`（本地）、`api/collect.js`（Vercel 备份）、
      `tools/collect-turso.js`（云端主链路）。三者是独立实现，会漂移。
- [ ] 改了日报逻辑？→ 同步检查 `server/services/ai/daily.js`、
      `api/daily-generate.js`、`tools/collect-turso.js` 的 `runDaily()`、`api/[...slug].js` 的 getOrGenerate 兜底；
      **读取侧档位守卫在 `lib/brief-guards.js`（不变量 12），四个写入者共用，勿在任一端重写**。
- [ ] 改了 Turso schema？→ 四处采集实现 + `tools/generate-snapshots.js` + `api/[...slug].js` 全部要对齐。
- [ ] 改了 workflow 的 cron？→ 注意 GH Actions 是 **UTC**，且整点拥挤，用错峰分钟（:07/:37 风格）。
- [ ] 改完必须跑：`npm test`（278 项全绿为基线，2026-09-15 起；不许新增失败）。
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
| **AI 对话/摘要（手动触发）** | ✅ 已上线 | Vercel | /api/ai/chat 供应商链 Agnes 优先；settings.ai 已清空，env 唯一来源 |
| YouTube/X | ⚠️ 间歇 | GH runner | 反爬掷骰，阈值已放宽 |
| B站 | ❌ | 仅本地 | wbi 签名未移植（纯 crypto 可移植，待做） |
| 抖音 | ❌ | 仅本地 | 需 Playwright 登录态，永远本地 |
| 云端队列 poller（手机提交链接） | ⚠️ 手动 | Vercel 手动 / 本地自动 | 云端已可 `POST /api/queue/sync` 手动拉取；自动轮询仍在本地调度器 |
| OPML 源清单同步 | ⚠️ 手动 | Vercel 手动 / 本地自动 | 云端已可 `POST /api/opml/sync`；12h 自动同步仍本地 |
| 采集停滞报警 | ❌ | 仅本地 | 心跳已埋点（settings cloud.collect），报警引擎未上云（15-cloud-alerts 待做） |
| 页面内自动刷新 | ✅ 已上线 | Vercel | 60s 增量轮询 /api/articles/since（2026-09-11 替代废弃的 SSE） |

> 结论：**本地关机，信息流、日报、翻译、阅读全部正常运转**。仅 B站/抖音采集、手机提交队列、OPML 增量同步依赖本地开机。

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
