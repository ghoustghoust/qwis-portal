# 阅读器高级筛选 + 保存视图 Tasks

> 依据：已批准的 spec.md(F1-F4）与 plan.md（决策 1-8)。验证基线：坑 #18——路由行为测试一律真实路由驱动。

## 文件清单

| 操作 | 文件 | 职责 |
|---|---|---|
| 修改 | `server/routes/articles.js` | smart 排序 / score_min / lang 超采样 / LIST_FIELDS 扩展 |
| 修改 | `server/routes/settings.js` | +views 分区读写与校验 |
| 新建 | `tests/regression-views-filter.test.js` | 真实路由回归（401/smart/score/lang/views) |
| 新建 | `web/src/components/FilterPanel.jsx` | 筛选面板浮层 + 保存视图 |
| 修改 | `web/src/components/ArticleList.jsx` | 参数透传 + 挂 FilterPanel |
| 修改 | `web/src/pages/ReaderPage.jsx` | filter 状态扩展 |
| 修改 | `web/src/components/Sidebar.jsx` | +我的视图区 |

## T1: articles.js — smart 排序

**文件：** `server/routes/articles.js`
**依赖：** 无
**步骤：**
1. LIST_FIELDS 增加 `s.focus AS source_focus, a.score`
2. sort 参数扩展：`smart` 时 sortKeyExpr = `(unixepoch(COALESCE(a.published_at,a.created_at)) + COALESCE(s.focus,0)*259200)`,dir 固定 DESC；游标比较沿用 sort_key\|id 复合键模式（SELECT 里输出该表达式 AS sort_key)
3. new/old 路径逻辑不变

**验证：** T6 回归（真实路由断言 focus 源排在同时间窗非 focus 源之前）

## T2: articles.js — score_min + lang

**文件：** `server/routes/articles.js`（续）
**依赖：** T1
**步骤：**
1. buildWhere 加：`score_min` ∈ {80,90}（其余值忽略）→ `a.score IS NOT NULL AND a.score >= ?`
2. `lang=zh|en`：原始查询改为循环取底层页（每页 PAGE_SIZE×4，最多 4 页），应用层 `/[\u4e00-\u9fff]/.test(title)` 过滤（zh 留命中，en 留未命中），凑满 30 或底层耗尽为止；nextCursor 取自最后一条被消费的原始行
3. dedup=1 与 lang 同现时 lang 忽略（决策 6)

**验证：** T6 回归（造中/英文标题条目断言归属；score_min 断言无评分条目消失）

## T3: settings.js — views 分区

**文件：** `server/routes/settings.js`
**依赖：** 无
**步骤：**
1. GET 响应加 `views: getSetting('reader.views', [])`
2. PUT 加 `body.views`：先校验（数组、≤20、每项 name 非空 ≤20 字、filter 为对象）后 `setSetting('reader.views', ...)` 整体替换；非法 400 不写

**验证：** T6 回归（GET 公开含 views;PUT 无 token 401；非法 400；上限 20)

## T4: FilterPanel.jsx（新建）

**文件：** `web/src/components/FilterPanel.jsx`
**依赖：** 无（UI 可与后端并行）
**步骤：**
1. 浮层面板：排序（智能/最新/最早）、时间（全部/今天/本周/本月）、语言（全部/中文/英文；dedup 开启时禁用）、评分（不限/≥80/≥90，带「仅热点榜条目有评分」提示）、关键词输入
2. 「清除全部」复位；「保存为视图…」命名弹层 → 收集当前 filter → GET settings 取旧 views → PUT 整体替换追加 → toast
3. 全 t-* 变量；浮层点击外部关闭

**验证：** `npm run build` 通过；浏览器实测面板开合/清除/保存

## T5: 前端接线（ReaderPage/ArticleList/Sidebar)

**文件：** `web/src/pages/ReaderPage.jsx`、`web/src/components/ArticleList.jsx`、`web/src/components/Sidebar.jsx`
**依赖：** T1-T4
**步骤：**
1. ReaderPage filter 扩展 {sort, lang, scoreMin, timePreset}，默认 {sort:'new', lang:'all', scoreMin:0, timePreset:'all'};sort 记忆 localStorage('qwis.sort')
2. ArticleList：头部挂 FilterPanel；请求透传 sort（含 smart)/lang/score_min;timePreset 映射 from（今天=本地今日/本周=周一/本月=1 日）;q 在面板关键词非空时任意 tab 都传；useEffect 依赖数组补新键
3. Sidebar：导航区与分组区之间插「我的视图」区（load 时一并 GET settings 取 views)；点击 onFilterChange(view.filter)；每项 hover 出 XIcon 删除（PUT 移除）
4. 应用视图时同时同步 FilterPanel 的显示状态（filter 单一数据源在 ReaderPage)

**验证：** `npm run build` 通过；浏览器端到端走查

## T6: 回归测试（真实路由驱动）

**文件：** `tests/regression-views-filter.test.js`（新建）
**依赖：** T1-T3
**步骤：**
1. 首行 require('./helpers')；起 express 实例（authMiddleware + articles + settings 路由）,generateToken,fetch 打真实路由（样板 regression-sourcelib.test.js)
2. 断言：sort=smart focus 加成排序；score_min=80 隐藏无评分与低分条目；lang=zh/en 归属正确；views GET 公开/PUT 401/非法 400/超 20 拒绝；新参数缺省时响应与现状一致（字段/分页契约不变）

**验证：** `npm test` 全绿（含既有全部用例）

## 执行顺序

```
T1 → T2 → T3 → T6（后端+测试）
T4（可并行）→ T5（前端接线）
T6 + T5 → npm test 全绿 + npm run build → 完成
```
