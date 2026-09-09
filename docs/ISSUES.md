# 全网情报系统 · 已知问题清单

> 活文档，随修复进展更新。最后更新：2026-09-09（二次复检 + API 实锤验证）
> 来源：2026-09-09 Vercel 全功能复检 + 代码深度审查 + 用户批注验证 + 8 项 API 实测

---

## P0 — 功能缺失/严重缺陷

| # | 问题 | 影响 | 位置 | 状态 |
|---|------|------|------|------|
| P0-1 | **"我的阅读"页面数据缺失**：Vercel `handleReading` 只返回 counts，不返回 items/nextCursor | 页面永远显示"暂无阅读沉淀"，6508 篇文章不可见 | `api/[...slug].js` L628-634 | 🔴 待修复 |
| P0-2 | **日报生成三重路径冲突**：①`collect.yml` UTC 1:00 调 `/api/daily-generate`；②`[...slug].js` `handleDaily` getOrGenerate；③`collect.yml` UTC 1:30 快照。三者可能重复生成或互相覆盖 | 日报数据不一致或重复写入 | `collect.yml` + `api/[...slug].js` + `api/daily-generate.js` | 🟡 需统一 |
| P0-3 | **热点榜"精选"与"全部动态"内容完全一致**：`handleHot` 不处理 `tab`/`category`/`q`/`source` 参数，前端传参被忽略 | 两个 Tab 返回相同数据，筛选完全无效 | `api/[...slug].js` L211-223 | 🔴 待修复 |
| P0-4 | **翻译按钮未恢复**：`ArticleView.jsx` 无翻译触发按钮，仅有翻译后的被动显示逻辑（`hasTranslation` 徽章） | 用户无法主动触发翻译，只能阅读已被 Agencs 翻译的文章 | `web/src/components/ArticleView.jsx` | 🔴 待修复 |
| P0-5 | **页面切换加载缓慢**：每个页面（reader/hot/reading）切换时都显示"加载中…"，无数据缓存/预加载机制 | 用户体验差，每次切换等待 2-5 秒 | 前端路由 + 各页面组件 | 🟡 需优化 |
| P0-6 | **🔥 Vercel 部署代码严重过期**：`/api/meta` 返回 401（仓库已加入 PUBLIC_GET_PATHS）；日报响应含旧字段 `col_id/cocoon/videos/sortMode`（仓库已删除）；`stale` 逻辑未生效 | 上次会话的全部修复（日报 getOrGenerate、meta 白名单）均未生效，需重新部署 | Vercel 部署状态 | 🔴 **需立即重新部署** |

## P1 — 功能不完整

