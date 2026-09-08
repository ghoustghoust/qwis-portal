# 订阅源库管理 + 源自动分类 Tasks

> 依据：已批准的 spec.md(F1-F8/AC1-AC13）与 plan.md（13 条技术决策）。
> 验证基线：每个任务完成后跑对应验证；全部完成后 `npm test` + `npm run build` 全绿。

## 文件清单

| 操作 | 文件 | 职责 |
|---|---|---|
| 新建 | `server/services/classify.js` | 分类目录/关键词/OPML 层级解析/落组/预览/执行 |
| 新建 | `server/routes/sourcelib.js` | GET library / POST batch / POST autoclassify |
| 修改 | `server/index.js` | 挂载 sourcelib（在 sources 之前） |
| 修改 | `server/routes/sources.js` | POST / 挂接自动分类；VIDEO_TYPES 改引 classify |
| 修改 | `server/routes/groups.js` | move：kind 校验 + categoryLocked |
| 修改 | `server/services/collectors/wechat/index.js` | syncOpml 新增源挂接 |
| 修改 | `server/services/queue/poller.js` | resolvePending 新增源挂接 |
| 修改 | `server/services/ai/daily.js` | FAMILIAR → settings 可配 |
| 新建 | `tests/classify.test.js` | 分类纯逻辑单测 |
| 新建 | `tests/regression-sourcelib.test.js` | 接口回归（batch/autoclassify/move/401） |
| 新建 | `web/src/components/SourceLibraryTab.jsx` | 源库主组件 |
| 新建 | `web/src/components/BackfillPreviewModal.jsx` | 回填预览弹窗 |
| 修改 | `web/src/components/icons.jsx` | +6 图标 |
| 修改 | `web/src/pages/AdminPage.jsx` | +「源库」Tab 置首位 |

## T1: classify.js — 分类目录与纯函数

**文件：** `server/services/classify.js`
**依赖：** 无
**步骤：**
1. 定义 `VIDEO_TYPES = ['bilibili','douyin','youtube']` 与 `kindOfType(type)`
2. 定义 `CATEGORY_CATALOG`（8 类，zh/aliases/keywords，按 plan 表格原文）
3. `normalizeName(s)`：小写 + trim（组名复用匹配用）
4. `matchByKeyword(text)`：按目录顺序对 keywords 做包含匹配，返回目录项或 null
5. `categoryFromOpml(catName)`：aliases 归一（含英文→zh），返回目录项或 null
6. `classifySource({name, type, url, description}, opmlMap)`：`opmlMap.get(url)` → categoryFromOpml → `matchByKeyword(name+' '+description)` → null；返回 `{key, zh, reason}` 或 null
7. module.exports 导出以上

**验证：** `node -e "const c=require('./server/services/classify'); console.log(c.classifySource({name:'腾讯技术工程',type:'rss',url:'x'},new Map()))"` 输出 `{key:'programming', zh:'编程技术', reason:'keyword'}`；无命中时输出 null

## T2: classify.js — 落组与单源自动分类

**文件：** `server/services/classify.js`（续）
**依赖：** T1
**步骤：**
1. `getOrCreateGroupId(zh, kind)`：按 `normalizeName` 精确同名同 kind 查 groups，无则 INSERT(sort=max+1)，返回 id
2. `mergeCocoonFamiliar(zh)`：getSetting('daily.cocoonFamiliar') 读数组（无则默认 11 项），并入 zh 去重写回
3. `autoClassifySourceId(id)`：读源 → buildOpmlCategoryMap() → classifySource → null 则返回 false；命中→getOrCreateGroupId → UPDATE group_id → mergeCocoonFamiliar → true；全程不抛（内部 try/catch，失败返回 false）
4. `DEFAULT_FAMILIAR` 常量导出（daily.js 复用）

**验证：** `node -e "..."` 在临时库（APP_DATA_DIR 指向 mktemp 目录）建一个名为「AI前线」的源，调用后其 group_id 指向新建「人工智能」组；第二次调用同名组不重复建

## T3: classify.js — OPML 层级解析与存量预览/执行

**文件：** `server/services/classify.js`（续）
**依赖：** T2
**步骤：**
1. `buildOpmlCategoryMap()`：读 `opml/` 三文件（路径相对项目根，fs 只读），正则解析 outline 层级——有 xmlUrl 的条目继承最近的无 xmlUrl 分组名作为分类；返回 `Map<xmlUrl, 分类原名>`；进程内缓存
2. `previewReclassify({includeLocked=false, showAll=false})`：全量扫 sources → 跳过 locked（除非 includeLocked)→ classifySource → 组装 `{id,name,currentGroupId,currentGroup,suggestedKey,suggested,reason}`;showAll=false 时只留「建议≠当前」；返回 `{items,total,changed,skippedLocked}`
3. `applyReclassify(ids)`：逐 id 重算建议（不信任前端传入的建议值）→ 跳过 locked → UPDATE group_id → 统计 `{applied, skippedLocked, groupsCreated}`；落组同样 mergeCocoonFamiliar

