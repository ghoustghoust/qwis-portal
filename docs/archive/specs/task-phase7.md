# 七期 Tasks

> 依据已批准的 spec-phase7.md + plan-phase7.md。共 14 个任务。
> 约定：AIHOT actor=a3a001f8-e397-4995-acb0-569186f210b5（用户本机标识）；curl 中文请求体写临时文件 --data-binary；服务端口 3000。

## 文件清单

| 操作 | 文件 | 职责 | 任务 |
|------|------|------|------|
| 修改 | `server/db.js` | articles 六列迁移 | T1 |
| 新建 | `server/services/aihot/enrich.js` | 详情页解析+串行补抓 | T2 |
| 新建 | `tests/aihot-parse.test.js` | parseDetail 单测 | T3 |
| 修改 | `server/services/collectors/rss/index.js`、`store.js` | ETag/🔗原文链接/full.xml 精选标/enrich 触发 | T4 |
| 新建 | `server/services/aihot/backfill.js` | sitemap 回填 | T5 |
| 修改 | `server/services/hot.js`、`server/routes/hot.js` | 富字段/来源筛选/回填路由 | T6 |
| 新建 | `server/services/datamgr.js`、`server/routes/data.js`；修改 `server/index.js` | 快照/恢复/清理 API（F6） | T7 |
| 新建 | `tests/datamgr.test.js` | 快照/清理单测 | T8 |
| 重构 | `web/src/pages/HotPage.jsx` | 日期分组时间轴（F3） | T9 |
| 重构 | `web/src/components/HotDetail.jsx` | 双语切换详情（F4） | T10 |
| 新建 | `web/src/components/DataTab.jsx`；修改 `SettingsPage.jsx`、`HotSettings.jsx` | 数据管理 Tab + 回填控制（F6/F2） | T11 |
| 修改 | `config/customer-config.json`、`tools/setup-customer.js` | actor 配置 + full.xml/daily.xml 源登记 | T12 |
| 执行 | 数据回填 + 分类校准 | F2/F5 真实数据落地 | T13 |
| 执行 | 兼容性验收（plan 兼容清单 + 回归） | checklist 兼容节 | T14 |

---

## T1: articles 六列迁移
**文件：** `server/db.js`
**依赖：** 无
**步骤：**
1. 增量迁移：`score INTEGER`、`reason TEXT`、`tags TEXT`、`featured INTEGER DEFAULT 0`、`original_html TEXT`、`original_url TEXT`（逐列 try ALTER）
**验证：** `node -e` 查 PRAGMA table_info(articles) 含六列

## T2: 详情页解析与补抓（F1 核心）
**文件：** `server/services/aihot/enrich.js`
**依赖：** T1
**步骤：**
1. `parseDetail(html)` 纯函数：评分（`AI 编辑部评分 N，满分 100`）、推荐理由（`m-detail-reason-text`）、标签（`#词` 链，排除 6 位 hex 颜色码）、精选徽章（`✦精选`/featured 标记）、发布时间、zhHtml/originalHtml（RSC `$xx` 引用还原 + HTML 反转义）；字段全缺时返回 nulls（N3 降级）
2. 串行队列（独立链，AIHOT_ENRICH_GAP_MS 默认 2000）
3. `enrichArticle(id)`：fetchText(浏览器 UA) → parseDetail → UPDATE articles
4. `enrichMissing(limit=10)`：aggregator 源 score IS NULL 条目逐个补抓
**验证：** 用 data/.ai2.html（已存的 Cursor 详情页 352KB）喂 parseDetail：score=71、reason 非空、tags 含行业动态、zhHtml/originalHtml 均 >1000 字符

## T3: parseDetail 单测
**文件：** `tests/aihot-parse.test.js`
**依赖：** T2
**步骤：** 样例 HTML 片段测评分/理由/标签/双语正文/缺字段降级
**验证：** `npm test` 新增用例全绿

## T4: rss 链路增强（F2 主链路）
**文件：** `server/services/collectors/rss/index.js`、`store.js`
**依赖：** T2
**步骤：**
1. mapItem 提取 description 里 🔗 原文链接 → original_url 字段（saveArticles 落库，冲突时 UPDATE original_url）
2. ETag：parseFeed 用 httpFetch 带 If-None-Match/If-Modified-Since（读 extra.etag/lastModified），304 → 返回 {notModified:true} 空结果并更新 next_fetch_at
3. extra.marksFeatured=1 的源（full.xml）：命中条目 UPDATE featured=1（saveArticles 冲突时同步）
4. aggregator 源 fetch 完成后异步 enrichMissing(10)
5. AIHOT 源 url 从 feed.xml 切换为 all.xml（带 actor）；新增 full.xml 源（带 actor、marksFeatured）；daily.xml 登记为「AIHOT 日报」源
**验证：** 刷新 AIHOT 源日志含「304 未变更」或新增计数；新条目 10 分钟内 score 落库；full.xml 刷新后既有条目 featured=1