| # | 问题 | 影响 | 位置 | 状态 |
|---|------|------|------|------|
| P1-1 | **管理台源库 Tab 为空**：`/api/sources/library` 在 Vercel 不存在 | 管理台无法浏览/导入/管理源库 | `api/[...slug].js` dispatch | 🔴 待实现 |
| P1-2 | **报警引擎 Vercel 端缺失**：`/api/alerts` 仅在本地 Express 实现 | 云端无法触发/管理报警 | `api/[...slug].js` 无对应路由 | 🟡 待实现 |
| P1-3 | **B站采集严重过期**：serverless `fetchBilibili` 跳过 wbi 签名，仅 RSS 兜底；无 RSS 的源永远不更新 | 视频数据可能 9+ 天未更新 | `api/collect.js` L231-239 | 🟡 待排查 |
| P1-4 | **57 个源处于 error 状态**：连续 3 次失败自动暂停，但无自动恢复机制 | 采集覆盖不完整 | Turso sources 表 | 🟡 待排查 |
| P1-5 | **lastSync.rss 返回 null 字符串**：SQL `MAX(last_fetched_at)` 在无数据时返回 null | 前端状态页显示异常 | `api/[...slug].js` L588 | 🟡 待修复 |
| P1-6 | **热点榜分类筛选无效**：分类 pills 传递 `category` 参数但 `handleHot` 不处理 | 点击分类按钮无效果 | `api/[...slug].js` L211-223 | 🔴 同 P0-3 |
| P1-7 | **热点详情"推荐理由"显示 null**：`item.reason` 字段在数据库中为 null 时直接渲染 | 显示 "null" 文本 | `web/src/components/HotDetail.jsx` L34, L165-171 | 🟡 待修复 |
| P1-8 | **公众号源在 Vercel 端完全不采集**：`collect.js` 排除 `wemp` 类型 | 公众号内容只来自本地采集 | `api/collect.js` L362 | 🟡 已知限制 |
| P1-9 | **"实时流"Tab 缺失**：用户期望有基于自有 RSS 源的实时信息流，与热点榜事件流区分 | 热点榜只有事件聚合，缺少原始 RSS 实时流 | 前端 + 后端均无实现 | 🟡 待设计 |
| P1-10 | **管理台登录凭据不匹配**：`admin/admin123` 登录返回 401，Vercel 环境变量 `ADMIN_PASSWORD` 可能非默认值 | 管理台完全无法访问 | Vercel env `ADMIN_PASSWORD` | 🔴 需确认环境变量 |

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
| 源库管理 | ✅ | ❌ | 缺失 |
| 分组管理 | ✅ | ✅ | 一致 |
| 采集触发 | ✅ | ✅ | 一致 |
| 批量恢复源 | ✅ | ❌ | 缺失 |
| 日报查看 | ✅ | ✅ | 一致 |
| 日报生成 | ✅ | ✅ 双份 | 冲突 |
| 热榜 | ✅ | ✅ | 一致 |
| 事件聚合 | ✅ | ✅ | 一致 |
| 报警引擎 | ✅ | ❌ | 缺失 |
| SSE 推送 | ✅ | ❌ | 缺失 |
| OPML 导入导出 | ✅ | ❌ | 缺失 |
| 数据备份 | ✅ | ❌ | 缺失 |
| 阅读沉淀 | ✅ 完整 | ❌ 仅计数 | 缺失 |
| 批量操作 | ✅ | ❌ | 缺失 |
| Markdown 导出 | ✅ | ❌ | 缺失 |
| AI 设置 | ✅ | ✅ | 一致 |
| 健康检查 | ✅ | ❌ | 缺失 |
| 审计日志 | ✅ | ❌ | 缺失 |

---

## 修复记录

| 日期 | 修复项 | 说明 |
|------|--------|------|
| 2026-09-09 | P0-2(旧) 日报过期 | handleDaily 增加 getOrGenerate 逻辑，采集窗口改为北京时间前一天 00:00~06:00 |
| 2026-09-09 | P1-2(旧) /api/meta 401 | 加入 PUBLIC_GET_PATHS 白名单 + 新增 handleMeta 处理器 |
| 2026-09-09 | 全面复检 | 重新审查全部代码路径，发现 P0-3（热点筛选无效）、P0-4（翻译按钮缺失）、P0-1（阅读数据缺失）等新问题 |
| 2026-09-09 | **二次复检** | 8 项 API 实测确认：P0-6 部署过期（修复未生效）、P1-10 登录凭据不匹配、源数据新鲜度验证 |

---

## API 实测原始数据（2026-09-09 二次复检）

| 端点 | 状态 | 关键数据 |
|------|------|----------|
| `GET /api/status` | ✅ 200 | 638 enabled sources, 468 unread, 261 today, 5706 week; `lastSync.rss="null"`, `lastSync.bilibili=2026-08-31`（9天前!） |
| `GET /api/articles?sort=new` | ✅ 200 | 最新文章 2026-09-08T16:00Z（~18h前），来源分布正常（HN/TechCrunch/Verge/公众号等） |
| `GET /api/sources` | ✅ 200 | 返回数据（结构需确认） |
| `GET /api/daily` | ⚠️ 200 | `generated_at` 为空, `stale=false` → getOrGenerate 逻辑未部署 |
| `GET /api/meta` | 🔴 401 | 仓库代码已加入白名单但部署未更新 → **确认部署过期** |
| `GET /api/reading` | ⚠️ 200 | 仅返回 `{counts:{read:6508,later:0,all:6508}}`，无 items → P0-1 确认 |
| `GET /api/hot?tab=featured` vs `tab=all` | 🔴 相同数据 | 第一条均为"小米平板9 Pro Max…" → P0-3 确认 |
| `POST /api/auth/login` (admin/admin123) | 🔴 401 | 默认凭据不可用 → Vercel env `ADMIN_PASSWORD` 非 `admin123` |
| `DELETE /api/sources` (无 auth) | ✅ 401 | 鉴权保护正常 |
