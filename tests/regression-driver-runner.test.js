// B105（P0-1）：scratch 驱动族「退出段崩（0xC0000005）但载荷正确」不再翻红；真红不许被吞、不许只剩裸 "Command failed"
// 判据本体：tests/driver-runner.js（runDriver）
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runDriver } = require('./driver-runner');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'drv-runner-'));
const mk = (name, body) => { const p = path.join(TMP, name); fs.writeFileSync(p, body); return p; };

test('DR1 正常退出：返回 stdout 原样（B105）', () => {
  const d = mk('ok.cjs', `console.log('OUT {"a":1}'); process.exit(0);`);
  const out = runDriver(d, [], { payloadRe: /^OUT /m });
  assert.match(out, /OUT \{"a":1\}/);
});

test('DR2 B105 形状：载荷打出后退出码非 0 → 不抛、载荷可用（退出码与载荷分别判）', () => {
  const d = mk('crash-after.cjs', `console.log('OUT {"a":1}'); process.exit(3);`);
  const out = runDriver(d, [], { payloadRe: /^OUT /m });
  assert.match(out, /OUT \{"a":1\}/);
});

test('DR3 真红不许伪装：无载荷且退出非 0 → 抛，错误里必须带 status 与 stderr 尾（B105）', () => {
  const d = mk('die.cjs', `console.error('BOOM-原因'); process.exit(3);`);
  assert.throws(() => runDriver(d, [], { payloadRe: /^OUT /m }), (e) => {
    assert.match(e.message, /status=3/, '错误里没带退出码');
    assert.match(e.message, /BOOM-原因/, '错误里没带 stderr 尾行');
    return true;
  });
});

test('DR4 脚本不存在 → 抛且带 status（node 报 Cannot find module 进 stderr）', () => {
  assert.throws(() => runDriver(path.join(TMP, 'no-such.cjs'), [], { payloadRe: /^OUT /m }),
    (e) => /status=1/.test(e.message) && /Cannot find module/.test(e.message));
});

test('DR5 反向：没配 payloadRe 时「空输出 + 非 0 退出」也必须抛（不许写成永远放行的恒绿口径）', () => {
  const d = mk('silent-die.cjs', `process.exit(9);`);
  assert.throws(() => runDriver(d, []), /status=9/);
});
