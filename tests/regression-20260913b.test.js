// 2026-09-13 晚修复回归：reading 两段式边界（type 泄漏/搜索参数绑定/tab 白名单/cursor）/ OPML 导出 / cleanup 豁免
// 驱动真实 serverless handler + 真实 Turso（只读或带确认的预览，沿用 regression-cloud-settings 模式）
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
for (const line of envTxt.split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const handler = require('../api/[...slug].js');
const jwt = require('jsonwebtoken');
const TOKEN = jwt.sign({ sub: 'admin', role: 'admin' }, process.env.AUTH_SECRET || 'dev-secret');

function mockReq(method, url, body) {
  const [p, qs] = url.split('?');
  return {
    method, url,
    query: Object.fromEntries(new URLSearchParams(qs || '')),
    body,
    headers: { authorization: `Bearer ${TOKEN}` },
  };
}
function mockRes() {
  const res = { _status: 200, _body: null, _headers: {} };
  res.setHeader = (k, v) => { res._headers[k] = v; return res; };
  res.status = (s) => { res._status = s; return res; };
  res.json = (b) => { res._body = b; return res; };
  res.send = (b) => { res._body = b; return res; };
  res.end = () => res;
  return res;
}
async function call(method, url, body) {
  const res = mockRes();
  await handler(mockReq(method, url, body), res);
  return { status: res._status, body: res._body, headers: res._headers };
}

test('R1 reading type=video 不泄漏文章（快路径 type 检查）', async () => {
  const d = await call('GET', '/api/reading?type=video');
  const items = d.body?.items || [];
  // 库内收藏视频可为 0（返回空即正确），关键断言是无文章泄漏
  const leak = items.filter((i) => i.item_type !== 'video');
  assert.equal(leak.length, 0, `type=video 不得返回文章，泄漏 ${leak.length} 条`);
});

test('R2 reading q=AI 搜索有结果（OR 拆分分支参数完整绑定）', async () => {
  const d = await call('GET', '/api/reading?q=AI');
  assert.strictEqual(d.status, 200);
  assert.ok((d.body?.items || []).length > 0, `搜索应有结果（分支参数曾少绑 2 个导致 500/空），实得 ${d.body?.items?.length}`);
  assert.ok(d.body.items.every((i) => i.item_type === 'article'), '带 q 时全部为文章');
});

test('R3 reading tab 白名单：未知 tab 当 all 处理', async () => {
  const d = await call('GET', '/api/reading?tab=__unknown__');
  assert.strictEqual(d.status, 200);
  assert.ok((d.body?.items || []).length > 0, '未知 tab 应回退 all 而非空');
});

test('R4 reading 快路径 cursor 翻页不重复且递减', async () => {
  const p1 = await call('GET', '/api/reading?tab=all');
  const items1 = p1.body?.items || [];
  assert.strictEqual(items1.length, 30);
  const cur = p1.body?.nextCursor;
  assert.ok(cur, '应给出游标');
  const p2 = await call('GET', `/api/reading?tab=all&cursor=${encodeURIComponent(cur)}`);
  const items2 = p2.body?.items || [];
  assert.ok(items2.length > 0, '第二页不得为空');
  const ids1 = new Set(items1.map((i) => i.item_type + ':' + i.id));
  assert.ok(items2.every((i) => !ids1.has(i.item_type + ':' + i.id)), '两页不得重复');
  assert.ok(items2[0].sort_key <= cur, '第二页必须更旧');
});

test('R5 OPML 导出：结构/转义/分组嵌套', async () => {
  const d = await call('GET', '/api/opml/export');
  assert.strictEqual(d.status, 200);
  const xml = typeof d.body === 'string' ? d.body : String(d.body);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<opml version="2\.0">/);
  assert.ok(xml.includes('xmlUrl='), '应含源');
  assert.ok(!/text="[^"]*&(?!amp;|lt;|gt;|quot;|#)/.test(xml), '属性值不得有未转义裸 &');
  assert.match(d.headers['Content-Type'] || '', /xml/i);
  assert.match(d.headers['Content-Disposition'] || '', /attachment/);
});

// R6（`POST /api/data/cleanup/preview {days:7}` 直打生产）已按 B117 搬走 ——
// → `tests/regression-cloud-writes-isolated.test.js` W-5：在本地 libsql 文件库里种
//   「老未读 / 老已读 / 老稍后读 / 老精选 / 新未读 + 一条老视频」，先断言 preview 只数出 1 条，
//   再**真跑一次 cleanup**，断言存活的正是那四条豁免/窗口内的。原用例只断言"视频恒 0 + articles>=0"，
//   恒真且押在生产只读上；本文件其余用例全是 GET（读生产是可接受的取证方式）。

test('R7 周刊编辑综述：任务结构整段复述一票否决（specs/24 对抗案例）', async () => {
  const _ai2 = require('../api/_ai');
  // 实测污染形态：模型输出 "1. **Analyze User Input:** - **Role:** …" 任务结构
  _ai2._setProviderOverride(async () =>
    '1.  **Analyze User Input:**\n   - **Role:** Tech weekly editor-in-chief\n   - **Task:** Write a 500-700 word editorial review\n2.  **Draft the review:**\nSome content here.'
  );
  const r = await _ai2.generateWeeklyEditorNote([{ title: 'a', weeklyTheme: '其它', source: 's' }], [{ title: '主线', narrative: 'n', items: [{ id: 1, title: 'a' }, { id: 2, title: 'b' }] }]);
  assert.equal(r, null, '结构化输出应整段否决');
  // 干净综述通过
  _ai2._setProviderOverride(async () => '本期最值得关注的张力，来自AI能力对既有治理体系的持续冲击。胡塞武装用Claude Code编写导弹制导软件的案例首次将大模型被武器化的风险摆上台面，而对齐评估的反复击穿说明治理体系仍在补课。与此同时，算力基建竞赛白热化：互联网巨头大举借债扩建数据中心，欧洲则在讨论主权算力的独立路径。个体的注意力成了新的稀缺资源——从健身数据泄露到消费理性的回归，安全管理正在从组织层面渗透到每个人的日常。三条主线共同指向一个判断：能力越便宜，可托付与可验证就越昂贵。');
  const ok = await _ai2.generateWeeklyEditorNote([{ title: 'a', weeklyTheme: '其它', source: 's' }], [{ title: '主线', narrative: 'n', items: [{ id: 1, title: 'a' }, { id: 2, title: 'b' }] }]);
  assert.ok(ok && ok.length >= 200, '干净综述应通过');
  _ai2._setProviderOverride(null);
}, { timeout: 30000 });
