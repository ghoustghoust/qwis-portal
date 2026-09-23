# 全网情报系统 · 架构文档

> 所有 Agent 的共用上下文。改架构/流程/凭据位置时必须同步更新本文档。文档自身的清洁规则见 `docs/DOC_GOVERNANCE.md`。
> 最后更新:2026-09-23(09-23 只读复核轮：§1 图下「清理 04:13 从未触发」加注经生产心跳实测推翻 —— cleanup 已实跑两轮删 59,306 行,已就地改写并标出两件仍未定项;specs 35~43 作废的锚点在 docs/ISSUES.md。承接上轮 2026-09-19(夜·只读复核轮：图下加注「清理 04:13 当前从未触发」的实测依据与心跳判据,见 B101;09-18 文档清洁轮：调度改指针、pitfalls 索引补 #D2、日期订正;方案A 采集移入 GH runner 直写 Turso 见 2026-09-11)

## 0. 部署方向决策(2026-09-11 方案A)

- **主部署:Vercel Serverless(读层 + 管理台)**——`api/` 目录为读 API,对外地址 `https://qwis-intel.vercel.app`。
- **采集主链路:GitHub Actions runner 直写 Turso**——`.github/workflows/collect.yml` 每 15min 跑 `tools/collect-turso.js`(模式:collect / cleanup / daily / daily-ai / weekly / mybrief / translate,见 `collect-turso.js:1954-1967`),不经 Vercel 函数(根治 Hobby 10s→单次 2 源死局)。runner 海外网络,YouTube/X/RSSHub 直连。
- **Vercel 端 api/collect.js、api/daily-generate.js 保留为手动备份**(`POST ?key=COLLECT_KEY`),不再是定时链路。
- **本地 Express + SQLite**:开发/灾备用途。完整功能(含抖音 Playwright)仅在本地可用。

## 1. 系统全景

```
                        ┌─────────────────────────────────┐
                        │ GitHub Actions runner            │
                        │ 每15min 全量采集(:07/:22/:37/:52) │
                        │ cron-job.org 外置触发器(8430047)  │
                        │ 双保险(GH schedule 会丢任务)      │
                        │ 日报 09:03 / 快照 09:33          │
                        │ 清理 04:13(均北京时间)            │
                        │ tools/collect-turso.js 直写 Turso │
                        └─────────────┬───────────────────┘
                                      │ @libsql/client HTTPS 直写
                                      ▼
┌──────────────────┐        ┌──────────────────────────────┐
│  本地机(开发/灾备)  │        │  Vercel 主部署(读层+管理台)     │
│                  │        │                              │
│  情报系统 :3000   │        │  qwis-intel.vercel.app        │
│  ├ Express+SQLite│        │  ├ api/[...slug].js (读 API)  │
│  ├ 阅读器/日报/热榜 │        │  ├ api/collect.js (手动备份)  │
│  ├ /admin/ 管理台 │        │  ├ api/daily-generate.js(备份)│
│  ├ 采集调度器      │        │  ├ 读者前端(完整页面)          │
│  └ 抖音 Playwright│        │  ├ /admin/ 管理后台           │
└──────────────────┘        │  └ Turso (东京) ◀── 唯一数据源  │
   公众号 = wechat2rss       └──────────────────────────────┘
```

**Vercel 为读层主部署,采集主链路在 GH Actions runner(方案A,2026-09-11),本地为开发/灾备**。`api/` 目录是读 API 正式代码;采集/日报/清理由 `.github/workflows/collect.yml` 驱动 `tools/collect-turso.js` 直写 Turso(根治 Hobby 10s→单次 2 源死局,详见 docs/changes/2026-09-11-runner-direct-collect.md)。本地 Express 保留完整功能(含抖音 Playwright),用于开发和全功能灾备,未来宝塔/自有服务器全量部署时抖音功能在服务器运行。portal 历史:原 portal/ 独立仓库已合并进根项目 api/,冻结态已解除;Vercel 老项目 qwis-portal 已于 2026-09-11 删除下架。双端共享语义但独立实现,改一边要检查另一边。

> **编号/日期自洽说明（09-20 文档洁净轮）**：本文件 `git log` 的最后提交日是 2026-09-20，但**最后一次内容改动是 09-19 夜那次「清理 04:13 从未触发」加注**（`530a5f4` 当天写完、随叫停轮压到 09-20 才推）——所以头注日期停在 09-19 是对的，不是漏更。提交日 ≠ 内容日这件事本身，就是 §3 Step 2 需要人读一遍的原因。
> ⚠️ **图里"清理 04:13"是设计时刻,不是实际状态**（2026-09-19 夜实测,见 `docs/ISSUES.md` B101）：`cleanup` job 唯一的触发条件是 `if: github.event.schedule == '13 20 * * *'`,而实际主力触发器 cron-job.org 走的是 `workflow_dispatch`,其 `mode` 选项里**根本没有 cleanup** → dispatch 永远跑不到它；216 条 scheduled run 里没有一条落在 20:13 前后;生产心跳近 168 轮（≈23h）里 `cleanup` 出现 **0 次**。反向证据:拿那两条 DELETE 的原样谓词做 COUNT,线上现有 **10,733 条**（保留清理 8,616 + 热榜 2,117）满足删除条件却仍在库里 → **保留清理自引入起基本没执行过**。改这张图之前请先读 B101（原出处 43 号 spec 已作废删除，锚点见 `docs/ISSUES.md`；是否要恢复每日删除属产品决策 D4,不是bug修复）。
>
> ✅ **上面这条已被 09-23 实测推翻 —— 清理现在是常驻执行的路径。** 直读生产 `settings['cloud.collect'].history`：**cleanup 已实跑两轮 —— `2026-09-20T22:27Z` 删 50,823（热榜 26,532 + 保留 24,291）、`2026-09-21T23:17Z` 删 8,483（324 + 8,159）= 两天 59,306 行**；删除闸 `deleteGateAny` 现判**放行**（转储凭证 71,742 行 / 19h 内），此刻待删 7,500 条 = 全库 35.4%。取证命令 `npm run check:retention`。作废的 43 号 spec 原文逐字反查锚点见 `docs/ISSUES.md` 的「specs 35~43 作废」行。
> **两件仍未定，别顺手当已验证**：① 两轮心跳落在 22:27Z / 23:17Z 而**非** cron 声明的 `13 20 * * *`，"20:13 那条 schedule 究竟有没有在触发"仍未证实 —— 图上"清理 04:13"至今只是设计时刻；② 待删窗口列是 `COALESCE(published_at, created_at)`（`lib/retention.js:30`），而采集在做历史回填 → 实测 09-22 单日入库 8,737 条里 **7,083 条（81%）当天就已过窗**（发布平均滞后 149.1 天）。所以"是否恢复每日删除属产品决策、不是 bug 修复"这句**仍然成立**，只是决策对象从"要不要开"变成"要不要这样删"。

## 2. 仓库与目录

| 路径 | 说明 |
|---|---|
| `D:\全网情报系统\` | 主仓库(本地 git,非远端托管) |
| `server/` | Express 后端:routes/(API)、services/(collectors 采集器、ai/daily 日报、events 事件聚合、alerts 报警、scheduler 调度、queue 任务队列)、db.js(本地 better-sqlite3 同步层)。**统一异步双模式层在 `lib/db.js`**（本地 better-sqlite3 包装 / 云端 Turso HTTP，`TURSO_DATABASE_URL` 决定） |
| `web/` | 主前端(Vite+React+Tailwind),多入口:index.html(读者)+ admin.html(管理后台,独立 bundle) |
| `api/` | **Vercel 读层正式代码**:catch-all [...slug].js(读 API)、collect.js/daily-generate.js(手动备份端点) |
| `tools/` | 运维脚本(2026-09-04 清洁后):collect-turso.js(**云端采集主链路**,GH runner 直写 Turso)、generate-snapshots.js(静态快照)、fix-hotlist-times.js(热榜时间戳修正)、export-portal.js、sync-portal.js、import-bestblogs-opml.js、ops-toolkit.js、audit-cloud.js、seed-hotlist.js、seed-turso.js、setup-customer.js、gen_bat.py;一次性脚本已归档 `archive/tools/` |
| `archive/` | 全部历史资产:reports/(修复报告)、specs/(一~八期)、docs-deprecated/、analysis/、_eval/(参考工程)、tools/(一次性脚本)、测试/ |
| `opml/` | bestblogs 源清单(wechat2rss 375 公众号 / youtube 124 / podcast 60),2026-09-04 已导入 |
| ~~`D:\tools\we-mp-rss\`~~ | **已退役(2026-09-04)**:公众号改走 wechat2rss 托管 RSS,不再自建引擎;代码移 trash/,旧 wemp 源 enabled=0 保留历史文章 |

> ℹ️ `api/` 和 `vercel.json` 是 Vercel 主部署的正式代码。`src-admin/`、`admin.html`、`vite.config.js`、`vite.admin.config.js`、`copy-routes.js` 是原 portal 构件的历史副本，**不要使用/修改**，待清理。主前端构建走 `web/vite.config.js`。

## 3. 关键架构决策(为什么这么设计)

1. **采集必须在本地/云端函数,不能在浏览器**——风控与 Cookie。
2. **公众号 = wechat2rss 托管 RSS**(2026-09-04 起):自建 we-mp-rss(Python 子进程 + 微信读书 Cookie)已退役——太重且未内部集成。375 个 bestblogs wechat2rss 源以 type='rss' 导入,正文在 `content:encoded`(rss 适配器已读),图片由对方 img-proxy 代理(单点依赖,已知情接受);缺失的 28 个原 wemp 源接受损失。
3. **catch-all serverless**:Vercel Hobby 限 12 个函数,portal/api/[...slug].js 单函数路由全部 /api/*。
4. **云端读 Turso 优先,静态 JSON 快照兜底**(portal/public/data/)。
5. **管理后台是独立 bundle**(admin.html),不随读者前端分发;云端 /admin/ 有口令(httpOnly cookie)。
6. **定时调度(2026-09-11 方案A 重构)**:GitHub Actions runner 直跑 `tools/collect-turso.js` 写 Turso。**cron 具体值唯一事实源 = `.github/workflows/collect.yml:24-36`**（现 7 条 cron / 9 个 job：采集、日报、AI 早报×2、我的早报、周刊、快照、清理；AGENTS.md §2.5 禁止在本文档写死），本行只记语义：采集每 15min 全量到期源，**不再**戳 Vercel /api/collect(Hobby 10s 死局)。GH schedule 高负载会延迟甚至丢任务(09-11 曾连丢五轮),故加 cron-job.org 外置触发器(jobId 8430047)双保险兜底。本地调度器管本地采集。YouTube 源熔断阈值放宽为 10(反爬假 404/500 防误杀),其余类型仍为 3。**09-11 采集语义新规**:RSS 云端间隔 60min;热榜时间戳按名次递减 60s 排列(fix-hotlist-times.js)。
7. **前端无感刷新:60s 轮询 `/api/articles/since`**(2026-09-11):SSE 长连接在 Vercel serverless 不支持(函数 30s 超时即断),已废弃 `server/routes/events-sse.js` 的云端路径,前端改为每 60s 轮询增量端点拉新。
8. **SQLite 任务队列**(重构 Phase 5):本地调度器 tick 改为 scanAndEnqueue 入队 + TaskQueue 异步消费(并发 5，同源去重，优先级排序，崩溃恢复)。`QUEUE_ENABLED=false` 环境变量可回退串行模式。2026-09-05 补强:入队同源去重(pending/running 不重复)、retryDelayMs 退避生效(默认 30s)、job_queue 随每日数据清理自动 purge(completed>24h / failed>7d)。2026-09-05b 补强:bilibili/douyin 类型级 promise 链互斥(队列并发 5 下同平台多源不再并发,坑 #6 的串行保护补齐)。
9. **API 鉴权(2026-09-05 启用,P0)**:读者只读 GET 公开(articles/videos/hot/daily/groups/sources/status/img/settings),一切写操作 + alerts/data/backup/queue/health/auth-douyin 等敏感读接口需 Bearer JWT(POST /api/auth/login 获取,7d 有效)。中间件必须注册在路由挂载之前(index.js 有回归测试 P0-1e 锁死顺序)。密钥链:AUTH_SECRET(.env,缺省自动生成并持久化 settings auth.secret)、ADMIN_USER/ADMIN_PASSWORD(.env,默认 admin/admin123 会有启动告警)。应急回退:AUTH_DISABLED=true(仅本机调试)。前端:api.js 自动注入 Bearer,401 广播 'qwis:unauthorized' → LoginGate 弹登录框(管理台 blocking 强制登录,读者端可关闭继续只读)。token 存 localStorage('qwis.token') 全站共享。2026-09-05b 补强:GET /api/sources 的 extra 改白名单重建(intervalMin/lastError 脱敏/lastErrorAt/marksFeatured/aggregator/domain/etag/lastModified),原串不再外泄;log.mask 行内键值分支打码失效 bug 已修;api.upload 供二进制上传(DataTab 快照导入)。
10. **日报保底双保险**:定时 cron(settings daily.time,默认 08:00)+ 启动时 needsGeneration() 补跑(错过定时的场景)+ 前端打开 /daily/ 时 stale 即自动补(F3)。本地/服务器部署经 PM2 ecosystem.config.js 注入 TZ=Asia/Shanghai,定时不随服务器时区漂移(注:此为本地/服务器语义,云端日报为 GH runner 09:03 定时直写 Turso,无 PM2)。日报页(2026-09-05b 混合式改版):栏首封面卡≤3 + 紧凑列表行,栏目折叠/全展、排序(默认/最新/热度)、关键词高亮、渐进渲染(首批 12 行 + content-visibility),偏好存 localStorage(qwis.daily.*)。
12. **源四轴模型 + 前后台信息架构重构(2026-09-15, T5-2 / specs 26→27/27b/29/30)**：`focus` 一字段四职拆为四轴——上架 `enabled`（既有）/ 收录 `reader_visible`（新列=1）/ 订阅 `settings subscription.ids` / 重点 `spotlight`（新列）/ 屏蔽 `muted`（新列=0）；一次性迁移 focus=1→spotlight=1+订阅集初始化（幂等闸 settings `axes.migrated`，生产 Turso 已 schema-first 执行：8 源行为不变）；**`focus` 列物理保留但代码引用清零**（仅 lib/source-axes.js 迁移函数与兼容别名可读它）。`lib/source-axes.js` 为四轴唯一实现（三端共用，同 hot-events 模式）。阅读器默认「今日」滚动 24h 视图（`/api/articles?since=<ISO>` 新参数 + smart=spotlight+3d 加权），未读口径收敛近 3 天（/api/sources 与 /api/status 同口径），「全部」降级检索模式（前端门槛：无筛选条件不请求）。源库三视图（组合卡片/问题源/检索），后台 12→5 Tab（源库含平台接入/早报中心含日报设置/热点榜策展/AI 能力含翻译/系统=数据+监控+报警）+ 每 Tab 前台对照卡；抖音 Tab 下架（永不云端化决策不变）。组级操作走 `POST /api/sources/batch {groupScopeId}` 单条 SQL（云端 serverless 不可逐行循环）。

11. **源库管理 + 自动分类(2026-09-05 深夜,十期)**:管理台「源库」Tab(置首位,版心特例 1160px)统一浏览/筛选/批量管理全类型源。`routes/sourcelib.js` 提供 `GET /api/sources/library`(公开只读,含 itemCount/contentKind)、`POST /api/sources/batch`(enable 走 unfreezeSource+6h 随机错峰/focus 只增量/move 带 kind 校验+写锁定)、`POST /api/sources/autoclassify`(dryRun 预览零落库/apply 跳过锁定源,预览清单只含可执行建议——无建议条目单独计 noSuggestion)。**sourcelib 必须挂在 sources 路由之前**(决策:防 /batch 被子路由截胡,index.js 有注释)。手动锁定 = `extra.categoryLocked=1`,统一写在 `POST /api/groups/move`(Sidebar 拖拽/源库下拉/批量移动的汇聚点),自动分类永不覆盖。新源自动分类挂接三点:手动添加(sources.js POST)/OPML 同步(wechat syncOpml)/队列导入(poller resolvePending),全部 try/catch 降级不阻断建源。分类目录内置 8 类(中英别名归一+关键词表,数组顺序即优先级),落组仅精确同名同 kind 复用。破茧栏名单从 daily.js 硬编码改为 `settings['daily.cocoonFamiliar']` 可配+落组自动并入。详见 docs/specs/09-source-library-autoclassify/(spec/plan/task/checklist 四件套)。

## 3.1 模块架构(重构后)

```
server/services/
├── collectors/
│   ├── _shared.js      # 并发防护锁 + 刷新间隔计算
│   ├── _base.js        # 适配器契约校验(validateAdapter)
│   ├── registry.js     # 适配器注册表 + 契约校验
│   ├── repo.js         # 数据仓储 CRUD(saveArticles/saveVideos)
│   ├── fetcher.js      # 抓取编排(fetchSource → 落库 → enrich 触发)
│   ├── store.js        # 源生命周期(markError/unfreeze) + 兼容 re-export
│   ├── rss/            # RSS 适配器(含 fetchFulltext/cleanContent 正式导出)
│   ├── hotlist/        # 热榜适配器
│   └── ...             # bilibili/douyin/wechat/x
├── ai/
│   ├── _tokens.js      # titleTokens + jaccard 纯函数
│   └── daily.js        # 日报引擎
├── aihot/
│   ├── backfill.js     # AIHOT sitemap 历史回填(running 锁带 since 心跳,>30min 陈旧自动复位)
│   └── enrich.js       # AIHOT 详情页解析/富字段补写
├── scheduler/
│   ├── index.js        # 调度核心(tick/scanAndEnqueue + start/stop)
│   └── jobs/           # 独立 Job 模块
│       ├── daily.js    # 日报定时
│       ├── fulltext.js # 全文补抓
│       ├── opml.js     # OPML 同步
│       ├── maintenance.js # 数据清理+报警清理+健康自检
│       ├── portal.js   # 门户同步
│       └── recovery.js # 中断恢复
├── queue/
│   ├── taskQueue.js    # SQLite 任务队列(优先级/重试/同源去重/崩溃恢复)
│   └── poller.js       # 云端队列轮询器(wechat/bilibili/douyin)
├── events.js           # 事件聚合(引用 _tokens.js，不依赖 daily.js)
├── classify.js         # 源自动分类(十期):分类目录/关键词兜底/OPML 层级解析/落组/存量预览&执行
└── alerts.js           # 报警引擎
```

## 4. 数据通路(按源类型)

| 类型 | 通道 | 注意 |
|---|---|---|
| hotlist(热榜) | newsnow `/api/s?id=&latest` | url 规范 `hotlist://{id}`;**必须带浏览器 UA**;hover 摘要可能乱码(西里尔特征丢弃) |
| 公众号(rss) | wechat2rss.bestblogs.dev 托管 feed | 全文在 `content:encoded`;图片走对方 img-proxy(防盗链已解决,但系单点依赖) |
| rss | rss-parser + `customFields:['content:encoded','content']`(缺了会丢全文) | GBK 页面用 fetchHtmlSmart charset 嗅探 |
| bilibili | wbi 签名 + 合集/搜索兜底 | 风控 -352 时走兜底 |
| 抖音 | Playwright + 登录态 | **仅本地**,云端不跑 |

## 5. 已知坑（血泪史 → 已迁至 docs/pitfalls/ 踩坑库）

> 全部坑已按域拆分到 **`docs/pitfalls/`** 单独文件（2026-09-13 重构），每条含症状/根因/规则/案例，换手必读。
> 本节只留索引，编号全局通用（历史文档引用的坑 #N 不变）：**条数以 pitfalls/ 为准，本表不写死数字**（AGENTS.md §2.5 单一事实源）。

| 域 | 文件 | 坑编号 | 一句话核心 |
|---|---|---|---|
| 采集与信源 | `docs/pitfalls/collection.md` | #4 #6 #7 #9 #19 #28 #29 #30 #35 | 三份实现同步改；浏览器 UA；反爬熔断是常态；大查询禁携全文；**熔断=45min 抖动锁源 48h，三端自愈语义不一致** |
| 后端与数据 | `docs/pitfalls/backend.md` | #10 #11 #12 #14 #15 #16b #17 #23 #25 #31 #33 #36 | 游标同型；无索引大查询云端必炸；focus 双语义；超长 OR 链必须平衡二叉树（表达式树深度上限 100）；**被 catch 隔离的静默 ReferenceError**；**`typeof null==='object'` 把 NULL 写成 `'null'` 字面串** |
| AI 管线 | `docs/pitfalls/ai.md` | #8 #24 #26 #32 #34 #A1 #A2 | settings 覆盖 env 先查残留；推理模型输出三层清洗；**多写者产物表读取按档位不按时间**；**深析必须有否决权/入报必须有分数门槛** |
| 前端 | `docs/pitfalls/frontend.md` | #1 #2 #16 #F1 #54 | 防盗链；hook 必须在早退 return 前；**`flex-1` 基准 0 的主列会被无界兄弟挤到 0 宽，而 0 宽下 line-clamp 不封顶（B85 的 594px 空框）** |
| 部署与运维 | `docs/pitfalls/deployment.md` | #5 #20 #21 #22 #D1 #D2 | 密钥三处同步；vercel.json 无 crons；push 后验远端 SHA |
| 测试 | `docs/pitfalls/testing.md` | #13 #18 #27 #T1 #T2 | 云端测试直打生产库；全量替换语义必须快照还原；**还原必须断言，否则报警链路被写坏两天无人知** |

## 6. 凭据与配置位置

| 凭据 | 位置 |
|---|---|
| 情报系统配置 | `D:\全网情报系统\.env`(PORT/代理/云队列/ADMIN_USER/ADMIN_PASSWORD/AUTH_SECRET)+ settings 表 |
| 本地代理（Clash） | `http://127.0.0.1:12000`（2026-09-13 实测，旧 7890 已失效）；git 已配 http.proxy=127.0.0.1:12000 |
| Turso | `.env` 的 TURSO_DATABASE_URL/TURSO_AUTH_TOKEN;Vercel 项目环境变量(production) |
| COLLECT_KEY | Vercel env + GitHub repo Secrets(Actions) + 本地 .env —— **三处必须同步**(坑 #20) |
| GitHub PAT(管理 Secrets/查日志) | `docs/HANDOVER.md` §1.5(该文件已 gitignore,勿提交;稳定后轮换) |
| cron-job.org API Key | `docs/HANDOVER.md` §1.5；外置触发器 jobId 8430047 的管理 Key（该触发器是采集**主力**：每 15min POST workflow_dispatch，GH schedule 仅备份）；任务配置内嵌上方 GitHub PAT，PAT 轮换时须同步更新 cron-job，控制台 <https://console.cron-job.org/dashboard> |
| 云端管理口令 | Turso settings `admin.passwordHash`(首次访问设置) |
| 报警渠道 | settings `alerts`(本地) / Turso settings(云端);支持钉钉/企微/飞书/Server酱/Bark/TG/自定义 webhook |
| ~~微信读书 Cookie / we-mp-rss SECRET_KEY~~ | **已随 we-mp-rss 退役作废**(2026-09-04);credentials 表 weread 行可不再维护 |

## 7. 运维手册

- **启动**:`D:\全网情报系统\start-all.bat`(起主系统)
- **重启情报系统**:`restart-server.bat`(按端口找 PID,管理员运行)
- **手动同步门户(历史脚本)**:portal 独立仓库已合并进根项目,`node tools/sync-portal.js` / `sync-portal.bat` 现存用途仅为导出静态 JSON 快照兜底(export-portal.js),推送分支不再生效
- **健康自检**:根目录 `npm test`;冒烟 `node smoke-test.js`(生产库副本上跑,零副作用);云端 `node tools/audit-cloud.js`(19 项)
- **日志**:主进程 console
- **详细 runbook**:`docs/RUNBOOK.md`(唯一现行运维手册,2026-09-04 整合);平台指南 `docs/ANDROID_SUBMIT_GUIDE.md`、`docs/X_SETUP_GUIDE.md`;历史文档全部在 `archive/`

## 8. 测试约定

- node:test,`tests/*.test.js`,helpers.js 用 APP_DATA_DIR 隔离临时库(任何引用 server/* 的测试文件必须先 require helpers)
- 每个线上修过的 bug 必须有回归测试(regression-phase9.test.js、regression-aclass.test.js 是样板)
- 改完跑 `npm test` + `npm run build`(含 portal build),全绿才算完

## 8. 历史修复纪要（2026-09-04 ~ 09-05，已收敛归档）

> 完整过程记录已归档至 `docs/changes/archive/` 与 `docs/deprecated/`，语义权威见 `docs/features/`。速览：
- **09-04 A 类硬伤批量修复**：pending_items schema、编号参数空转、DataTab 上传契约、抖音双端点等（archive/docs-deprecated/A_CLASS_FIX_REPORT.md）。
- **09-04 we-mp-rss 退役 + bestblogs 迁移**：公众号=wechat2rss 托管 RSS（375 源入「公众号」组）；自建引擎代码移 trash/；.env WEMP_* 失效。
- **09-05 十期**：源库 Tab + 自动分类（spec：docs/specs/09-source-library-autoclassify/）。
- **09-05 视觉精修 / 信息架构修正**：设计 token 共享组件；热榜/聚合源退出文章流（默认排除，include_hot=1 豁免）；word_count 纯文本字数列替代 LENGTH(content_html)；OverviewRail 右栏（features：docs/features/my-reading.md 等）。

## 9. Agent 协作规则

1. 先读本文档 + 对应 runbook,再动手
2. 主系统 server/ 业务代码与 portal/ 云端代码**共享语义但不共享进程**,改一边要想另一边
3. 新功能默认:本地 API + 云端 API 双实现,前端一套
4. 不要引入需要无头浏览器的云端功能(抖音是本地专属)
5. 提交前:npm test 全绿 + 构建无错 + 涉及云端的跑 audit-cloud.js
