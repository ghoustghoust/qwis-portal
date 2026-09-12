// 18-daily-ai-v2 回归测试：深析解析/窗口计算/降级判定/主题透出
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
for (const line of envTxt.split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
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

test('4. 窗口计算：北京自然日边界', () => {
  // 复现 runDailyAi 的窗口算法
  const bjOffset = 8 * 3600e3;
  const bjNow = new Date(Date.now() + bjOffset);
  const todayStart = new Date(bjNow); todayStart.setUTCHours(0, 0, 0, 0);
  const startUtc = new Date(todayStart.getTime() - 24 * 3600e3 - bjOffset).toISOString();
  const endUtc = new Date(todayStart.getTime() - bjOffset).toISOString();
  assert.equal(new Date(endUtc) - new Date(startUtc), 24 * 3600e3);
  // endUtc 应是北京今天 00:00
  const endBj = new Date(Date.parse(endUtc) + bjOffset);
  assert.equal(endBj.getUTCHours(), 0);
});
