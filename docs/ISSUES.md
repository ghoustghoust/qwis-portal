# 全网情报系统 · 已知问题清单

> 活文档，随修复进展更新。最后更新：2026-09-09（第四次深度代码扫描 v4）
> 来源：2026-09-09 重新部署 + 23 项自动化测试 + 四轮代码审查 + 用户批注验证 + 前端全量路由交叉验证

---

## P0 — 功能缺失/严重缺陷

| # | 问题 | 影响 | 位置 | 状态 |
|---|------|------|------|------|
| P0-1 | **"我的阅读"页面数据缺失**：Vercel `handleReading` 只返回 counts，不返回 items/nextCursor；**且静默忽略所有查询参数**（tab/type/q/cursor 全部无效） | 页面永远显示"暂无阅读沉淀"，6508 篇文章不可见；筛选/搜索/分页完全无效 | `api/[...slug].js` L628-634 | ✅ **已修复**（重写 handleReading，支持 UNION ALL + tab/type/q/cursor） |
| P0-2 | **日报生成三重路径冲突**：①`collect.yml` UTC 1:00 调 `/api/daily-generate`；②`[...slug].js` `handleDaily` getOrGenerate；③`collect.yml` UTC 1:30 快照。三者可能重复生成或互相覆盖 | 日报数据不一致或重复写入 | `collect.yml` + `api/[...slug].js` + `api/daily-generate.js` | 🟡 需统一 |
| P0-3 | **热点榜"精选"与"全部动态"内容完全一致**：`handleHot` 不处理 `tab`/`category`/`q`/`source` 参数，前端传参被忽略 | 两个 Tab 返回相同数据，筛选完全无效 | `api/[...slug].js` L211-223 | ✅ **已修复**（支持 tab/category/q/source 筛选 + 游标分页） |
| P0-4 | **翻译按钮未恢复**：`ArticleView.jsx` 无翻译触发按钮，仅有翻译后的被动显示逻辑（`hasTranslation` 徽章） | 用户无法主动触发翻译，只能阅读已被 Agencs 翻译的文章 | `web/src/components/ArticleView.jsx` | ✅ **已修复**（新增翻译/原文切换按钮 + 全面 i18n 中英文切换） |
| P0-5 | **页面切换加载缓慢**：每个页面切换时都显示“加载中…”，无数据缓存/预加载机制 | 用户体验差，每次切换等待 2-5 秒 | 前端路由 + 各页面组件 | ✅ **已修复**（客户端路由 pushState + hover 预取，JS 上下文跨页存活，api 缓存生效） |
| P0-6 | ~~**Vercel 部署代码过期**~~ | 已重新部署，`/api/meta` 返回 200，`/api/daily` 自动生成成功 | 部署完成 | ✅ **已修复** |
| P0-7 | **"全部标为已读"按钮 Vercel 端不可用**：前端调用 `POST /api/articles/read-all`，但 Vercel dispatch 表无此路由 | 点击后返回 404/401，功能完全不可用。本地 Express 有完整实现 | `web/src/components/ArticleView.jsx` L88 + `api/[...slug].js` dispatch | ✅ **已修复**（新增 handleArticlesReadAll + dispatch 路由） |
| P0-8 | **阅读沉淀页批量操作+导出 Vercel 端不可用**：`POST /api/reading/batch` 和 `POST /api/reading/export` 在 dispatch 表中均无路由 | 批量取消稍后读/取消收藏/移除已读 + Markdown 导出完全不可用 | `web/src/pages/MyReadingPage.jsx` L159,L177 + `api/[...slug].js` dispatch | ✅ **已修复**（新增 handleReadingBatch + handleReadingExport + dispatch 路由） |

## P1 — 功能不完整

