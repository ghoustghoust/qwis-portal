# 阅读器高级筛选 + 保存视图 Plan

> 依据：已批准的 `docs/specs/11-advanced-filter-views/spec.md`(F1-F4，含三项已确认决策：智能排序=focus优先+时间衰减确定性公式；语言=标题字符集启发式；评分筛选保留但仅热点条目有效)。

## 架构概览

```
后端:
  routes/articles.js   扩展:LIST_FIELDS + s.focus/a.score;新参数 score_min/lang/sort=smart
  routes/settings.js   扩展:GET/PUT + views 区(读公开/写保护,沿用现有鉴权,零改动 auth)
前端:
  pages/ReaderPage.jsx      filter 状态扩展(sort/lang/scoreMin/timePreset)
  components/FilterPanel.jsx(新建)  筛选面板浮层
  components/ArticleList.jsx 透传新参数;q 不再仅限 history tab
  components/Sidebar.jsx     新增「我的视图」区(视图列表/点击应用/删除)
  components/SaveViewButton  内联进 FilterPanel(命名保存)
```

改动哲学：articles/settings 只做**增量扩展**（新参数/新分区），不改任何现有参数语义；视图复用 settings 分区机制，不新增路由、不动 authMiddleware 白名单。

## 核心数据结构

### View（存 settings['reader.views']，上限 20）

```js
{ id: 'v' + Date.now().toString(36), name: 'AI 精选',
  filter: { tab:'all', sourceId:null, groupId:null, q:'', sort:'smart',
            lang:'all'|'zh'|'en', scoreMin:0|80|90, timePreset:'all'|'today'|'week'|'month' } }
```

### GET /api/articles 新增参数（全部可选，缺省=现状）

| 参数 | 取值 | 语义 |
|---|---|---|
| `sort=smart` | 与 new\|old 并列 | 智能排序：`ORDER BY (unixepoch(COALESCE(a.published_at,a.created_at)) + COALESCE(s.focus,0)*259200) DESC, a.id DESC`——focus 源获 3 天（259200s）时间加成，其余按发布时间。游标=计算出的 smart_key\|id 复合键（沿用现有 sort_key\|id 模式） |
| `score_min` | 80 / 90 | SQL:`a.score IS NOT NULL AND a.score >= ?`（无评分条目自然隐藏，spec F2 语义） |
| `lang` | zh / en | **应用层判定**：标题含 CJK(/[\u4e00-\u9fff]/)即 zh。实现=超采样：每页底层取 PAGE_SIZE×4(120）行，过滤后返回≤30 条，nextCursor 取自最后一条原始行（保证翻页不丢不重）；仅 lang 存在时启用 |

- LIST_FIELDS 增加 `s.focus AS source_focus, a.score`（纯增量，前端旧字段不受影响）。
- dedup=1 与新参数的组合：smart/score 可与 dedup 叠加（dedup 在聚类前应用同一 where;sort=smart 时聚类输入按 smart 序）；lang 与 dedup 不叠加（dedup 优先，lang 忽略——前端在有 dedup 开启时禁用语言档）。

### settings 扩展

- GET `/api/settings` 响应加 `views: getSetting('reader.views', [])`（公开读 ✓）
- PUT `/api/settings` 加 `body.views`：整体替换，校验——必须是数组、≤20、每项 `{name:非空≤20字, filter:对象}`，非法 400 不写（沿用"先校验后写"惯例）

## 模块设计

### routes/articles.js（修改）
- buildWhere 加 score_min 条件；sort 分支加 smart（构造 smartKeyExpr，游标比较改用它）;lang 分支：超采样循环（最多翻 4 个底层页）过滤后返回。
- 排序响应沿用 span/counts 契约。

### routes/settings.js（修改）
- GET 加 views 分区；PUT 加 views 校验+整体替换。

### FilterPanel.jsx（新建，~150 行）
- 触发按钮在 ArticleList 头部（FilterIcon)；浮层含：排序（智能/最新/最早）、时间（全部/今天/本周/本月）、语言（全部/中文/英文）、评分（不限/≥80/≥90 + 提示文案「仅热点榜条目有评分」)、关键词输入；底部「清除全部」「保存为视图…」。
- 保存为视图：弹出命名输入 → PUT /api/settings {views:[...old, newView]} → toast；超 20 个提示先删。

