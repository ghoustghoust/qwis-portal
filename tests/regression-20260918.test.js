// 2026-09-18 对抗性修复回归测试：周刊归档删除路由 / 读层日报选取守卫接线
// 纪律：只读断言，不改生产 settings 内容（删除用例打一个不存在的期号，只验路由可达性）
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
for (const line of envTxt.split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const handler = require('../api/[...slug].js');
const jwt = require('jsonwebtoken');
const TOKEN = jwt.sign({ sub: 'admin', role: 'admin' }, process.env.AUTH_SECRET || 'dev-secret');

function mockRes() {
  const res = { _status: 200, _body: null };
  res.setHeader = () => res; res.status = (s) => { res._status = s; return res; };
  res.json = (b) => { res._body = b; return res; }; res.send = (b) => { res._body = b; return res; }; res.end = () => res;
  return res;
}
async function call(method, url) {
  const res = mockRes();
  await handler({ method, url, query: {}, body: {}, headers: { authorization: 'Bearer ' + TOKEN } }, res);
  return { status: res._status, body: res._body || {} };
}

// 事故：`if (weeklyDelMatch && method === 'DELETE')` 被写在 :2773 的 `if (method === 'GET')` 块内，
// DELETE 请求永远落不到它，一路掉到末尾的 404 Not Found —— T3-2 R1「归档删除」从未真正上线过。
test('1. DELETE /api/weekly/archive/:issue 路由可达（不再是兜底 404 Not Found）', async () => {
  const r = await call('DELETE', '/api/weekly/archive/999999');
  const msg = String(r.body.error || '');
  assert.ok(
    !/^Not Found$/i.test(msg),
    `路由不可达：拿到通用 404 "Not Found"，说明 DELETE 分支仍在 GET 块内（实际: ${msg}）`,
  );
  // 期号不存在时 handler 自己会返回 404 + 「期号不存在」——这才证明真的进了 handleWeeklyArchiveDelete
  assert.equal(r.status, 404);
  assert.match(msg, /期号不存在|不存在/);
});

test('2. GET /api/weekly 仍正常（改动未破坏公开读路径）', async () => {
  const r = await call('GET', '/api/weekly');
  assert.ok(r.body.ok || r.body.empty, '应返回报告或空态，而不是错误');
});

// 2026-09-18 线上对抗审查抓到的真根因：runner 里 qOne() 被调用 6 处却从未定义
// （只定义了 qAll/qRun）→ 每次 ReferenceError 都被上层 try/catch 吞成一行日志。
// 直接后果：① reading.digest 从未生成（我的早报「阅读足迹」永久缺失）；
// ②daily-ai 视频计数恒 0；③collect 报警块在「少量失败」分支抛错后，
//   同 try 内的「停滞检测 collectStalled」被整体跳过——正是"停摆无人发现"的成因。
test('3. runner 不得调用未定义的 q* 查询助手（qOne ReferenceError 事故回归锁）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'collect-turso.js'), 'utf8');
  const defined = new Set([...src.matchAll(/(?:async\s+)?function\s+(q[A-Z]\w*)\s*\(/g)].map((m) => m[1]));
  const called = new Set([...src.matchAll(/(?<![.\w])(q[A-Z]\w*)\s*\(/g)].map((m) => m[1]));
  const missing = [...called].filter((n) => !defined.has(n));
  assert.deepEqual(missing, [], `runner 调用了未定义的查询助手: ${missing.join(', ')}（会以 ReferenceError 被 try/catch 静默吞掉）`);
  assert.ok(defined.has('qAll') && defined.has('qRun'), 'qAll/qRun 必须仍定义');
});

test('4. qOne 语义：单行对象、无结果返回 null（.c 类调用点依赖此契约）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'collect-turso.js'), 'utf8');
  const body = /async function qOne\s*\([\s\S]*?\n}/.exec(src);
  assert.ok(body, 'qOne 必须存在');
  assert.match(body[0], /rows\[0\]/, 'qOne 必须取首行');
  assert.match(body[0], /\|\|\s*null/, 'qOne 空结果必须返回 null 而非 undefined');
  assert.ok(
    src.indexOf('async function qAll') < src.indexOf('async function qOne')
    && src.indexOf('async function qOne') < src.indexOf('async function qRun'),
    'qOne 应与 qAll/qRun 同区定义（三个查询助手不许分两处）',
  );
});
