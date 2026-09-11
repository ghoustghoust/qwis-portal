# 全网情报系统 · 架构文档

> 所有 Agent 的共用上下文。改架构/流程/凭据位置时必须同步更新本文档。
> 最后更新:2026-09-11(方案A:云端采集移入 GH Actions runner 直写 Turso,Vercel 纯读层)

## 0. 部署方向决策(2026-09-11 方案A)

- **主部署:Vercel Serverless(读层 + 管理台)**——`api/` 目录为读 API,对外地址 `https://qwis-intel.vercel.app`。
- **采集主链路:GitHub Actions runner 直写 Turso**——`.github/workflows/collect.yml` 每 30min 跑 `tools/collect-turso.js`(collect/daily/cleanup 三模式),不经 Vercel 函数(根治 Hobby 10s→单次 2 源死局)。runner 海外网络,YouTube/X/RSSHub 直连。
- **Vercel 端 api/collect.js、api/daily-generate.js 保留为手动备份**(`POST ?key=COLLECT_KEY`),不再是定时链路。
- **本地 Express + SQLite**:开发/灾备用途。完整功能(含抖音 Playwright)仅在本地可用。

## 1. 系统全景

```
                        ┌─────────────────────────────────┐
                        │ GitHub Actions runner            │
                        │ 每30min 全量采集(:07/:37)         │
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

## 2. 仓库与目录

| 路径 | 说明 |
|---|---|
| `D:\全网情报系统\` | 主仓库(本地 git,非远端托管) |
| `server/` | Express 后端:routes/(API)、services/(collectors 采集器、ai/daily 日报、events 事件聚合、alerts 报警、scheduler 调度、queue 任务队列)、db.js(本地 better-sqlite3)、cloud/db.js(双模式异步层) |
| `web/` | 主前端(Vite+React+Tailwind),多入口:index.html(读者)+ admin.html(管理后台,独立 bundle) |
| `api/` | **Vercel 读层正式代码**:catch-all [...slug].js(读 API)、collect.js/daily-generate.js(手动备份端点) |
| `tools/` | 运维脚本(2026-09-04 清洁后):export-portal.js、sync-portal.js、import-bestblogs-opml.js、ops-toolkit.js、audit-cloud.js、seed-hotlist.js、seed-turso.js、setup-customer.js、gen_bat.py;一次性脚本已归档 `archive/tools/` |
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
6. **定时调度(2026-09-11 方案A 重构)**:GitHub Actions runner 直跑 `tools/collect-turso.js` 写 Turso——每 30min 全量到期源(:07/:37)、日报 09:03、快照 09:33、清理 04:13(北京时间);**不再**戳 Vercel /api/collect(Hobby 10s 死局)。本地调度器管本地采集。YouTube 源熔断阈值放宽为 10(反爬假 404/500 防误杀),其余类型仍为 3。
7. **SQLite 任务队列**(重构 Phase 5):本地调度器 tick 改为 scanAndEnqueue 入队 + TaskQueue 异步消费(并发 5，同源去重，优先级排序，崩溃恢复)。`QUEUE_ENABLED=false` 环境变量可回退串行模式。2026-09-05 补强:入队同源去重(pending/running 不重复)、retryDelayMs 退避生效(默认 30s)、job_queue 随每日数据清理自动 purge(completed>24h / failed>7d)。2026-09-05b 补强:bilibili/douyin 类型级 promise 链互斥(队列并发 5 下同平台多源不再并发,坑 #6 的串行保护补齐)。
8. **API 鉴权(2026-09-05 启用,P0)**:读者只读 GET 公开(articles/videos/hot/daily/groups/sources/status/img/settings),一切写操作 + alerts/data/backup/queue/health/auth-douyin 等敏感读接口需 Bearer JWT(POST /api/auth/login 获取,7d 有效)。中间件必须注册在路由挂载之前(index.js 有回归测试 P0-1e 锁死顺序)。密钥链:AUTH_SECRET(.env,缺省自动生成并持久化 settings auth.secret)、ADMIN_USER/ADMIN_PASSWORD(.env,默认 admin/admin123 会有启动告警)。应急回退:AUTH_DISABLED=true(仅本机调试)。前端:api.js 自动注入 Bearer,401 广播 'qwis:unauthorized' → LoginGate 弹登录框(管理台 blocking 强制登录,读者端可关闭继续只读)。token 存 localStorage('qwis.token') 全站共享。2026-09-05b 补强:GET /api/sources 的 extra 改白名单重建(intervalMin/lastError 脱敏/lastErrorAt/marksFeatured/aggregator/domain/etag/lastModified),原串不再外泄;log.mask 行内键值分支打码失效 bug 已修;api.upload 供二进制上传(DataTab 快照导入)。
9. **日报保底双保险**:定时 cron(settings daily.time,默认 08:00)+ 启动时 needsGeneration() 补跑(错过定时的场景)+ 前端打开 /daily/ 时 stale 即自动补(F3)。云端部署经 PM2 ecosystem.config.js 注入 TZ=Asia/Shanghai,定时不随服务器时区漂移。日报页(2026-09-05b 混合式改版):栏首封面卡≤3 + 紧凑列表行,栏目折叠/全展、排序(默认/最新/热度)、关键词高亮、渐进渲染(首批 12 行 + content-visibility),偏好存 localStorage(qwis.daily.*)。
10. **源库管理 + 自动分类(2026-09-05 深夜,十期)**:管理台「源库」Tab(置首位,版心特例 1160px)统一浏览/筛选/批量管理全类型源。`routes/sourcelib.js` 提供 `GET /api/sources/library`(公开只读,含 itemCount/contentKind)、`POST /api/sources/batch`(enable 走 unfreezeSource+6h 随机错峰/focus 只增量/move 带 kind 校验+写锁定)、`POST /api/sources/autoclassify`(dryRun 预览零落库/apply 跳过锁定源,预览清单只含可执行建议——无建议条目单独计 noSuggestion)。**sourcelib 必须挂在 sources 路由之前**(决策:防 /batch 被子路由截胡,index.js 有注释)。手动锁定 = `extra.categoryLocked=1`,统一写在 `POST /api/groups/move`(Sidebar 拖拽/源库下拉/批量移动的汇聚点),自动分类永不覆盖。新源自动分类挂接三点:手动添加(sources.js POST)/OPML 同步(wechat syncOpml)/队列导入(poller resolvePending),全部 try/catch 降级不阻断建源。分类目录内置 8 类(中英别名归一+关键词表,数组顺序即优先级),落组仅精确同名同 kind 复用。破茧栏名单从 daily.js 硬编码改为 `settings['daily.cocoonFamiliar']` 可配+落组自动并入。详见 docs/specs/09-source-library-autoclassify/(spec/plan/task/checklist 四件套)。

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

## 5. 已知坑(血泪史,勿再踩)

1. **mmbiz.qpic.cn 图片防盗链**:加 `referrerpolicy="no-referrer"`;封面走 `/api/img` 代理(服务端无 Referer)。
2. **微信文章懒加载**:`data-src` → 必须转 `src`(cleanContent 已处理)。
3. ~~we-mp-rss 列表分页是 limit/offset~~(已随 we-mp-rss 退役作废,2026-09-04)。
4. **fetch 超时**:无头抓取/全文补抓要限速(微信 3s/篇)。
5. **bat 文件必须 GBK 编码**(cmd 按 ANSI 解析),用 `tools/gen_bat.py` 生成,别手改。
6. **调度器串行是有意的**:抖音/B站并发会被秒封。
7. **熔断机制**:源连失 3 次自动 enabled=0,修好后手动启用会清零 fail_count。
8. **日报出库安检**:乱码标题/风控错误页不得入报(daily.js hasMojibake/isErrorPageItem)。
9. **云端/本地采集语义双实现漂移**:Vercel 端 `portal/api/_collect.js`、`portal/api/_daily.js` 是主系统 `server/services/collectors/*`、`server/services/ai/daily.js` 的移植副本(非同步),写 Turso 云库。**修改任何采集语义(过滤/清洗/熔断/去重/增量)必须同步检查云端副本**，否则漂移。（例：2026-09-02 P0-2 修了 rss/index.js 的 pubDate 过滤器；已核实云端 `_collect.js fetchRss` 当时无同样过滤逻辑，故无需双改）
10. **better-sqlite3 编号参数 `?1 ?2 ?3` 不支持位置绑定**(`.run(a,b,c)` 必抛 RangeError):一律用匿名 `?` 或命名参数对象。(2026-09-04 全文补抓 UPDATE 曾因此空转)
11. **异步回调(setImmediate/cron)内的同步 DB 操作必须 try/catch**:prepare 引用不存在的列会抛成 uncaughtException 崩进程。(2026-09-04 pending_items 事件)
12. **pending_items 表结构只有 (id,type,url,name,status,error,imported_at)**——无 source_id/created_at;文章关联一律经 url JOIN articles 取 a.id。
13. **smoke-test.js 跑的是生产库副本**(启动时 backup 到临时目录 + APP_DATA_DIR 注入,结束清理);任何测试文件 require server 模块前必须先 require tests/helpers,严禁直写 data/app.db。
14. **Express 中间件按注册序执行**:鉴权/防护类中间件必须注册在路由挂载之前——2026-09-04 前 authMiddleware 挂在路由之后导致全 API 零鉴权(已修复并有 P0-1e 回归锁)。
15. **aggregator 是 `extra` JSON 标志,不是 sources.type 取值**:判断聚合源一律 `json_extract(COALESCE(extra,'{}'),'$.aggregator')=1`(2026-09-05 前 fulltext.js 的 `type != 'aggregator'` 恒真,曾导致 AIHOT 条目被越权直抓第三方原站)。
16. **正则从 HTML 属性取 URL 必须解 `&amp;` 实体**:firstImg 用正则取 `<img src>`,原始属性值里的 `&` 是 `&amp;`,不解码会让 wechat2rss img-proxy 收到错误参数(`amp;u`)封面全挂;JSDOM 取的属性(og:image)已自动解码无需处理。阅读器文章流默认排除 hotlist/聚合源(见 §8.4)。
16. **cron 任务必须模块级句柄管理**:reschedule() 会重复调 scheduleXxx(),不停旧就叠加(2026-09-05b 前 fulltext cron 每改一次设置多挂一个,已修:fulltext.js stopFulltextRecovery + scheduler stop() 清理)。同理长任务禁同步执行:门户同步曾 execSync 阻塞主进程数分钟,已改 spawn detached 子进程 + in-flight 守卫(jobs/portal.js)。
17. **focus 有两种写法,选错会互踩**:日报设置页 `focusSourceIds` 是全量替换(不在名单的源 focus 清零);源库 batch focus/unfocus 是逐 id 增量。**新代码一律用增量**,全量替换只保留在日报设置页那一个入口。手动改归锁定统一走 `extra.categoryLocked`(写入点只有 `POST /api/groups/move` 与 batch move),判断用 `json_extract(COALESCE(extra,'{}'),'$.categoryLocked')` 或 JSON.parse 后读键,别新加列。
18. **回归测试必须驱动真实路由**:在测试体内手写与实现相同的 SQL 再断言自己,实现改了测试照样绿(2026-09-05 验收发现 3 例空转)。路由行为测试一律起 express 实例打真实 HTTP(tests/regression-sourcelib.test.js 是样板:app.listen(0)+generateToken+fetch)。
19. **newsnow 热榜 API 必须浏览器 UA**(2026-09-11):自定义 UA(qwis-collector/1.0)直接 403,曾致 29 个热榜源云端全灭、19 个被熔断停用。采集链路(api/collect.js、tools/collect-turso.js)UA 统一为 Chrome。
20. **GH Actions Secrets 与 Vercel env 是两套独立存储**(2026-09-11):COLLECT_KEY 只改一边 → 全部定时任务 403 静默失败 2 天才发现。改密钥必须三处同步(本地 .env / Vercel env / GH Secrets),且要有失败告警。
21. **vercel.json 不做 ${VAR} 插值,且 Vercel Cron 用 GET**:crons 块里写 `?key=${COLLECT_KEY}` 传的是字面量;collect.js 只收 POST → 该 cron 从未生效(已移除,定时管线全归 GH Actions)。
22. **外部 undici 包的 ProxyAgent 不能喂给 Node 内置 fetch**(符号不兼容,一律 "fetch failed"):走代理必须配套用 undici 包自带的 fetch(tools/collect-turso.js 参考实现)。进程退出用 exitCode 自然退出,process.exit 会触发 libuv UV_HANDLE_CLOSING 断言(exit 127)。
23. **无索引列上大表查询在 libsql 远程是致命的**(2026-09-11):articles 3.6 万行+全文列后,`MAX(created_at)`、`WHERE created_at>=?`、`ORDER BY COALESCE(published_at,created_at)` 全表扫描 43-46s → Vercel 30s 超时全线 504。修复:补 `idx_articles_created` + 表达式索引 `idx_articles_pubco`(查询 0.1s)。**新增高频过滤/排序列时必须同步建索引,本地 better-sqlite3 快感觉不出来,云端必炸**。
24. **Agnes AI 的 key 绑调用方 IP 地区**(2026-09-11):同一 key 从亚洲 IP(Clash 香港出口)200,从 Azure US(GH runner)返回 401 "api key invalid"。**Vercel 函数区域必须固定 hnd1(东京)**(vercel.json regions,顺带与 Turso 东京同区降延迟);runner 侧翻译需 DEEPSEEK_API_KEY 回退(llmChat 已内置双供应商链)。另外 Vercel env 曾缺 AGNES_API_KEY(HANDOVER 文档写了但实际没配)——**文档与真实配置要实测核对,不能信纸面**。

## 6. 凭据与配置位置

| 凭据 | 位置 |
|---|---|
| 情报系统配置 | `D:\全网情报系统\.env`(PORT/代理/云队列/ADMIN_USER/ADMIN_PASSWORD/AUTH_SECRET)+ settings 表 |
| Turso | `.env` 的 TURSO_DATABASE_URL/TURSO_AUTH_TOKEN;Vercel 项目环境变量(production) |
| COLLECT_KEY | Vercel env + GitHub repo Secrets(Actions) + 本地 .env —— **三处必须同步**(坑 #20) |
| GitHub PAT(管理 Secrets/查日志) | `docs/HANDOVER.md` §1.5(该文件已 gitignore,勿提交;稳定后轮换) |
| 云端管理口令 | Turso settings `admin.passwordHash`(首次访问设置) |
| 报警渠道 | settings `alerts`(本地) / Turso settings(云端);支持钉钉/企微/飞书/Server酱/Bark/TG/自定义 webhook |
| ~~微信读书 Cookie / we-mp-rss SECRET_KEY~~ | **已随 we-mp-rss 退役作废**(2026-09-04);credentials 表 weread 行可不再维护 |

## 7. 运维手册

- **启动**:`D:\全网情报系统\start-all.bat`(起主系统)
- **重启情报系统**:`restart-server.bat`(按端口找 PID,管理员运行)
- **手动同步门户**:`node tools/sync-portal.js` 或 `sync-portal.bat`
- **健康自检**:根目录 `npm test`;冒烟 `node smoke-test.js`(生产库副本上跑,零副作用);云端 `node tools/audit-cloud.js`(19 项)
- **日志**:主进程 console
- **详细 runbook**:`docs/RUNBOOK.md`(唯一现行运维手册,2026-09-04 整合);平台指南 `docs/ANDROID_SUBMIT_GUIDE.md`、`docs/X_SETUP_GUIDE.md`;历史文档全部在 `archive/`

## 8. 测试约定

- node:test,`tests/*.test.js`,helpers.js 用 APP_DATA_DIR 隔离临时库(任何引用 server/* 的测试文件必须先 require helpers)
- 每个线上修过的 bug 必须有回归测试(regression-phase9.test.js、regression-aclass.test.js 是样板)
- 改完跑 `npm test` + `npm run build`(含 portal build),全绿才算完

## 8.1 2026-09-04 A 类硬伤修复(详见 archive/docs-deprecated/A_CLASS_FIX_REPORT.md)

pending_items schema 崩溃链、enrichMissing id 错用、调度器清理路径错误、全文补抓编号参数空转、hotlist score 落库、DataTab 契约错位+真实上传导入(POST /api/data/upload)、抖音登录双端点(/api/auth/douyin/status|start)、AlertsTab 删除(api.del + DELETE /api/alerts/log/:index 带 at 指纹)、portal src-admin 重复声明修复、backfill.js→_backfill.js、解冻脚本保留 extra、smoke 副本隔离;另修 clearCooldowns 键写错、aihot-parse 测试隔离。

## 8.2 2026-09-04 we-mp-rss 退役 + bestblogs 源迁移(详见 archive/docs-deprecated/A_CLASS_FIX_REPORT.md 第三轮)

- **迁移**:`node tools/import-bestblogs-opml.js` 把 opml/ 三个 OPML 导入——wechat2rss 公众号 375(type='rss',分组「公众号」)、YouTube 124(type='youtube',分组「YouTube」)、播客 53(type='rss',分组「播客」);旧 65 个 wemp 源 enabled=0(历史文章保留)。首刷 next_fetch_at 在 6h 内随机错峰。执行前快照 `data/backups/app-20260904-180351.db`。
- **退役代码**(均移 trash/):services/wempSupervisor.js、routes/wemp.js、collectors/wemp/、web WempTab.jsx、tests/wemp-routes.test.js、tools/wemp-*/seed-mp-library/fix-wemp-shells 等;scheduler wemp 心跳、alerts 的 wemp_down/wemp_cookie_expired 事件、health 的 wemp 字段、ops-toolkit reset-wemp 命令同步移除。
- **依赖减一**:不再需要 Python/we-mp-rss 子进程;.env 的 WEMP_* 变量全部失效可删。

