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

test('R6 cleanup preview：视频恒 0 + 豁免语义（授权只读）', async () => {
  const d = await call('POST', '/api/data/cleanup/preview', { days: 7 });
  assert.strictEqual(d.status, 200);
  const wd = d.body?.willDelete || {};
  assert.equal(wd.videos, 0, '视频/播客不参与清理');
  assert.ok(typeof wd.articles === 'number' && wd.articles >= 0);
  assert.ok(d.body?.total >= wd.articles);
});