| # | 问题 | 影响 | 位置 | 状态 |
|---|------|------|------|------|
| P1-1 | **管理台源库路由鉴权行为不明**：`/api/sources/library` 返回 401（鉴权中间件拦截），但 dispatch 表中无对应 handler | 需确认是否有实际处理逻辑 | `api/[...slug].js` dispatch | 🟡 需验证 |
| P1-2 | **报警引擎 Vercel 端鉴权行为不明**：`/api/alerts` 返回 401（鉴权中间件拦截），dispatch 表中无对应 handler | 需确认是否有实际处理逻辑 | `api/[...slug].js` dispatch | 🟡 需验证 |
| P1-3 | **B站采集严重过期**：serverless `fetchBilibili` 跳过 wbi 签名，仅 RSS 兜底；无 RSS 的源永远不更新 | 视频数据可能 9+ 天未更新 | `api/collect.js` L231-239 | 🟡 待排查 |
| P1-4 | **57 个源处于 error 状态**：连续 3 次失败自动暂停，但无自动恢复机制 | 采集覆盖不完整 | Turso sources 表 | 🟡 待排查 |
| P1-5 | **lastSync.rss 返回 null 字符串**：SQL `MAX(last_fetched_at)` 在无数据时返回 null | 前端状态页显示异常 | `api/[...slug].js` L588 | 🟡 待修复 |
| P1-6 | **热点榜分类筛选无效**：分类 pills 传递 `category` 参数但 `handleHot` 不处理 | 点击分类按钮无效果 | `api/[...slug].js` L211-223 | ✅ 同 P0-3 已修复 |
| P1-7 | **热点详情"推荐理由"显示 null**：`item.reason` 字段在数据库中为 null 时直接渲染 | 显示 "null" 文本 | `web/src/components/HotDetail.jsx` L34, L165-171 | 🟡 待修复 |
| P1-8 | **公众号源在 Vercel 端完全不采集**：`collect.js` 排除 `wemp` 类型 | 公众号内容只来自本地采集 | `api/collect.js` L362 | 🟡 已知限制 |
| P1-9 | **"实时流"Tab 缺失**：用户期望有基于自有 RSS 源的实时信息流，与热点榜事件流区分 | 热点榜只有事件聚合，缺少原始 RSS 实时流 | 前端 + 后端均无实现 | 🟡 待设计 |
| P1-10 | **管理台登录凭据不匹配**：`admin/admin123` 登录返回 401，Vercel 环境变量 `ADMIN_PASSWORD` 可能非默认值 | 管理台完全无法访问 | Vercel env `ADMIN_PASSWORD` | 🔴 需确认环境变量 |
| P1-11 | **日报手动重新生成 Vercel 端不可用**：前端 `DailyPage.jsx` 调用 `POST /api/daily/regenerate`，dispatch 表无此路由 | 管理后台无法手动触发日报重新生成 | `web/src/pages/DailyPage.jsx` L54 + `api/[...slug].js` dispatch | 🔴 待修复 |
| P1-12 | **前端 401 处理缺陷**：`handleResponse` 检查 `data.needLogin` 字段来决定是否弹出登录框，但后端 401 响应格式为 `{ ok: false, error: '...' }`，从不包含 `needLogin` | 用户 token 过期后登录弹窗不会自动弹出，用户只能看到空白页面 | `web/src/api.js` L94 vs `api/[...slug].js` L109 | ✅ **已修复**（移除 needLogin 检查，直接判断 res.status === 401） |
| P1-13 | **`handleArticleLater` Vercel 端响应不一致**：Vercel 返回 `{ ok: true }` 不含 `later` 字段，本地 Express 返回 `{ ok: true, later: 0|1 }` | 前端需自行反推状态（L77 fallback），可能导致 UI 状态不同步 | `api/[...slug].js` L668-672 vs `server/routes/articles.js` L226-232 | 🟡 待修复 |

## P2 — 逻辑冲突/双端漂移

