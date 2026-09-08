# 订阅源库管理 + 源自动分类 Plan

> 依据：`docs/specs/09-source-library-autoclassify/spec.md`(F1-F8 / N1-N5 / AC1-AC13,已经两轮对抗核验)。
> 行布局决策（用户确认「继续」时采纳推荐项）：紧凑表格行为骨架 + 1.png 的状态徽章/头像视觉。

## 架构概览

```
┌─ 前端(web/src)─────────────────────────────────────────────┐
│ AdminPage.jsx          +1 Tab:「源库」(id:'library')          │
│ └─ components/SourceLibraryTab.jsx   源库主组件(新建)         │
│     ├─ BatchToolbar(内联)     批量操作浮动条                  │
│     ├─ GroupSelect(内联)      文件夹下拉(kind 过滤+锁定标记)  │
│     └─ BackfillPreviewModal.jsx (新建)  回填预览 diff 弹窗     │
│ icons.jsx                +6 图标(Folder/Search/Filter/       │
│                          Sparkles/Lock/Library)              │
├─ 后端(server/)─────────────────────────────────────────────┤
│ services/classify.js   (新建) 自动分类:目录/关键词/落组纯逻辑  │
│ routes/sourcelib.js    (新建) GET library 列表 / POST batch  │
│                               / POST autoclassify            │
│ routes/sources.js      POST / 创建后挂 classify(1 行挂接)     │
│ routes/groups.js       POST /move +kind 校验 +categoryLocked │
│ collectors/wechat/index.js   syncOpml 新增源挂 classify      │
│ services/queue/poller.js     resolvePending 新增源挂 classify│
│ services/ai/daily.js   FAMILIAR 硬编码 → settings 可配       │
└─────────────────────────────────────────────────────────────┘
```

