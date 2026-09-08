// SQLite-backed 任务队列（重构 Phase 5）
// 职责：替代 setInterval + 串行 await 的 tick 机制，支持优先级/重试/同源去重/崩溃恢复
// 设计决策：不引入 Redis（项目哲学自包含，PM2 单 fork），用 SQLite job_queue 表实现

const { db } = require('../../db');
const { nowIso } = require('../../util/time');
const log = require('../../util/log');

// 任务处理器注册表：type → async function(payload, jobRow)
const handlers = new Map();

// prepared statements
const insertJob = db.prepare(`
  INSERT INTO job_queue(type, payload, priority, source_id, created_at)
  VALUES(@type, @payload, @priority, @source_id, @created_at)
`);

const fetchPending = db.prepare(`
  SELECT * FROM job_queue
  WHERE status = 'pending'
  ORDER BY priority DESC, id ASC
`);

const markRunning = db.prepare(`
  UPDATE job_queue SET status = 'running', started_at = ?, attempts = attempts + 1
  WHERE id = ?
`);

const markCompleted = db.prepare(`
  UPDATE job_queue SET status = 'completed', completed_at = ? WHERE id = ?
`);

const markFailed = db.prepare(`
  UPDATE job_queue SET status = 'failed', error = ?, completed_at = ? WHERE id = ?
`);

const resetRunning = db.prepare(`
  UPDATE job_queue SET status = 'pending', started_at = NULL WHERE status = 'running'
`);

const countRunningForSource = db.prepare(`
  SELECT COUNT(*) as cnt FROM job_queue WHERE source_id = ? AND status = 'running'
`);

const countByStatus = db.prepare(`
  SELECT status, COUNT(*) as count FROM job_queue GROUP BY status
`);

const fetchRetryable = db.prepare(`
  SELECT * FROM job_queue
  WHERE status = 'failed' AND attempts < retries
    AND (completed_at IS NULL OR completed_at <= ?)
  ORDER BY priority DESC, id ASC
  LIMIT 10
`);

const resetFailedToPending = db.prepare(`
  UPDATE job_queue SET status = 'pending', error = NULL, completed_at = NULL WHERE id = ?
`);

// 1.3 增强：超过重试上限的 job 标记为 dead（不再自动重试，需手动介入）
const markDead = db.prepare(`
  UPDATE job_queue SET status = 'dead', error = ? WHERE id = ?
`);

// 1.2 新增：按 type 分组统计
const countByTypeAndStatus = db.prepare(`
  SELECT type, status, COUNT(*) as count FROM job_queue GROUP BY type, status
`);

// 1.2 新增：最近 N 条 failed 任务
const fetchRecentFailed = db.prepare(`
  SELECT id, type, payload, error, attempts, retries, source_id, created_at, completed_at
  FROM job_queue WHERE status = 'failed'
  ORDER BY completed_at DESC LIMIT ?
`);

// 1.3 新增：查询 dead 任务
const fetchDeadJobs = db.prepare(`
  SELECT id, type, payload, error, attempts, retries, source_id, created_at, completed_at
  FROM job_queue WHERE status = 'dead'
  ORDER BY completed_at DESC LIMIT ?
`);

// 1.2 新增：手动重试单个 failed/dead 任务
const fetchJobById = db.prepare(`SELECT * FROM job_queue WHERE id = ?`);

// 入队去重：同 type + source_id 已有 pending/running 任务时不再重复入队（2026-09-05 P1-3）
const findActiveForSource = db.prepare(`
  SELECT id FROM job_queue
  WHERE type = ? AND source_id = ? AND status IN ('pending','running')
  LIMIT 1
`);

class TaskQueue {
  constructor(opts = {}) {
    this.concurrency = opts.concurrency || 5;
    this.perSourceLimit = opts.perSourceLimit || 1;
    this.retryDelayMs = opts.retryDelayMs != null ? opts.retryDelayMs : 30000; // 注意不能用 ||（0 是合法值：立即重试）
    this._running = 0;
    this._processing = false;
    this._processTimer = null;
  }

  // 注册任务处理器
  static registerHandler(type, handler) {
    if (typeof handler !== 'function') throw new Error(`处理器必须是函数: ${type}`);
    handlers.set(type, handler);
  }

  // 入队（同 type + source_id 已有 pending/running 任务时去重，返回既有任务 id）
  enqueue(type, payload, opts = {}) {
    const priority = opts.priority || 0;
    const sourceId = opts.sourceId != null ? opts.sourceId : null;
    if (sourceId != null) {
      const dup = findActiveForSource.get(type, sourceId);
      if (dup) return dup.id; // 已有同源的待执行/执行中任务，跳过重复入队
    }
    const result = insertJob.run({
      type,
      payload: JSON.stringify(payload || {}),
      priority,
      source_id: sourceId,
      created_at: nowIso(),
    });
    return result.lastInsertRowid;
  }

  // 主循环：取 pending → running → 执行 → completed/failed
  async process() {
    if (this._running >= this.concurrency) return;

    // 查找可执行的 pending job（跳过同源去重的）
    const candidates = fetchPending.all();
    let job = null;
    for (const c of candidates) {
      if (this._running >= this.concurrency) return;
      if (c.source_id != null) {
        const { cnt } = countRunningForSource.get(c.source_id);
        if (cnt >= this.perSourceLimit) continue; // 同源去重，跳过
      }
      job = c;
      break;
    }
    if (!job) return;

    const handler = handlers.get(job.type);
    if (!handler) {
      markFailed.run(`无处理器: ${job.type}`, nowIso(), job.id);
      log.warn(`任务队列: 未知类型 ${job.type}，标记失败`);
      return;
    }

    markRunning.run(nowIso(), job.id);
    this._running++;

    try {
      const payload = JSON.parse(job.payload || '{}');
      await handler(payload, job);
      markCompleted.run(nowIso(), job.id);
    } catch (err) {
      markFailed.run(String(err.message || err), nowIso(), job.id);
      log.error(`任务队列[${job.type}]执行失败:`, err.message);
    } finally {
      this._running--;
    }
  }