| # | 问题 | 影响 | 位置 | 状态 |
|---|------|------|------|------|
| P2-1 | **日报引擎双份实现**：`api/daily-generate.js` 的 `generateDaily()` 与 `api/[...slug].js` 的 `generateDailyInline()` 逻辑重复但代码独立 | 维护成本高，行为可能分化 | 两个文件各 ~100 行 | 🟡 需合并 |
| P2-2 | **vercel.json 与 collect.yml 调度重复**：cleanup 同时在两处定义（UTC 20:00） | 可能重复执行 | `vercel.json` L13-18 + `collect.yml` L89-99 | 🟡 需统一 |
| P2-3 | **Vercel/本地 Express 功能严重漂移**：源库管理、报警引擎、SSE 实时推送、OPML 导入导出、批量恢复等仅在本地实现 | 云端功能残缺 | 对比 `server/routes/` vs `api/[...slug].js` | 🟡 持续跟踪 |
| P2-4 | **AUTH_SECRET 回退值 'dev-secret'**：环境变量未设时使用硬编码默认值 | 生产安全风险 | `api/[...slug].js` L96 | 🟡 待修复 |
| P2-5 | **图片代理无 SSRF 防护**：`/api/img` 可代理任意 URL | 安全隐患（Vercel 网络隔离隐式防护） | `api/[...slug].js` L783-798 | 🟡 待修复 |
| P2-6 | **LIKE '%keyword%' 慢查询**：文章搜索/筛选使用 LIKE 全表扫描 | 大数据量时性能下降 | `api/[...slug].js` L136 | 🟡 待优化 |
| P2-7 | **handleDaily 日期比较用 UTC 而非北京时间**：`genDate.toDateString() === now.toDateString()` 按 UTC 判断"同一天"，北京 9:00 前可能误判 | 日报可能在 UTC 跨日时被误认为已生成 | `api/[...slug].js` L520 | 🟡 待修复 |
| P2-8 | **Vercel 端缺失路由汇总（前端调用但 dispatch 无 handler）**：`/api/articles/read-all`、`/api/reading/batch`、`/api/reading/export`、`/api/daily/regenerate`、`/api/sources/restore-all`、`/api/sources/autoclassify`、`/api/data/*`（snapshot/restore/cleanup）、`/api/alerts/*`、`/api/settings/daily` | 对应前端功能在 Vercel 上全部返回 404/401 | `api/[...slug].js` dispatch 表 | 🟡 需逐项补齐 |

## P3 — 体验优化/低优先级

| # | 问题 | 影响 | 状态 |
|---|------|------|------|
| P3-1 | **侧栏"历史存档"与"我的阅读"功能重叠**：两者都展示已读文章 | 用户困惑 | 已知 |
| P3-2 | **热点榜文章时间显示相对值（19h）而非发布时间** | 用户无法确认文章实际发布时间 | 已知 |
| P3-3 | **热点榜分类无内容或内容一致**：AI 分类未实际执行 | 分类无意义 | 待 AI 分类集成 |
| P3-4 | **前端 GET 缓存 TTL 5s 偏短**：频繁请求时性能浪费 | 可提升到 15-30s | 待优化 |
| P3-5 | **右侧概览轨 `dailyItemCount` / `dailyTopSources` 永远为 undefined**：`handleStatus` 不返回这两个字段 | 显示为 "—" | 待实现 |
| P3-6 | **视频收藏功能未接入**：前端收藏按钮只操作 `articles.later`，`videos.favorite` 无写入路径 | 视频收藏为空 | 待排查 |
| P3-7 | **SSE 实时推送 Vercel 端不可用**：`/api/events` 仅在 Express 实现 | Vercel 端无实时推送 | 已知限制 |
| P3-8 | **21 个暂停源需定期审查** | 部分信息源缺失 | 定期审查 |

---

## 用户批注问题对照验证

