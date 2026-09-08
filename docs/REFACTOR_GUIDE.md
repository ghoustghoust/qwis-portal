# 架构重构迁移指南

> 深度架构重构 Phase 1-5 的文件拆分映射表 + import 路径变更说明。
> 日期: 2026-09-05

## 概述

本次重构将采集层（store.js 202 行 6 职责）、调度层（scheduler/index.js 310 行 9 种定时任务）、事件引擎（events.js 反向依赖）拆分为高内聚低耦合的独立模块，并引入 SQLite 任务队列替代串行 tick。

**所有现有 import 路径通过 re-export 保持兼容**，无需批量修改调用方。

## 文件拆分映射表

### 采集层 (server/services/collectors/)

| 原文件 | 拆分后 | 职责 |
|--------|--------|------|
| `store.js` (202 行) | `_shared.js` | 并发防护锁 `withSourceLock` + 刷新间隔计算 `intervalMinFor` |
| | `_base.js` | 适配器契约校验 `validateAdapter` |
| | `repo.js` | 数据仓储 CRUD（`saveArticles` / `saveVideos`） |
| | `fetcher.js` | 抓取编排（`fetchSource` → 落库 → enrich 触发） |
| | `store.js` (~73 行) | 源生命周期（`markSourceError` / `unfreezeSource`）+ 兼容 re-export |

**兼容 re-export**: `store.js` 仍导出 `saveArticles`、`saveVideos`、`fetchSource`、`intervalMinFor`，所有 `require('../collectors/store')` 调用路径无需修改。

### 调度层 (server/services/scheduler/)

| 原文件 | 拆分后 | 职责 |
|--------|--------|------|
| `index.js` (310 行) | `index.js` (~140 行) | 调度核心（tick/scanAndEnqueue + start/stop/reschedule） |
| | `jobs/daily.js` | 日报定时 + `fetchDueBeforeDaily` |
| | `jobs/fulltext.js` | 全文补抓（6h cron） |
| | `jobs/opml.js` | OPML 同步 |
| | `jobs/maintenance.js` | 数据清理 + 报警清理 + 健康自检 |
| | `jobs/portal.js` | 门户数据同步 |
| | `jobs/recovery.js` | 中断恢复（`resumeInterrupted`） |

### 事件引擎解耦

| 变更 | 说明 |
|------|------|
| `events.js` | `require('./ai/daily')` → `require('./ai/_tokens')` |
| `ai/_tokens.js` | 新文件：`titleTokens` + `jaccard` + `normalizeTitle` 纯函数 |
| `ai/daily.js` | 改引 `_tokens.js`，不再被 events.js 直接依赖 |

### 适配器契约形式化

| 变更 | 说明 |
|------|------|
| `_base.js` | 新增 `validateAdapter()` 校验 type + fetch + match 必须存在 |
| `registry.js` | `register()` 调用 `validateAdapter()` 校验 |
| `rss/index.js` | 新增正式导出 `fetchFulltext` / `cleanContent`（替代 `_internals` 引用） |
| `hotlist/index.js` | 消除 `_internals` 引用，改用 registry 正式 API |
| `hot.js` | 同上 |

### 任务队列 (server/services/queue/)

| 文件 | 说明 |
|------|------|
| `taskQueue.js` | **新增**: SQLite-backed TaskQueue（优先级/重试/同源去重/崩溃恢复） |
| `poller.js` | 保留不变（云端队列轮询器） |

**job_queue 表**: `server/db.js` 新增 DDL 迁移。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `QUEUE_ENABLED` | `true` | 设为 `false` 回退串行 tick 模式（不启用任务队列消费） |

## 新增测试

| 文件 | 覆盖 |
|------|------|
| `tests/task-queue.test.js` | 入队/出队/优先级/重试/同源去重/崩溃恢复/并发限制/生命周期（9 个用例） |

## 依赖关系图

```
scheduler/index.js
  ├── jobs/daily.js ──── collectors/store.js (fetchSource, markSourceError)
  ├── jobs/fulltext.js
  ├── jobs/opml.js
  ├── jobs/maintenance.js
  ├── jobs/portal.js
  ├── jobs/recovery.js
  └── queue/taskQueue.js ──── 注册 fetch_source handler

collectors/store.js (兼容 re-export)
  ├── collectors/fetcher.js ──── collectors/repo.js
  ├── collectors/_shared.js ──── collectors/registry.js
  └── collectors/_base.js ──── collectors/registry.js (validateAdapter)

events.js ──── ai/_tokens.js (纯函数，不依赖 daily.js)
ai/daily.js ──── ai/_tokens.js
```

## 风险与回退

- **re-export 遗漏**: store.js 保持所有原导出，grep `require.*store` 确认无遗漏
- **队列时序变化**: `QUEUE_ENABLED=false` 可立即回退串行模式
- **适配器改造**: Phase 4 只做契约校验，不修改适配器内部逻辑
- **SQLite 写锁**: WAL 模式已启用，job_queue 与业务表共享无竞争问题