## T5: sitemap 回填（F2）
**文件：** `server/services/aihot/backfill.js`
**依赖：** T2
**步骤：**
1. `start()`：抓 sitemap.xml → /items/ URL 去重 → 排除库中已有 → 逐条抓详情页直接入库（串行 ≥2s）
2. 进度写 settings['aihot.backfill'] {running,total,done,failed}；`status()` 读取；running 时重复 start 拒绝
**验证：** node 内联小规模验证（截取 5 个 URL 跑通入库全流程）

## T6: 热榜 API 富字段（F3/F4 数据）
**文件：** `server/services/hot.js`、`server/routes/hot.js`
**依赖：** T1、T5
**步骤：**
1. query 返回加 score/reason/tags/featured/original_url/has_original；`source` 参数按 author 筛选
2. GET /api/hot/sources（author 聚合计数）
3. POST /api/hot/backfill + GET /api/hot/backfill（状态）
4. 保留 /api/hot/original 作兜底
**验证：** curl 验证各端点字段齐全

## T7: 数据管理 API（F6）
**文件：** `server/services/datamgr.js`、`server/routes/data.js`、`server/index.js`
**依赖：** 无
**步骤：**
1. snapshot()：db.backup 到 data/backups/app-*.db
2. restore(file)：打开快照按八表清插（不重启）
3. previewCleanup(days)/cleanup(days)：只删 articles/videos/pending_items/daily_reports 老数据
4. stats()：体积+各表条数；GET list 快照列表
5. 路由挂 /api/data
**验证：** curl 全流程：快照→删数据→恢复→数据回来；preview/cleanup 计数正确

## T8: datamgr 单测
**文件：** `tests/datamgr.test.js`
**依赖：** T7
**步骤：** 临时库造数据：快照/恢复/清理预览/清理执行
**验证：** npm test 全绿

## T9: HotPage 时间轴重构（F3）
**文件：** `web/src/pages/HotPage.jsx`
**依赖：** T6
**步骤：**
1. 日期分组（本地日期，「M月D日 星期X · N 条」可折叠，默认首日展开）+ 左列 HH:mm + 竖线
2. 卡片：信源标签/评分徽章/标题/摘要/推荐理由（featured）/#标签/精选徽章/♡收藏（=articles.later，与阅读器双向一致）
3. 精选 Tab 分类胶囊沿用；全部动态 Tab 加来源下拉（/api/hot/sources）+ 搜索沿用
4. 空分类文案：「该分类近期待抓取内容为空」
**验证：** Playwright 截图：分组/折叠/富卡片/来源筛选/收藏后阅读器稍后读可见

## T10: HotDetail 双语重构（F4）
**文件：** `web/src/components/HotDetail.jsx`
**依赖：** T6
**步骤：**
1. 布局对齐 AIHOT 详情：返回/精选徽章/评分/收藏/打开原文/标题/信源+时间+作者/AI导读/推荐理由/标签
2. 正文区「中文|原文」切换：original_html 直接渲染；无值走 /api/hot/original 兜底；再失败显示「阅读原文 ↗」
3. 复制链接保留
**验证：** Playwright 截图双语切换、缺原文兜底、与六期按钮无重复入口

## T11: 数据管理 Tab + 回填控制（F6/F2 前端）
**文件：** `web/src/components/DataTab.jsx`、`pages/SettingsPage.jsx`、`components/HotSettings.jsx`
**依赖：** T7、T6
**步骤：**
1. SettingsPage 加第四 Tab「数据」：快照生成/恢复/列表、保留天数输入、清理预览→确认执行、库体积与条目数；一期备份区文案标注「配置轻量迁移」避免与快照混淆
2. HotSettings 加「回填历史」按钮 + 进度条（poll GET /api/hot/backfill）
**验证：** Playwright 截图快照/清理预览/回填进度；build 0 error

## T12: 配置与源登记
**文件：** `config/customer-config.json`、`tools/setup-customer.js`
**依赖：** T4
**步骤：**
1. customer-config 加 ahot.actor/enrichGapMs 注释化配置
2. setup：actor 渲染进 all/full/daily 三个 feed 地址模板
**验证：** 重跑 setup 幂等不破坏现有源（已存在的源不重复建）

## T13: 真实回填 + 分类校准（F2/F5 落地）
**依赖：** T5、T9
**步骤：**
1. 触发正式回填（311 条，预计 10~15 分钟），盯日志与进度
2. 用回填真实数据校准六类映射（抽样比对 AIHOT 官网分类），固化进 settings['hot.categories']
3. daily.xml 源登记验证
**验证：** 教程/论文等分类出现历史内容；抽 5 条与官网分类一致

## T14: 兼容性验收
**依赖：** 全部
**步骤：**
1. plan「兼容与合并清单」7 行逐行确认落实
2. 回归：一~六期关键链路抽查（阅读/视频播放/日报/备份/队列/抖音限速）
3. npm test 全绿；build 0 error
4. 端到端：按 checklist 场景走查并截图
**验证：** checklist-phase7.md 全部勾选

---

## 执行顺序

```
T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8（后端线，T7/T8 可与 T4~T6 并行）
T9 → T10（热榜前端，依赖 T6）
T11（依赖 T7/T6）→ T12 → T13（真实回填，依赖 T5）→ T14（验收）
```
