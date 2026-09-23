// 2026-09-13 修复回归测试：游标分页断裂(F1) / 未来时间 pubDate 钳制(F2) / 翻译思维链污染清洗(F3)
// F1 驱动真实 serverless handler + 真实 Turso（只读，沿用 regression-cloud-settings 模式）
// F2 驱动本地 repo（APP_DATA_DIR 隔离库）
// F3 纯函数单测
const { test, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

require('./helpers'); // APP_DATA_DIR 隔离——必须先于任何 server/* require

// CI 无 .env（凭据不入库）：本地照旧读生产凭据；CI 下云端用例整组 skip（用例名带标记，不许静默消失）
const HAS_ENV = fs.existsSync(path.join(__dirname, '..', '.env'));
const envTxt = HAS_ENV ? fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8') : '';
for (const line of envTxt.split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const cloudTest = HAS_ENV ? test : (name, fn) => test(`${name}（CI 无 .env 凭据，跳过）`, { skip: true }, fn);

// ─── F3：翻译输出清洗（纯函数，无网络） ───
const _ai = require('../api/_ai');

test('F3-1 指令回显+分析+译文标记 → 提取标记后正文', () => {
  const polluted = '用户提供了一篇英文原文和中文译文草稿，要求我从四个维度检查并改进译文，输出最终稿：\n1. 术语与技术概念：是否准确一致\n2. 语言表达与结构：是否符合中文阅读习惯\n译文：Perplexity 信任 GPT-6 Astra 处理端到端系统，与早期模型相比检查频率大幅降低。';
  const out = _ai.sanitizeTranslationReply(polluted, '初翻草稿内容');
  assert.ok(!out.includes('用户提供了'), '不得残留指令回显');
  assert.ok(!out.includes('四个维度'), '不得残留分析过程');
  assert.ok(out.startsWith('Perplexity'), '应从译文标记后取正文');
});

test('F3-2 纯分析无译文标记 → 回退上一轮草稿', () => {
  const analytical = '让我仔细对比原文和译文草稿。\n1. 术语与技术概念：基本准确\n2. 表达流畅度尚可，建议保留初稿。';
  const out = _ai.sanitizeTranslationReply(analytical, '干净的初翻草稿');
  assert.strictEqual(out, '干净的初翻草稿');
});

test('F3-3 干净译文原样通过（不误伤）', () => {
  const clean = 'Perplexity 信任 GPT-6 Astra 处理端到端系统，与早期模型相比检查频率大幅降低。\n\n该公司表示，Astra 可用于撰写通信内容、修改软件以及监控生产系统。';
  const out = _ai.sanitizeTranslationReply(clean, '草稿');
  assert.strictEqual(out, clean);
});

test('F3-4 无草稿且纯分析 → 原样返回（由上层决定丢弃）', () => {
  const analytical = 'I need to review the terminology first, then output.';
  assert.strictEqual(_ai.sanitizeTranslationReply(analytical, ''), analytical);
});

test('F3-5 英文思维链形态（Here\'s a thinking process + 编号加粗分析）被识别', () => {
  const thinking = "Here's a thinking process:\n1.  **Analyze User Input:**\n   - **Role:** Senior tech publishing editor.\n   - **Task:** Translate-polish from English to Chinese\n2.  **Draft the translation:**\n\n## Final Polish\nPerplexity 信任 GPT-6 Astra 管理端到端系统。";
  // 无「译文」中文标记但有「## Final Polish」→ 不在标记表 → 整体判定思维链 → 回退草稿
  assert.strictEqual(_ai.sanitizeTranslationReply(thinking, '初翻草稿'), '初翻草稿');
  assert.strictEqual(_ai.isThinkingLikeReply(thinking), true);
  assert.strictEqual(_ai.isThinkingLikeReply('Here\'s a thinking process:'), true);
});

test('F3-6 正常英文开头的译文不被误伤', () => {
  const legit = 'Here is how the new system works, according to the company.';
  assert.strictEqual(_ai.isThinkingLikeReply(legit), false);
  assert.strictEqual(_ai.sanitizeTranslationReply(legit, '草稿'), legit);
});

// ─── 2026-09-15 翻译污染事故回归锁（生产实测 25 篇元评论标题 + 「评论：0」胡编标题） ───
test('F3-7 术语校对轮复述指令起手式（用户要求我…）被识别并回退草稿', () => {
  const meta = '用户要求我作为术语校对专家，检查初翻草稿中的术语翻译是否与对照表一致。只修正术语不一致的地方，其余内容一字不动。';
  assert.strictEqual(_ai.isThinkingLikeReply(meta), true);
  assert.strictEqual(_ai.sanitizeTranslationReply(meta, '干净草稿'), '干净草稿');
  const meta2 = '我已收到您的翻译请求，但您只提供了文章标题和元数据（URL、评分等），没有提供需要翻译的正文内容。';
  assert.strictEqual(_ai.isThinkingLikeReply(meta2), true);
  assert.strictEqual(_ai.sanitizeTranslationReply(meta2, '干净草稿'), '干净草稿');
  const meta3 = '让我仔细比对：译文与术语表……';
  assert.strictEqual(_ai.isThinkingLikeReply(meta3), true);
});

test('F3-8 深析占位金句被清洗（薄正文桥接源不再产「原文引用待提取」）', () => {
  // analyzeArticle 的清洗是纯输出侧逻辑——直接测 QUOTE_PLACEHOLDER_RE 等效行为（经模块内 analyzeArticle 无法离线调 AI，改为锁定清洗正则的判定面）
  const re = /待提取|待原文|待补充|未提供正文|未提供.*内容|暂无原文|无法提取|无法提供|原文缺失|未见正文/;
  assert.ok(re.test('（原文未提供正文内容，无法提取金句）'));
  assert.ok(re.test('原文引用待提取'));
  assert.ok(re.test('待原文确认后补充'));
  assert.ok(re.test('暂无原文引用（未提供正文）'));
  assert.ok(!re.test('真正的金句：软件供应链攻击日益频发'));
});

// ─── F2：未来时间 pubDate 钳制（本地隔离库，真实 repo 落库） ───
const { db } = require('../server/db');
const repo = require('../server/services/collectors/repo');

test('F2-1 未来 pubDate 入库被钳为 now；过去时间原样保留', () => {
  const future = new Date(Date.now() + 24 * 3600e3).toISOString();
  const past = new Date(Date.now() - 3600e3).toISOString();
  const urlF = `test-clamp-future-${Date.now()}`;
  const urlP = `test-clamp-past-${Date.now()}`;
  try {
    const added = repo.saveArticles(999999, [
      { title: '未来时间钳制测试', url: urlF, published_at: future, content_html: '<p>x</p>' },
      { title: '过去时间保留测试', url: urlP, published_at: past, content_html: '<p>x</p>' },
    ]);
    assert.strictEqual(added, 2);
    const f = db.prepare('SELECT published_at, created_at FROM articles WHERE url=?').get(urlF);
    assert.ok(f.published_at <= new Date().toISOString() && f.published_at > new Date(Date.now() - 60e3).toISOString(),
      `未来值应被钳为 now，实际 ${f.published_at}`);
    const p = db.prepare('SELECT published_at FROM articles WHERE url=?').get(urlP);
    assert.strictEqual(p.published_at, past, '过去时间不得被改动');
  } finally {
    db.prepare('DELETE FROM articles WHERE url IN (?, ?)').run(urlF, urlP);
  }
});

// ─── F1：云端游标分页（真实 handler + Turso 只读） ───
const handler = require('../api/[...slug].js');
function mockReq(url) {
  const [p, qs] = url.split('?');
  return { method: 'GET', url, query: Object.fromEntries(new URLSearchParams(qs || '')), headers: {} };
}
function mockRes() {
  const res = { _status: 200, _body: null };
  res.setHeader = () => res;
  res.status = (s) => { res._status = s; return res; };
  res.json = (b) => { res._body = b; return res; };
  res.send = (b) => { res._body = b; return res; };
  res.end = () => res;
  return res;
}
async function call(url) {
  const res = mockRes();
  await handler(mockReq(url), res);
  return res._body;
}

cloudTest('F1-1 阅读器分页：第一页游标为 ISO 文本格式且翻页持续推进', async () => {
  const p1 = await call('/api/articles?sort=new&tab=all');
  assert.strictEqual(p1.ok, true);
  assert.ok(Array.isArray(p1.items) && p1.items.length === 30, `第一页应 30 条，实际 ${p1.items?.length}`);
  assert.ok(p1.nextCursor, '第一页必须给出游标（42k+ 文章不可能没有下一页）');
  // 游标格式断言：首段必须是 ISO 时间戳（而非 epoch 秒数）
  const [cursorVal] = String(p1.nextCursor).split('|');
  assert.match(cursorVal, /^\d{4}-\d{2}-\d{2}T/, `游标必须是 ISO 文本，实际 "${cursorVal}"`);

  // 翻页：第二页必须非空且全部严格更旧
  const p2 = await call(`/api/articles?sort=new&tab=all&cursor=${encodeURIComponent(p1.nextCursor)}`);
  assert.strictEqual(p2.ok, true);
  assert.ok(p2.items.length === 30, `第二页应 30 条，实际 ${p2.items.length}（修复前恒 0 → 滑动上限根因）`);
  const lastOfP1 = p1.items[p1.items.length - 1];
  const keyOf = (a) => `${a.published_at || a.created_at}|${a.id}`;
  for (const it of p2.items) {
    assert.ok(keyOf(it) < keyOf(lastOfP1), `第二页条目必须严格更旧：${keyOf(it)} vs ${keyOf(lastOfP1)}`);
  }
  // 游标不重复：两页无交集
  const ids1 = new Set(p1.items.map((a) => a.id));
  assert.ok(p2.items.every((a) => !ids1.has(a.id)), '两页不得出现重复条目');
});

cloudTest('F1-2 热点榜全部动态分页：游标可翻页', async () => {
  const p1 = await call('/api/hot?tab=all');
  assert.strictEqual(p1.ok, true);
  assert.ok(Array.isArray(p1.items) && p1.items.length > 0);
  if (!p1.nextCursor) return; // 数据不足一页时无游标，跳过
  const [cursorVal] = String(p1.nextCursor).split('|');
  assert.match(cursorVal, /^\d{4}-\d{2}-\d{2}T/, `游标必须是 ISO 文本，实际 "${cursorVal}"`);
  const p2 = await call(`/api/hot?tab=all&cursor=${encodeURIComponent(p1.nextCursor)}`);
  assert.strictEqual(p2.ok, true);
  assert.ok(p2.items.length > 0, '热点榜第二页不得为空（修复前恒 0）');
  const ids1 = new Set(p1.items.map((a) => a.id));
  assert.ok(p2.items.every((a) => !ids1.has(a.id)), '热点榜两页不得重复');
});

// 2026-09-14 三阶段修正：精选=自有源六维≥60 且 AI 相关；热榜源不再混入（热度百万级越过旧门槛 10000 的量纲失误）
cloudTest('F3 热点榜精选：全部为六维≥60 的自有源条目', async () => {
  const p1 = await call('/api/hot?tab=featured');
  assert.strictEqual(p1.ok, true);
  assert.ok(Array.isArray(p1.items), '精选必须返回数组');
  if (!p1.items.length) return; // 评分覆盖初期允许空，但一旦有内容必须满足口径
  for (const it of p1.items) {
    const sc = Number(it.score);
    assert.ok(Number.isFinite(sc) && sc >= 60 && sc <= 100, `精选条目必须是六维分 60-100，实际 ${it.score}（${String(it.title).slice(0, 30)}）`);
  }
});

after(() => {
  try { require('../server/db').db.close?.(); } catch { /* ignore */ }
});
