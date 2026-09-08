// 门户同步 Job（重构 Phase 3 从 scheduler/index.js 提取）
// 职责：定时将本地数据同步到 Vercel Portal（只读门户）
// 2026-09-05b A4 修复：sync-portal 内含分钟级 execSync（vercel build/deploy），
// 直接 require.run() 会同步阻塞 Express 事件循环数分钟；改为 spawn 独立子进程（detached+unref），
// in-flight 守卫防止上一轮未结束时叠加

const path = require('path');
const { spawn } = require('child_process');
const log = require('../../../util/log');

let inFlight = false;

function runPortalSync() {
  if (inFlight) {
    log.warn('[门户同步] 上一轮仍在进行，本次跳过');
    return;
  }
  inFlight = true;
  try {
    const script = path.join(__dirname, '..', '..', '..', '..', 'tools', 'sync-portal.js');
    const child = spawn(process.execPath, [script], { detached: true, stdio: 'ignore' });
    child.unref();
    child.on('error', (err) => { inFlight = false; log.warn('[门户同步] 子进程启动失败:', err.message); });
    child.on('exit', (code) => { inFlight = false; if (code !== 0) log.warn(`[门户同步] 子进程退出码 ${code}`); });
    log.info('[门户同步] 已异步启动子进程');
  } catch (err) {
    inFlight = false;
    log.warn('[门户同步] 启动失败:', err.message);
  }
}

module.exports = { runPortalSync };