| 用户批注 | 对应问题 | 根因分析 |
|----------|----------|----------|
| "侧栏×号应该是显示源的梳理而不是信息的梳理" | P3-1 | 侧栏导航项标签不清晰 |
| "历史存档和我的板块功能重叠" | P3-1 | 两个入口展示相同数据子集 |
| "这里应该是文章发出来的时候的时间" | P3-2 | 列表用 `relativeTime()` 而非 `formatDateTime()` |
| "原本有翻译的按钮，被隐藏了" | P0-4 | `ArticleView.jsx` 缺少翻译触发按钮 |
| "有的文章已被翻译，应多按钮选原文/翻译文" | P0-4 | 翻译/原文切换按钮未实现 |
| "标题没有被翻译" | P0-4 | 翻译只处理正文，标题未接入翻译流程 |
| "9.8 一条数据？9.9 无数据？" | P0-2/P1-3 | 采集调度异常或数据源过期 |
| "精选和全部动态有啥区别？" | P0-3 | `handleHot` 不处理 tab 参数 |
| "分类划分毫无作用" | P1-6 | 分类筛选后端未实现 |
| "推荐理由显示 null" | P1-7 | `reason` 字段为 null 时未做空值保护 |
| "每次切换页面加载很久" | P0-5 | 无页面缓存/预加载，每次全量请求 |
| "公众号只有一条且不是实时" | P1-8 | Vercel 端不采集 wemp 类型 |
| "全部 6508 个文章为何显示暂无" | P0-1 | `handleReading` 只返回 counts 不返回 items |
| "源刷新依赖手动点浏览器刷新" | 见下方专项分析 | 前端无轮询/SSE 自动刷新 |

---

## 项 7 专项：源自动刷新问题深度分析

### 当前机制
1. **后端采集**：`api/collect.js` 查询 `next_fetch_at <= now` 的到期源 → 逐源抓取 → 更新 `next_fetch_at`
2. **调度触发**：完全依赖 GitHub Actions cron（整点 + 夜间密集）调用 `/api/collect`
3. **前端展示**：各页面组件在 mount 时一次性请求数据，**无轮询/SSE/自动刷新机制**

### 问题根因
- **Vercel 端无 SSE**：`/api/events` 仅在本地 Express 实现（`server/routes/events-sse.js`），Vercel 的 `[...slug].js` 无此路由
- **前端无轮询**：`ReaderPage`、`HotPage`、`MyReadingPage` 都在 `useEffect` 中一次性 fetch，无 `setInterval` 或 `refetch` 逻辑
- **`useRealtime` hook 在 Vercel 端无效**：SSE 连接 `/api/events` 在 Vercel 上 404，触发重连循环
- **源间隔配置**：默认 RSS 8 小时、OPML 12 小时、B站 60 分钟——即使后端采集正常，新内容也要等下一个采集窗口

### 验证结论（2026-09-09 二次确认）
**问题未解决**。API 实测证据：
1. 前端 `ReaderPage` 仅在 mount 时一次性 fetch（L45 `useEffect`），**无 `setInterval`/轮询**
2. `useRealtime` hook 连接 `/api/events`（SSE），但 Vercel dispatch 表（L800-850）**无此路由** → 404 → 指数退避重连循环
3. `HotPage`、`MyReadingPage` 完全没有实时推送逻辑
4. 最新文章的 `published_at` 为 2026-09-08T16:00Z（约 18h 前），说明后端采集仍在运行，但前端无法自动感知
5. `lastSync.rss` 返回 `"null"` 字符串 → 无法判断 RSS 最近同步时间

### 建议方案
- **短期**：在前端添加 `setInterval` 轮询（如 ReaderPage 每 60s 检查 `/api/status` 的 `lastSync.rss` 变化，变化时刷新列表）
- **中期**：Vercel 端实现轻量 SSE 或 WebSocket（Vercel Pro 支持 streaming）
- **长期**：利用 Vercel Edge Config 或 Turso 的 live query 实现实时推送

---

## 调度冲突详细分析

### 冲突 1：日报生成三条路径
```
路径 A: collect.yml cron UTC 1:00 → POST /api/daily-generate → generateDaily()
路径 B: 用户访问 /reader → GET /api/daily → handleDaily → generateDailyInline()
路径 C: collect.yml cron UTC 1:30 → generate-snapshots.js（读取 daily_reports 生成静态 JSON）
```
- A 和 B 可能在不同时间生成两份日报（A 在 9:00 北京，B 在用户首次访问时）
- A 和 B 使用不同的生成函数（代码重复），行为可能不一致
- C 依赖 A 已正确写入 daily_reports

