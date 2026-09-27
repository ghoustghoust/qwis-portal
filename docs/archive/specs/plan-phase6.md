# 六期 Plan：日报保鲜 + 日历筛选 + AIHOT 修复 + 热点榜

> 依据已批准的 spec-phase6.md（F1~F8 / N1~N5 / AC1~AC8）。
> 现有栈：Express + better-sqlite3 + React SPA（三页面按 pathname 分发）。

## 架构概览

```
scheduler 重构为 due 驱动（F2 基础）
  └─ 每 60s 扫 next_fetch_at<=now 的 enabled 源 → fetchSource（抖音仍走串行队列）
hot/ 模块（F6/F7 核心）
  └─ routes/hot.js：GET /api/hot（精选/全部/搜索/分页）+ POST /api/hot/original（英文原文）
daily.js 增强（F3/F5）
  └─ stale 判定 + 同主题合并 + 同源限流
web/ 新增 HotPage + 阅读器 DateFilter 组件（F4）
```

## 核心数据结构

### sources.extra 扩展（F2/F5）
```json
{ "intervalMin": 30,      // 源级刷新间隔覆盖（分钟），null=跟随全局
  "aggregator": true }    // 聚合源标记（AIHOT），日报去重时优先级低于一手源
```

### 分类映射（F6，settings['hot.categories']，只读规则表）
```json
{ "模型": ["模型发布", "评测/基准"],
  "产品": ["产品更新"],
  "行业": ["行业动态"],
  "论文": ["论文"],
  "教程": ["教程/实践"],
  "观点": ["大佬观点", "现象/趋势"] }
```
`mapCategory(category, title)`：先按 AIHOT category 精确映射；未命中用标题关键词兜底（论文/paper/教程/观点等）；仍不中返回 null（仅「全部」可见）。

### 英文原文缓存（F7，进程内 Map）
`originalCache: Map<articleId, {html, at}>`，TTL 6h，上限 100 条（LRU 逐出）。不落库。

## 模块设计

### server/services/scheduler/index.js（重构，F2 基础）
**职责：** due 驱动调度——每 60s 扫描 `enabled=1 AND next_fetch_at<=now` 的源逐个 fetchSource；抖音源仍经 douyin.enqueue（串行 ≥10s 不破 N4）；OPML 同步保留独立 12h interval；日报 cron 不变；队列轮询 10min 不变。
**对外接口：** start()/reschedule()/stop() 不变。
**兼容：** `store.intervalMinFor(type)` 改为 `intervalMinFor(source)`——先读 `source.extra.intervalMin`，缺省走 type 全局值。

### server/routes/sources.js（修改，F2）
- PUT `/:id/interval` {intervalMin|null}：写 sources.extra.intervalMin，调 scheduler.reschedule()
- GET 响应 items 带 `intervalMin`（从 extra 解析）

### server/services/ai/daily.js（修改，F3/F5）
- `needsGeneration()`：今日生成时间已过且当日无 daily_reports 记录 → true；GET /api/daily 响应加 `stale` 字段
- `classify()` 后处理 `dedupAndCap(items)`：
  - 标题归一化（去标点/小写/去来源前缀）→ token 集合 Jaccard ≥0.5 判同主题
  - 同主题合并：优先级 一手源（非 aggregator）> 聚合源；主卡片保留优先级高者，`related: [{source_name, ref_id, kind}]` 记录其余，前端显示「另有 N 家信源报道」
  - 限流：每栏每 source_id 取前 3 条（按命中数/时间序）
- sections items 结构加 `related: []` 字段

### server/routes/daily.js（修改，F3）
GET /api/daily 响应加 `stale: needsGeneration()`；前端 stale 时自动 POST /regenerate 并轮询结果。

### server/routes/articles.js + videos.js（修改，F4）
- 查询参数加 `from`/`to`（YYYY-MM-DD）：`COALESCE(published_at, created_at) >= from AND < to+1天`
- 响应加 `span: {min, max}`（当前过滤下 MIN/MAX 发布日期，列表头跨度显示用）
- db.js 增量迁移：`idx_articles_published`、`idx_videos_published`（N5）

### server/services/hot.js（新建，F6/F7）
- `query({category, q, cursor})`：从 articles 取 hotlist 源（extra.aggregator=1）内容，category 经 mapCategory 过滤；游标复用文章排序键
- `originalHtml(articleId)`：从 content_html 提取「🔗 阅读原文」链接 → fetchFulltext（走代理）→ 缓存返回；失败抛错由路由返回兜底提示

### server/routes/hot.js（新建，F6/F7）
- GET `/api/hot?tab=featured|all&category=&q=&cursor=`：featured=分类过滤（category 为空=全部），all=时间线+搜索
- POST `/api/hot/original {id}`：→ {ok, html, sourceUrl} / {ok:false, error}
- server/index.js 加挂 `/api/hot` + 页面路由 `/hot/`