### Sidebar.jsx（修改）
- 视图导航区与分组区之间插「我的视图」区：GET settings 取 views（利用现有 load 周期）；点击 → onFilterChange(view.filter)；长按/hover 显示删除（XIcon)→ PUT 删除该项。
- 未登录读者：GET 公开可读；写操作 401 → LoginGate 广播（现有机制自动生效）。

### ReaderPage.jsx / ArticleList.jsx（修改）
- filter 状态扩展四个键；ArticleList 透传 sort(扩展支持 smart)/lang/score_min；时间预设在前端映射为 from 参数（today=本地今日，week=本周一，month=本月 1 日）;q 在面板关键词存在时任意 tab 都传（现状仅 history 传 q）。

## 模块交互

**应用视图**:Sidebar 点击视图 → ReaderPage.setFilter(view.filter)+面板状态同步 → ArticleList useEffect 依赖变化 → 重新 fetch 第一页。
**保存视图**:FilterPanel 收集当前 ReaderPage filter 全量 → PUT settings → Sidebar 重新 load → 新区出现。
**智能排序**:GET /api/articles?sort=smart → SQL 计算 smart_key(focus+3d 加成)→ 游标分页同现有模式。

## 文件组织

```
server/routes/articles.js            修改：smart/score/lang 三参数 + LIST_FIELDS 扩展
server/routes/settings.js            修改：+views 分区读写校验
tests/regression-views-filter.test.js 新建：真实路由驱动(样板 regression-sourcelib)
web/src/components/FilterPanel.jsx   新建
web/src/components/ArticleList.jsx   修改：参数透传 + 头部挂 FilterPanel
web/src/components/Sidebar.jsx       修改：+我的视图区
web/src/pages/ReaderPage.jsx         修改：filter 状态扩展
```

## 技术决策

| # | 决策点 | 选择 | 理由 |
|---|---|---|---|
| 1 | 视图存储 | settings['reader.views']，不加表不加列 | 沿袭十期 N5；GET settings 公开/PUT 受保护，零鉴权改动 |
| 2 | 智能排序公式 | focus 源 +3 天时间加成，SQL 内计算 | 确定性、可解释、可游标分页；无 AI（spec 决策 1) |
| 3 | 语言判定 | 应用层启发式 + 超采样翻页 | SQLite GLOB 对 UTF-8 范围匹配不可靠；不落库（spec 决策 2)；超采样保持游标语义 |
| 4 | 评分筛选 | SQL 条件 score IS NOT NULL AND >=档 | 无评分条目自然隐藏即 spec 语义；提示文案在前端面板 |
| 5 | 时间预设 | 前端映射为现有 from 参数 | 后端零改动，复用 F4 日期范围 |
| 6 | dedup 与 lang | 互斥（dedup 优先，面板禁用语言档） | 两套游标语义（簇序号 vs 行键）不兼容，叠加复杂度不值 |
| 7 | 视图数量上限 | 20,PUT 整体替换 | 防滥用；编辑=删了重建（YAGNI，不做单项 PATCH) |
| 8 | 参数扩展方式 | 只加不改：新参数缺省时走现有代码路径 | 零回归；现有测试不需改动 |

## spec 覆盖自检

F1→sort=smart（决策 2);F2→四维度（score SQL/lang 超采样/time 前端映射/q 透传）;F3→Sidebar 我的视图+保存按钮；F4→settings views 区+20 上限；N1 不动 portal;N2 超采样上限 4 页+SQL 过滤；N3 views 读公开写保护（settings 现有语义）;N4 FilterPanel 全 t-* 变量。AC1-AC6 → checklist 逐条映射。