## 8.3 2026-09-05 十期:源库管理 + 源自动分类(四件套 docs/specs/09-source-library-autoclassify/)

- **源库 Tab**(管理台首位):全类型源统一列表(含停用/熔断/已退役 wemp/marksFeatured 标记源),四筛选(类型/文件夹/状态)+搜索+本地分页,批量启用/停用/特别关注/移动,单源改组下拉(同 kind 过滤),累计条目数(区别未读数口径)。
- **自动分类**:内置 8 类目录(bestblogs OPML 中英别名归一 + 关键词兜底);OPML 层级解析(buildOpmlCategoryMap,YouTube 8 类/播客 7 类;公众号 OPML 扁平天然不适用);新源三挂接点自动入组;存量回填 dryRun 预览(默认只列可执行变更,无建议条目计 noSuggestion)→ 勾选确认 → apply。
- **验收修复**:P2-1 预览口径(无建议条目不再计入变更清单);P2-2 测试空转(3 例重述实现式测试重写为真实路由驱动,新增 401/dryRun 回归锁,tests 168 全绿)。
- 前端新增 `SourceLibraryTab.jsx`/`BackfillPreviewModal.jsx`,icons.jsx +6(Folder/Search/Filter/Sparkles/Lock/Library)。

## 8.3 2026-09-05 视觉精修（排版向，不改主题配色）

