# 六期 Tasks

> 依据已批准的 spec-phase6.md + plan-phase6.md。共 16 个任务，按依赖排序。
> 约定：所有验证在本机执行；服务重启命令统一为「杀 3000 端口进程 → node server/index.js」。

## 文件清单

| 操作 | 文件 | 职责 | 任务 |
|------|------|------|------|
| 修改 | `server/db.js` | published_at 索引迁移 | T1 |
| 新建 | `scripts/fix-phase6-data.sql`（或 node 内联） | AIHOT 乱码修正 + aggregator 标志 | T2 |
| 修改 | `server/services/collectors/store.js` | intervalMinFor(source) 源级间隔 | T3 |
| 修改 | `server/services/scheduler/index.js` | due 驱动重构 | T4 |
| 修改 | `server/routes/sources.js` | PUT :id/interval + GET 带 intervalMin | T5 |
| 修改 | `server/services/ai/daily.js` | needsGeneration + dedupAndCap | T6 |
| 修改 | `server/routes/daily.js` | GET 加 stale 字段 | T7 |
| 修改 | `server/routes/articles.js`、`videos.js` | from/to 筛选 + span | T8 |
| 新建 | `server/services/hot.js` | 热榜查询 + 英文原文 | T9 |
| 新建 | `server/routes/hot.js`；修改 `server/index.js` | 热榜 API + /hot/ 路由 | T10 |
| 新建 | `web/src/components/DateFilter.jsx` | 日历浮层 | T11 |
| 修改 | `web/src/components/ArticleList.jsx`、`VideoGrid.jsx`、`pages/ReaderPage.jsx` | 接入日期筛选 | T12 |
| 修改 | `web/src/pages/DailyPage.jsx`、`components/ColumnSection.jsx` | 打开即补 + related 标注 | T13 |
| 新建 | `web/src/pages/HotPage.jsx`、`components/HotDetail.jsx` | 热点榜页面 | T14 |
| 修改 | `web/src/main.jsx` | /hot/ 路由 + 导航入口 | T15 |
| 修改 | `web/src/components/{WechatTab,BilibiliTab,DouyinTab}.jsx`、`pages/SettingsPage.jsx` | 源级间隔编辑 + 热榜设置区 | T16 |

---

## T1: published_at 索引迁移
**文件：** `server/db.js`
**依赖：** 无
**步骤：**
1. 增量迁移区加：`CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at)` 与 videos 同款
**验证：** `node -e "require('./server/db.js')"` 后 `PRAGMA index_list('articles')` 含新索引

## T2: AIHOT 数据修正（F1）
**依赖：** 无
**步骤：**
1. SQL：`UPDATE sources SET name='AIHOT 热榜', extra=json_set(COALESCE(extra,'{}'),'$.aggregator',1) WHERE id=25`
2. 检查前端 api.js 提交头为 UTF-8（确认非系统 bug）
**验证：** `curl.exe -s http://localhost:3000/api/sources | findstr AIHOT` 名称无乱码且 extra 含 aggregator

## T3: 源级间隔（store 层，F2）
**文件：** `server/services/collectors/store.js`
**依赖：** 无
**步骤：**
1. `intervalMinFor(type)` 改为 `intervalMinFor(source)`：解析 `source.extra` 的 intervalMin（>0 优先），否则按 type 走全局 intervals 设置
2. fetchSource 内 next_fetch_at 计算改用新签名
**验证：** node 内联：extra.intervalMin=30 的源 next_fetch_at ≈ now+30min

## T4: 调度器 due 驱动重构（F2）
**文件：** `server/services/scheduler/index.js`
**依赖：** T3
**步骤：**
1. 去掉 wechat/rss/x/youtube/bilibili 的 per-type setInterval；改为单一 `setInterval(tick, 60000)`
2. tick：查 `enabled=1 AND (next_fetch_at IS NULL OR next_fetch_at<=now)`，逐个 fetchSource（抖音源仍 douyin.enqueue 串行）；异常 markSourceError 不中断
3. OPML 12h、日报 cron、队列轮询 10min 保留原样；start()/reschedule()/stop() 签名不变
**验证：** 把 AIHOT 间隔设为 1 分钟，日志显示约每 1min 抓一次；验完改回 30

