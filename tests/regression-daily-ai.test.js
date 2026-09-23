// 18-daily-ai-v2 回归测试：深析解析/窗口计算/降级判定/主题透出
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// CI 无 .env（凭据不入库）：退到 file: 本地库（AI 全部打桩，库只承 settings 读写，表在 before 里建）
const HAS_ENV = fs.existsSync(path.join(__dirname, '..', '.env'));
if (HAS_ENV) {
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} else {
  process.env.TURSO_DATABASE_URL = `file:${path.join(require('os').tmpdir(), `daily-ai-ci-${process.pid}.db`).replace(/\\/g, '/')}`;
  process.env.TURSO_AUTH_TOKEN = '';
  const { before } = require('node:test');
  const { createClient } = require('@libsql/client');
  before(async () => {
    const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: '' });
    await db.execute('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)');
    await db.close();
  });
}
const _ai = require('../api/_ai');

test('1. analyzeArticle：正常 JSON 解析六维+富字段', async () => {
  _ai._setProviderOverride(async () => JSON.stringify({
    scores: { 选题: 9, 内容: 8, 深度: 8, 实用: 7, 创新: 8, 表达: 8 },
    totalScore: 82, reason: '深度技术分析，数据扎实', summary: '摘要', quote: '金句',
    points: ['p1', 'p2'], tags: ['AI', 'Agent'],
  }));
  const r = await _ai.analyzeArticle({ title: 't', summary: 's', content_html: '<p>body</p>' });
  assert.equal(r.totalScore, 82);
  assert.equal(r.scores['选题'], 9);
  assert.equal(r.points.length, 2);
  _ai._setProviderOverride(null);
}, { timeout: 30000 });

test('2. analyzeArticle：脏输出兜底 null（不阻断早报）', async () => {
  _ai._setProviderOverride(async () => '这不是 JSON，是模型发癫');
  const r = await _ai.analyzeArticle({ title: 't', content_html: '<p>x</p>' });
  assert.equal(r, null);
  _ai._setProviderOverride(null);
}, { timeout: 30000 });

test('3. generateTheme：导语清洗（去引号截断）', async () => {
  _ai._setProviderOverride(async () => '「从开放模型成本，到记忆治理，再到人机协作，判断 AI 落地责任分配。」');
  const t = await _ai.generateTheme([{ title: 'a', reason: 'r' }]);
  assert.ok(t.length <= 120);
  assert.ok(!t.startsWith('「'));
  _ai._setProviderOverride(null);
}, { timeout: 30000 });

test('3b. generateTheme：思维链/元任务污染行全部拒绝 → 返回 null（不得回退污染行）', async () => {
  // 2026-09-13 两次线上实测污染形态
  _ai._setProviderOverride(async () =>
    'The dominant themes emerging are AI and machine learning discussions, semiconductor and chip technology, the tension between technological progress and cultural anxiety.'
  );
  assert.equal(await _ai.generateTheme([{ title: 'a', reason: 'r' }]), null, '英文思维链长句应被拒绝');
  _ai._setProviderOverride(async () => '用户希望我作为科技媒体主编，从入选列表中提炼出一句话导语。');
  assert.equal(await _ai.generateTheme([{ title: 'a', reason: 'r' }]), null, '角色/任务复述应被拒绝');
  // 混合输出：污染行 + 干净导语行 → 取干净行
  _ai._setProviderOverride(async () =>
    '分析：\n1. 先看AI主线\n从芯片互联，到算力调度，再到端侧落地，判断基础设施红利窗口。'
  );
  const t3 = await _ai.generateTheme([{ title: 'a', reason: 'r' }]);
  assert.ok(t3 && t3.includes('从芯片互联'), '混合输出应取干净导语行');
  _ai._setProviderOverride(null);
}, { timeout: 30000 });

test('3c. generateTheme：第一人称"写作意图句"必须拒绝（2026-09-18 周刊第 2 期线上实锤污染）', async () => {
  // 线上实际入库值：/api/weekly report.theme === "我需要找到贯穿这些文章的核心主线。"
  // 旧否决表只列了 我想/我觉得/我会/我来/让我… 与「需要我」（词序相反），
  // 「我需要」两头都不沾 → 既没被 isAnalysis 拦下也没被一票否决拦下。
  const bad = [
    '我需要找到贯穿这些文章的核心主线。',
    '我们必须从三个维度来组织这期周刊。',
    '我们应该聚焦算力与治理的张力。',
    '我们要讲的是基础设施的稀缺性。',
    '我需要强调的是，本周的主线是安全。',
  ];
  for (const line of bad) {
    _ai._setProviderOverride(async () => line);
    assert.equal(await _ai.generateTheme([{ title: 'a', reason: 'r' }]), null, `应拒绝第一人称写作意图句: ${line}`);
  }
  // 反向保护：含「自我/我们」但确为内容陈述的导语不得被误杀
  _ai._setProviderOverride(async () => '从模型开源，到算力自建，再到数据主权，判断 AI 行业的自我定位。');
  const ok = await _ai.generateTheme([{ title: 'a', reason: 'r' }]);
  assert.ok(ok && ok.includes('自我定位'), `内容陈述句不应被误杀，实得: ${ok}`);
  _ai._setProviderOverride(null);
}, { timeout: 30000 });

test('4. 窗口计算：北京自然日边界', () => {
  // 原来这里把产品的算术**又抄了一遍**（自己 +8h、自己 setUTCHours），于是它判的是"我抄的两份一致"，
  // 而不是"产品算得对"——偏移写错它照样绿。改成：性质判在产品用的那份实现上，再钉住产品确实走它。
  const fs = require('fs');
  const path = require('path');
  const { beijingDayStartMs, beijingDateStr } = require('../lib/time-window');
  const dayStart = beijingDayStartMs();
  const startUtc = new Date(dayStart - 24 * 3600e3).toISOString();
  const endUtc = new Date(dayStart).toISOString();
  assert.equal(new Date(endUtc) - new Date(startUtc), 24 * 3600e3, '窗口不是整整一个北京日');
  assert.equal(beijingDateStr(Date.parse(endUtc)), beijingDateStr(), '窗口右端不是"今天 0 点"（北京）');
  assert.equal(beijingDateStr(Date.parse(startUtc)), beijingDateStr(Date.now() - 24 * 3600e3),
    '窗口左端不是"昨天 0 点"（北京）');
  // runner 的 briefWindow 必须走这同一份实现（否则上面的性质判据与线上无关）
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'collect-turso.js'), 'utf8')
    .replace(/\r\n/g, '\n');
  assert.match(src, /function briefWindow\(\)[\s\S]{0,500}beijingDayStartMs\(\)/,
    'tools/collect-turso.js 的 briefWindow 不再走 lib/time-window（窗口算术又各自写了一份）');
});