**验证：** 临时库中：locked 源不出现在预览；apply 后 group_id 已变且 locked 源不变；opml Map 中 youtube url 命中（如检查 map size>100)

## T4: groups.js move — kind 校验 + 锁定

**文件：** `server/routes/groups.js`
**依赖：** T1（用 kindOfType)
**步骤：**
1. move 路由内：查源的 type → kindOfType → 与目标组 kind 比对，不一致返回 400 `{ok:false,error:'文件夹类型不匹配'}`(group_id=null 跳过校验）
2. UPDATE group_id 成功后：读 extra → 合并 `categoryLocked:1` → 写回

**验证：** `node --test tests/regression-sourcelib.test.js -n` 占位——先人工：`node -e` 临时库建 video 源 + article 组，直接调路由逻辑 SQL 不可行，改为跑 T9 的回归测试（本任务验证合并到 T9)

## T5: 三个新增源挂接点 + daily.js FAMILIAR

**文件：** `server/routes/sources.js`、`server/services/collectors/wechat/index.js`、`server/services/queue/poller.js`、`server/services/ai/daily.js`
**依赖：** T2
**步骤：**
1. sources.js:VIDEO_TYPES 改为 `require('../services/classify').VIDEO_TYPES`（删本地定义）;POST / INSERT 后 `try{require('../services/classify').autoClassifySourceId(r.lastInsertRowid)}catch{}`，响应 item 重读（带 group_id)
2. wechat/index.js:syncOpml 的 insertStmt.run 后取 lastInsertRowid 同样挂接
3. poller.js:resolvePending INSERT 后同样挂接
4. daily.js:274 `FAMILIAR` → `getSetting('daily.cocoonFamiliar', DEFAULT_FAMILIAR)`(DEFAULT 从 classify 引；getSetting 已在依赖中）

**验证：** T9 回归测试覆盖（建源自动入组断言）

## T6: sourcelib.js — GET library

**文件：** `server/routes/sourcelib.js`（新建）
**依赖：** T1
**步骤：**
1. 复用 sources.js 的 `_withInterval`（已导出单测口）做 extra 脱敏
2. GET `/library`：全量 sources + `GROUP BY source_id` 的 articles/videos 计数两张聚合表 → map 合并出 `itemCount`(kindOfType 决定取哪张）与 `contentKind`
3. 输出契约：`{ok:true, items:[...]}`

**验证：** 启动服务后 `curl localhost:3000/api/sources/library | head -c 400` 返回 ok:true 且 item 含 itemCount/contentKind;678 源响应 <1s

## T7: sourcelib.js — POST batch

**文件：** `server/routes/sourcelib.js`（续）
**依赖：** T6、T2
**步骤：**
1. 参数校验：ids 为非空数字数组；action 白名单五值；move 时 groupId 查存在性
2. enable：逐 id `unfreezeSource` + `UPDATE next_fetch_at = now + random(0,6h)`（错峰）
3. disable：`UPDATE enabled=0`
4. focus/unfocus：增量 `UPDATE sources SET focus=? WHERE id=?`（逐 id)
5. move：kind 校验（不一致计入 failed)+ UPDATE group_id + extra 合并 categoryLocked=1
6. 统一返回 `{ok, succeeded, failed, errors}`

**验证：** T9 回归（四动作+错峰断言 next_fetch_at 分散+focus 增量不清他人）

## T8: sourcelib.js — POST autoclassify + 挂载

**文件：** `server/routes/sourcelib.js`（续）、`server/index.js`
**依赖：** T3、T7
**步骤：**
1. POST `/autoclassify`:`{dryRun:true, includeLocked?, showAll?}` → previewReclassify;`{apply:true, ids}` → applyReclassify
2. index.js:`app.use('/api/sources', require('./routes/sourcelib'))` 放在现有 sources 挂载**之前**（决策 10)，并在 P0-1e 回归锚点注释里补一句该顺序

**验证：** `curl -X POST localhost:3000/api/sources/batch` 无 token → 401;dryRun 前后数据库 `SELECT COUNT(*) FROM sources WHERE group_id IS NOT NULL` 不变