- **设计 token**:`web/src/index.css` 新增 `.pill/.meta/.card-lift/.stat-num/.unread-bar/.stars/.badge-red/.badge-gray/.avatar-fallback`,全部 var() 驱动三主题自适应;共享组件 `web/src/components/ui/`(TagPills/Stars/SourceAvatar/StatCard);util.js 新增 parseTags/formatWords/readingMinutes/sourceLabel(HotPage/HotDetail 已改共享引用)。
- **后端纯增量**:articles LIST_FIELDS 增加 `tags/reason/content_len`(LENGTH 估算);status 增加 `overview`(enabledSources/todayNew/weekNew/dailyItemCount/dailyTopSources,公开只读);日报 sections 条目条件透传 score/tags。
- **结构性新功能**:阅读器文章模式未选中文章时右栏渲染 `OverviewRail`(本周概览 2×2 + 近7天入早报 Top5 + 使用提示)。
- **回归测试**:tests/regression-ui-data.test.js(UI-D1~D3)。
- **顺手修复**:scheduler 增加 `started` 守卫——reschedule() 在未启动进程(测试/脚本)中不再自启调度器(曾致全量测试挂起);LoginModal 去掉用户名预填 admin。

## 8.4 2026-09-05 阅读器信息架构修正(热榜/聚合源退出文章流)