## T5: 间隔 API（F2）
**文件：** `server/routes/sources.js`
**依赖：** T3
**步骤：**
1. PUT `/:id/interval` {intervalMin: 分钟数|null(恢复默认)}：更新 extra.intervalMin，reschedule
2. GET 列表 items 解析 extra 带 `intervalMin` 字段
**验证：** curl PUT 后 GET 返回 intervalMin；PUT null 后字段消失

## T6: 日报 stale + 去重限流（F3/F5 后端）
**文件：** `server/services/ai/daily.js`
**依赖：** 无
**步骤：**
1. `needsGeneration()`：settings['daily'].time（默认 08:00）已过且今日无 daily_reports → true；导出
2. `dedupAndCap(items)`：标题归一化（小写/去标点/去数字日期前缀）→ token 集合；两两 Jaccard ≥0.5 合并：主条目取非 aggregator 优先（同级取发布时间早者），其余进 `related:[{kind,ref_id,source_name}]`；合并后按栏内同源截断前 3
3. generate() 在 classify 后对每栏应用 dedupAndCap；导出 classify/dedupAndCap 供测试
**验证：** 造两条标题相似条目（官博+AIHOT）→ 合并为一条、related=1、主条目为官博；同源 5 条同栏 → 剩 3 条

## T7: 日报 stale 字段（F3）
**文件：** `server/routes/daily.js`
**依赖：** T6
**步骤：** GET /api/daily 响应加 `stale: daily.needsGeneration()`
**验证：** 清掉今日日报后 GET 返回 stale:true；regenerate 后再 GET 为 false

## T8: 文章/视频日期筛选（F4 后端）
**文件：** `server/routes/articles.js`、`videos.js`
**依赖：** T1
**步骤：**
1. 查询参数 `from`/`to`（YYYY-MM-DD）：`COALESCE(published_at, created_at) >= from+'T00:00' AND <= to+'T23:59:59'`（注意本地时区与 ISO 对齐，统一按 UTC 日期边界）
2. 响应加 `span:{min,max}`：同过滤条件下 MIN/MAX（不含 from/to 之外的值）
**验证：** curl from=2020-01-01&to=2020-12-31 只返回该年文章且 span 正确；不传时 span 为全量范围

## T9: 热榜服务层（F6/F7 后端）
**文件：** `server/services/hot.js`
**依赖：** 无
**步骤：**
1. `CATEGORY_MAP`（读 settings['hot.categories']，默认值照 plan）
2. `mapCategory(category, title)`：映射 + 关键词兜底 → 六类或 null
3. `query({category, q, cursor})`：articles JOIN sources，限定 `json_extract(s.extra,'$.aggregator')=1`；category 过滤在应用层（mapCategory 结果比对）；排序键游标复用文章逻辑
4. `originalHtml(articleId)`：从 content_html 提取 `🔗` 后的原文 href → fetchFulltext（rss 适配器复用）→ Map 缓存（TTL 6h、容量 100）
**验证：** node 内联：mapCategory 各类命中正确；query 分页正确；originalHtml 对真实条目返回英文 HTML

## T10: 热榜 API 与页面路由（F6）
**文件：** `server/routes/hot.js`、`server/index.js`
**依赖：** T9
**步骤：**
1. GET `/api/hot?tab=&category=&q=&cursor=`（tab=featured 时 category 生效；tab=all 时 q 生效）
2. POST `/api/hot/original` {id} → {ok, html, sourceUrl}；失败 {ok:false, error}
3. GET `/api/hot/categories` → 六类清单（前端胶囊用）
4. index.js：挂 `/api/hot`；`/hot/` 页面路由返回 SPA
**验证：** curl 三端点；`/hot/` 返回 200

