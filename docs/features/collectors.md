# 采集层架构

> ⚠️ 适用范围：**采集语义全库有三份实现**——本地端 `server/services/collectors/`、云端读层的即时采集 `api/collect.js`、
> 主链路 runner `tools/collect-turso.js`（AGENTS §1：改任何一份的过滤/清洗/熔断/去重/UA/间隔，必须同步检查另外两份）。
> 最后更新：2026-10-03（收敛轮：youtube 别名身份写明、模块数去写死、报警计数点改指共用实现）
> 本文写"怎么算"，**不复制易变数字**（间隔与阈值的真值去处见下文两处指针）。

## 设计目标

- **适配器模式**：6 种平台适配器（RSS/B站/抖音/热榜/微信/X）统一为 `{type, match, fetch}` 契约；YouTube 以独立 `type='youtube'` 存储、复用 RSS 适配器（别名登记），不单设适配器
- **职责分离**：原单体 store.js 按职责拆成一组高内聚模块（目录见下）
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
标记源错误(source, errMsg)
  ├── fail_count += 1
  ├── extra.lastError = errMsg（脱敏）
  ├── fail_count 达到「该类型的熔断阈值」→ enabled=0（自动熔断）
  │     ⚠️ 阈值**不在本文档写死**：全库一份在熔断实现里（`lib/source-breaker.js`），
  │     按源类型区分——视频类放宽（反爬会假 404/500，误杀代价大），其余更严。三端共用这一份。
  └── fail_count 达到报警计数点 → 触发报警（异步，非批量路径；计数点取值在 runner 与本地各自的采集实现里——是两份，改要对齐，语义见 `events-alerts.md` 的升级阶梯）

解冻源(id)
  ├── enabled=1, fail_count=0, status='ok'
  └── 清 extra.lastError/lastErrorAt，保留 intervalMin/etag
```

### 刷新间隔怎么算

优先级**不是**一条直线，且**按类型分岔**（这是 09-25 订正的旧错：本文原先写"RSS 兜底 8h"，实际差着 16 倍）：

1. 源级覆盖 `extra.intervalMin` —— 最高，单源可钉。
2. 全局配置 `settings.intervals[...]`。
3. **文字类那一族（rss / wechat / x / youtube）到此为止**：它们共用一个"文章刷新间隔"键，
   没配就用默认值（真值见 `_shared.js`，云端与本地是否同源见 `FEATURE_MATRIX.md` §1.4）——
   **这一族不查适配器默认值**，所以"改了适配器默认间隔想影响 RSS 源"是无效的。
4. **B站/抖音**：查适配器默认值，再不行才落各自的兜底数。
5. 其余（热榜/未知类型）：适配器默认 → 回落到文章族那个间隔。

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

1. **`pending_items` 是"搬进来的待办"表，不是文章表**：列见建表语句，**没有 source_id、也没有 created_at**（要按源归属得先解析出 url 再落 articles）
2. **异步回调内的 DB 操作必须 try/catch**，prepare 抛错可崩进程
3. **better-sqlite3 不支持编号参数 `?1`**，一律用匿名 `?`
4. **抖音串行限速**：fetch 内部经 douyin.enqueue 严格串行 ≥10s 间隔
5. **ETag 304 短路**：RSS 适配器支持条件请求，notModified 时不更新数据
6. **字数一律取纯文本那一列，不许用正文源码长度**：正文里嵌着标记与图片地址，拿它算字数会**虚高几十倍**。前端优先取纯文本列，落库时也钉住了两者的大小关系。要改字数口径先读这两处，别只改一头
