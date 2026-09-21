# `server/routes/` — 本地 HTTP 路由

22 个文件。挂载关系写在 `server/index.js` 的**字面量路由表**里（`const routes = {...}` 再由变量 `require()` 装载），所以任何静态依赖分析都会把它们误判成孤儿——**删文件前先回看那张表**。

## 挂载表（取自 `server/index.js`）

| 前缀 | 文件 | 说明 |
|---|---|---|
| `/api/settings` | `settings.js` | 含"只被回显、不真正生效"的假开关历史（白盒 W3 在盯这个） |
| `/api/sources/restore-all` | `restore-all.js` | 批量恢复熔断源，**必须早于 `/api/sources` 注册** |
| `/api/sources` | `sources.js` | 源 CRUD 与冻结/解冻 |
| `/api/groups` | `groups.js` | 分组 |
| `/api/articles` | `articles.js` | 文章列表/游标分页/since |
| `/api/videos` | `videos.js` | 视频侧（抖音/B 站/YouTube） |
| `/api/opml`、`/api/rss` | `opml.js` | **同一文件挂两个前缀**；rss 刷新走 `refresh-all` 的 type 过滤 |
| `/api/status` | `status.js` | 运行状态 |
| `/api/backup` | `backup.js` | 备份 |
| `/api/queue` | `queue.js` | 云端队列（B 站/抖音/公众号 push/pull） |
| `/api/img` | `img.js` | **SSRF 防护面**，回归锁 B18 盯这里 |
| `/api/daily` | `daily.js` | 日报 |
| `/api/hot` | `hot.js` | 热榜 |
| `/api/data` | `data.js` | 数据管理与清理 |
| `/api/auth` | `auth.js` | 登录与抖音扫码态 |
| `/api/alerts` | `alerts.js` | 报警渠道与测试发送 |
| `/api/health` | `health.js` | 健康自检 + 采集心跳，**排障入口**（AGENTS.md §4） |
| `/api/reading` | `reading.js` | 我的阅读 |
| `/api/audit` | `audit.js` | 审计流水（可审计性靠它） |
| `/api/ai` | `ai.js` | AI 能力台 |
| — | `events-sse.js`、`sourcelib.js` | **不在上面这张字面量表里**，挂载点另写；改它们前先读 `index.js` |

**不放什么**：业务规则本体（进 `lib/` 或 `server/services/`）。路由文件应保持薄——只做参数校验、调服务、拼响应。

**状态**：active