### 冲突 2：cleanup 双重调度
```
vercel.json crons: UTC 20:00 → /api/collect?key=...&mode=cleanup
collect.yml cron:  UTC 20:00 → /api/collect?key=...&mode=cleanup
```
- 两者完全相同，可能导致同一天执行两次 cleanup

### 冲突 3：采集调度不完整
```
vercel.json crons: 仅有 cleanup（UTC 20:00）
collect.yml cron: 整点采集 + 夜间密集 + 日报 + 快照 + cleanup
```
- vercel.json 缺少整点采集和夜间密集的 cron 定义
- 如果 GitHub Actions 出问题，整点采集完全依赖 vercel.json → 但 vercel.json 没有定义

---

## 双端功能差异矩阵

| 功能 | 本地 Express | Vercel | 差异等级 |
|------|:---:|:---:|:---:|
| 文章 CRUD | ✅ | ✅ | 一致 |
| 源管理 | ✅ | ✅ 基础 | 部分 |
| 源库管理 | ✅ | ⚠️ 鉴权拦截 | 待验证 |
| 分组管理 | ✅ | ✅ | 一致 |
| 采集触发 | ✅ | ✅ | 一致 |
| 批量恢复源 | ✅ | ❌ | 缺失 |
| 日报查看 | ✅ | ✅ | 一致 |
| 日报自动生成 | ✅ | ✅ 已验证 | 一致 |
| 热榜 | ✅ | ✅ | 一致 |
| 热榜筛选 | ✅ | ✅ 已修复 | 一致 |
| 事件聚合 | ✅ | ✅ | 一致 |
| 报警引擎 | ✅ | ⚠️ 鉴权拦截 | 待验证 |
| SSE 推送 | ✅ | ❌ | 缺失 |
| OPML 导入导出 | ✅ | ❌ | 缺失 |
| 数据备份 | ✅ | ⚠️ 鉴权拦截 | 待验证 |
| 阅读沉淀 | ✅ 完整 | ✅ 已修复 | 一致 |
| 批量操作 | ✅ | ✅ 已修复 | 一致 |
| Markdown 导出 | ✅ | ✅ 已修复 | 一致 |
| AI 设置 | ✅ | ✅ | 一致 |
| Meta 信息 | ✅ | ✅ 已修复 | 一致 |
| 健康检查 | ✅ | ⚠️ 鉴权拦截 | 待验证 |
| 审计日志 | ✅ | ❌ | 缺失 |

---

## 修复记录

| 日期 | 修复项 | 说明 |
|------|--------|------|
| 2026-09-09 | P0-2(旧) 日报过期 | handleDaily 增加 getOrGenerate 逻辑，采集窗口改为北京时间前一天 00:00~06:00 |
| 2026-09-09 | P1-2(旧) /api/meta 401 | 加入 PUBLIC_GET_PATHS 白名单 + 新增 handleMeta 处理器 |
| 2026-09-09 | 全面复检 | 重新审查全部代码路径，发现 P0-3（热点筛选无效）、P0-4（翻译按钮缺失）、P0-1（阅读数据缺失）等新问题 |
| 2026-09-09 | **二次复检** | 8 项 API 实测确认：P0-6 部署过期（修复未生效）、P1-10 登录凭据不匹配、源数据新鲜度验证 |
| 2026-09-09 | **重新部署** | commit `b0c3b50` → `vercel --prod`，Build 20s 成功 |
| 2026-09-09 | **P0-6 ✅ 已修复** | `/api/meta` 返回 200（32317 articles, 973 videos, 650 sources） |
| 2026-09-09 | **日报自动生成 ✅ 已验证** | `/api/daily` 触发 getOrGenerate，生成 2026-09-09T12:25:42Z 日报（128 candidates, 25 items） |
| 2026-09-09 | **部署后全量测试** | 21 项测试：PASS=11, WARN=5, FAIL=5。P0-1/P0-3 仍未修复 |
| 2026-09-09 | **第四次深度扫描** | 前端全量写操作路由交叉验证，新发现 P0-7（read-all 缺失）、P0-8（batch/export 缺失）、P1-11（daily/regenerate 缺失）、P1-12（401 needLogin 不匹配）、P1-13（later 响应不一致）、P2-8（缺失路由汇总） |
| 2026-09-09 | **P0-1/P0-3/P0-7/P1-12 修复** | P0-1 重写 handleReading（UNION ALL + 分页）；P0-3 handleHot 支持 tab/category/q/source 筛选；P0-7 新增 read-all 路由；P1-12 修复 401 处理（移除 needLogin 检查）。详见 `docs/specs/P1-12-401-handling-fix.md` |
| 2026-09-09 | **P0-5/P0-8 修复** | P0-5 客户端路由改造（pushState 替代整页跳转 + hover 预取 api 缓存）；P0-8 新增 reading/batch（批量操作）+ reading/export（Markdown 导出）路由 |
| 2026-09-09 | **P0-4 + i18n 中英文切换** | P0-4 新增翻译/原文切换按钮；新建 i18n.jsx（轻量级 Context + localStorage 双语方案）；main/Sidebar/ArticleView/HotPage/MyReadingPage/LoginModal 全面接入 t() |

