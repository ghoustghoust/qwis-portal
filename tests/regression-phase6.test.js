// Phase 6 对抗性审查测试（重构后故障场景验证）
// 覆盖：进程中断恢复、同源并发去重、失败重试上限、未知任务类型容错、文档完整性
require('./helpers');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { cleanup } = require('./helpers');
const { db } = require('../server/db');
const { TaskQueue, taskQueue } = require('../server/services/queue/taskQueue');
const fs = require('fs');
const path = require('path');

after(() => cleanup());

function clearQueue() {
  db.exec('DELETE FROM job_queue');
}

// ─── 对抗性场景 1：进程中断恢复 ─────────────────────────────────────────────
test('P6-1: 进程中断后 running 任务恢复为 pending', () => {
  clearQueue();
  // 模拟：进程崩溃时有 3 个 running 任务
  for (let i = 0; i < 3; i++) {
    db.prepare(`
      INSERT INTO job_queue(type, payload, status, priority, attempts, created_at, started_at)
      VALUES('fetch_source', '{}', 'running', 0, 1, datetime('now'), datetime('now'))
    `).run();
  }
  const before = db.prepare("SELECT COUNT(*) as cnt FROM job_queue WHERE status='running'").get();
  assert.equal(before.cnt, 3);

  const recovered = TaskQueue.recoverCrashed();
  assert.equal(recovered, 3);

  const afterRecover = db.prepare("SELECT status FROM job_queue").all();
  for (const row of afterRecover) {
    assert.equal(row.status, 'pending');
  }
});

// ─── 对抗性场景 2：同源并发去重 ─────────────────────────────────────────────
test('P6-2: 同源任务并发去重——同 source_id 只执行一个', async () => {
  clearQueue();
  const executed = [];
  let resolveBlock;
  const block = new Promise(r => { resolveBlock = r; });

  TaskQueue.registerHandler('p6_dedup_test', async (payload) => {
    executed.push(payload.sourceId);
    if (executed.length === 1) await block;
  });

  const q = new TaskQueue({ concurrency: 5, perSourceLimit: 1 });
  q.enqueue('p6_dedup_test', { sourceId: 100 }, { sourceId: 100 });
  q.enqueue('p6_dedup_test', { sourceId: 100 }, { sourceId: 100 });
  q.enqueue('p6_dedup_test', { sourceId: 200 }, { sourceId: 200 });

  const p1 = q.process();
  await new Promise(r => setTimeout(r, 20));
  await q.process(); // 同源去重，跳过
  await q.process(); // 不同源，执行

  resolveBlock();
  await p1;

  assert.equal(executed.length, 2);
  assert.ok(executed.includes(100));
  assert.ok(executed.includes(200));
});

// ─── 对抗性场景 3：失败重试上限 ─────────────────────────────────────────────
test('P6-3: 超过重试上限的任务不再被 retryFailed 重置', async () => {
  clearQueue();
  TaskQueue.registerHandler('p6_retry_limit', async () => {
    throw new Error('always fails');
  });

  const q = new TaskQueue({ concurrency: 1 });
  q.enqueue('p6_retry_limit', {});

  // 手动将 attempts 设为等于 retries（模拟已重试完）
  db.prepare("UPDATE job_queue SET attempts = retries WHERE status = 'pending'").run();

  // process 会取 pending 任务执行，但 attempts 已经等于 retries
  // 先让它执行一次（会失败，attempts+1 > retries）
  await q.process();

  const stats = q.getStats();
  assert.equal(stats.failed, 1);

  // retryFailed 不应重置这个任务（attempts >= retries）
  const resetCount = await q.retryFailed();
  assert.equal(resetCount, 0);

  const afterRetry = db.prepare("SELECT status FROM job_queue WHERE type='p6_retry_limit'").get();
  assert.equal(afterRetry.status, 'failed');
});

// ─── 对抗性场景 4：未知任务类型容错 ─────────────────────────────────────────
test('P6-4: 未知任务类型标记 failed 而非崩溃', async () => {
  clearQueue();
  const q = new TaskQueue({ concurrency: 1 });
  const jobId = q.enqueue('completely_unknown_type', { test: true });

  await q.process();

  const job = db.prepare('SELECT status, error FROM job_queue WHERE id = ?').get(jobId);
  assert.equal(job.status, 'failed');
  assert.match(job.error, /无处理器/);

  // 队列仍在正常工作（没有崩溃）
  const stats = q.getStats();
  assert.equal(stats.total, 1);
});

