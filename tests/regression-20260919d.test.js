// 2026-09-19 T6 第 1 步小刺打包回归锁 —— 本文件先记 B39
// 原则（EVAL_GUIDE §6/§7）：每条断言都必须"改前会红"，且不锁代码形状而锁行为/数据。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
require('./helpers');
const { cleanup } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test.after(() => cleanup());

// ── B39 生成历史：标题写「近 7 天」，实为 ORDER BY id DESC LIMIT 7 ──
// 2026-09-19 只读实测（tools/_diag-brief-history.cjs，线上 94 行日报）：
//   近 7 天真实 59 行，接口最多露 7 行 → 52 行看不见，且列表最旧只到 09-16（标题承诺 7 天，实际 3 天）
//   近 7 天里 42 行没有 schemaVersion（裸关键词版）、16 行 sv=2（AI 增强）、1 行降级
//   → UI 无法区分，用户批注⑦「生成历史看不出哪期能用」
test('B39-1 窗口必须是"真 7 天"，不是"前 7 条"', async () => {
  const { DAILY_HISTORY_SQL, historySinceIso, HISTORY_WINDOW_DAYS } = require('../lib/brief-guards');
  assert.ok(DAILY_HISTORY_SQL, 'lib/brief-guards 必须导出历史查询（SQL 放共享模块才能被真库跑）');
  assert.match(DAILY_HISTORY_SQL, /generated_at\s*>=\s*\?/, '必须按时间窗过滤');
  assert.ok(!/LIMIT\s+7\b/.test(DAILY_HISTORY_SQL), '不得再用 LIMIT 7 冒充 7 天窗口');
  assert.equal(HISTORY_WINDOW_DAYS, 7);
  const since = Date.parse(historySinceIso(Date.parse('2026-09-19T00:00:00Z')));
  assert.ok(Math.abs((Date.parse('2026-09-19T00:00:00Z') - since) / 864e5 - 7) < 0.01, '窗口边界必须正好 7 天');
});

test('B39-2 真实数据行为：7 天窗内一行不漏、窗外一行不漏进', () => {
  const { db } = require('../server/db');
  const { DAILY_HISTORY_SQL, historySinceIso } = require('../lib/brief-guards');
  const now = Date.now();
  db.exec('DELETE FROM daily_reports');
  const ins = db.prepare('INSERT INTO daily_reports(generated_at, window_hours, stats) VALUES (?,?,?)');
  // 窗外 3 行（8~12 天前）+ 窗内 9 行（含 0.1 天前与 6.9 天前两个边界）
  for (const d of [12, 9, 8]) ins.run(new Date(now - d * 864e5).toISOString(), 30, '{}');
  for (const d of [0.1, 1, 2, 3, 4, 5, 6, 6.5, 6.9]) ins.run(new Date(now - d * 864e5).toISOString(), 30, '{"schemaVersion":2}');
  const rows = db.prepare(DAILY_HISTORY_SQL).all(historySinceIso(now));
  assert.equal(rows.length, 9, `7 天窗内应返回 9 行，实测 ${rows.length}`);
  assert.ok(rows.every((r) => Date.parse(r.generated_at) >= now - 7.01 * 864e5), '窗外行泄漏');
});

test('B39-3 档位投影：AI 增强 / 裸关键词必须由 brief-guards 单一实现判定，前端不再硬编码「近 7 天」', () => {
  const { isAiDailyReport } = require('../lib/brief-guards');
  assert.equal(isAiDailyReport({ stats: '{"schemaVersion":2}' }), true);
  assert.equal(isAiDailyReport({ stats: '{}' }), false, '无 schemaVersion 的裸关键词版必须判 false');
  assert.equal(isAiDailyReport({ stats: '{"schemaVersion":"1"}' }), false, '字符串型 sv 也必须能判（实测线上混着写）');

  const api = read('api/[...slug].js');
  assert.match(api, /isAiDailyReport/, '云端历史接口必须复用 isAiDailyReport，不得自己再判一次 schemaVersion');

  const ui = read('web/src/components/BriefCenterTab.jsx');
  assert.ok(!/生成历史（近 7 天）/.test(ui), '前端标题不得把窗口写死，必须由接口回传的 windowDays 决定');
  assert.match(ui, /windowDays|window_days/, '前端应读接口回传的窗口天数');
});
