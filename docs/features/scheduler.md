# 调度引擎

> ⚠️ 适用范围：本文描述本地 Express（server/）实现。云端对应物：采集 tools/collect-turso.js、API api/[...slug].js；差异与云端覆盖见 docs/FEATURE_MATRIX.md。
> 补注：jobs/portal.js 的 portal 同步目标已随 portal 项目删除而失效；云端调度在 .github/workflows/collect.yml。

> `server/services/scheduler/` — 定时任务调度中心
> 最后更新：2026-09-05

## 设计目标

- **调度核心精简**：原 310 行 9 种定时任务拆为 ~140 行调度核心 + 6 个独立 Job 模块
- **due 驱动**：每 60s 扫描到期源，入队任务队列异步消费（或 fallback 串行）
- **防重入**：ticking 守卫 + 共享对象引用传递给 daily job
- **任务队列集成**：Phase 5 引入 SQLite TaskQueue 替代串行 await

## 模块结构

```
scheduler/
├── index.js        # 调度核心（tick/scanAndEnqueue + start/stop/reschedule）
└── jobs/
    ├── daily.js    # 日报定时 + fetchDueBeforeDaily
    ├── fulltext.js # 全文补抓（6h cron）
    ├── opml.js     # OPML 同步
    ├── maintenance.js # 数据清理 + 报警清理 + 健康自检
    ├── portal.js   # 门户数据同步
    └── recovery.js # 中断恢复
```

## 核心流程

### 启动流程（start()）

```
start()
  ├── TaskQueue.recoverCrashed()  // 崩溃恢复
  ├── 注册 OPML 定时器（每 12h）
  ├── 注册 scanAndEnqueue 定时器（每 60s）
  ├── taskQueue.startProcessing(2000)  // 队列消费
  ├── 注册 retryFailed 定时器（每 30s）
  ├── jobsDaily.scheduleDaily()  // 日报 cron
  ├── jobsFulltext.scheduleFulltextRecovery()  // 全文补抓
  ├── 日报补跑检测（needsGeneration → 立即生成）
  ├── 队列轮询注册（queue.enabled 控制）
  ├── 门户同步注册（每 2h）
  ├── 数据清理注册（每 24h）
  ├── 报警清理注册（每 10min）
  ├── jobsRecovery.resumeInterrupted()  // 中断恢复
  └── 健康自检注册（每 5min）
```

### tick / scanAndEnqueue

```
scanAndEnqueue()
  ├── ticking 守卫（防重入）
  ├── 查询到期源（enabled=1 AND next_fetch_at <= now）
  └── for each source:
      ├── QUEUE_ENABLED=true → taskQueue.enqueue('fetch_source', ...)
      └── QUEUE_ENABLED=false → await fetchOne(source)  // 串行 fallback
```

### ticking 防重入

```js
const tickingRef = { value: false };
jobsDaily.setTickingRef(tickingRef);  // 共享对象引用
// scheduler 和 daily job 共用同一把锁
```

## Job 模块职责

| 模块 | 职责 | 触发方式 |
|------|------|---------|
| daily.js | 日报定时生成 + fetchDueBeforeDaily | node-cron（默认 08:00） |
| fulltext.js | 全文补抓（<1000 字符薄内容） | 每 6h cron |
| opml.js | OPML 源清单同步 | 每 12h setInterval |
| maintenance.js | 数据清理 + 报警清理 + 健康自检 | 24h / 10min / 5min |
| portal.js | Vercel portal 快照同步 | 每 2h setInterval |
| recovery.js | 中断的 bilibili/douyin pending 恢复 | 启动时一次性 |

## 接口契约

```js
const scheduler = require('./scheduler');
scheduler.start();     // 启动所有定时任务
scheduler.stop();      // 停止所有定时器
scheduler.reschedule(); // 清旧重建（settings 变更后）
scheduler.tick();      // 手动触发一次扫描（兼容旧调用）
scheduler.fetchDueBeforeDaily();  // 日报前补抓
scheduler.healthCheck();          // 手动健康自检
scheduler.runOpmlSync();          // 手动 OPML 同步
```

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `QUEUE_ENABLED` | `true` | 设为 `false` 回退串行 tick 模式 |

## 注意事项

1. **ticking 守卫是共享对象引用**，scheduler 和 daily job 必须共用同一 tickingRef
2. **抖音串行限速**在 adapter.fetch 内部实现，不在调度层
3. **健康自检启动 30min 后才生效**，避免启动期间误报
4. **日报补跑**：服务启动晚于定时时间时自动补生成
