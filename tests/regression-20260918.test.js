// 2026-09-18 对抗性修复回归测试（静态面）：runner 查询助手 / _rawChat 正文契约
//
// 本文件原有两条**打生产 Turso** 的用例（`DELETE /api/weekly/archive/999999` 带真 Bearer token、
// `GET /api/weekly`），已于 09-21 按 B117 搬走：
//   → `tests/regression-cloud-writes-isolated.test.js` W-1~W-6（本地 libsql 文件库 + 正负两条行为断言）。
// 搬走的理由不是"它们删了东西"（实测没有：`handleWeeklyArchiveDelete` 在读到不存在的期号时先 return 404，
// `setSetting` 在其后），而是**安全性押在"999999 这个期号恰好不存在"的夹具选择上，而不是押在隔离上**，
// 且一条打生产的 DELETE 换来的信息只有"路由可达"。原规格在 43 号 spec §六（09-23 该批 spec 已作废删除，锚点见 docs/ISSUES.md）。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

// 2026-09-18 线上对抗审查抓到的真根因：runner 里 qOne() 被调用 6 处却从未定义
// （只定义了 qAll/qRun）→ 每次 ReferenceError 都被上层 try/catch 吞成一行日志。
// 直接后果：① reading.digest 从未生成（我的早报「阅读足迹」永久缺失）；
// ②daily-ai 视频计数恒 0；③collect 报警块在「少量失败」分支抛错后，
//   同 try 内的「停滞检测 collectStalled」被整体跳过——正是"停摆无人发现"的成因。
test('3. runner 不得调用未定义的 q* 查询助手（qOne ReferenceError 事故回归锁）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'collect-turso.js'), 'utf8');
  const defined = new Set([...src.matchAll(/(?:async\s+)?function\s+(q[A-Z]\w*)\s*\(/g)].map((m) => m[1]));
  const called = new Set([...src.matchAll(/(?<![.\w])(q[A-Z]\w*)\s*\(/g)].map((m) => m[1]));
  const missing = [...called].filter((n) => !defined.has(n));
  assert.deepEqual(missing, [], `runner 调用了未定义的查询助手: ${missing.join(', ')}（会以 ReferenceError 被 try/catch 静默吞掉）`);
  assert.ok(defined.has('qAll') && defined.has('qRun'), 'qAll/qRun 必须仍定义');
});

test('4. qOne 语义：单行对象、无结果返回 null（.c 类调用点依赖此契约）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'collect-turso.js'), 'utf8');
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

test('5. _rawChat 不得把 reasoning_content 当作回复返回（周刊杂志/导语污染的共同根因）', () => {
  // 线上实锤（本轮 mode=weekly 日志）：
  //   [weekly] 杂志结构放弃：回复里没有 JSON 对象（前 80 字：The user wants me to organize 20 items…）
  // 那段英文是 reasoning_content。旧代码 `msg.content || msg.reasoning_content` 在模型
  // 只出思考不出正文时，把思维链直接当成"AI 的回答"交给下游——generateTheme 于是收到
  // 「我需要找到贯穿这些文章的核心主线。」「19-20: 日本加息对全球资金影响。」这类自述/大纲碎片。
  // 清洗器在下游捞不如上游断：必须抛错让 aiChat 记为调用失败。
  const src = fs.readFileSync(path.join(ROOT, 'api', '_ai.js'), 'utf8');
  const fn = /async function _rawChat[\s\S]*?\n}/.exec(src);
  assert.ok(fn, '_rawChat 必须存在');
  assert.ok(
    !/msg\.content\s*\|\|\s*msg\.reasoning_content/.test(fn[0]),
    '禁止 `msg.content || msg.reasoning_content`——思维链不得冒充正文',
  );
  assert.match(fn[0], /reasoning_content/, 'reasoning_content 仍需被识别（用于报错信息）');
  assert.ok(
    /throw new Error\([^)]*仅含/.test(fn[0]),
    '只有 reasoning 没有 content 时必须抛错，而不是静默采纳',
  );
});
