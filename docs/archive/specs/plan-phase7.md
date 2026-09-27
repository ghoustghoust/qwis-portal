# 七期 Plan：热点榜全量对齐 AIHOT

> 依据已批准的 spec-phase7.md（F1~F6 / N1~N6 / AC1~AC7）。
> 前置技术侦察结论：AIHOT 详情页 SSR HTML + RSC payload 含全部所需字段（评分 aria-label、m-detail-reason-text 推荐理由、标签、#article-body 中文正文、RSC 内 zhHtml/originalHtml 双语全文）；feed 系列无评分；sitemap 311 条可回填；官方授权限个人本机使用。

## 架构概览

```
采集增强（AIHOT 专属链路）
  feed 轮询（all.xml 30min + full.xml 精选标）
    → 新条目入库 → enrich 队列（详情页补抓，串行 ≥2s）
  sitemap 回填（一次性，同一 enrich 管线）
数据层：articles 扩列 score/reason/tags/featured/original_html/original_url
展示层：HotPage 日期分组时间轴重构 + HotDetail 双语切换
数据管理：整库快照（db.backup）+ 按天清理 + 设置页「数据」Tab
```

## 核心数据结构

### articles 新增列（db.js 增量迁移）
```sql
score INTEGER NULL,        -- AI 评分 0-100
reason TEXT,               -- 推荐理由
tags TEXT,                 -- JSON 数组 ["智能体","安全/对齐"]
featured INTEGER DEFAULT 0,-- AIHOT 官方精选标
original_html TEXT,        -- 英文原文全文（RSC originalHtml）
original_url TEXT          -- 第三方原文链接（feed 🔗 链接）
```

### enrich 进度（settings['aihot.backfill']）
```json
{ "running": false, "total": 311, "done": 120, "failed": 3, "lastError": null, "finishedAt": null }
```

### 分类映射（settings['hot.categories']，F5 校准后）
官方 slug → 中文六类：`ai-models→模型, ai-products→产品, industry→行业, paper→论文, tip→教程`；
feed 中文 category → 六类的映射表按实测值校准（开发期用真实数据验证并固化）；观点类 = 大佬观点/技巧观点/现象/趋势 等。

## 模块设计

### server/services/aihot/enrich.js（新建，F1 核心）
**职责：** AIHOT 条目详情页补抓与解析。
**对外接口：**
- `enrichArticle(articleId)`：取 articles.url（详情页地址）→ fetchText（浏览器 UA，全局代理）→ 解析 SSR+RSC → UPDATE articles SET score/reason/tags/featured/original_html/original_url
- `enrichMissing(limit)`：找 aggregator 源中 score IS NULL 的条目逐个 enrich（串行 ≥2s/条，失败退避记日志）
- `parseDetail(html)`：纯函数（可单测）——返回 {score, reason, tags, featured, zhHtml, originalHtml}
**解析要点：** 评分取 `aria-label="AI 编辑部评分 N，满分 100"`；推荐理由 `p.m-detail-reason-text`；标签 `#xxx` 链（过滤颜色码类误匹配：标签以「#+中文/英文词」模式、排除 6 位 hex）；双语正文从 RSC payload 的 `$xx` 引用还原（zhHtml/originalHtml 指向的 deferred chunk 文本，做 HTML 反转义）。
**限速：** 独立串行链（不复用抖音队列），间隔默认 2000ms（env AIHOT_ENRICH_GAP_MS 可覆盖，测试用）。

### server/services/aihot/backfill.js（新建，F2 回填）
**职责：** 抓 sitemap.xml → 提取 /items/ URL → 对比库中已有 → 缺的逐条 enrich 入库（published_at 取详情页发布时间；无则当前时间）。
**接口：** `start()`（幂等，running 时拒绝）、`status()`；进度写 settings['aihot.backfill']。
**入库路径：** 不经过 feed——直接以详情页数据构造 article（source_id=AIHOT 源 id，url=详情页地址，title/zhHtml/summary 由 zhHtml 生成）。

### server/services/collectors/rss/index.js（修改，F2 主链路）
- AIHOT 源（extra.aggregator=1）fetch 后触发 `enrichMissing(10)`（每次刷新最多补 10 条，异步不阻塞）
- ETag 条件请求：sources.extra 存 etag/lastModified；parseFeed 用 httpFetch 带 If-None-Match，304 时返回空变更（{notModified:true}）
- full.xml 作为第二个聚合源登记（name='AIHOT 精选全文'，extra.aggregator=1 + extra.marksFeatured=1）：其条目命中即置 featured=1（saveArticles 对 featured 做冲突更新）