## T11: DateFilter 组件（F4 前端）
**文件：** `web/src/components/DateFilter.jsx`
**依赖：** 无
**步骤：**
1. 📅 按钮 + 浮层：快捷段（今天/近3天/近7天/近30天/全部）+ 两个 `<input type="date">` + 应用/清除
2. 激活时按钮文案显示 `M/D~M/D`、高亮；props: `value={from,to} onChange`
3. 浮层点击外部关闭
**验证：** build 通过；浮层交互自检

## T12: 阅读器接入日期筛选（F4 前端）
**文件：** `pages/ReaderPage.jsx`、`components/ArticleList.jsx`、`VideoGrid.jsx`
**依赖：** T8、T11
**步骤：**
1. ReaderPage filter 状态加 from/to（文章/视频各自独立记住）
2. ArticleList 头部：排序按钮旁挂 DateFilter；请求带 from/to；列表头第二行显示 span（「2020/2/14 ~ 2026/8/16 · 共 N」）
3. VideoGrid 工具行挂 DateFilter（视频态）
**验证：** 选近7天列表只含近7天；点阮一峰源筛选保持；视频 Tab 同效；翻页正常；build 0 error

## T13: 日报页打开即补 + related 标注（F3/F5 前端）
**文件：** `pages/DailyPage.jsx`、`components/ColumnSection.jsx`
**依赖：** T6、T7
**步骤：**
1. DailyPage mount：GET /api/daily → stale=true → 显示「正在生成今日情报…」→ POST regenerate → 完成后渲染 + 提示条「已生成 DeepSeek 智能日报。」
2. ColumnSection 卡片：`item.related?.length>0` 时标题下显示「另有 N 家信源报道」（hover/title 显示来源名）
**验证：** 模拟 stale 场景页面自动生成；造去重数据后卡片显示标注；build 0 error

## T14: 热点榜页面（F6/F7 前端）
**文件：** `pages/HotPage.jsx`、`components/HotDetail.jsx`
**依赖：** T10
**步骤：**
1. HotPage：精选 Tab（分类胶囊 全部/模型/产品/行业/论文/教程/观点 + 卡片流：标题/中文摘要/信源/相对时间/分类标签/游标分页）+ 全部动态 Tab（时间线 + 搜索框）
2. HotDetail 弹窗：中文 content_html 渲染 + 信源/时间/标签 + 「查看英文原文」按钮（loading→英文渲染；失败显示「阅读原文 ↗」兜底）+ 复制链接/打开原文
**验证：** 三主题无崩坏；胶囊筛选正确；搜索命中；英文原文加载成功；build 0 error

## T15: 路由与导航（F6/F8）
**文件：** `web/src/main.jsx`
**依赖：** T14
**步骤：**
1. `/hot/` 分发 HotPage；IconRail 加🔥入口（settings hot.enabled!==false 时显示）
**验证：** 四页面 200；导航图标点击切换正确

## T16: 设置页源级间隔 + 热榜区（F2/F8 前端）
**文件：** `components/{WechatTab,BilibiliTab,DouyinTab}.jsx`、`pages/SettingsPage.jsx`
**依赖：** T5
**步骤：**
1. 三个 Tab 的已订阅列表每行加「间隔」小编辑（分钟输入 + 保存 + 恢复默认），调 PUT :id/interval
2. SettingsPage 加「热点榜」区：AIHOT 间隔编辑、分类规则表只读（GET /api/hot/categories + 映射表）、hot.enabled 开关（GET/PUT /api/settings 加 hot 分区）
**验证：** 改 AIHOT 间隔后 scheduler 日志重排；开关关闭后导航🔥消失；build 0 error

---

## 执行顺序

```
T1 → T2 → T3 → T4 → T5（后端调度线）
T6 → T7（日报线，与调度线并行）
T8 → T11 → T12（筛选线，与上两条并行）
T9 → T10 → T14 → T15（热榜线）
T13 依赖 T6/T7
T16 依赖 T5/T15
收尾：build + 单测回归 + 联调（AC1~AC8）
```
