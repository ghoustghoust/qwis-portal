// H27② 回归锁：AI 批触发门不许再依赖"定时事件里的串等值"。
// 为什么：GH 会把定时事件挂错 cron 串（10-02 周刊整档丢失，心跳无痕），"事件串 == job 声明串"
// 这条门本身会开错门。用户拍板方案②：搭 dispatch 通道，步骤内按时间窗 + 当日产物 + 认领键判。
// 判定纯逻辑在 lib/daily-ai-claim.js，schedule 与 dispatch 两条路径共用。
'use strict';
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const eb = require('../lib/daily-ai-claim');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// 北京 21:35（窗口内）与 12:00（窗口外）的 nowMs：用固定 UTC 时刻构造（北京=UTC+8）
const IN_WINDOW = Date.UTC(2026, 9, 3, 13, 35);  // 北京 21:35
const OUT_WINDOW = Date.UTC(2026, 9, 3, 4, 0);   // 北京 12:00
const TODAY = '2026-10-03';

test('H27-1 时间窗：北京 21:25 前 dispatch 轮不开门，之后开；force 不看窗', () => {
  assert.equal(eb.windowOpen(OUT_WINDOW), false, '白天轮不该跑晚间批');
  assert.equal(eb.windowOpen(IN_WINDOW), true, '窗口内轮被拒了');
  assert.equal(eb.windowOpen(OUT_WINDOW, true), true, '显式补跑不该被窗拦');
});

test('H27-2 三判据：今天已有 AI 档产物 → 不重跑（主判据，防调度与补跑双写）', () => {
  const d = eb.claimDecision(null, { slot: 'evening', hasProductToday: true, nowMs: IN_WINDOW });
  assert.equal(d.run, false);
  assert.match(d.why, /已有 AI 档产物/);
});

test('H27-3 认领键：别轮正在生成 → 跳过；认领过期（死轮）→ 放行重跑', () => {
  const fresh = { date: TODAY, slot: 'evening', at: new Date(IN_WINDOW - 30 * 60e3).toISOString(), status: 'started' };
  const running = eb.claimDecision(fresh, { slot: 'evening', hasProductToday: false, nowMs: IN_WINDOW });
  assert.equal(running.run, false, '认领未过期却重跑 = 并发双写');
  const stale = { date: TODAY, slot: 'evening', at: new Date(IN_WINDOW - 340 * 60e3).toISOString(), status: 'started' };
  assert.equal(eb.claimDecision(stale, { slot: 'evening', hasProductToday: false, nowMs: IN_WINDOW }).run, true,
    '认领超过作业硬上限仍挡着 = 死轮锁死当天');
});

test('H27-4 failed 允许重跑；昨天的认领管不到今天；档位分开（备跑不顶晚间）', () => {
  assert.equal(eb.claimDecision({ date: TODAY, slot: 'evening', at: new Date(IN_WINDOW - 60e3).toISOString(), status: 'failed' },
    { slot: 'evening', hasProductToday: false, nowMs: IN_WINDOW }).run, true, '失败批不许锁死当天');
  const yesterday = eb.claimDecision({ date: '2026-10-02', slot: 'evening', at: '2026-10-02T13:00:00.000Z', status: 'started' },
    { slot: 'evening', hasProductToday: false, nowMs: IN_WINDOW });
  assert.equal(yesterday.run, true, '跨日认领还在挡');
  const otherSlot = eb.claimDecision({ date: TODAY, slot: 'backup', at: new Date(IN_WINDOW - 30 * 60e3).toISOString(), status: 'started' },
    { slot: 'evening', hasProductToday: false, nowMs: IN_WINDOW });
  assert.equal(otherSlot.run, true, '备跑的认领挡住了晚间批（档位没分）');
});

test('H27-5 force 显式补跑越过一切（人工动作最高优先）', () => {
  const d = eb.claimDecision({ date: TODAY, slot: 'evening', at: new Date(IN_WINDOW - 30 * 60e3).toISOString(), status: 'started' },
    { slot: 'evening', hasProductToday: true, nowMs: IN_WINDOW, force: true });
  assert.equal(d.run, true, '显式补跑被认领/产物判据挡了');
});

test('H27-6 接线：workflow 搭上 dispatch 通道并带窗口守卫；runner 走三判据门', () => {
  const yml = read('.github/workflows/collect.yml');
  const jobStart = yml.indexOf('daily-ai-evening:');
  assert.ok(jobStart > 0, '找不到 daily-ai-evening 作业');
  const seg = yml.slice(jobStart, yml.indexOf('\n  #', jobStart + 10) === -1 ? yml.length : yml.indexOf('\n  # ───', jobStart + 10));
  assert.match(seg, /github\.event_name == 'workflow_dispatch'/, 'AI 主批没搭 dispatch 通道（还是只认 schedule）');
  assert.match(seg, /WINDOW_GUARD/, '步骤没带窗口守卫（dispatch 轮会全天开跑）');
  assert.match(seg, /--window-guard/, '命令没带窗口守卫旗标');
  const runner = read('tools/collect-turso.js');
  assert.match(runner, /runDailyAiGuarded/, 'daily-ai 模式没走三判据门');
  assert.match(runner, /claimDecision/, '门里没用共用判定（另写一份会漂）');
});