### server/services/hot.js（修改，F3/F4 数据）
- query 返回字段加 score/reason/tags/featured/original_url/has_original
- 全部动态 Tab 加 `source` 参数（按 author 筛选）+ 来源清单接口数据
- 新增 `GET /api/hot/sources`（agg 源下 author 聚合计数）

### server/routes/hot.js（修改）
- GET /api/hot 新字段透传；加 `source` 参数
- GET /api/hot/sources
- POST /api/hot/backfill + GET /api/hot/backfill（回填控制与状态）
- POST /api/hot/enrich {id}（单条手动补抓，调试用）

### server/services/datamgr.js（新建，F6）
- `snapshot()`：`db.backup('data/backups/app-yyyymmdd-hhmmss.db')`（better-sqlite3 在线备份，WAL 安全）
- `restore(file)`：打开快照库，按表（sources/groups/articles/videos/pending_items/daily_reports/settings/credentials）清表+全量插入（活库在线恢复，不用重启）
- `previewCleanup(days)`：统计早于截止日的 articles/videos 条数
- `cleanup(days)`：删除老内容（只删 articles/videos；pending/daily_reports 亦按同期清理），返回删除数
- `stats()`：库文件体积 + 各表条数

### server/routes/data.js（新建，F6）
- POST /api/data/snapshot；POST /api/data/restore {file}；GET /api/data/list（快照列表）
- POST /api/data/cleanup/preview {days}；POST /api/data/cleanup {days, confirm:true}
- GET /api/data/stats
- index.js 挂载 /api/data

### web/ 前端
- **pages/HotPage.jsx（重构，F3）**：日期分组时间轴组件（分组头「8月16日 星期日 · N 条」可折叠，左列 HH:mm + 竖线）；精选/全部动态两个 Tab 同用；卡片：信源标签（author）、评分徽章（有则显示）、标题、摘要、推荐理由（featured 卡）、#标签、精选徽章、♡收藏（接 articles later）；全部动态 Tab 加来源下拉 + 搜索框
- **components/HotDetail.jsx（重构，F4）**：返回/精选徽章/评分/收藏/打开原文/标题/信源+时间+作者/「AI 导读」/「推荐理由」/标签/正文区「中文|原文」切换（原文缺时「阅读原文 ↗」兜底）/复制链接
- **pages/SettingsPage.jsx + components/DataTab.jsx（新建，F6）**：第四个 Tab「数据」：快照生成/恢复/列表、保留天数设置、清理预览与确认执行、库体积与条目数；热榜设置区从六期位置并入或保留（以现有布局定）
- 热榜设置区（六期 HotSettings）加「回填」按钮 + 进度条（poll /api/hot/backfill）

### 配置项
- customer-config.json 加 `aihot.actor`（匿名标识，用户的 a3a001f8-...）与 `aihot.enrichGapMs`(2000)；setup 时把两个 feed 源（all.xml/full.xml）带上 actor 参数

## 模块交互

**增量采集：** scheduler due → rss.fetch(AIHOT/all.xml) → 新条目入库（含 original_url 从 🔗 提取）→ 异步 enrichMissing(10) 逐条补评分/双语全文 → 热榜下次请求即富卡片。

**精选标：** full.xml 源 fetch → 同 url 条目 featured=1（saveArticles 冲突更新）。

**回填：** 设置页点「回填历史」→ POST backfill → sitemap 解析 → 缺漏逐条 enrich 入库 → 前端轮询进度条 → 完成后分类胶囊各档出现历史内容。

**快照迁移：** 设置-数据 → 生成快照 → 得到 app-*.db → 拷到服务器同目录 → 启动即用（无需考虑缓存）。

## 文件组织

