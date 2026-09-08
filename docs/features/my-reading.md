# 我的阅读（沉淀聚合页）

> `server/routes/reading.js` + `web/src/pages/MyReadingPage.jsx`
> 最后更新：2026-09-06

## 设计目标

- **阅读沉淀**：聚合已读文章 + 稍后读 + 收藏视频的并集，提供统一的阅读回顾入口
- **三 Tab 切换**：全部 / 稍后读 / 已读，各 Tab 独立计数
- **类型筛选**：全部 / 文章 / 播客 / 视频，与源类型口径一致
- **批量操作 + 导出**：支持取消稍后读/取消收藏/移除已读记录，导出为 Markdown

## API（reading.js）

### GET /api/reading

聚合列表，支持 tab/type/q/cursor 分页。

| 参数 | 值 | 说明 |
|------|-----|------|
| `tab` | `all` / `favorited` / `read` | 全部 / 稍后读 / 已读 |
| `type` | `all` / `article` / `podcast` / `video` | 类型筛选 |
| `q` | 字符串 | 关键词搜索（标题 + 源名） |
| `cursor` | ISO 时间戳 | 游标分页（按 `sort_key DESC`） |

**响应**：`{ ok, items, nextCursor, counts }`

- `items`：UNION ALL 文章 + 视频，统一字段（`id/item_type/title/url/cover/summary/date/source_name/source_type/read_at/later/favorite/sort_key`）
- `counts`：`{ all, favorited, read }` 各 Tab 计数（受 type/q 过滤，不受 tab 影响）
- 分页：`PAGE_SIZE=30`，`hasMore` 通过多取 1 条判断

**Tab × Type 矩阵**：

| | type=all | type=article | type=podcast | type=video |
|---|---|---|---|---|
| **tab=all** | 文章(已读∪稍后读) + 视频(收藏) | 文章(已读∪稍后读) | 播客(已读∪稍后读) | 视频(收藏) |
| **tab=favorited** | 文章(稍后读) + 视频(收藏) | 文章(稍后读) | 播客(稍后读) | 视频(收藏) |
| **tab=read** | 文章(已读) | 文章(已读) | 播客(已读) | 空 |

### POST /api/reading/batch

批量操作，body：`{ action, items: [{type, id}] }`

| action | 语义 | 影响表 |
|--------|------|--------|
| `unlater` | 取消稍后读 | `articles.later=0` |
| `unfavorite` | 取消收藏 | `videos.favorite=0` |
| `clear_read` | 移除已读记录 | `articles.read_at=NULL` |

### POST /api/reading/export

导出选中条目为 Markdown，body：`{ items: [{type, id}] }`

**响应**：`{ ok, markdown, count }`

Markdown 格式：标题 + 类型/来源/日期/链接/摘要（截断 200 字），按日期降序排列。

## 前端（MyReadingPage.jsx）

- 三 Tab 切换（全部/稍后读/已读）+ 类型筛选下拉 + 搜索框
- 游标分页（滚动加载更多）
- 批量选择 + 操作按钮
- 导出 Markdown 按钮
- 文章/视频混合列表，统一卡片样式

## 类型口径

与十期源库（classify.js）保持一致：

| 分类 | 源类型 |
|------|--------|
| 文章（article） | `wechat` / `rss` / `x` |
| 播客（podcast） | `douyin` |
| 视频（video） | `bilibili` / `douyin` / `youtube` |

> 注意：`douyin` 同时出现在播客和视频两侧——抖音源的内容既可能是音频播客也可能是视频，按 `contentKind` 区分。