**改动哲学**：新增为主、修改为点状挂接；不改 SourceTable(批量选择是 2026-09-04 刚移除的死代码，且该组件被 3 个 Tab 复用，改动面大）；不改现有 `GET /api/sources` 契约（零回归）；portal/ 一字不动(N1)。

## 核心数据结构

### 分类目录（classify.js 内置常量）

```js
CATEGORY_CATALOG = [
  { key: 'programming', zh: '编程技术',     aliases: ['Programming & Technology', '编程技术'],
    keywords: ['技术', '开发', '编程', '前端', '后端', '开源', 'dev', 'engineer', 'github'] },
  { key: 'ai',          zh: '人工智能',     aliases: ['Artificial Intelligence', '人工智能', 'AI'],
    keywords: ['ai', '人工智能', '大模型', 'llm', 'gpt', '深度学习', '机器学习', '智能'] },
  { key: 'business',    zh: '商业科技',     aliases: ['Business & Technology', '商业科技 Business & Tech', '商业访谈'],
    keywords: ['商业', '创业', '科技', '创投', '融资', '财经', '公司'] },
  { key: 'finance',     zh: '金融经济',     aliases: ['Finance & Economy', '金融经济'],
    keywords: ['金融', '经济', '投资', '股票', '基金', 'macro'] },
  { key: 'product',     zh: '产品',         aliases: ['Product Development', '产品'],
    keywords: ['产品', '产品经理', '设计', 'ux', '交互'] },
  { key: 'growth',      zh: '效率成长',     aliases: ['Productivity & Growth', '个人成长', '效率成长'],
    keywords: ['效率', '成长', '学习', '阅读', '写作', '自律'] },
  { key: 'news',        zh: '新闻媒体',     aliases: ['News & Media', '新闻媒体'],
    keywords: ['新闻', '资讯', '日报', '早报', '晚报', '媒体'] },
  { key: 'life',        zh: '生活方式与文化', aliases: ['Lifestyle & Culture', '生活方式与文化'],
    keywords: ['生活', '文化', '艺术', '旅行', '美食', '书'] },
];
```

- 匹配顺序：OPML 原生分类（经 aliases 归一）→ keywords 对 `name + description` 做大小写不敏感包含匹配（**目录数组顺序即优先级**，前面的类更具体优先命中）→ 未命中返回 null（保持未分组，spec F5-3）。
- **组复用策略（保守）**：落组时按「精确同名 + 同 kind」复用现有组（大小写/首尾空格归一）；不做近义模糊复用（「人工智能」不复用现有「AI」组——近义合组留给用户手动删组合并，避免误并）。aliases 仅用于 OPML 分类名归一，不用于现有组名匹配。

### sources.extra 新增键（不加列，N5）

| 键 | 含义 | 写入点 |
|---|---|---|
| `categoryLocked: 1` | 手动锁定，自动分类/回填跳过 | `POST /api/groups/move`（所有人工作归入口的汇聚点） |

### settings 新增键

| 键 | 含义 | 默认 |
|---|---|---|
| `daily.cocoonFamiliar` | 破茧栏域内分组名数组 | 现有硬编码 11 项：`['AI','科技','科技热榜','国际科技','AI 模型','AI 产品','技巧观点','行业动态','公众号','播客','YouTube']` |

daily.js:274 的 FAMILIAR 改为 `getSetting('daily.cocoonFamiliar', 默认值)`；自动分类落组时把组名并入该 setting（去重）——无 UI 编辑器（YAGNI）。

### 接口契约

```
GET  /api/sources/library                     （公开只读，与 GET /api/sources 同语义）
  ← { ok, items: Source[] }   Source 增加两个字段：
     itemCount  (累计条目数：文章源=articles 总数，视频源=videos 总数；GROUP BY 一次聚合，非 N+1)
     contentKind('article'|'video'，后端算好，前端不重复 VIDEO_TYPES 判断)
  其余字段 = 现有 GET /api/sources 的 withInterval 脱敏输出（含 group_id/focus/enabled/fail_count/status/last_fetched_at/avatar/extra 白名单）
  说明：不做服务端分页/筛选——678 源全量一次返回（与现有模式一致），前端本地筛选分页。

POST /api/sources/batch                       （受保护 Bearer）
  → { ids: number[], action: 'enable'|'disable'|'focus'|'unfocus'|'move', groupId?: number|null }
  ← { ok, succeeded, failed, errors?: [{id, error}] }
  规则：
   - enable：逐个走 store.unfreezeSource（清 fail_count+错误标记）+ next_fetch_at=now+random(0,6h) 错峰
   - disable：enabled=0
   - focus / unfocus：增量 UPDATE sources.focus（绝不做全量替换，防与日报设置页互踩，spec F3）
   - move：目标组必须存在且 kind 与源 contentKind 一致（不一致→该条计入 failed）；批量移动属人工改归，成功项与单点 move 一样写 extra.categoryLocked=1（决策 5 的语义在此复用实现）

POST /api/sources/autoclassify                （受保护 Bearer）
  → { dryRun: true, includeLocked?: bool }
  ← { ok, items: [{ id, name, currentGroupId, currentGroup, suggestedKey, suggested, reason: 'opml'|'keyword'|null }],
      total, changed, skippedLocked }
     dryRun 不落库；默认只返回「建议≠当前」的条目（changed），加 showAll:true 返回全部
  → { apply: true, ids: number[] }            （执行预览中用户勾选的条目）
  ← { ok, applied, skippedLocked, groupsCreated: string[] }
     逐条 UPDATE group_id；跳过 extra.categoryLocked=1；使用的组名并入 settings.daily.cocoonFamiliar

POST /api/groups/move  （现有路由修改）
  变更：① kind 校验——源 contentKind 与目标组 kind 不一致返回 400 {error:'文件夹类型不匹配'}；
        ② 成功后写 extra.categoryLocked=1（合并写，不覆盖 extra 其它键）。
  兼容性：Sidebar 拖拽是唯一现有调用方，拖拽到未分组（group_id=null）同样置锁定（人工意图明确）。
```

## 模块设计

### server/services/classify.js（新建，核心纯逻辑）

**职责**：自动分类全部逻辑，无 HTTP 依赖，可独立单测。
**对外接口**：
- `kindOfType(type)` → `'article'|'video'`（VIDEO_TYPES 单一定义点，与 sources.js:11 对齐——提取为 classify 导出，sources.js 改为引用）
- `classifySource({ name, type, url, description? }, opmlMap)` → `{ key, zh, reason: 'opml'|'keyword' } | null`（纯函数）
- `getOrCreateGroupId(zh, kind)` → groupId（精确同名同 kind 复用，否则 INSERT；sort=max+1）
- `autoClassifySourceId(id)` → 对单个源执行分类并落组（供三个新增源挂接点调用；落组后并入 cocoonFamiliar）
- `buildOpmlCategoryMap()` → `Map<url, categoryZh>`：解析 `opml/` 三文件，捕获分组层级（youtube/podcast 的二级 outline；wechat 扁平自然无映射）；进程内缓存
- `previewReclassify({ includeLocked })` / `applyReclassify(ids)` → F6 预览/执行

**依赖**：db.js、groups 表、opml/ 文件（fs 只读）。

### server/routes/sourcelib.js（新建）

**职责**：源库三个接口的 HTTP 层；参数校验；调 classify.js 与 store.js。
**依赖**：classify.js、store.unfreezeSource、db.js。

### server/routes/groups.js（修改 move 一处）

+kind 校验（查源 type→contentKind 对比组 kind）；+成功写 categoryLocked（读 extra→合并→写回）。

### 三个新增源挂接点（各 1-2 行）

| 文件 | 位置 | 挂接 |
|---|---|---|
| routes/sources.js:98 | POST / 创建成功后 | `classify.autoClassifySourceId(r.lastInsertRowid)` |
| collectors/wechat/index.js:58 | syncOpml insertStmt 后 | 同上（拿到 lastInsertRowid） |
| queue/poller.js:94 | resolvePending INSERT 后 | 同上 |

挂接均 try/catch 包裹——分类失败不阻断建源主流程（降级为未分组）。

### server/services/ai/daily.js（修改 1 行）

`FAMILIAR` 硬编码 → `getSetting('daily.cocoonFamiliar', DEFAULT_FAMILIAR)`；DEFAULT_FAMILIAR 保留现有 11 项作缺省。

### web/src/components/SourceLibraryTab.jsx（新建，~350 行）

**结构**：
```
工具栏：搜索框 | 类型筛选(全部/文章/播客/视频/推文/热榜) | 文件夹筛选 | 状态筛选(全部/未启用/熔断/特别关注)
        | [自动分类回填] 按钮
批量条(选中>0 时浮现)：已选 N 项 | 启用 | 停用 | 特别关注 | 取消特别关注 | 移动到文件夹▾ | 取消选择
表格(紧凑行)：☑ | 头像/占位 | 名称(含锁定🔒) | 类型徽章 | 文件夹(GroupSelect 下拉) | 状态徽章 | 条目数 | 最近抓取 | 特别关注☆ | 启用开关
分页：复用 SourceTable 的分页样式(上一页/页码/下一页，每页 20/50/100)
```
- 数据：`api.get('/api/sources/library')` 一次拉全量 + `api.get('/api/groups')`；本地 useMemo 筛选/分页（同 SourceTable 模式）
- 类型判定（前端显示用，与后端 contentKind 对齐）：
  | 显示类型 | 判定 |
  |---|---|
  | 视频 | type ∈ {bilibili, douyin, youtube} |
  | 推文 | type = x |
  | 热榜 | type = hotlist 或 extra.aggregator=1 |
  | 播客 | type = rss 且 extra.origin = 'bestblogs-podcast'（或 url 含 xiaoyuzhoufm） |
  | 文章 | 其余（rss / wechat / wemp） |
- 状态徽章：已退役(type=wemp，灰) / 熔断(enabled=0 且 fail_count≥3，橙) / 已停用(enabled=0，灰) / 正常(绿)；特别关注=StarIcon 实心
- 行交互：文件夹下拉（只列同 kind 组，含「未分组」）→ POST /api/groups/move → 本地更新；☆ 切换 → POST batch focus/unfocus 单 id；开关 → batch enable/disable 单 id（复用批量通道，单点是批量的特例，避免再维护 toggle 调用）
- 空态：筛选无结果 / 全库无源的两种文案

### web/src/components/BackfillPreviewModal.jsx（新建，~150 行）

打开时 POST autoclassify {dryRun:true}；展示变更清单表格：☑（默认全选）| 源名 | 当前文件夹 → 建议文件夹 | 依据徽章（OPML 分类/关键词）；顶部：共 N 条建议变更（跳过锁定 M 条）| 「显示全部」开关 | 「包含手动锁定源」开关（重发 dryRun）；底部：取消 / [应用 N 项变更] → POST autoclassify {apply:true, ids} → toast 结果 + 刷新列表。

### icons.jsx 补缺（+6）

FolderIcon / SearchIcon / FilterIcon / SparklesIcon（自动分类）/ LockIcon / LibraryIcon——全部按现有 24px stroke 风格手写 SVG。

## 模块交互（数据流）

**批量启用**：勾选 → BatchToolbar「启用」→ POST batch{action:'enable'} → 逐源 unfreezeSource + 错峰 next_fetch_at → {succeeded, failed} → toast → 重新拉 library。

**手动改归（源库下拉或 Sidebar 拖拽）**：→ POST /api/groups/move → kind 校验 → UPDATE group_id + extra.categoryLocked=1 → 前端本地更新（源库）/ load()（Sidebar）。

**新源自动分类**：POST /api/sources → resolve → INSERT → classify.autoClassifySourceId → 命中目录→getOrCreateGroupId→UPDATE group_id + 并入 cocoonFamiliar → 响应 item 已带 group_id。

**存量回填**：源库点「自动分类回填」→ Modal dryRun → 用户勾选确认 → apply → 逐条 UPDATE（跳过锁定）→ 组名并入 cocoonFamiliar → toast「已应用 N 项，新建文件夹 X 个」。

## 文件组织

```
server/
├── services/classify.js            新建：分类目录/关键词/落组/预览/执行
├── routes/sourcelib.js             新建：library/batch/autoclassify
├── routes/sources.js               修改：POST / 挂接 + VIDEO_TYPES 改从 classify 引
├── routes/groups.js                修改：move +kind 校验 +锁定
├── services/collectors/wechat/index.js  修改：syncOpml 挂接
├── services/queue/poller.js        修改：resolvePending 挂接
├── services/ai/daily.js            修改：FAMILIAR → settings
├── index.js                        修改：挂载 /api/sources 新增子路由（sourcelib 挂在 sources 同前缀内或独立路径,见决策10）
tests/
├── classify.test.js                新建：目录匹配/别名归一/关键词兜底/未命中/锁定跳过/落组复用
├── regression-sourcelib.test.js    新建：batch 四动作+错峰+kind 校验+autoclassify dryRun 不落库+401
web/src/
├── components/SourceLibraryTab.jsx      新建
├── components/BackfillPreviewModal.jsx  新建
├── components/icons.jsx            修改：+6 图标
└── pages/AdminPage.jsx             修改：+「源库」Tab（id:'library'，置于首位）
```

## 技术决策

| # | 决策点 | 选择 | 理由 |
|---|---|---|---|
| 1 | 源库数据来源 | 新建 `GET /api/sources/library`，不改现有 `GET /api/sources` | 现有接口被 Sidebar/各 Tab/日报设置消费，加字段改契约回归面大；新接口零回归（spec N5） |
| 2 | 分页/筛选位置 | 前端本地（一次拉全量） | 678 源 ≈300KB，与 SourceTable 现有模式一致；服务端分页属过度设计 |
| 3 | 批量选择 UI | 新建 SourceLibraryTab，不给 SourceTable 加回批量 | SourceTable 批量功能 2026-09-04 刚作为死代码移除；它被 3 个 Tab 复用，改动面大 |
| 4 | 锁定存储 | extra.categoryLocked，不加列 | spec N5；与 aggregator/intervalMin 同模式（json_extract 判定） |
| 5 | 锁定写入点 | 只挂 `POST /api/groups/move` | 所有人工作归入口（Sidebar 拖拽/源库下拉/批量移动）的汇聚点，单点收敛无遗漏 |
| 6 | focus 批量写法 | 增量 UPDATE | 日报设置页 focusSourceIds 是全量替换语义，双写会互踩（spec F3 红线） |
| 7 | 破茧栏名单 | settings 可配 + 落组时自动并集 | daily.js:274 硬编码与组名强耦合；不做 UI 编辑器（YAGNI） |
| 8 | 单源启用/特别关注 | 复用 batch 接口（单 id 数组） | 避免维护两套通道；toggle 保留给现有 Tab 不动 |
| 9 | 组复用 | 仅精确同名同 kind；不做近义模糊复用 | 「人工智能」≠现有「AI」组宁可新建，误并比重复更难收拾（用户可删组合并） |
| 10 | batch 路由防截胡 | sourcelib.js 内自带 `/batch` `/autoclassify`，以 `app.use('/api/sources', sourcelib)` 挂在 sources.js **之前** | restore-all 的挂载顺序侥幸教训（审查 B2）；先挂先匹配，POST /batch 不会被任何现有路由截胡 |
| 11 | 分类失败降级 | 挂接点 try/catch，失败=未分组 | 分类是增强不是阻断，建源主流程必须永远成功 |
| 12 | OPML 层级解析 | classify.js 独立实现 buildOpmlCategoryMap，不动 wechat/parseOpml | parseOpml 服务远程同步路径（扁平 OPML），改它有回归风险；回填用本地文件另解析 |
| 13 | 行布局 | 紧凑表格行 + 状态徽章/头像（方案 A） | 用户确认；960px→1160px 版心特例仅源库 Tab（spec F8.6） |

## spec 覆盖自检

F1→library 接口+表格列；F2→工具栏四筛选+类型判定表；F3→batch 四动作（决策 6 护航）；F4→GroupSelect+move 校验锁定（决策 5）；F5→classify 三挂接点（决策 11/12）；F6→autoclassify dryRun/apply+Modal；F7→CATEGORY_CATALOG+保守复用（决策 9）；F8→组件结构+icons 补缺+徽章色板；N1→不动 portal；N2→一次拉取+本地筛选；N3→batch/autoclassify 受保护（挂 authMiddleware 之后自然生效）；N4→两个新测试文件；N5→不加列、不改现有接口契约。AC12/AC13→决策 6/7。