```
server/
├── db.js                        — 改：articles 六列迁移
├── services/
│   ├── aihot/enrich.js          — 新：详情页解析+补抓（F1）
│   ├── aihot/backfill.js        — 新：sitemap 回填（F2）
│   ├── collectors/rss/index.js  — 改：ETag + enrich 触发 + 🔗 提取 + full.xml 精选标
│   ├── collectors/store.js      — 改：featured 冲突更新、新列落库
│   ├── hot.js                   — 改：富字段查询 + sources 聚合
│   └── datamgr.js               — 新：快照/恢复/清理/统计（F6）
├── routes/
│   ├── hot.js                   — 改：新字段/backfill/sources
│   └── data.js                  — 新：F6 API
└── index.js                     — 改：挂 /api/data
web/src/
├── pages/HotPage.jsx            — 重构：日期分组时间轴
├── components/HotDetail.jsx     — 重构：双语切换详情
├── components/DataTab.jsx       — 新：数据管理 Tab
├── pages/SettingsPage.jsx       — 改：第四 Tab
└── components/HotSettings.jsx   — 改：回填按钮+进度
tests/
├── aihot-parse.test.js          — 新：parseDetail 用例（存样例 HTML 片段）
└── datamgr.test.js              — 新：快照/清理用例
config/customer-config.json      — 改：aihot.actor / enrichGapMs
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 详情页解析 | 正则+字符串提取（SSR 结构稳定区）+ jsdom 仅用于正文清洗 | RSC payload 是流式 JSON 片段，整 DOM 上 jsdom 慢且脆；固定 class/aria 锚点更稳，parseDetail 纯函数可单测 |
| 双语全文来源 | RSC payload 的 zhHtml/originalHtml | 一次请求拿全（spec F1 要求顺带存原文）；失败回退 feed 中文 + 原文页 Readability |
| 精选标 | full.xml 命中即精选 | 官方精选集合，最权威；无需解析详情页徽章（两者一致时双保险） |
| 快照 | better-sqlite3 db.backup 在线备份 | WAL 下安全、无需停服务；恢复按表清插免重启 |
| 回填限速 | 独立串行链 2s/条 | N1 礼貌；与抖音队列互不影响 |
| ETag | extra 存 etag，If-None-Match/304 短路 | 官方合同建议；省双方带宽 |
| 分类校准 | 官方分类 feed slug + 实测中文 category 双映射 | F5 要求以官方为准 |

## spec 覆盖对照

| spec | 归属模块 |
|------|---------|
| F1 详情补抓 | aihot/enrich.js + rss 触发 + articles 扩列 |
| F2 积累回填 | rss ETag/full.xml + aihot/backfill.js + daily.xml 登记源 |
| F3 时间轴 UI | HotPage 重构 + hot.js 富字段 |
| F4 双语详情 | HotDetail 重构 + original_html |
| F5 分类修正 | settings['hot.categories'] 校准 + hot.js |
| F6 快照清理 | datamgr.js + routes/data.js + DataTab.jsx |
| N1/N6 | enrich 限速链 + 仅本机使用 |
| N2 | 日期分组懒渲染 + 游标分页沿用 |
| N3 | parseDetail 字段缺失降级 |
| N4 | 代理与 .article-content 渲染沿用 |

## 新旧功能兼容与合并清单（开发者视角逐条定夺）

| 既有功能（六期及更早） | 本期新增 | 关系定夺 |
|---|---|---|
| HotDetail「查看英文原文」按钮（六期，抓原页 Readability） | F4 中文/原文切换 tab（F1 存的 original_html） | **合并**：original_html 有值时直接切 tab；无值时按钮降级为走原页抓取的兜底——一套详情 UI，两个数据源 |
| 一期订阅备份/恢复（backup.js，sources/groups/settings JSON） | F6 整库快照 | **并存但 UI 合并**：都进「数据」Tab；一期备份管「配置轻量迁移」，快照管「整库搬迁」，文案说清各自用途 |
| 阅读器稍后阅读♡（文章收藏） | 热榜卡片收藏 | **复用同一字段**：热榜 ♡ 就是 articles.later，阅读器「稍后阅读」里能看到热榜收藏的内容（双向一致） |
| 每日情报日报（daily.js） | daily.xml（AIHOT 精编日报源） | **并存不混**：AIHOT 日报是普通文章源，进阅读器+日报候选池；我们自产日报版式不变。AIHOT 评分本期不进日报排序（spec 明确不做） |
| 六期 HotSettings 区（间隔/分类表/开关） | 回填按钮+进度、DataTab | **合并到同一设置区**，避免两个「热榜设置」入口 |
| /api/hot/original（六期路由） | F1 original_html | **保留作兜底路由**，前端优先用 original_html |
| due 调度 / 虚拟滚动 / 图片代理 / 三主题 | 全部沿用 | **回归验证项**，见 checklist 兼容性节 |

## 兼容性验收原则（写入 checklist-phase7）

1. **回归**：一~六期关键链路（阅读/播放/日报/备份/队列/限速）抽查不劣化
2. **重复审查**：上表每一行在验收时确认「合并决策已落实，无双入口/双逻辑」
3. **使用者视角**：按端到端场景走查（新用户打开热榜→浏览→详情→收藏→阅读器能看到）
4. **开发者视角**：npm test 全绿 + 字段级抽查（DB 里 score/reason/featured 落库正确）
5. **上下级兼容**：导航→页面→分组→卡片→详情逐层点击无断链、无 404、无空态误导
