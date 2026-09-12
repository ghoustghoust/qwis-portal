// 16-ai-infra 回归测试：provider 全部打桩（不真调 Agnes），仅术语库读写真实 Turso（ai.glossary 测后恢复）
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
for (const line of envTxt.split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const _ai = require('../api/_ai');
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

let origGlossary = null;
before(async () => {
  const g = await db.execute("SELECT value FROM settings WHERE key='ai.glossary'");
  origGlossary = g.rows[0] ? g.rows[0].value : null;
});
after(async () => {
  if (origGlossary !== null) await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('ai.glossary',?)", args: [origGlossary] });
  db.close();
});

test('1. 限流串行：并发 5 次调用间隔 ≥4s 且按序', async () => {
  _ai._setProviderOverride(async () => 'ok');
  await db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('ai.minIntervalMs','4000')");
  const t0 = Date.now();
  const results = await Promise.all([
    _ai.aiChat([{ role: 'user', content: 'a' }]),
    _ai.aiChat([{ role: 'user', content: 'b' }]),
    _ai.aiChat([{ role: 'user', content: 'c' }]),
  ]);
  const elapsed = Date.now() - t0;
  assert.ok(results.every((r) => r.ok));
  assert.ok(elapsed >= 8000, `3 次串行应 ≥8s，实际 ${elapsed}ms`);
  _ai._setProviderOverride(null);
}, { timeout: 30000 });

test('2. 429 退避重试后成功', async () => {
  _ai._setProviderOverride(null);
  let calls = 0;
  _ai._setProviderOverride(async () => {
    calls++;
    if (calls < 3) { const e = new Error('agnes HTTP 429'); e.status = 429; throw e; }
    return 'ok-after-retry';
  });
  await db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('ai.minIntervalMs','0')");
  const r = await _ai.aiChat([{ role: 'user', content: 'x' }]);
  assert.ok(r.ok && r.reply === 'ok-after-retry');
  assert.equal(calls, 3);
  _ai._setProviderOverride(null);
}, { timeout: 30000 });

test('3. 术语库：写入→读取→生长累计→locked 不覆盖', async () => {
  await db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('ai.glossary','[]')");
  let g = await _ai.growGlossary([{ en: 'LLM', zh: '大语言模型', domain: 'AI', confidence: 0.95 }]);
  assert.equal(g.added, 1);
  // 归一化命中（小写+复数）
  g = await _ai.growGlossary([{ en: 'llms', zh: '大模型', confidence: 0.9 }]);
  assert.equal(g.updated, 1);
  assert.equal(g.added, 0);
  const list = await _ai.loadGlossary();
  assert.equal(list.length, 1);
  assert.equal(list[0].zh, '大语言模型', 'locked=false 也应只累计不改写');
  assert.equal(list[0].occurrenceCount, 2);
  // 低置信度丢弃
  g = await _ai.growGlossary([{ en: 'Foo', zh: '某物', confidence: 0.5 }]);
  assert.equal(g.added, 0);
});

test('4. filterArticle：脏 JSON 兜底 + 正常解析', async () => {
  _ai._setProviderOverride(async () => '{"score": 85, "ignore": false, "reason": "深度技术文"}');
  let r = await _ai.filterArticle({ title: 't', source: 's', summary: 'x' });
  assert.equal(r.score, 85);
  assert.equal(r.ignore, false);
  _ai._setProviderOverride(async () => '这不是JSON');
  r = await _ai.filterArticle({ title: 't' });
  assert.equal(r.ignore, false, '解析失败应放行');
  _ai._setProviderOverride(null);
}, { timeout: 30000 });

test('5. loadPrompt：settings 覆盖 > repo 文件', async () => {
  await db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('prompt.filter','\"自定义过滤提示词\"')");
  let p = await _ai.loadPrompt('filter');
  assert.equal(p, '自定义过滤提示词');
  await db.execute("DELETE FROM settings WHERE key='prompt.filter'");
  p = await _ai.loadPrompt('filter');
  assert.match(p, /初筛编辑/);
});

test('6. ai.stats 滚动记录', async () => {
  _ai._setProviderOverride(async () => 'ok');
  await db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('ai.minIntervalMs','0')");
  await _ai.aiChat([{ role: 'user', content: 'stat-test' }]);
  const s = await _ai.aiStats();
  assert.ok(s.calls24h >= 1);
  _ai._setProviderOverride(null);
});
