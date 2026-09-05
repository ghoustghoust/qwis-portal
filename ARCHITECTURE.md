# 全网情报系统 · 架构移交文档

> 所有 Agent 的共用上下文。改架构/流程/凭据位置时必须同步更新本文档。
> 最后更新:2026-09-05(全面清理过时引用,统一术语)

## 0. 部署方向决策(2026-09-04,用户拍板,勿再遗忘)

- **目标云端形态:宝塔/自有服务器全量部署**——Express+SQLite 主系统 + 抖音 Playwright 全部上服务器(PM2,ecosystem.config.js 即为此准备),本地机即生产机。公众号走 wechat2rss 托管 RSS(无自建引擎)。Vercel portal 已进入冻结态。原因:Vercel 不适合承载重前端,serverless 副本维护成本高。
- **Vercel portal(qwis-portal)进入冻结态**:迁移完成前只修安全项(图片代理白名单、危险写接口鉴权),功能语义不再逐条对齐本地;已知漂移清单见 A_CLASS_FIX_REPORT 之后的审计归档,不再投入修复。
- 迁移完成后:portal 仓库归档,GH Actions 采集与快照同步下线,Turso 退役,对外读者端由宝塔上的主系统直接服务。

## 1. 系统全景

```
                        ┌─────────────────────────────┐
                        │  GitHub Actions(每小时定时)   │
                        └─────────────┬───────────────┘
                                      │ POST /api/collect?key=
                                      ▼
┌──────────────────┐        ┌──────────────────────────┐
│  本地机(灾备/存档)  │        │  云端(Vercel + Turso,冻结态)│
│                  │        │                          │
│  情报系统 :3000   │ 快照同步 │  qwis-portal.vercel.app   │
│  ├ Express+SQLite│ ──────▶ │  ├ serverless API(Turso) │
│  ├ 阅读器/日报/热榜 │ (每2h)  │  ├ 读者前端(完整三页面)    │
│  ├ /admin/ 管理台 │        │  ├ /admin/ 云端管理(有口令) │
│  └ 采集调度器      │        │  └ 采集函数(GH Actions 驱动)│
└──────────────────┘        │  Turso(twis, 东京)        │
   公众号 = wechat2rss       └──────────────────────────┘
   RSS 源(无自建引擎)
```

**两套部署「共享语义但不共享代码」**(portal 前端 = 主前端构建;云端 API 是 server/ 的移植副本,读 Turso;本地 API 读 SQLite)。本地是"全功能 + 灾备存档";云端为过渡形态,语义已漂移(热点榜数据源、日报候选类型、熔断计数位置等均不一致),冻结期间**不要**再以"同构同码"假设双端行为一致。

## 2. 仓库与目录

