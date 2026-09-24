// 级3「每源预配额」回归锁（2026-09-24，docs/specs/44-prescreen-tier/spec.md 步1）
//
// 为什么（锁的纪律：每条判据指到用户的一句话或一个实测数字）：
//   用户 2026-09-24 裁决「初筛的职责是削减，不是理解」+「分两批，先做步1」。
//   实测支撑：24h 窗口 2,688 篇 / 469 个活跃源，而候选的 `ORDER BY a.published_at DESC LIMIT 500`
//   只覆盖 94 源（20%）—— 500 个坑里 352 个是同一批高频源的"第 3 篇以后"。
//   本锁盯的就是这件事：**削减换回的是源覆盖，AI 调用量不许变**。
//   判据文档：`docs/RSS高质量信息流系统设计参考文档 (1).md` §1.6 级3。
//
// P6/P7/P8 是"形态锁"（扫源码文本），与 F5/W14 同族：它们防的是"只改了一份 / 单位写错"
// 这类只在某一份里复发的漂移（B20 的门槛漏接、B137 的 elapsedMin ÷10 都是这个形状）。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// 惰性取模块（#64-1 的要求，不是风格问题）：顶层 require 新建模块会让 F2P 在基线提交上
// 直接加载失败 —— 那时 `lib/prescreen.js` 还不存在，锁就读不出"是世界变了还是锁坏了"。
const ps = () => require('../lib/prescreen');
const derivedWriters = () => require('../lib/daily-writers').findDailyReportWriters(ROOT);

const row = (id, sourceId) => ({ id, source_id: sourceId, title: `t${id}` });
const srcCount = (rows) => new Set(rows.map((r) => r.source_id)).size;

test('P1 小源（日更 ≤cap）全额通过 —— §1.6「小源（日更 ≤2 篇）全额通过，不受影响」', () => {
  const rows = [];
  for (let s = 1; s <= 50; s++) for (let i = 0; i < 2; i++) rows.push(row(rows.length + 1, s));
  const kept = ps().applySourceQuota(rows, { cap: 2, limit: 500 });
  assert.equal(kept.length, 100, '每源恰好 2 篇的池子，一篇都不该被削');
  assert.equal(srcCount(kept), 50);
});

test('P2 大源截到 cap，且留下的是池内前 cap 篇（选篇信号=最新，不是评分）', () => {
  const big = [1, 2, 3, 4, 5].map((id) => row(id, 99)); // 已按 published_at DESC 排好
  const kept = ps().applySourceQuota(big, { cap: 2, limit: 500 });
  assert.deepEqual(kept.map((r) => r.id), [1, 2], '截的是"第 3 篇以后"，留的是最新的两篇');
});

test('P3 本刀的因果：削掉的是重复坑位，同一上限下源覆盖换回来', () => {
  // 复刻线上形态：5 个大源各 200 篇排在前面（时间序），300 个小源各 1 篇在后
  const rows = [];
  for (let s = 1; s <= 5; s++) for (let i = 0; i < 200; i++) rows.push(row(rows.length + 1, s));
  for (let s = 6; s <= 305; s++) rows.push(row(rows.length + 1, s));
  const noCap = ps().applySourceQuota(rows, { cap: 100, limit: 500 }); // cap 放到极大 = 等价于"只做上限"
  const withCap = ps().applySourceQuota(rows, { cap: 2, limit: 500 });
  assert.equal(noCap.length, 500);
  assert.equal(srcCount(noCap), 5, '不限量时 500 个坑全被 5 个大源吃掉 —— 这就是线上那 94 源的成因');
  assert.equal(srcCount(withCap), 305, '同样 500 上限，cap=2 之后每个有货的源都有代表');
  assert.ok(withCap.length < noCap.length, '条数下降而覆盖上升 = 这一刀是"免费"的');
  const read = ps().prescreenStats(rows.slice(0, 500), withCap, 2);
  assert.deepEqual(Object.keys(read).sort(), ['cap', 'kept', 'keptSources', 'pool', 'poolSources']);
  assert.equal(read.cap, 2, '读数必须带 cap 本身：否则"配额是几"这个事实又只剩代码里有一份');
});

test('P4 坏配置一律回默认 —— 缺键/空串/布尔/0/小数/越界/非数字都不许读成"配额关了"', () => {
  assert.equal(ps().DEFAULT_PER_SOURCE_CAP, 2, '默认值唯一出处；改了它要同步 §1.6 与 44 号 spec');
  for (const bad of [undefined, null, '', '  ', false, true, 0, -1, 1.5, 'abc', NaN, Infinity, 999]) {
    assert.equal(ps().prescreenCapOf(bad), ps().DEFAULT_PER_SOURCE_CAP, `prescreenCapOf(${JSON.stringify(bad)}) 必须回默认`);
  }
  for (const ok of [1, 2, 3, '2', '5', 100]) assert.equal(ps().prescreenCapOf(ok), Number(ok));
  // 端到端：坏 cap 传进主函数不许变成"不限量"
  const rows = [1, 2, 3, 4, 5].map((id) => row(id, 7));
  assert.equal(ps().applySourceQuota(rows, { cap: '', limit: 500 }).length, 2);
});