- **问题**:热榜源(微博热搜等 29 个)与聚合源(AIHOT)的文章混在阅读器,未读高达 2.5 万(「综合热搜」一组 9002),文件夹聚合阅读模型失效;统计轨被噪音刷爆。
- **语义变更**:`/api/articles` 默认排除 `type='hotlist'` 与 `extra.aggregator=1` 源的文章(显式 `source_id` 或 `include_hot=1` 豁免);counts(later/history)同口径。热榜/聚合内容的阅读入口是热点榜页(/hot/),不受影响。
- **侧栏文件夹优先**:文章模式不列热榜/聚合源;无可见成员的组不渲染;分组默认折叠(localStorage `qwis.groupsCollapsed` 语义反转:false=显式展开),点组名=读该组聚合流;未分组区空时隐藏(拖拽中仍显示作投放目标)。
- **统计轨去噪**:overview 的 enabledSources/todayNew/weekNew/来源榜均排除热榜/聚合源,新增 unreadArticles。
- **数据归档**:阮一峰→编程技术、NeuralNine→编程技术(视频)、影视飓风→新建视频组「影音创作」;未分组启用源清零(备份 data/backups/app-before-group-filing-*)。
- 回归:UI-D4/D5(regression-ui-data.test.js)。
- **同轮修正**:① 阅读器列表常驻搜索框(原仅历史存档可搜,q 全 tab 透传);② 「本周概览」常驻右栏(xl 以上),正文区选中文章不再卸载它,空态由 ArticleView 自渲;③ 侧栏组行尾双数字改单未读数(成员数收进 tooltip);④ /api/reading 的 counts.all 修复为已读+稍后读并集(原误为全库文章数,「我的阅读·全部」曾显示 2.6 万);⑤ firstImg 解码 &amp; 实体(坑 #16),存量 3891 条坏封面已清洗;⑥ 我的阅读缩略图走 imgUrl 代理 + no-referrer + 失败回退源头像(reading 接口补 source_avatar);⑦ **字数虚高修复**:新增 articles.word_count 纯文本字数列(写入/全文补抓/enrich 三链路维护,存量 26677 条已回填),列表/详情/快读的「N 字·约 M 分钟」改用它——此前用 LENGTH(content_html) 把公众号内联样式算成字数(500 字新闻显示 5.2 万字)。回归 UI-D6/D7。

## 9. Agent 协作规则

1. 先读本文档 + 对应 runbook,再动手
2. 主系统 server/ 业务代码与 portal/ 云端代码**共享语义但不共享进程**,改一边要想另一边
3. 新功能默认:本地 API + 云端 API 双实现,前端一套
4. 不要引入需要无头浏览器的云端功能(抖音是本地专属)
5. 提交前:npm test 全绿 + 构建无错 + 涉及云端的跑 audit-cloud.js