### web/ 前端
- **main.jsx**：`/hot/` 分发到 HotPage；导航 IconRail 加热榜图标（settings['hot.enabled']!==false 时显示，F8）
- **pages/HotPage.jsx**：精选 Tab（分类胶囊：全部/模型/产品/行业/论文/教程/观点）+ 全部动态 Tab（时间线+搜索框）；卡片=标题+中文摘要+信源+相对时间+分类标签
- **components/HotDetail.jsx**：详情弹窗——中文渲染、信源/时间/标签、「查看英文原文」（调 /api/hot/original，加载态+失败兜底「阅读原文 ↗」）、复制链接/打开原文
- **components/DateFilter.jsx**（F4）：📅 按钮 + 浮层（快捷段 今天/近3天/近7天/近30天/全部 + 两个 date input + 清除）；激活显示「M/D~M/D」；ArticleList 头部与 VideoGrid 工具行各挂一个；filter 状态沿 ReaderPage 下传
- **设置页**（F2/F8）：WechatTab 扩展源列表、BilibiliTab、DouyinTab 的已订阅列表各加「间隔」编辑（分钟输入+恢复默认）；SettingsPage 加「热点榜」区（AIHOT 间隔快捷编辑、分类规则表只读、启用开关）

### F1 乱码修复
SQL 修正 id=25 名称为「AIHOT 热榜」+ `extra.aggregator=1`。乱码根因是当初 curl 命令行 GBK 提交（非系统 bug），docs 注明提交链路 UTF-8 即可。

## 模块交互

**F3 打开即补：** DailyPage mount → GET /api/daily → `stale:true` → 显示「正在生成今日情报…」→ POST /regenerate（后端先补抓到期源）→ 渲染新报告 + 顶部提示条。

**F4 筛选链路：** DateFilter 选范围 → ReaderPage filter.from/to → ArticleList/VideoGrid 重新请求 → 响应 span 显示于列表头（「2020/2/14 ~ 2026/8/16」）。

**F5 日报去重：** generate() → classify 分栏 → 每栏 dedupAndCap → 写 daily_reports → 前端卡片渲染 related 标注。

**F7 英文原文：** HotDetail 点「查看英文原文」→ POST /api/hot/original → 提取中文正文里的 🔗 链接 → 服务端代理抓取 + Readability → 返回英文 HTML 渲染。

## 文件组织

```
server/
├── services/
│   ├── scheduler/index.js   — 改：due 驱动重构
│   ├── collectors/store.js  — 改：intervalMinFor(source)
│   ├── ai/daily.js          — 改：stale/dedup/cap
│   └── hot.js               — 新：热榜查询 + 英文原文
├── routes/
│   ├── sources.js           — 改：interval 接口
│   ├── articles.js          — 改：from/to + span
│   ├── videos.js            — 改：from/to + span
│   ├── daily.js             — 改：stale 字段
│   └── hot.js               — 新：热榜 API
├── db.js                    — 改：published_at 索引迁移
└── index.js                 — 改：挂 /api/hot + /hot/ 路由
web/src/
├── pages/HotPage.jsx        — 新
├── components/HotDetail.jsx — 新
├── components/DateFilter.jsx— 新
├── main.jsx                 — 改：路由+导航
└── components/{ArticleList,VideoGrid,ReaderPage,WechatTab,BilibiliTab,DouyinTab,SettingsPage}.jsx — 改
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 源级间隔实现 | due 驱动调度重构（60s tick 扫到期源） | per-type setInterval 无法支持源级粒度；due 驱动天然支持且语义更清晰 |
| 去重判定 | 标题 token Jaccard ≥0.5 + 关键词重叠 | 确定性、零成本（N3）；向量/AI 判重成本高收益低 |
| 聚合源识别 | sources.extra.aggregator 标志 | 通用：以后加任何聚合站都自动适用去重优先级 |
| 分类归类 | category 精确映射 + 标题关键词兜底 | AIHOT feed 自带 category 覆盖率高；不调 AI（N3） |
| 英文原文 | 进程内 LRU 缓存，不落库 | 原文有时效性内容变动，缓存 6h 足够；不占 DB |
| 日期筛选实现 | SQL from/to + 排序键游标不变 | 游标逻辑一期已按 (sort_key,id) 复合键，加过滤条件即可 |
| 热榜数据源 | articles 表 aggregator 源 | 复用现有采集/清洗/分页全部链路，零新表 |

## spec 覆盖对照

| spec | 归属模块 |
|------|---------|
| F1 乱码 | SQL 修正 + docs 注明 |
| F2 源级间隔 | scheduler 重构 + store.intervalMinFor + routes/sources + 设置页三 Tab |
| F3 打开即补 | daily.needsGeneration + routes/daily stale + DailyPage 自动触发 |
| F4 日期筛选 | routes/articles/videos（from/to/span）+ DateFilter + ArticleList/VideoGrid/ReaderPage + db 索引 |
| F5 去重限流 | daily.dedupAndCap + ColumnSection 显示 related |
| F6 热点榜 | services/hot + routes/hot + HotPage + main.jsx 导航 |
| F7 英文原文 | hot.originalHtml + HotDetail |
| F8 设置可见 | SettingsPage 热榜区 + main.jsx 开关 |
| N1~N5 | 单请求礼貌间隔 / 沿用虚拟滚动 / 确定性规则 / 代理兜底 / published_at 索引 |
