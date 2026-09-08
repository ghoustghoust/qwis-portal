// 2026-09-05b 修复回归（本轮新发现 P0-P1 + 日报改版）
// 覆盖：A2 fulltext cron 句柄管理（防重复注册）/ A3 sources extra 白名单脱敏 /
//       A6 aihot backfill 陈旧 running 锁复位 / B1 日报 sections col_id + items hits
require('./helpers');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { cleanup } = require('./helpers');
const { db, getSetting, setSetting } = require('../server/db');

after(() => cleanup());

// ─── A2：fulltext cron 单注册 / 可彻底停止 ───
test('A2: scheduleFulltextRecovery 重复调用不累积 cron，stop 后无活动任务', () => {
  const cron = require('node-cron');
  const ft = require('../server/services/scheduler/jobs/fulltext');
  // node-cron v3 的 getTasks() 注册表含已停止任务；活动判定 = 调度器 timeout 句柄仍在
  const active = () =>
    [...cron.getTasks().entries()].filter(
      ([n, t]) => n === 'fulltext-recovery' && t && t._scheduler && t._scheduler.timeout
    ).length;
  const before = active();
  ft.scheduleFulltextRecovery();
  ft.scheduleFulltextRecovery();
  ft.scheduleFulltextRecovery();
  assert.equal(active(), before + 1, '重复 schedule 后仍应只有 1 个活动 fulltext cron');
  ft.stopFulltextRecovery();
  assert.equal(active(), before, 'stop 后应无活动任务');
});

// ─── A3：GET /api/sources 的 extra 白名单脱敏 ───
test('A3: withInterval 白名单重建 extra，未脱敏 lastError/未知敏感键不外泄', () => {
  const { _withInterval } = require('../server/routes/sources');
  const row = {
    id: 1,
    name: '测试源',
    extra: JSON.stringify({
      intervalMin: 120,
      lastError: '连接 https://secret-internal.example.com 失败 token=abc123',
      lastErrorAt: '2026-09-05T00:00:00.000Z',
      marksFeatured: true,
      aggregator: 1,
      domain: 'example.com',
      cookieRef: 'credentials:bilibili', // 敏感键：不应外泄
      internalNote: 'do-not-leak', // 未知键：不应外泄
    }),
  };
  const out = _withInterval(row);
  assert.equal(out.intervalMin, 120, 'intervalMin 提到顶层');
  const extra = JSON.parse(out.extra);
  assert.equal(extra.intervalMin, 120);
  assert.equal(extra.marksFeatured, true);
  assert.equal(extra.aggregator, 1);
  assert.ok(!('cookieRef' in extra), 'cookieRef 不得外泄');
  assert.ok(!('internalNote' in extra), '未知键不得外泄');
  assert.ok(!out.extra.includes('secret-internal.example.com'), 'extra 原串不得包含未脱敏 URL');
  assert.ok(!out.extra.includes('token=abc123'), 'extra 原串不得包含未脱敏凭据片段');
  assert.ok(out.lastError && !out.lastError.includes('token=abc123'), '顶层 lastError 必须脱敏');
});

// ─── A6：aihot backfill 陈旧 running 锁自动复位 ───
test('A6: backfill 的 running 锁超过 30min 视为陈旧自动复位，新鲜锁仍拒绝并发', async () => {
  const backfill = require('../server/services/aihot/backfill');
  // 聚合源（backfill 需要 extra.aggregator=1 的源）
  db.prepare(
    "INSERT INTO sources(type, name, url, extra, enabled, status, created_at) VALUES('rss','AIHOT','hotlist://aihot',?,1,'ok',?)"
  ).run(JSON.stringify({ aggregator: 1 }), new Date().toISOString());

  // 新鲜 running 锁 → 拒绝
  setSetting('aihot.backfill', { running: true, since: new Date().toISOString(), total: 9, done: 1, failed: 0 });
  const denied = await backfill.start({ urls: [], wait: true });
  assert.equal(denied.ok, false, '新鲜 running 锁应拒绝并发启动');

  // 陈旧 running 锁（31min 前）→ 自动复位并允许启动
  setSetting('aihot.backfill', {
    running: true,
    since: new Date(Date.now() - 31 * 60e3).toISOString(),
    total: 9,
    done: 1,
    failed: 0,
  });
  const started = await backfill.start({ urls: [], wait: true });
  assert.equal(started.ok, true, '陈旧 running 锁应自动复位并允许启动');
  assert.equal(getSetting('aihot.backfill', {}).running, false, '空列表跑完后 running=false');
});

// ─── B1：日报 sections 带 col_id、items 带 hits，默认四栏结构不变 ───
test('B1: generate 输出 col_id 与 hits，且栏目/排序/安检逻辑不变', async () => {
  const daily = require('../server/services/ai/daily');
  const now = new Date().toISOString();
  const r = db.prepare(
    "INSERT INTO sources(type, name, url, extra, enabled, status, created_at) VALUES('rss','测试公众号','https://example.com/feed','{}',1,'ok',?)"
  ).run(now);
  const sid = r.lastInsertRowid;
  db.prepare(
    'INSERT INTO articles(source_id, title, url, summary, content_html, published_at, created_at) VALUES(?,?,?,?,?,?,?)'
  ).run(sid, '新课程训练营招募：AI 自动化培训开始报名', 'https://example.com/a1', '简介', '<p>正文</p>', now, now);
  db.prepare(
    'INSERT INTO articles(source_id, title, url, summary, content_html, published_at, created_at) VALUES(?,?,?,?,?,?,?)'
  ).run(sid, '无关的日常随笔一篇', 'https://example.com/a2', '简介', '<p>正文</p>', now, now);

  const report = await daily.generate(48);
  assert.ok(Array.isArray(report.sections) && report.sections.length >= 4, '默认四栏目（含可能的破茧栏）');
  for (const sec of report.sections) {
    assert.ok(sec.col_id, `栏目「${sec.column}」必须有 col_id`);
  }
  const c1 = report.sections.find((s) => s.col_id === 'c1');
  assert.ok(c1, '关键词栏 c1 存在');
  const hit = c1.items.find((i) => i.title.includes('训练营'));
  assert.ok(hit, '命中关键词的文章应入 c1 栏');
  assert.ok(hit.hits >= 2, 'hits 透出关键词命中数（课程/训练营/招募/培训 中至少 2 个）');
  const fb = report.sections.find((s) => s.col_id === 'fallback');
  assert.ok(fb.items.some((i) => i.title.includes('无关')), '未命中文章进 fallback 栏');
});
