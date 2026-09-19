// 16-ai-infra 回归测试：provider 全部打桩（不真调 Agnes）+ 术语库/prompt/统计读写
// **2026-09-19 起改在本地 libsql 文件库上跑（B83 / 坑 #52）**。
// 旧版用真凭据连生产 Turso，把 ai.glossary / ai.minIntervalMs / prompt.filter / ai.stats 全写在生产 settings 上：
//   · before() 快照 ai.glossary、after() 整键写回——中途抛错就把生产术语库留在 '[]'（术语库是
//     runner 每天生长出来的资产，被测试清过一次就得重新攒，坑 #52 同族）；
//   · ai.minIntervalMs 被留在 '0'：等于把线上 AI 通道的串行限速关掉（Agnes 免费池 20 RPM 会 429）；
//   · prompt.filter 若在用例中间中断没删掉，线上初筛提示词就永久变成"自定义过滤提示词"。
// 现在：每条用例一个子进程 + file: 本地库，桩之外**没有任何真实网络出口**（驱动里把 fetch 直接打死）。
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(os.tmpdir(), `ai-infra-${process.pid}.db`).replace(/\\/g, '/');
// 驱动脚本必须落在仓库内：Node 从脚本所在目录往上找 node_modules（放临时目录先撞 Cannot find module）
const DRIVER = path.join(ROOT, `.ai-infra-driver-${process.pid}.cjs`);

