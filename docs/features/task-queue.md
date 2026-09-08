# SQLite 任务队列

> `server/services/queue/taskQueue.js` — 持久化任务队列
> 最后更新：2026-09-05

## 设计目标

- **不引入 Redis**：项目哲学自包含，PM2 单 fork，SQLite 足够
- **优先级排序**：focus 源高优先级（100），普通源（50）
- **同源去重**：同一 source_id 同时只允许 1 个 running
- **崩溃恢复**：进程重启后自动将 running 任务重置为 pending
- **可回退**：`QUEUE_ENABLED=false` 环境变量回退串行模式

## 数据模型

```sql
CREATE TABLE IF NOT EXISTS job_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,           -- 'fetch_source' | 'enrich' | ...
  payload TEXT NOT NULL,        -- JSON: {sourceId, ...}
  status TEXT DEFAULT 'pending', -- pending | running | completed | failed
  priority INTEGER DEFAULT 0,   -- 越高越先执行
  retries INTEGER DEFAULT 3,    -- 最大重试次数
  attempts INTEGER DEFAULT 0,   -- 已尝试次数
  source_id INTEGER,            -- 同源去重键
  error TEXT,                   -- 失败原因
  created_at TEXT,
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX idx_jq_status_priority ON job_queue(status, priority DESC);
CREATE INDEX idx_jq_source_status ON job_queue(source_id, status);
```

## TaskQueue API

### 构造函数

```js
const { TaskQueue, taskQueue } = require('./queue/taskQueue');

// 单例 taskQueue（默认配置）
// 或自定义：
const q = new TaskQueue({
  concurrency: 5,        // 全局最大并行
  perSourceLimit: 1,     // 同源最多 1 个 running
  retryDelayMs: 30000,   // 重试退避基数
});
```

### 核心方法

| 方法 | 说明 |
|------|------|
| `TaskQueue.registerHandler(type, handler)` | 注册任务处理器（静态方法） |
| `q.enqueue(type, payload, opts)` | 入队，返回 jobId |
| `q.process()` | 消费一个 pending 任务 |
| `q.startProcessing(intervalMs)` | 启动持续消费（轮询模式） |
| `q.stopProcessing()` | 停止消费 |
| `q.retryFailed()` | 重置 failed 且可重试的任务为 pending |
| `TaskQueue.recoverCrashed()` | 崩溃恢复：running → pending |
| `q.getStats()` | 队列状态统计 |

### 处理器注册

```js
TaskQueue.registerHandler('fetch_source', async (payload, jobRow) => {
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(payload.sourceId);
  if (!source || !source.enabled) return;
  await fetchSource(source);
});
```

## 核心流程

### 入队 → 消费

```
scanAndEnqueue()
  └── for each due source:
      └── taskQueue.enqueue('fetch_source', {sourceId}, {priority, sourceId})

taskQueue.startProcessing(2000)
  └── 每 2s:
      └── for i in concurrency:
          └── process()
              ├── fetchPending（ORDER BY priority DESC, id ASC）
              ├── 同源去重检查（countRunningForSource）
              ├── markRunning（attempts += 1）
              ├── handler(payload, job)
              ├── 成功 → markCompleted
              └── 失败 → markFailed（error 记录）
```

### 崩溃恢复

```
start()
  └── TaskQueue.recoverCrashed()
      └── UPDATE job_queue SET status='pending' WHERE status='running'
```

### 重试策略

```
retryFailed()
  └── SELECT * FROM job_queue WHERE status='failed' AND attempts < retries
      └── UPDATE SET status='pending'  // 重新入队
```

## 调度器集成

```js
// scheduler/index.js start()
function start() {
  TaskQueue.recoverCrashed();  // 崩溃恢复
  // ...
  if (QUEUE_ENABLED) taskQueue.startProcessing(2000);
  if (QUEUE_ENABLED) timers.push(setInterval(() => taskQueue.retryFailed(), 30000));
}

function stop() {
  taskQueue.stopProcessing();
  // ...
}
```

## 注意事项

1. **SQLite WAL 模式**已启用，job_queue 与业务表共享无写锁竞争
2. **进程内内存锁**（`_running` 计数器）+ **SQLite 持久化**双重保障
3. **未知类型任务**标记 failed 而非崩溃（log.warn 记录）
4. **重试上限**：attempts >= retries 后不再被 retryFailed() 重置
5. **回退模式**：`QUEUE_ENABLED=false` 时 tick() 走串行 await，不经过队列