---

## 部署后全量测试原始数据（2026-09-09 20:25 第三次复检）

> 部署 commit: `b0c3b50` · Build 20s · 含 AiSettingsTab + handleMeta + getOrGenerate

| # | 端点 | 结果 | 说明 |
|---|------|------|------|
| 1 | `GET /api/status` | ✅ 200 | 638 enabled, 468 unread, lastSync.rss=null, bilibili=Aug 31 |
| 2 | `GET /api/articles?sort=new` | ✅ 200 | 30 items, latest=2026-09-08T16:00Z |
| 3 | `GET /api/hot` | ✅ 200 | 200 items |
| 4 | `GET /api/hot/events` | ⚠️ 200 | 0 events（可能正常：当日无聚合事件） |
| 5 | `GET /api/daily` | ✅ **200** | **auto-generated at 2026-09-09T12:25:42Z**, 128 candidates, 25 items, 2 sections |
| 6 | `GET /api/sources` | ✅ 200 | 正常返回 |
| 7 | `GET /api/groups` | ✅ 200 | 0 groups |
| 8 | `GET /api/settings` | ✅ 200 | keys: ok, daily, intervals |
| 9 | `GET /api/meta` | ✅ **200** | articles=32317, videos=973, sources=650, lastUpdated=2026-09-09T03:17Z |
| 10 | `GET /api/reading` | 🔴 200 | **STILL broken**: only counts (read=6508), no items |
| 11 | `GET /api/hot?tab=featured` vs `all` | 🔴 相同 | 200 items, same IDs → **P0-3 未修复** |
| 12 | `POST /api/sources/1/toggle` (no auth) | ✅ 401 | 鉴权正常 |
| 13 | `PUT /api/ai/config` (no auth) | ✅ 401 | 鉴权正常 |
| 14 | SQL injection test | ✅ safe | 安全处理 |
| 15 | `GET /api/articles/9999999` | ✅ 404 | 不存在文章正确 404 |
| 16 | `GET /api/nonexistent` | ⚠️ 401 | 鉴权先于 dispatch，合理 |
| 17 | `POST /api/auth/login` (admin/admin123) | 🔴 401 | env ADMIN_PASSWORD 非默认值 |
| 18 | `GET /api/sources/library` | ⚠️ 401 | 鉴权拦截，dispatch 无 handler |
| 19 | `GET /api/alerts` | ⚠️ 401 | 鉴权拦截，dispatch 无 handler |
| 20 | `GET /api/backup` | ⚠️ 401 | 鉴权拦截 |
| 21 | `GET /api/health` | ⚠️ 401 | 鉴权拦截 |

**汇总：PASS=11, WARN=5, FAIL=5**（总计 21 项）
