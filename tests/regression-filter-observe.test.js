// P0-2 回归锁（2026-09-23）：初筛间歇性静默失效修复 + 失败可观测
// 背景：agnes-2.5-flash 是推理模型，filter 的 maxTokens=128 常全烧在思考上 → finish=length
//   → 无 content → 抛错 → 失败放行 50 分（>门槛 30）。近 11 期剔除率在 0%↔13.8% 随机跳，
//   且"0 剔除"与"初筛根本没工作"数据同形不可判别（第 22 期=用户截图那期即 0 剔除）。
// 修复三件事：① maxTokens 128→512（对齐 _ai.js :69 推理模型默认线）；
//   ② 失败/解析失败返回 failed:true（此前失败不落任何数，"筛没筛"在原理上算不出来）；
//   ③ 失败率 ≥20% 或预算截断 → 飞书报警（判据唯一实现 lib/filter-observe.js）。
// 打桩口径与 regression-ai-infra 相同：provider 全桩 + fetch 打死 + file: 本地库，零真实出口。
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runDriver } = require('./driver-runner');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(os.tmpdir(), `filter-observe-${process.pid}.db`).replace(/\\/g, '/');
const DRIVER = path.join(ROOT, `.filter-observe-driver-${process.pid}.cjs`);

function run(caseName) {
  const out = runDriver(DRIVER, [caseName, DB_FILE], { timeout: 120000, payloadRe: /^OUT /m });
  const line = out.trim().split('\n').filter((l) => l.startsWith('OUT ')).pop();
  assert.ok(line, `子进程没打印结果（${caseName}）：\n${out}`);
  return JSON.parse(line.slice(4));
}

before(() => {
  fs.writeFileSync(DRIVER, `
process.env.TURSO_DATABASE_URL = 'file:' + process.argv[3];
process.env.TURSO_AUTH_TOKEN = '';
process.env.AGNES_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
// 本文件所有 AI 用例都走 _setProviderOverride 打桩：真 fetch 一旦被打到就是测试写坏了，直接判红
globalThis.fetch = async () => { throw new Error('filter-observe 用例不应有真实网络调用'); };
const { createClient } = require('@libsql/client');
const _ai = require(${JSON.stringify(path.join(ROOT, 'api', '_ai.js'))});
const CASE = process.argv[2];
(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL });
  await db.execute('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)');
  const put = (k, v) => db.execute({ sql: 'INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', args: [k, v] });
  await put('ai', JSON.stringify({ apiKey: 'local-fake-key', model: 'stub' }));
  const out = {};
  if (CASE === 'fail') {
    _ai._setProviderOverride(async () => { throw new Error('模拟 Agnes 全挂'); });
    out.r = await _ai.filterArticle({ title: 't', source: 's', summary: 'x' });
  } else if (CASE === 'maxtokens') {
    let seen = null;
    _ai._setProviderOverride(async (p, messages, opts) => { seen = opts; return '{"score": 42, "reason": "ok"}'; });
    out.r = await _ai.filterArticle({ title: 't', source: 's', summary: 'x' });
    out.maxTokens = seen && seen.maxTokens;
  } else if (CASE === 'parsefail') {
    _ai._setProviderOverride(async () => '这根本不是 JSON，是模型的散文');
    out.r = await _ai.filterArticle({ title: 't', source: 's', summary: 'x' });
  }
  console.log('OUT ' + JSON.stringify(out));
  process.exitCode = 0;
})().catch((e) => { console.error('DRIVER-FATAL', e && e.stack || e); process.exitCode = 3; });
`);
});

after(() => {
  try { fs.rmSync(DRIVER, { force: true }); } catch { /* 尽力清理 */ }
  try { fs.rmSync(DB_FILE, { force: true }); } catch { /* 尽力清理 */ }
});

test('F1 初筛调用失败 → 返回 failed:true（放行语义不变：score 50 / ignore false）', () => {
  const { r } = run('fail');
  assert.equal(r.failed, true, '失败必须带 failed 标记，否则调用方无法计数（P0-2 的不可判别就是这么来的）');
  assert.equal(r.score, 50);
  assert.equal(r.ignore, false);
});

test('F2 初筛 maxTokens ≥ 512（推理模型要留思考空间，128 会全烧在思考上）', () => {
  const { r, maxTokens } = run('maxtokens');
  assert.equal(r.failed, undefined, '桩正常返回时不许误标 failed');
  assert.equal(r.score, 42);
  assert.ok(Number(maxTokens) >= 512, `filter maxTokens=${maxTokens} —— 低于 512 推理模型会把字数全烧在思考上（P0-2 根因）`);
});

test('F3 模型答了但掏不出 JSON → 同样 failed:true（"没筛成"要可数）', () => {
  const { r } = run('parsefail');
  assert.equal(r.failed, true);
  assert.equal(r.ignore, false);
});