| 路径 | 说明 |
|---|---|
| `D:\全网情报系统\` | 主仓库(非 git) |
| `server/` | Express 后端:routes/(API)、services/(collectors 采集器、ai/daily 日报、events 事件聚合、alerts 报警、scheduler 调度)、db.js(本地 better-sqlite3)、cloud/db.js(双模式异步层) |
| `web/` | 主前端(Vite+React+Tailwind),多入口:index.html(读者)+ admin.html(管理后台,独立 bundle) |
| `portal/` | Vercel 项目(独立 git 仓库 ghoustghoust/qwis-portal,**冻结态**):api/(serverless catch-all [...slug].js)、public/data/(静态快照兜底)、构建自主前端 ../web |
| `tools/` | 运维脚本(2026-09-04 清洁后):export-portal.js、sync-portal.js、import-bestblogs-opml.js、ops-toolkit.js、audit-cloud.js、seed-hotlist.js、seed-turso.js、setup-customer.js、gen_bat.py;一次性脚本已归档 `archive/tools/` |
| `archive/` | 全部历史资产:reports/(修复报告)、specs/(一~八期)、docs-deprecated/、analysis/、_eval/(参考工程)、tools/(一次性脚本)、测试/ |
| `opml/` | bestblogs 源清单(wechat2rss 375 公众号 / youtube 124 / podcast 60),2026-09-04 已导入 |
| ~~`D:\tools\we-mp-rss\`~~ | **已退役(2026-09-04)**:公众号改走 wechat2rss 托管 RSS,不再自建引擎;代码移 trash/,旧 wemp 源 enabled=0 保留历史文章 |

## 3. 关键架构决策(为什么这么设计)

1. **采集必须在本地/云端函数,不能在浏览器**——风控与 Cookie。
2. **公众号 = wechat2rss 托管 RSS**(2026-09-04 起):自建 we-mp-rss(Python 子进程 + 微信读书 Cookie)已退役——太重且未内部集成。375 个 bestblogs wechat2rss 源以 type='rss' 导入,正文在 `content:encoded`(rss 适配器已读),图片由对方 img-proxy 代理(单点依赖,已知情接受);缺失的 28 个原 wemp 源接受损失。
3. **catch-all serverless**:Vercel Hobby 限 12 个函数,portal/api/[...slug].js 单函数路由全部 /api/*。
4. **云端读 Turso 优先,静态 JSON 快照兜底**(portal/public/data/)。
5. **管理后台是独立 bundle**(admin.html),不随读者前端分发;云端 /admin/ 有口令(httpOnly cookie)。
6. **定时双轨**:GitHub Actions 每 15min 戳云端 /api/collect;本地调度器管本地采集+快照同步。

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

## 6. 凭据与配置位置

| 凭据 | 位置 |
|---|---|
| 情报系统配置 | `D:\全网情报系统\.env`(PORT/代理/云队列)+ settings 表 |
| Turso | `.env` 的 TURSO_DATABASE_URL/TURSO_AUTH_TOKEN;Vercel 项目环境变量(production) |
| COLLECT_KEY | Vercel env + GitHub repo Secrets(Actions) |
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

## 8.1 2026-09-04 A 类硬伤修复(详见 A_CLASS_FIX_REPORT.md)

pending_items schema 崩溃链、enrichMissing id 错用、调度器清理路径错误、全文补抓编号参数空转、hotlist score 落库、DataTab 契约错位+真实上传导入(POST /api/data/upload)、抖音登录双端点(/api/auth/douyin/status|start)、AlertsTab 删除(api.del + DELETE /api/alerts/log/:index 带 at 指纹)、portal src-admin 重复声明修复、backfill.js→_backfill.js、解冻脚本保留 extra、smoke 副本隔离;另修 clearCooldowns 键写错、aihot-parse 测试隔离。

## 8.2 2026-09-04 we-mp-rss 退役 + bestblogs 源迁移(详见 A_CLASS_FIX_REPORT.md 第三轮)

- **迁移**:`node tools/import-bestblogs-opml.js` 把 opml/ 三个 OPML 导入——wechat2rss 公众号 375(type='rss',分组「公众号」)、YouTube 124(type='youtube',分组「YouTube」)、播客 53(type='rss',分组「播客」);旧 65 个 wemp 源 enabled=0(历史文章保留)。首刷 next_fetch_at 在 6h 内随机错峰。执行前快照 `data/backups/app-20260904-180351.db`。
- **退役代码**(均移 trash/):services/wempSupervisor.js、routes/wemp.js、collectors/wemp/、web WempTab.jsx、tests/wemp-routes.test.js、tools/wemp-*/seed-mp-library/fix-wemp-shells 等;scheduler wemp 心跳、alerts 的 wemp_down/wemp_cookie_expired 事件、health 的 wemp 字段、ops-toolkit reset-wemp 命令同步移除。
- **依赖减一**:不再需要 Python/we-mp-rss 子进程;.env 的 WEMP_* 变量全部失效可删。

## 9. Agent 协作规则

1. 先读本文档 + 对应 runbook,再动手
2. 主系统 server/ 业务代码与 portal/ 云端代码**共享语义但不共享进程**,改一边要想另一边
3. 新功能默认:本地 API + 云端 API 双实现,前端一套
4. 不要引入需要无头浏览器的云端功能(抖音是本地专属)
5. 提交前:npm test 全绿 + 构建无错 + 涉及云端的跑 audit-cloud.js
