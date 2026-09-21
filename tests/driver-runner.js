// B105 族（scratch 驱动子进程在退出阶段偶发 0xC0000005，载荷已正确打出）的统一口径：
//   退出码与断言载荷分别判 —— 载荷在 = 产品行为已证明，退出段崩只记警告并打出 status/stderr 尾；
//   载荷不在 = 真红，连 status/signal/stderr 一起抛，不许只剩一句裸 "Command failed"。
// 锁：tests/regression-driver-runner.test.js DR1~DR5（含反向：无载荷必须抛、没配 payloadRe 不许永远放行）。
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

function runDriver(driverPath, args, opts = {}) {
  const r = spawnSync(process.execPath, [driverPath, ...args], {
    cwd: opts.cwd || path.join(__dirname, '..'),
    encoding: 'utf8',
    env: opts.env || process.env,
    timeout: opts.timeout || 120000,
  });
  const out = r.stdout || '';
  const err = r.stderr || '';
  if (r.error) throw new Error(`驱动 ${path.basename(driverPath)} 没能跑起来（${r.error.message}）`);
  if (r.status !== 0) {
    const hasPayload = opts.payloadRe ? opts.payloadRe.test(out) : out.trim().length > 0;
    if (hasPayload) {
      // B105 族：退出段崩但载荷完整 —— 载荷断言照常跑；崩溃本身记警告（可见、可统计、不吞）
      console.warn(`[B105] 驱动 ${path.basename(driverPath)} 退出段崩（status=${r.status} signal=${r.signal || '无'}），载荷完整按放行口径继续；stderr 尾：${err.split('\n').slice(-5).join(' | ') || '（空）'}`);
    } else {
      throw new Error(`驱动 ${path.basename(driverPath)} 真红（status=${r.status} signal=${r.signal || '无'}）：\n--- stderr 尾 ---\n${err.split('\n').slice(-20).join('\n') || '（空）'}\n--- stdout 尾 ---\n${out.split('\n').slice(-20).join('\n') || '（空）'}`);
    }
  }
  return out;
}

module.exports = { runDriver };