function run(caseName) {
  const out = execFileSync(process.execPath, [DRIVER, caseName, DB_FILE],
    { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  const line = out.trim().split('\n').filter((l) => l.startsWith('OUT ')).pop();
  assert.ok(line, `子进程没打印结果（${caseName}）：\n${out}`);
  return JSON.parse(line.slice(4));
}

before(() => {
  fs.writeFileSync(DRIVER, `
process.env.TURSO_DATABASE_URL = 'file:' + process.argv[3];
process.env.TURSO_AUTH_TOKEN = '';
// 本地假 key：只为让 _providerChain 非空（空链会直接抛"未配置 AI API Key"），绝不为它读生产凭据
process.env.AGNES_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
const { createClient } = require('@libsql/client');
// 本文件所有 AI 用例都走 _setProviderOverride 打桩：真 fetch 一旦被打到就是测试写坏了，直接判红
globalThis.fetch = async () => { throw new Error('B83：ai-infra 用例不应有真实网络调用'); };
const _ai = require(${JSON.stringify(path.join(ROOT, 'api', '_ai.js'))});
const CASE = process.argv[2];
(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL });
  await db.execute('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)');
  const put = (k, v) => db.execute({ sql: 'INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', args: [k, v] });
  await put('ai', JSON.stringify({ apiKey: 'local-fake-key', model: 'stub' }));
  const out = {};
  if (CASE === 'serial') {
    _ai._setProviderOverride(async () => 'ok');
    await put('ai.minIntervalMs', '4000');
    const t0 = Date.now();
    const results = await Promise.all([
      _ai.aiChat([{ role: 'user', content: 'a' }]),
      _ai.aiChat([{ role: 'user', content: 'b' }]),
      _ai.aiChat([{ role: 'user', content: 'c' }]),
    ]);
    out.elapsed = Date.now() - t0;
    out.results = results;
    _ai._setProviderOverride(null);
  }
  if (CASE === 'retry') {
    _ai._setProviderOverride(null);
    let calls = 0;
    _ai._setProviderOverride(async () => {
      calls++;
      if (calls < 3) { const e = new Error('agnes HTTP 429'); e.status = 429; throw e; }
      return 'ok-after-retry';
    });
    await put('ai.minIntervalMs', '0');
    out.r = await _ai.aiChat([{ role: 'user', content: 'x' }]);
    out.calls = calls;
    _ai._setProviderOverride(null);
  }
  if (CASE === 'glossary') {
    await put('ai.glossary', '[]');
    out.a1 = await _ai.growGlossary([{ en: 'LLM', zh: '大语言模型', domain: 'AI', confidence: 0.95 }]);
    out.a2 = await _ai.growGlossary([{ en: 'llms', zh: '大模型', confidence: 0.9 }]);
    out.list = await _ai.loadGlossary();
    out.a3 = await _ai.growGlossary([{ en: 'Foo', zh: '某物', confidence: 0.5 }]);
    out.listAfter = await _ai.loadGlossary();
  }
  if (CASE === 'filter') {
    await put('ai.minIntervalMs', '0');
    _ai._setProviderOverride(async () => '{"score": 85, "ignore": false, "reason": "深度技术文"}');
    out.good = await _ai.filterArticle({ title: 't', source: 's', summary: 'x' });
    _ai._setProviderOverride(async () => '这不是JSON');
    out.dirty = await _ai.filterArticle({ title: 't' });
    _ai._setProviderOverride(null);
  }
  if (CASE === 'prompt') {
    await put('prompt.filter', '"自定义过滤提示词"');
    out.custom = await _ai.loadPrompt('filter');
    await db.execute("DELETE FROM settings WHERE key='prompt.filter'");
    out.fallback = await _ai.loadPrompt('filter');
  }
  if (CASE === 'stats') {
    _ai._setProviderOverride(async () => 'ok');
    await put('ai.minIntervalMs', '0');
    await _ai.aiChat([{ role: 'user', content: 'stat-test' }]);
    out.s = await _ai.aiStats();
    _ai._setProviderOverride(null);
  }
  console.log('OUT ' + JSON.stringify(out));
  await db.close();
})().catch((e) => { console.error('DRIVERERR ' + e.message); process.exitCode = 3; });
`);
});
after(() => {
  for (const f of [DRIVER, DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) {
    try { fs.rmSync(f, { force: true }); } catch { /* 关不掉就留给系统临时目录 */ }
  }
});

test('1. 限流串行：并发 3 次调用间隔 ≥8s 且按序', async () => {
  const r = run('serial');
  assert.ok(r.results.every((x) => x.ok), JSON.stringify(r.results));
  assert.ok(r.elapsed >= 8000, `3 次串行应 ≥8s，实际 ${r.elapsed}ms`);
}, { timeout: 60000 });

test('2. 429 退避重试后成功', () => {
  const r = run('retry');
  assert.ok(r.r.ok && r.r.reply === 'ok-after-retry', JSON.stringify(r.r));
  assert.equal(r.calls, 3);
}, { timeout: 60000 });

test('3. 术语库：写入→读取→生长累计→locked 不覆盖', () => {
  const r = run('glossary');
  assert.equal(r.a1.added, 1);
  // 归一化命中（小写+复数）
  assert.equal(r.a2.updated, 1);
  assert.equal(r.a2.added, 0);
  assert.equal(r.list.length, 1);
  assert.equal(r.list[0].zh, '大语言模型', 'locked=false 也应只累计不改写');
  assert.equal(r.list[0].occurrenceCount, 2);
  // 低置信度丢弃
  assert.equal(r.a3.added, 0);
  assert.equal(r.listAfter.length, 1);
});

test('4. filterArticle：脏 JSON 兜底 + 正常解析', () => {
  const r = run('filter');
  assert.equal(r.good.score, 85);
  assert.equal(r.good.ignore, false);
  assert.equal(r.dirty.ignore, false, '解析失败应放行');
}, { timeout: 60000 });

test('5. loadPrompt：settings 覆盖 > repo 文件', () => {
  const r = run('prompt');
  assert.equal(r.custom, '自定义过滤提示词');
  assert.match(r.fallback, /初筛编辑/);
});

test('6. ai.stats 滚动记录', () => {
  const r = run('stats');
  assert.ok(r.s.calls24h >= 1, JSON.stringify(r.s));
});

test('7. 自证：本文件不再碰生产库（B83/坑 #52 的门禁）', () => {
  const full = fs.readFileSync(path.join(__dirname, 'regression-ai-infra.test.js'), 'utf8');
  const cut = full.indexOf("test('7.");
  assert.ok(cut > 0, '找不到自证条目起点，本条会退化成恒真');
  const src = full.slice(0, cut);
  assert.ok(!/['"]\.env['"]/.test(src), '还在读 .env → 又要拿真凭据连生产库了');
  assert.ok(!/authToken:\s*process\.env/.test(src), 'createClient 带真实 authToken → 会打到生产 Turso');
  assert.match(src, /TURSO_DATABASE_URL = 'file:'/, '子进程必须被指到本地文件库');
  assert.match(src, /globalThis\.fetch = async/, 'AI 用例必须钉死"无真实网络出口"，不许偷偷打 Agnes');
});
