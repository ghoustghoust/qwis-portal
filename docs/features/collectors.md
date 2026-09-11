# 采集层架构

> ⚠️ 适用范围：本文描述本地 Express（server/）实现。云端对应物：采集 tools/collect-turso.js、API api/[...slug].js；差异与云端覆盖见 docs/FEATURE_MATRIX.md。
> 补注：云端 YouTube 熔断阈值 10、RSS 间隔 60min。

> `server/services/collectors/` — 数据采集引擎
> 最后更新：2026-09-05

## 设计目标

- **适配器模式**：6 种平台（RSS/B站/抖音/热榜/微信/X）统一为 `{type, match, fetch}` 契约
- **职责分离**：原 store.js（202 行 6 职责）拆为 5 个高内聚模块
- **并发安全**：同源互斥锁，防止 tick/手动刷新/日报补抓并发冲突
- **向后兼容**：store.js 通过 re-export 保持所有现有 import 路径不变

## 模块结构

```
collectors/
├── _shared.js      # 并发防护锁 withSourceLock + 刷新间隔 intervalMinFor
├── _base.js        # 适配器契约校验 validateAdapter
├── registry.js     # 适配器注册表 + detectByUrl
├── repo.js         # 数据仓储 CRUD（saveArticles / saveVideos）
├── fetcher.js      # 抓取编排（fetchSource → 落库 → enrich 触发）
├── store.js        # 源生命周期（markSourceError / unfreezeSource）+ 兼容 re-export
├── rss/            # RSS/Atom 适配器
├── bilibili/       # B站适配器
├── douyin/         # 抖音适配器
├── hotlist/        # 热榜适配器
├── wechat/         # 微信公众号（走 RSS 适配器别名）
└── x/              # X/Twitter 适配器
```

## 适配器契约（_base.js）

```js
// 必须实现
type: string                    // 适配器唯一标识
match(input: string): object|false  // URL 识别
fetch(source, ctx): Promise<{articles, videos}>  // 拉取内容

// 可选
resolve(input): Promise<{name, url, uid, avatar}>  // 解析订阅源字段
defaultIntervalMin: number      // 默认刷新间隔
capabilities: object            // {articles, videos, fulltext}
fetchFulltext(url): Promise<{content}>  // 全文补抓
cleanContent(html): string      // 内容清洗
```

`registry.register()` 调用 `validateAdapter()` 校验 type + fetch + match 必须存在，缺失则抛错。

## 核心流程

### 抓取流程（fetcher.js）

```
fetchSource(source)
  └── withSourceLock(source.id, fetchSourceInner)
        ├── registry.getAdapter(source.type)
        ├── adapter.fetch(source, ctx)
        ├── repo.saveArticles(source.id, articles)
        ├── repo.saveVideos(source.id, videos)
        ├── ETag/Last-Modified 写回 extra
        ├── 更新 last_fetched_at / next_fetch_at / status='ok'
        └── aggregator 源 → setImmediate → enrichMissing
```

### 并发防护（_shared.js）

`withSourceLock(sourceId, fn)` — 内存 Set 互斥锁：
- 同一 sourceId 同时只允许一个 fn() 执行
- 后续调用返回 `{skipped: true, reason: 'in-flight'}`
- sourceId 为 null 时不加锁

### 源错误状态机（store.js）

```
markSourceError(source, errMsg)
  ├── fail_count += 1
  ├── extra.lastError = errMsg（脱敏）
  ├── fail_count >= 3 → enabled=0（自动熔断）
  └── fail_count >= 2 → 触发报警（异步，非批量路径）

unfreezeSource(id)
  ├── enabled=1, fail_count=0, status='ok'
  └── 清 extra.lastError/lastErrorAt，保留 intervalMin/etag
```

### 刷新间隔计算（_shared.js）

`intervalMinFor(source, registry)` 优先级：
1. `source.extra.intervalMin`（源级覆盖）
2. `settings.intervals[type]`（全局配置）
3. `adapter.defaultIntervalMin`（适配器默认）
4. 兜底值（RSS 8h，抖音 360min，B站 60min）

## 数据模型

| 表 | 关键字段 | 说明 |
|----|---------|------|
| sources | id, type, name, url, extra(JSON), fail_count, next_fetch_at | 订阅源 |
| articles | id, source_id, title, url(UNIQUE), score, featured | 文章 |
| videos | id, source_id, platform, url(UNIQUE), vid, play_uri | 视频 |
| pending_items | id, type, url, name, status | 待处理队列 |

## 接口契约

```js
// store.js（兼容 re-export）
const { saveArticles, saveVideos, fetchSource, intervalMinFor, markSourceError, unfreezeSource } = require('./store');

// 精确模块（推荐新代码使用）
const { saveArticles, saveVideos } = require('./repo');
const { fetchSource } = require('./fetcher');
const { withSourceLock, intervalMinFor } = require('./_shared');
const { markSourceError, unfreezeSource } = require('./store');
const registry = require('./registry');
```

## 注意事项

1. **pending_items 表只有 6 列**（id, type, url, name, status, error, imported_at），无 source_id/created_at
2. **异步回调内的 DB 操作必须 try/catch**，prepare 抛错可崩进程
3. **better-sqlite3 不支持编号参数 `?1`**，一律用匿名 `?`
4. **抖音串行限速**：fetch 内部经 douyin.enqueue 严格串行 ≥10s 间隔
5. **ETag 304 短路**：RSS 适配器支持条件请求，notModified 时不更新数据