## T9: 后端回归测试

**文件：** `tests/classify.test.js`、`tests/regression-sourcelib.test.js`（新建）
**依赖：** T1-T8
**步骤：**
1. 两文件首行 `require('./helpers')`（隔离约定，ARCHITECTURE §8)
2. classify.test.js：关键词命中/别名归一（英文→同一 zh)/未命中 null/锁定跳过/落组精确复用不重复建组
3. regression-sourcelib.test.js：建源自动入组（T5);move 跨 kind 400+写锁定；batch enable 错峰（next_fetch_at 两两不同且在 6h 窗口内）+focus 增量语义；autoclassify dryRun 不落库/apply 跳过 locked;batch/autoclassify 无 token 401（用 supertest 式直接起 express？不——按现有回归测试风格用源码锚点断言 + 直接调 handler 或起 app 实例，参照 regression-20260905.test.js 的 P0-1 模式）

**验证：** `npm test` 全绿（含旧 125+ 项不回归）

## T10: icons.jsx +6

**文件：** `web/src/components/icons.jsx`
**依赖：** 无（可与后端并行）
**步骤：** 按现有 24px stroke 风格补 FolderIcon/SearchIcon/FilterIcon/SparklesIcon/LockIcon/LibraryIcon
**验证：** `npm run build` 通过；图标在 T11 界面中渲染

## T11: SourceLibraryTab.jsx

**文件：** `web/src/components/SourceLibraryTab.jsx`（新建）
**依赖：** T6-T8（接口）、T10
**步骤：**
1. 数据：load() 拉 `/api/sources/library` + `/api/groups`；本地 state
2. 工具栏：SearchIcon 搜索框、类型/文件夹/状态三下拉、SparklesIcon「自动分类回填」按钮
3. 筛选 useMemo：类型判定表（plan 模块设计）/group_id/状态（wemp=已退役；fail_count≥3&&enabled=0=熔断；enabled=0=停用；focus=特别关注）/名称搜索
4. 表格：checkbox 列（含表头全选本页）、头像（有则 img no-referrer，无则首字占位——照 Sidebar.jsx:186 模式）、名称+LockIcon（锁定源）、类型徽章、GroupSelect(native select，只列同 kind 组+「未分组」)、状态徽章、itemCount、relativeTime(last_fetched_at)、☆ 切换、启用开关
5. 批量浮动条：选中>0 显示；四动作 + 移动到文件夹；调 batch 接口；toast 结果；load() 刷新
6. 单点 ☆/开关/改组：复用 batch / move 接口
7. 分页：每页 20/50/100，页码样式照 SourceTable:148-175
8. 空态/加载态文案；全部 t-* 主题变量取色

**验证：** `npm run build` 通过；手动起服务浏览器验证三主题/筛选/批量/改组

## T12: BackfillPreviewModal.jsx

**文件：** `web/src/components/BackfillPreviewModal.jsx`（新建）
**依赖：** T8、T11（由它唤起）
**步骤：**
1. 打开即 POST autoclassify {dryRun:true}；loading 态
2. 清单表格：checkbox（默认全选变更项）| 源名 | 当前文件夹 → 建议文件夹（箭头+高亮）| 依据徽章（OPML 分类=蓝/关键词=灰）
3. 顶部统计「共 N 条建议变更，跳过锁定 M 条」+「显示全部」+「包含手动锁定源」（切换重发 dryRun)
4. [应用 N 项变更] → {apply:true, ids} → toast + 关闭 + 父组件 load()
5. 未确认前零写入（纯 dryRun)

**验证：** 浏览器实测：打开预览 → 取消 → DB 无变化；应用后 Sidebar 分组变化

## T13: AdminPage 接入

**文件：** `web/src/pages/AdminPage.jsx`
**依赖：** T11、T12
**步骤：** tabs 数组首位加 `{id:'library', label:'源库'}`；默认 tab 改 'library'；渲染分支；源库 Tab 容器版心 `max-w-[1160px]`（其余 Tab 保持 960px——条件 className)
**验证：** `npm run build` 通过；/admin/ 默认落在源库 Tab；其它 Tab 版心不变

## 执行顺序

```
T1 → T2 → T3 ─┬─→ T4 ─→ T5 ─→ T6 → T7 → T8 → T9(后端验收)
T10(可并行)───┘
T10 → T11 → T12 → T13(前端)
T9 + T13 → npm test 全绿 + npm run build → 完成
```
