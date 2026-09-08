// 任务队列测试（重构 Phase 5）
// 覆盖：入队/出队/重试/同源去重/崩溃恢复/优先级/处理器注册
require('./helpers');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { cleanup } = require('./helpers');
const { db } = require('../server/db');
const { TaskQueue, taskQueue } = require('../server/services/queue/taskQueue');

after(() => cleanup());

// 清理 job_queue 表
function clearQueue() {
  db.exec('DELETE FROM job_queue');
}

test('TQ-1: 入队 + 基本消费', async () => {
  clearQueue();
  const results = [];
  TaskQueue.registerHandler('test_basic', async (payload) => {
    results.push(payload);
  });

  const q = new TaskQueue({ concurrency: 2 });
  q.enqueue('test_basic', { id: 1 });
  q.enqueue('test_basic', { id: 2 });

  await q.process();
  await q.process();

  assert.equal(results.length, 2);
  assert.deepEqual(results.map(r => r.id).sort(), [1, 2]);

  const stats = q.getStats();
  assert.equal(stats.completed, 2);
  assert.equal(stats.pending, 0);
});

test('TQ-2: 优先级排序（高优先级先执行）', async () => {
  clearQueue();
  const order = [];
  TaskQueue.registerHandler('test_priority', async (payload) => {
    order.push(payload.id);
  });

  const q = new TaskQueue({ concurrency: 1 });
  q.enqueue('test_priority', { id: 'low' }, { priority: 10 });
  q.enqueue('test_priority', { id: 'high' }, { priority: 100 });
  q.enqueue('test_priority', { id: 'mid' }, { priority: 50 });

  await q.process();
  await q.process();
  await q.process();

  assert.equal(order[0], 'high');
  assert.equal(order[1], 'mid');
  assert.equal(order[2], 'low');
});

test('TQ-3: 失败重试（retryFailed 重置 failed → pending）', async () => {
  clearQueue();
  let attempts = 0;
  TaskQueue.registerHandler('test_retry', async () => {
    attempts++;
    throw new Error('模拟失败');
  });

  const q = new TaskQueue({ concurrency: 1, retryDelayMs: 0 }); // 0 = 立即重试（2026-09-05 起默认 30s 退避）
  q.enqueue('test_retry', {});

  await q.process();
  let stats = q.getStats();
  assert.equal(stats.failed, 1);
  assert.equal(attempts, 1);

  // retryFailed 将 failed 重置为 pending
  const resetCount = await q.retryFailed();
  assert.equal(resetCount, 1);

  stats = q.getStats();
  assert.equal(stats.pending, 1);
  assert.equal(stats.failed, 0);
});

test('TQ-4: 同源去重（同 source_id 同时只允许 1 个 running）', async () => {
  clearQueue();
  const results = [];
  let resolveBlock;
  const blockPromise = new Promise(r => { resolveBlock = r; });

  TaskQueue.registerHandler('test_dedup', async (payload) => {
    results.push(payload.sourceId);
    // 第一个任务阻塞，保持 running 状态
    if (results.length === 1) await blockPromise;
  });

  const q = new TaskQueue({ concurrency: 5, perSourceLimit: 1 });
  q.enqueue('test_dedup', { sourceId: 42 }, { sourceId: 42 });
  q.enqueue('test_dedup', { sourceId: 42 }, { sourceId: 42 });
  q.enqueue('test_dedup', { sourceId: 99 }, { sourceId: 99 });

  // 启动第一个（source_id=42），会阻塞在 handler 内
  const p1 = q.process();
  await new Promise(r => setTimeout(r, 20)); // 确保 p1 已进入 handler

  // 第二个（source_id=42）应被同源去重跳过
  await q.process();
  // 第三个（source_id=99）不同源，应执行
  await q.process();

  resolveBlock(); // 释放第一个
  await p1;

  // 只有 42（第一个）和 99 被执行，第二个 42 被跳过
  assert.equal(results.length, 2);
  assert.ok(results.includes(42));
  assert.ok(results.includes(99));
});

test('TQ-5: 崩溃恢复（running → pending）', async () => {
  clearQueue();
  // 手动插入一条 running 状态的 job
  db.prepare(`
    INSERT INTO job_queue(type, payload, status, priority, attempts, created_at, started_at)
    VALUES('fetch_source', '{}', 'running', 0, 1, datetime('now'), datetime('now'))
  `).run();

  const count = TaskQueue.recoverCrashed();
  assert.equal(count, 1);

  const stats = db.prepare('SELECT status FROM job_queue').get();
  assert.equal(stats.status, 'pending');
});

test('TQ-6: 未知处理器类型标记失败', async () => {
  clearQueue();
  const q = new TaskQueue({ concurrency: 1 });
  const jobId = q.enqueue('unknown_type_xyz', {});

  await q.process();

  const stats = q.getStats();
  assert.equal(stats.failed, 1);
  const job = db.prepare('SELECT error FROM job_queue WHERE id = ?').get(jobId);
  assert.ok(job, 'job 应存在');
  assert.match(job.error, /无处理器/);
});

