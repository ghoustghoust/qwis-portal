// H13 / B21（P2-7）：我的早报期号与归档——同日重跑原地替换、新日 max+1、空态不占期号
'use strict';
require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runDriver } = require('./driver-runner');

const ROOT = path.join(__dirname, '..');

test('HA1 resolveMyBriefIssue：同日替换期号不变 / 新日 max+1 / 空归档从 1 起（H13）', () => {
  const { resolveMyBriefIssue } = require('../lib/brief-guards');
  assert.deepEqual(resolveMyBriefIssue([], '2026-09-22'), { issue: 1, replaceIndex: -1 });
  const arch = [{ issue: 1, date: '2026-09-20' }, { issue: 2, date: '2026-09-21' }];
  assert.deepEqual(resolveMyBriefIssue(arch, '2026-09-21'), { issue: 2, replaceIndex: 1 },
    '同日重跑必须原地替换（修码重跑不另算新期）');
  assert.deepEqual(resolveMyBriefIssue(arch, '2026-09-22'), { issue: 3, replaceIndex: -1 });
  assert.deepEqual(resolveMyBriefIssue([{ issue: 9, date: '2026-09-01' }], '2026-09-22'), { issue: 10, replaceIndex: -1 },
    '断档接续按 max+1，不按 length+1');
});

test('HA2 runner：写 latest 时同步维护 mybrief.archive 且 issue 进 report（源码形态）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'collect-turso.js'), 'utf8');
  assert.ok(src.includes("VALUES('mybrief.archive'"), 'runner 没写 mybrief.archive');
  assert.ok(src.includes('resolveMyBriefIssue'), 'runner 没走唯一期号解析');
  assert.ok(/issue:\s*issueInfo\.issue/.test(src), 'report 没带 issue');
});

test('HA3 /api/mybrief/archive：期号倒序列表 + 在公开白名单（H13）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha3-'));
  const DRIVER = path.join(ROOT, `.mb-archive-driver-${process.pid}.cjs`);
  fs.writeFileSync(DRIVER, `
process.env.TURSO_DATABASE_URL = 'file:' + process.argv[2].replace(/\\\\/g, '/');
process.env.TURSO_AUTH_TOKEN = '';
const db = require(${JSON.stringify(path.join(ROOT, 'lib', 'db.js'))});
const handler = require(${JSON.stringify(path.join(ROOT, 'api', '[...slug].js'))});
(async () => {
  await db.ensureSchema();
  await db.setSetting('mybrief.archive', [
    { issue: 1, date: '2026-09-20', generatedAt: '2026-09-20T13:00Z', theme: '第一天', sections: { top: [1], featured: [], rest: [1, 2] } },
    { issue: 2, date: '2026-09-21', generatedAt: '2026-09-21T13:00Z', theme: '第二天', sections: { top: [1, 2], featured: [3], rest: [] } },
  ]);
  const res = { _s: 200, _b: null };
  res.setHeader = () => res; res.status = (s) => { res._s = s; return res; };
  res.json = (b) => { res._b = b; return res; }; res.send = (b) => { res._b = b; return res; }; res.end = () => res;
  await handler({ method: 'GET', url: '/api/mybrief/archive', query: {}, headers: {} }, res);
  console.log('OUT ' + JSON.stringify(res._b));
  process.exit(0);
})().catch((e) => { console.error('DRIVERERR ' + e.message); process.exit(3); });
`);
  try {
    const out = runDriver(DRIVER, [path.join(dir, 't.db')], { payloadRe: /^OUT /m });
    const body = JSON.parse(/^OUT (.+)$/m.exec(out)[1]);
    assert.equal(body.ok, true, JSON.stringify(body).slice(0, 200));
    assert.deepEqual(body.issues.map((x) => x.issue), [2, 1], '必须期号倒序');
    assert.equal(body.issues[0].theme, '第二天');
    assert.deepEqual(body.issues[0].counts, { top: 2, featured: 1, rest: 0 });
    const src = fs.readFileSync(path.join(ROOT, 'api', '[...slug].js'), 'utf8');
    assert.ok(/'\/api\/mybrief\/archive'/.test(src), '路由没注册');
    assert.ok(/PUBLIC_GET_PATHS[\s\S]*?mybrief\/archive/.test(src) || src.includes(`'/api/mybrief/archive', '/api/weekly'`), '不在公开白名单（前端无 token 读不到）');
  } finally {
    try { fs.rmSync(DRIVER, { force: true }); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

test('HA4 页面：期号显示 + 往期早报列表 + 懒加载（B21 可见面）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'web', 'src', 'pages', 'MyBriefPage.jsx'), 'utf8');
  assert.ok(/第 \$\{report\.issue\} 期/.test(src), '页头没显示期号');
  assert.ok(src.includes('往期早报') && src.includes('/api/mybrief/archive'), '归档列表没接');
  assert.ok(!/archive\.slice\(0, 30\)\.map/.test(src) || src.includes('loadArchive'), '归档不是懒加载（首屏白白多一次请求）');
});

test('HA5 日报期号：读时按北京日去重计数 + 页头显示（B21）', () => {
  const api = fs.readFileSync(path.join(ROOT, 'api', '[...slug].js'), 'utf8');
  assert.ok(api.includes('dailyIssueOf'), 'handleDaily 没算期号');
  assert.ok(/COUNT\(DISTINCT substr\(generated_at,1,10\)\)/.test(api), '期号口径不是「有报告的北京日去重计数」（裸 id 混非 AI 批次不能当期号）');
  const hdr = fs.readFileSync(path.join(ROOT, 'web', 'src', 'components', 'DailyHeader.jsx'), 'utf8');
  assert.ok(hdr.includes('第 ${report.issue} 期'), '页头没带期号');
});
