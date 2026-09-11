# 源库管理与自动分类

> ⚠️ 适用范围：本文描述本地 Express（server/）实现。云端对应物：采集 tools/collect-turso.js、API api/[...slug].js；差异与云端覆盖见 docs/FEATURE_MATRIX.md。

> `server/routes/sourcelib.js` + `server/services/classify.js`
> 最后更新：2026-09-06（十期·2026-09-05 实现）

## 设计目标

- **统一源管理**：管理台「源库」Tab 置首位，统一浏览/筛选/批量管理全类型源
- **自动分类**：内置 8 类目录（中英别名归一 + 关键词兜底），新源三挂接点自动入组
- **手动锁定**：`extra.categoryLocked=1` 标记的源不受自动分类覆盖
- **破茧栏联动**：分类结果自动并入 `daily.cocoonFamiliar` 设置

## 源库 API（sourcelib.js）

### 路由挂载顺序

**必须挂在 `sources.js` 路由之前**（决策 10），避免 `/batch` 被子路由截胡。`index.js` 有注释标注。

### GET /api/sources/library

全量源列表（公开只读），含 `itemCount`（文章/视频计数）+ `contentKind`（article/video）。

- extra 白名单重建：`intervalMin/lastError/lastErrorAt/marksFeatured/aggregator/domain/etag/lastModified/categoryLocked/origin`
- 脱敏：原 extra 串不外泄，仅返回白名单键

### POST /api/sources/batch

批量操作，body：`{ ids, action, groupId? }`

| action | 语义 | 注意 |
|--------|------|------|
| `enable` | 启用（解冻 + 6h 随机错峰） | 调用 `unfreezeSource` |
| `disable` | 停用 | `enabled=0` |
| `focus` | 特别关注（增量） | `focus=1` |
| `unfocus` | 取消关注（增量） | `focus=0` |
| `move` | 移动到分组 | kind 校验 + 写 `categoryLocked=1` |

> **focus 语义注意**：batch focus/unfocus 是增量模式；日报设置页的 `focusSourceIds` 是全量替换（唯一入口）。

### POST /api/sources/autoclassify

自动分类预览/执行：

| 模式 | body | 返回 |
|------|------|------|
| 预览 | `{ dryRun: true, includeLocked?, showAll? }` | `{ items, total, changed, skippedLocked, noSuggestion }` |
| 执行 | `{ apply: true, ids: [...] }` | `{ applied, skippedLocked, groupsCreated }` |

- 预览默认只返回「建议≠当前」的条目；`showAll=true` 返回全部
- 无建议（`suggested=null`）的条目默认不计入变更清单，单独计数 `noSuggestion`
- 执行时跳过 `categoryLocked` 的源

## 分类引擎（classify.js）

### 内置分类目录（8 类）

数组顺序即优先级，前面的更具体优先命中：

| key | 中文名 | 关键词示例 |
|-----|--------|-----------|
| `programming` | 编程技术 | 技术/开发/编程/前端/后端/开源/dev/github |
| `ai` | 人工智能 | ai/大模型/llm/gpt/深度学习/机器学习 |
| `business` | 商业科技 | 商业/创业/科技/创投/融资/财经 |
| `finance` | 金融经济 | 金融/经济/投资/股票/基金/macro |
| `product` | 产品 | 产品/产品经理/设计/ux/交互 |
| `growth` | 效率成长 | 效率/成长/学习/阅读/写作/自律 |
| `news` | 新闻媒体 | 新闻/资讯/日报/早报/晚报/媒体 |
| `life` | 生活方式与文化 | 生活/文化/艺术/旅行/美食/书 |

### 分类优先级

1. **OPML 原生分类**：`buildOpmlCategoryMap()` 解析 `opml/*.opml` 的 outline 层级，经 `aliases` 归一匹配
2. **关键词匹配**：`name + description` 拼接后逐目录扫描关键词
3. **均未命中**：返回 `null`，保持未分组

### 落组规则

`getOrCreateGroupId(zh, kind)`：精确同名 + 同 kind（article/video）复用已有分组，否则新建。

### 三个挂接点

新源自动分类在以下三点触发（全部 try/catch 降级不阻断建源）：

1. **手动添加**：`routes/sources.js` POST 端点
2. **OPML 同步**：`wechat syncOpml` 流程
3. **队列导入**：`poller.resolvePending` 流程

### 破茧栏名单

`mergeCocoonFamiliar(zh)`：分类结果自动并入 `settings['daily.cocoonFamiliar']`（可配 JSON 数组）。默认域内分组名：

```
AI / 科技 / 科技热榜 / 国际科技 / AI 模型 / AI 产品 / 技巧观点 / 行业动态 / 公众号 / 播客 / YouTube
```

### 手动锁定

- 写入点：只有 `POST /api/groups/move`（Sidebar 拖拽/源库下拉/批量移动的汇聚点）
- 判断：`json_extract(COALESCE(extra,'{}'),'$.categoryLocked')` 或 `JSON.parse` 后读键
- 自动分类永不覆盖锁定源

## 前端

- `SourceLibraryTab.jsx`（338 行）：全类型源列表 + 四筛选 + 搜索 + 本地分页 + 批量操作
- `BackfillPreviewModal.jsx`（161 行）：存量回填预览弹窗
- `icons.jsx` +6 图标：Folder/Search/Filter/Sparkles/Lock/Library
- 管理台版心特例 1160px（源库 Tab 置首位）

## 测试

- `tests/regression-sourcelib.test.js`（189 行）：真实路由驱动（app.listen(0) + generateToken + fetch）
  - 401 未认证回归锁
  - dryRun 预览回归锁
  - 无建议条目不计入变更清单（P2-1 修复）
  - 测试空转防护（3 例重述实现式测试重写）