test('TQ-7: getStats 统计正确', async () => {
  clearQueue();
  TaskQueue.registerHandler('test_stats', async (payload) => {
    if (payload.fail) throw new Error('fail');
  });

  const q = new TaskQueue({ concurrency: 5 });
  q.enqueue('test_stats', { fail: false });
  q.enqueue('test_stats', { fail: true });
  q.enqueue('test_stats', { fail: false });

  await q.process();
  await q.process();
  await q.process();

  const stats = q.getStats();
  assert.equal(stats.completed, 2);
  assert.equal(stats.failed, 1);
  assert.equal(stats.total, 3);
});

test('TQ-8: startProcessing / stopProcessing 生命周期', async () => {
  clearQueue();
  const results = [];
  TaskQueue.registerHandler('test_lifecycle', async (payload) => {
    results.push(payload.id);
  });

  const q = new TaskQueue({ concurrency: 2 });
  q.enqueue('test_lifecycle', { id: 'a' });

  q.startProcessing(50); // 50ms 轮询
  // 等待消费完成
  await new Promise(r => setTimeout(r, 200));
  q.stopProcessing();

  assert.equal(results.length, 1);
  assert.equal(results[0], 'a');

  // stopProcessing 后再 enqueue 不会被消费
  q.enqueue('test_lifecycle', { id: 'b' });
  await new Promise(r => setTimeout(r, 100));
  assert.equal(results.length, 1); // 没有新增
});

test('TQ-9: 并发限制（不超过 concurrency）', async () => {
  clearQueue();
  let maxConcurrent = 0;
  let currentConcurrent = 0;

  TaskQueue.registerHandler('test_concurrency', async () => {
    currentConcurrent++;
    maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
    await new Promise(r => setTimeout(r, 50));
    currentConcurrent--;
  });

  const q = new TaskQueue({ concurrency: 3 });
  for (let i = 0; i < 10; i++) q.enqueue('test_concurrency', {});

  // 触发多轮 process
  const promises = [];
  for (let i = 0; i < 10; i++) promises.push(q.process());
  await Promise.all(promises);

  assert.ok(maxConcurrent <= 3, `并发 ${maxConcurrent} 超过限制 3`);
  assert.ok(maxConcurrent > 0, '至少执行了一个任务');
});

// ─── 2026-09-05 P1-3 队列成熟化回归 ───

test('TQ-10: 入队去重（同 type+source_id 的 pending/running 不重复入队）', async () => {
  clearQueue();
  const q = new TaskQueue({ concurrency: 1 });
  const id1 = q.enqueue('fetch_source', { sourceId: 7 }, { sourceId: 7 });
  const id2 = q.enqueue('fetch_source', { sourceId: 7 }, { sourceId: 7 });
  const id3 = q.enqueue('fetch_source', { sourceId: 8 }, { sourceId: 8 }); // 不同源正常入队
  assert.equal(id2, id1, '重复入队应返回既有任务 id');
  assert.notEqual(id3, id1);
  const stats = q.getStats();
  assert.equal(stats.pending, 2, '同源重复任务不应堆积');
});

test('TQ-11: 重试退避（retryDelayMs 未到不重置）', async () => {
  clearQueue();
  TaskQueue.registerHandler('test_backoff', async () => { throw new Error('模拟失败'); });
  const q = new TaskQueue({ concurrency: 1, retryDelayMs: 60000 }); // 60s 退避
  q.enqueue('test_backoff', {});
  await q.process();
  assert.equal(q.getStats().failed, 1);
  const resetCount = await q.retryFailed(); // 刚失败，退避期内不应重置
  assert.equal(resetCount, 0);
  assert.equal(q.getStats().failed, 1);
});

test('TQ-12: purgeDone 清理历史任务（completed>24h / failed>7d，running/pending 不动）', () => {
  clearQueue();
  const now = new Date();
  const iso = (d) => d.toISOString();
  db.prepare(`INSERT INTO job_queue(type, payload, status, priority, attempts, created_at, completed_at) VALUES('t','{}','completed',0,1,?,?)`)
    .run(iso(new Date(now - 48 * 3600e3)), iso(new Date(now - 25 * 3600e3))); // 25h 前完成 → 删
  db.prepare(`INSERT INTO job_queue(type, payload, status, priority, attempts, created_at, completed_at) VALUES('t','{}','completed',0,1,?,?)`)
    .run(iso(now), iso(now)); // 刚完成 → 留
  db.prepare(`INSERT INTO job_queue(type, payload, status, priority, attempts, created_at, completed_at) VALUES('t','{}','failed',0,3,?,?)`)
    .run(iso(new Date(now - 8 * 86400e3)), iso(new Date(now - 8 * 86400e3))); // 8 天前失败 → 删
  db.prepare(`INSERT INTO job_queue(type, payload, status, priority, attempts, created_at, completed_at) VALUES('t','{}','failed',0,3,?,?)`)
    .run(iso(now), iso(now)); // 刚失败 → 留
  db.prepare(`INSERT INTO job_queue(type, payload, status, priority, attempts, created_at) VALUES('t','{}','pending',0,0,?)`)
    .run(iso(now)); // pending → 不动

  const q = new TaskQueue();
  const deleted = q.purgeDone();
  assert.equal(deleted, 2);
  const left = q.getStats();
  assert.equal(left.completed, 1);
  assert.equal(left.failed, 1);
  assert.equal(left.pending, 1);
});