test('F4 报警判据表：失败率 ≥20% 或预算截断才报警（lib/filter-observe.js 唯一实现）', () => {
  const { filterAlert, FILTER_FAIL_ALERT_RATE } = require('../lib/filter-observe');
  assert.equal(FILTER_FAIL_ALERT_RATE, 0.2);
  assert.equal(filterAlert({ attempted: 500, failed: 0 }).alert, false);
  assert.equal(filterAlert({ attempted: 500, failed: 99 }).alert, false, '19.8% 不报——免费模型日常抖动不该叫人');
  const hit = filterAlert({ attempted: 500, failed: 100 });
  assert.equal(hit.alert, true, '20% 必须报');
  assert.match(hit.text, /失败 100\/500/);
  assert.equal(filterAlert({ attempted: 0, failed: 0 }).alert, false, '一次都没跑不许报');
  const tr = filterAlert({ attempted: 300, failed: 0, truncated: true });
  assert.equal(tr.alert, true, '预算截断=部分候选根本没被筛，必须报');
  assert.match(tr.text, /截断/);
});

test('F5 filterStats 落库形状：failed/truncated 两键真写进 stats（防"记了但不落"）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'collect-turso.js'), 'utf8');
  assert.ok(/filterStats:\s*\{[^}]*failed:\s*filterFailed/.test(src), 'filterStats 缺 failed 键');
  assert.ok(/filterStats:\s*\{[^}]*truncated:\s*filterTruncated/.test(src), 'filterStats 缺 truncated 键');
  // 09-24 追加（用户裁定「补这两个字段」）：attempted/rejected 不落库，"这期筛了几篇"就算不出来 ——
  // 失败放行的条目同时在 passed 与 failed 里，拿 passed+failed 当尝试数是重复计数（我上一轮就这么错过一次）。
  assert.ok(/filterStats:\s*\{[^}]*attempted:/.test(src), 'filterStats 缺 attempted 键');
  assert.ok(/filterStats:\s*\{[^}]*rejected:\s*filterRejected/.test(src), 'filterStats 缺 rejected 键');
  // 三段耗时拆开：合在 elapsedMin 里就永远分不清"初筛慢还是深析慢"，预算给没给够也就无从判断
  assert.ok(/timeSplit:\s*\{[^}]*filterMin:/.test(src), 'stats 缺 timeSplit.filterMin');
  assert.ok(/timeSplit:\s*\{[^}]*analyzeMin:/.test(src), 'stats 缺 timeSplit.analyzeMin');
  assert.ok(/timeSplit:\s*\{[^}]*mediaMin:/.test(src), 'stats 缺 timeSplit.mediaMin');
});