test('P5 limit 语义：默认 500 / Infinity=真不截断 / 坏值回默认', () => {
  // 1200 行 / 400 源 × 3 篇，cap=2 后有 800 篇合格 —— 上限才会真的咬合
  const rows = [];
  for (let s = 1; s <= 400; s++) for (let i = 0; i < 3; i++) rows.push(row(rows.length + 1, s));
  assert.equal(ps().applySourceQuota(rows, { cap: 2 }).length, ps().DEFAULT_POOL_LIMIT, '不传 limit 用默认 500');
  assert.equal(ps().applySourceQuota(rows, { cap: 2, limit: Infinity }).length, 800,
    'Infinity = 只限量不截断（本地灾备端口径：本端今天没有候选上限，本函数不替它新造一个）');
  assert.equal(ps().applySourceQuota(rows, { cap: 2, limit: null }).length, 800, 'null 同义 = 不截断');
  assert.equal(ps().applySourceQuota(rows, { cap: 2, limit: 'abc' }).length, ps().DEFAULT_POOL_LIMIT, '坏值回默认 500，不许读成"不截断"');
  assert.equal(ps().applySourceQuota(rows, { cap: 2, limit: 0 }).length, ps().DEFAULT_POOL_LIMIT,
    '0 同坏值（配置里的 0 通常是"没填"，不是"上限 0 篇"）');
  assert.equal(ps().applySourceQuota(null, { cap: 2 }).length, 0, '空池不许抛');
});

// 部署面 = 真会产出读者所见早报的那几份：runner 侧由 `.github/workflows/collect.yml` 以
// `node tools/collect-turso.js <mode>` 执行，Vercel 侧由 `vercel.json` 的 functions/rewrites 指向 `api/`。
// `server/` 不在此面（`.vercelignore` 排除它，注释「已由 api/ 替代」）—— 用户 2026-09-24 裁定 A：
// 入报门槛是**安全阀**，五份写入器（含未部署的本地端）都得接，W14 的面不变；
// 级3 是**策展策略**、改变的是版面构成，只约束部署面那几份。风险等级不同的两类判据不共用同一个面。
const DEPLOYED_DIRS = ['api/', 'tools/'];

function deployedWriters() {
  return derivedWriters().filter((w) => !w.dynamic && DEPLOYED_DIRS.some((d) => w.file.startsWith(d)));
}
function deployedWriterFiles() {
  return [...new Set(deployedWriters().map((w) => w.file))].sort();
}

test('P6 部署面写入器逐个接线（派生清单，剔掉整表复制类与未部署的本地端）', () => {
  const all = derivedWriters();
  assert.ok(all.filter((w) => !w.dynamic).length >= 5, `派生到的生成类写入器只有 ${all.filter((w) => !w.dynamic).length} 个（W14 要求 >=5）—— 判据抓不到东西了`);
  const files = deployedWriterFiles();
  // 4 个生成函数住在 3 个文件里：runDailyAi 与 runDaily 同在 tools/collect-turso.js
  assert.ok(deployedWriters().length >= 4 && files.length >= 3,
    `部署面只剩 ${deployedWriters().length} 个函数 / ${files.length} 个文件（${files.join(' ')}）—— 面的定义或写入器分布变了，本锁要重读`);
  const notWired = files.filter((f) => !fs.readFileSync(path.join(ROOT, f), 'utf8').includes('applySourceQuota'));
  assert.deepEqual(notWired, [], `这些部署面日报生成器没接级3：${notWired.join(', ')} —— B20 的形状就是"只接了 3/5 份"`);
});

test('P6b 本地端豁免的前提必须还成立：server/ 仍在 .vercelignore 外', () => {
  // 这条不是装饰：P6 把 `server/services/ai/daily.js` 排除在级3 之外，全部依据就是"它不在部署面"。
  // 哪天有人把 server/ 放回部署面（或改了 ignore），本锁立刻红，逼着重新判一次 A/B —— 豁免不会变成永久洞。
  const ignore = fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8').split(/\r?\n/).map((s) => s.trim());
  assert.ok(ignore.includes('server/'), '.vercelignore 不再排除 server/ —— P6 的本地端豁免前提失效，级3 要重新判是否接本地端');
  const gate = fs.readFileSync(path.join(ROOT, 'server', 'services', 'ai', 'daily.js'), 'utf8');
  assert.ok(gate.includes('applyDailyQualityGate'), '本地端虽然不接级3，但入报门槛（安全阀）必须继续在 —— 缺了就是 W14 该红');
});

test('P7 elapsedMin 单位（B137）：所有出现处都要 ÷6000 取一位小数', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'collect-turso.js'), 'utf8');
  const found = [...src.matchAll(/elapsedMin:\s*Math\.round\(\(Date\.now\(\) - t0\) \/ (\d+(?:e\d+)?)/g)].map((m) => Number(m[1]));
  assert.ok(found.length >= 2, `只扫到 ${found.length} 处 elapsedMin —— 判据抓不到东西了（daily-ai 与 weekly 各一处）`);
  // 600e2 = 60000 = "整分钟"，再 ÷10 就把落库值算成真实耗时的 1/10：
  // 两期观察读数 8.1/8.5 实为 81/85 分钟，据此误判过预算余量（B137）
  const bad = found.filter((d) => d !== 6000);
  assert.deepEqual(bad, [], `这些 elapsedMin 的除数不是 6000：${bad.join(', ')}`);
});

test('P8 旧候选形态不许复活：生成类写入器里不得再有未经配额的 `published_at DESC LIMIT 500`', () => {
  // 范围＝P6 那批派生写入器文件（`tools/export-portal.js` 也有一句 LIMIT 500，但它导的是门户静态快照、
  // 不是日报候选池，**故意不在本面内**；哪天它变成写入器，P6 的派生清单会自己把它带进来）。
  const files = deployedWriterFiles();
  const bad = files.filter((f) => /published_at DESC LIMIT 500/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(bad, [], `这些写入器还在直取 500 未经级3：${bad.join(', ')}`);
  assert.ok(deployedWriters().length >= 4, `对账面只有 ${deployedWriters().length} 个生成函数（分母：${files.join(' ')}）—— 判据抓不到东西了`);
});