  // 启动持续消费（轮询模式）
  startProcessing(intervalMs = 1000) {
    if (this._processTimer) return;
    this._processing = true;
    this._processTimer = setInterval(() => {
      if (!this._processing) return;
      // 并发消费：尝试填满 concurrency 槽位
      for (let i = 0; i < this.concurrency; i++) {
        this.process().catch(() => {});
      }
    }, intervalMs);
    log.info(`任务队列消费已启动: 并发=${this.concurrency}，间隔=${intervalMs}ms`);
  }

  // 停止消费
  stopProcessing() {
    this._processing = false;
    if (this._processTimer) {
      clearInterval(this._processTimer);
      this._processTimer = null;
    }
  }

  // 1.3 增强：指数退避 + dead 状态
  // 退避公式：retryDelayMs * 2^(attempts-1)，上限 10min
  // attempts >= retries 的 job 标记为 dead（不再自动重试，需手动 POST /api/queue/:id/retry）
  async retryFailed() {
    const now = Date.now();
    let resetCount = 0;
    let deadCount = 0;
    const jobs = fetchRetryable.all(now); // 取最近 10 条 failed 候选
    for (const job of jobs) {
      // 超过重试上限 → dead
      if (job.attempts >= job.retries) {
        markDead.run(`已达重试上限(${job.retries}次): ${job.error || '未知错误'}`, job.id);
        deadCount++;
        continue;
      }
      // 指数退避：距上次失败不足退避间隔则跳过
      const backoffMs = Math.min(this.retryDelayMs * Math.pow(2, Math.max(0, job.attempts - 1)), 600000);
      const completedAt = job.completed_at ? Date.parse(job.completed_at) : 0;
      if (completedAt && now - completedAt < backoffMs) continue;
      resetFailedToPending.run(job.id);
      resetCount++;
    }
    if (resetCount > 0) log.info(`任务队列: 重置 ${resetCount} 个失败任务为 pending`);
    if (deadCount > 0) log.warn(`任务队列: ${deadCount} 个任务超过重试上限，标记为 dead`);
    return { reset: resetCount, dead: deadCount };
  }

  // 队列清理（P1-3）：删除超过保留期的 completed/failed 任务，防 job_queue 无限膨胀
  // completed 默认保留 24h，failed 默认保留 7d（留排查窗口）
  purgeDone({ completedHours = 24, failedDays = 7 } = {}) {
    const completedCutoff = new Date(Date.now() - completedHours * 3600e3).toISOString();
    const failedCutoff = new Date(Date.now() - failedDays * 86400e3).toISOString();
    const a = db.prepare(`DELETE FROM job_queue WHERE status='completed' AND completed_at IS NOT NULL AND completed_at < ?`).run(completedCutoff);
    const b = db.prepare(`DELETE FROM job_queue WHERE status='failed' AND completed_at IS NOT NULL AND completed_at < ?`).run(failedCutoff);
    const total = (a.changes || 0) + (b.changes || 0);
    if (total > 0) log.info(`任务队列: 清理历史任务 ${total} 条（completed>${completedHours}h / failed>${failedDays}d）`);
    return total;
  }

  // 崩溃恢复：启动时扫描 running → 重置为 pending
  static recoverCrashed() {
    const info = resetRunning.run();
    const count = info.changes || 0;
    if (count > 0) log.info(`任务队列: 崩溃恢复 ${count} 个中断任务`);
    return count;
  }

  // 队列状态统计
  getStats() {
    const rows = countByStatus.all();
    const stats = { pending: 0, running: 0, completed: 0, failed: 0, dead: 0 };
    for (const r of rows) stats[r.status] = r.count;
    stats.total = Object.values(stats).reduce((a, b) => a + b, 0);
    return stats;
  }

  // 1.2 新增：按 type 分组的 pending/running/failed 计数
  getStatsByType() {
    const rows = countByTypeAndStatus.all();
    const map = {};
    for (const r of rows) {
      if (!map[r.type]) map[r.type] = { pending: 0, running: 0, failed: 0, dead: 0, completed: 0 };
      map[r.type][r.status] = r.count;
    }
    return map;
  }

  // 1.2 新增：最近 N 条 failed 任务摘要
  getRecentFailed(limit = 10) {
    return fetchRecentFailed.all(limit);
  }

  // 1.3 新增：查询 dead 任务
  getDeadJobs(limit = 20) {
    return fetchDeadJobs.all(limit);
  }

  // 1.2 新增：手动重试单个 failed/dead 任务（重置为 pending）
  retryOne(id) {
    const job = fetchJobById.get(id);
    if (!job) return { error: '任务不存在' };
    if (job.status !== 'failed' && job.status !== 'dead') return { error: `任务状态为 ${job.status}，不可重试` };
    resetFailedToPending.run(job.id);
    log.info(`任务队列: 手动重试 job#${id} (${job.type})`);
    return { ok: true, id: job.id, type: job.type };
  }
}

// 单例
const taskQueue = new TaskQueue();

module.exports = { TaskQueue, taskQueue };