// ─── 对抗性场景 5：文档完整性验证 ───────────────────────────────────────────
test('P6-5: 重构后文档体系完整', () => {
  const ROOT = path.join(__dirname, '..');

  // 核心文档存在（2026-09-11 文档重整后对齐：PROJECT_STATUS 等已归档 deprecated/，决策文档在 deprecated/）
  const requiredDocs = [
    'ARCHITECTURE.md',
    'AGENTS.md',
    'docs/INDEX.md',
    'docs/FEATURE_MATRIX.md',
    'docs/RUNBOOK.md',
    'docs/REFACTOR_GUIDE.md',
    'docs/CLOUD_PIPELINE_GUIDE.md',
    'docs/features/collectors.md',
    'docs/features/scheduler.md',
    'docs/features/task-queue.md',
    'docs/features/daily-report.md',
    'docs/features/events-alerts.md',
    'docs/deprecated/PROJECT_STATUS.md',
    'docs/deprecated/01-部署架构决策.md',
    'docs/deprecated/02-不做云端采集决策.md',
    'docs/specs/03-公众号走托管RSS决策.md',
    'docs/deprecated/04-不做Vercel前端决策.md',
    'docs/specs/05-任务队列选型决策.md',
  ];

  for (const doc of requiredDocs) {
    const fullPath = path.join(ROOT, doc);
    assert.ok(fs.existsSync(fullPath), `文档缺失: ${doc}`);
    const content = fs.readFileSync(fullPath, 'utf-8');
    assert.ok(content.length > 50, `文档内容过短: ${doc} (${content.length} bytes)`);
  }
});

// ─── 对抗性场景 6：根目录整洁度 ─────────────────────────────────────────────
test('P6-6: 根目录无散落文档（PROJECT_STATUS/A_CLASS_FIX_REPORT 已迁移）', () => {
  const ROOT = path.join(__dirname, '..');
  assert.ok(!fs.existsSync(path.join(ROOT, 'PROJECT_STATUS.md')), 'PROJECT_STATUS.md 应已移至 docs/');
  assert.ok(!fs.existsSync(path.join(ROOT, 'A_CLASS_FIX_REPORT.md')), 'A_CLASS_FIX_REPORT.md 应已归档');
});

// ─── 对抗性场景 7：重构模块代码完整性 ───────────────────────────────────────
test('P6-7: 重构后核心模块文件存在且非空', () => {
  const ROOT = path.join(__dirname, '..');
  const modules = [
    'server/services/collectors/_shared.js',
    'server/services/collectors/_base.js',
    'server/services/collectors/repo.js',
    'server/services/collectors/fetcher.js',
    'server/services/collectors/store.js',
    'server/services/collectors/registry.js',
    'server/services/ai/_tokens.js',
    'server/services/scheduler/index.js',
    'server/services/scheduler/jobs/daily.js',
    'server/services/scheduler/jobs/fulltext.js',
    'server/services/scheduler/jobs/opml.js',
    'server/services/scheduler/jobs/maintenance.js',
    'server/services/scheduler/jobs/portal.js',
    'server/services/scheduler/jobs/recovery.js',
    'server/services/queue/taskQueue.js',
  ];

  for (const mod of modules) {
    const fullPath = path.join(ROOT, mod);
    assert.ok(fs.existsSync(fullPath), `模块缺失: ${mod}`);
    const content = fs.readFileSync(fullPath, 'utf-8');
    assert.ok(content.length > 100, `模块内容过短: ${mod}`);
  }
});

// ─── 对抗性场景 8：events.js 不依赖 daily.js ───────────────────────────────
test('P6-8: events.js 已解耦——不直接 require daily.js', () => {
  const ROOT = path.join(__dirname, '..');
  const eventsContent = fs.readFileSync(path.join(ROOT, 'server/services/events.js'), 'utf-8');
  assert.ok(!eventsContent.includes("require('./ai/daily')"), 'events.js 不应直接 require daily.js');
  assert.ok(eventsContent.includes("require('./ai/_tokens')"), 'events.js 应引用 _tokens.js');
});

// ─── 对抗性场景 9：活跃文件引用路径正确 ─────────────────────────────────────
test('P6-9: 活跃文件无指向已移动文件的裸引用', () => {
  const ROOT = path.join(__dirname, '..');
  const SKIP_DIRS = new Set(['node_modules', 'archive', '.git', 'data', 'dist', '.qoder', '.opencode', '.autoclaw', '.cluster', '.github']);
  const SKIP_FILES = new Set(['regression-phase6.test.js', 'PHASE6_REVIEW_REPORT.md']);

  function walk(dir) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...walk(full));
      else if (/\.(md|js)$/.test(entry.name) && !SKIP_FILES.has(entry.name)) results.push(full);
    }
    return results;
  }

  const files = walk(ROOT);
  const errors = [];

  for (const f of files) {
    const content = fs.readFileSync(f, 'utf-8');
    const rel = path.relative(ROOT, f);

    // A_CLASS_FIX_REPORT.md 应指向 archive/docs-deprecated/
    const bareAClass = content.match(/(?<!archive\/docs-deprecated\/)A_CLASS_FIX_REPORT\.md/g);
    if (bareAClass) errors.push(`${rel}: 裸引用 A_CLASS_FIX_REPORT.md (${bareAClass.length} 处)`);

    // docs/DEPLOYMENT.md 已归档，应引用 docs/RUNBOOK.md
    if (content.includes('docs/DEPLOYMENT.md')) {
      errors.push(`${rel}: 引用已归档的 docs/DEPLOYMENT.md`);
    }
  }

  assert.ok(errors.length === 0, `发现 ${errors.length} 处断裂引用:\n${errors.join('\n')}`);
});
