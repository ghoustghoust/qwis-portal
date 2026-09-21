# `server/` — 本地 Express 全功能端

本地开发与灾备端：多平台采集器、due 驱动的调度中心、AI 日报、云端队列、SSE 推送。

**它和 `api/`（Vercel 读层）、`tools/collect-turso.js`（GH runner）共享语义、不共享进程**——改过滤、清洗、熔断、去重、UA、抓取间隔中的任何一处，必须同步检查另外两份（AGENTS.md §1 明写这是事故源）。

## 内容

| 内容 | 说明 |
|---|---|
| `index.js` | 进程入口。**路由靠一张字面量表 + 变量 `require()` 挂载**（`const routes = { '/api/xxx': './routes/xxx' }`），所以静态可达分析看不见——删路由文件前必须回看这张表 |
| `db.js` | SQLite 入口，读 `APP_DATA_DIR` 决定库位置；测试就是靠它把库隔离到临时目录 |
| `routes/` | HTTP 路由，挂载表见 `routes/README.md` |
| `services/` | 业务服务层。`scheduler/` 是调度中心（含 7 个 job 与 6 处定时器注册）、`collectors/` 是本地采集实现、`queue/` 是云端队列轮询、`ai/` 是日报与摘要、`realtime/` 是事件总线 |
| `middleware/` | 鉴权中间件。**注册顺序是已知坑**：顺序写错会让 `/api` 整段绕过鉴权 |
| `util/` | `log.js`（分级结构化日志 + `log.mask` 敏感字段脱敏）、`http.js`（代理与超时）、`safeimg.js`、`time.js` |
| `cloud/` | `cloud/db.js`：设了 `TURSO_DATABASE_URL` 即切 Turso（`IS_CLOUD`），否则走 SQLite。<!-- doc-lint:ignore：09-19 快照，cloud/db.js 现已并入 lib/db.js -->其头注提到的那份 portal 侧副本已随 portal 退役而**不存在了**——若将来重启 Turso 迁移，别按那条注释去找文件 |

## ⚠️ 实况与文档不符

本端 `sources` 表 678 条里**只有 29 条 `enabled=1`，且全部是 hotlist**（rss 457、youtube 125、wemp 65 全部停用）。也就是说"本地=全功能灾备"目前名存实亡：真把本地端拉起来，它只会跑热榜（spec 42 AU-07）。要恢复灾备能力，得先决定这 648 条源该不该重新启用。

**不放什么**：云端读层逻辑（进 `api/`）、runner 专用采集（进 `tools/collect-turso.js`）、任何需要无头浏览器的功能上云（AGENTS.md §2.7）。

**状态**：active