test('F6 夜间预算三段自洽：初筛段 < 总预算 < GitHub job 超时（抬一个不抬另一个=把另一段挤掉）', () => {
  // 为什么（用户 09-24）：「时间长一点都可以，给各个边界一些缓冲，毕竟我们时间有 9 小时」。
  // 实测外推的峰值最坏值：初筛 500 篇 × 11.8s ≈ 98min，深析 325 篇 × 18.6s ≈ 101min → 两段合计 ~200min，
  // 所以预算取 300min（夜窗 540min 留一半余量），job 超时取 330min（GitHub 单 job 硬上限 6h）。
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'collect-turso.js'), 'utf8');
  // 必须按**函数体**取数：`const BUDGET_MS` 全库有两份（runWeekly 那份是 60min），
  // 上一版判据用裸正则取第一个匹配，读到的其实是周刊的预算 —— 自己就成了假量具。
  const i = src.indexOf('async function runDailyAi(');
  assert.ok(i >= 0, 'runDailyAi 不在了');
  const j = src.indexOf('\nasync function', i + 1);
  const body = src.slice(i, j < 0 ? undefined : j);
  const budget = Number(/const BUDGET_MS = (\d+) \* 60e3/.exec(body)?.[1]);
  const filterCap = Number(/const FILTER_BUDGET_MS = (\d+) \* 60e3/.exec(body)?.[1]);
  assert.ok(Number.isFinite(budget) && Number.isFinite(filterCap), '两个预算常数任一被改名/改成表达式 —— 判据要跟着改，别让它哑');
  assert.ok(filterCap < budget, `初筛段 ${filterCap}min 必须小于总预算 ${budget}min，否则深析一段被挤空`);
  assert.ok(budget >= 240, `总预算 ${budget}min 撑不住峰值最坏值（初筛 98 + 深析 101 ≈ 200min）`);
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'collect.yml'), 'utf8');
  const timeouts = [...yml.matchAll(/timeout-minutes:\s*(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(Math.max(...timeouts) >= budget + 15,
    `job 超时 ${Math.max(...timeouts)}min 必须 ≥ 总预算 ${budget}min + 15min 缓冲，否则批次会被 GitHub 中途杀掉（比截断更糟：一行不落）`);
});

// ─── F7/F8（H35，09-24 夜）：失败"是哪一种"必须可分类、可落库、且分类器不许自说自话 ───
// 为什么要有这一层：09-24 线上量到一期初筛失败 171/500=34.2%，但只有总数 ⇒ 该抬 maxTokens、
// 该加退避、还是提示词的事，三件事谁都不知道。修法完全不同的一类问题被一个数字压扁了。
const WHY_TABLE = [
  // [期望键, 真实串, 串出自哪里]
  ['parse', '解析失败放行', 'api/_ai.js:274（模型答了但掏不出 JSON）'],
  ['reasoning_only', 'agnes 仅含 reasoning 无 content(finish=length, head=用户希望我…)', 'api/_ai.js:88'],
  ['reasoning_only', 'agnes 输出为思维链/分析文本', 'api/_ai.js:190'],
  ['no_key', '未配置 AI API Key', 'api/_ai.js:113'],
  ['rate_limited', '初筛失败放行: agnes HTTP 429', 'api/_ai.js:75（429 会重试，仍失败才到这）'],
  ['server', '初筛失败放行: agnes HTTP 503', 'api/_ai.js:75'],
  ['client', '初筛失败放行: agnes HTTP 401', 'api/_ai.js:75'],
  ['timeout', '初筛失败放行: This operation was aborted', 'api/_ai.js:71 的 AbortSignal.timeout(30s)'],
  ['transport', '初筛失败放行: fetch failed', 'undici 连不上（代理挂了/ DNS）'],
  ['transport', '初筛失败放行: ECONNRESET', '同上'],
];

test('F7 失败因由分类表：每一条真实串都要落到对的桶，认不出的必须进 other', () => {
  const { classifyFilterFail, FILTER_FAIL_WHY } = require('../lib/filter-observe');
  assert.ok(WHY_TABLE.length >= 10, `分类表只有 ${WHY_TABLE.length} 行 —— 分母塌了这条就是恒绿`);
  for (const [want, str, from] of WHY_TABLE) {
    assert.equal(classifyFilterFail(str), want, `串「${str}」（${from}）应判 ${want}，实际判了 ${classifyFilterFail(str)}`);
  }
  // 空/垃圾串必须进 other，**不许被任何一条宽松正则吃掉**（把未知伪装成已知，比没归因更坏）
  for (const bad of ['', null, undefined, '完全没见过的错误形状', 'HTTP', 'init']) {
    assert.equal(classifyFilterFail(bad), 'other', `「${JSON.stringify(bad)}」被认成了 ${classifyFilterFail(bad)} —— 宽松正则越界，会把未知塞进已知`);
  }
  // 每一个声明过的桶都得有样本能命中（否则它是死桶：线上永远数不到，等于没分类）
  const hit = new Set(WHY_TABLE.map(([k]) => k));
  for (const [k] of FILTER_FAIL_WHY) assert.ok(hit.has(k), `FILTER_FAIL_WHY 声明了 ${k} 却没有任何样本串能命中 ⇒ 这条正则是死代码`);
  // 顺序敏感：timeout 必须排在 transport 之前（"This operation was aborted" 两个都像）
  assert.equal(classifyFilterFail('This operation was aborted'), 'timeout', 'timeout/transport 顺序被改动 ⇒ 超时会被记成网络故障，修的方向就错了');
});

test('F8 分类桶集合与契约枚举双向相等，且两处计数点真的都在 tally', () => {
  const { FILTER_FAIL_WHY } = require('../lib/filter-observe');
  const EXITS = require('../docs/contracts/daily-report.json')
    .properties.report.properties.stats.properties.filterStats.properties.failWhy.propertyNames.enum;
  const impl = [...FILTER_FAIL_WHY.map(([k]) => k), 'other'];
  assert.ok(EXITS.length >= 9 && impl.length >= 9, `契约 ${EXITS.length} 条 / 实现 ${impl.length} 条 —— 有一侧塌了`);
  for (const k of impl) assert.ok(EXITS.includes(k), `实现有桶 ${k} 而契约没有 ⇒ 线上会出现契约外键（消费侧按契约读就会漏）`);
  for (const k of EXITS) assert.ok(impl.includes(k), `契约声明了 ${k} 而实现没有 ⇒ 那一格永远不会出现，契约在说谎`);
  // 两个计数点：日报 AI 档（落 stats）与周刊（只进日志）—— 共用 filterArticle，漏一处就是一本糊涂账
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'collect-turso.js'), 'utf8');
  const n = (src.match(/tallyFilterFailWhy\(/g) || []).length;
  assert.ok(n >= 2, `全仓只扫到 ${n} 处 tallyFilterFailWhy ⇒ 有一处计数点没接归因（周刊 :905 一带 与 日报 AI 档 :1189 一带）`);
  assert.ok(/failWhy: \w+/.test(src), 'filterStats 里没有 failWhy 这个键 ⇒ 分类算完了但没落库');
});
