// we-mp-rss 托管启动器（九期补丁）：情报系统启动时自动拉起公众号采集引擎
// 行为：8001 已在跑 → 跳过；否则 spawn 子进程（SECRET_KEY 注入、剥离代理环境变量、日志入 data/logs/wemp.log）
// 退出：父进程退出时连带杀掉子进程树（windows 下 taskkill /T，Linux/macOS 下 kill -9）
// 关闭托管：.env 加 WEMP_MANAGED=0
// 配置方式：通过环境变量设置 WEMP_HOME（默认值仅为本地开发方便，生产环境必须修改）
const { spawn, spawnSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const log = require('../util/log');

// P3: 跨平台兼容路径检测
const isWindows = process.platform === 'win32';
const PYTHON_VENV_BIN = isWindows ? '.venv\\Scripts\\python.exe' : '.venv/bin/python';
const WEMP_HOME = process.env.WEMP_HOME || (isWindows ? 'D:\\tools\\we-mp-rss' : '/opt/we-mp-rss');
const WEMP_PORT = Number(process.env.WEMP_PORT || 8001);

let child = null;
// P1-1：崩溃自动重启（指数退避 5s→10s→…→5min 封顶）；托管进程存活超 10min 视为健康，重置退避
let managed = false;        // 是否由本进程托管拉起（外部已跑的实例不负责重启）
let shuttingDown = false;   // 父进程退出中，不再重启
let restartAttempts = 0;
let lastSpawnAt = 0;
let restartTimer = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isUp() {
  try {
    const r = await fetch(`http://127.0.0.1:${WEMP_PORT}/`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

function killChild() {
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  if (!child || !child.pid) return;
  const pid = child.pid;
  child = null;
  try {
    // P2: spawnSync 同步阻塞——确保父进程 'exit' 钩子内 taskkill 真正执行完毕再退出。
    // 原 spawn 是异步的：'exit' 钩子同步返回后 taskkill 还没跑 → Python 子进程成孤儿（Windows 不随父进程终止子树）
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    log.info(`已停止托管的 we-mp-rss (PID ${pid})`);
  } catch { /* 尽力而为 */ }
}

async function start() {
  if (process.env.WEMP_MANAGED === '0') return;
  if (await isUp()) {
    log.info('we-mp-rss 已在运行，跳过托管启动');
    managed = false; // 外部实例：崩溃不由本进程负责重启（避免双重拉起）
    return;
  }
  const mainPy = path.join(WEMP_HOME, 'main.py');
  const pythonExe = path.join(WEMP_HOME, PYTHON_VENV_BIN);
  if (!fs.existsSync(mainPy)) {
    log.warn(`we-mp-rss 主程序不存在于 ${mainPy}，请确认安装路径（设置环境变量 WEMP_HOME）`);
    return;
  }
  if (!fs.existsSync(pythonExe)) {
    log.warn(`we-mp-rss Python 虚拟环境不存在于 ${pythonExe}`);
    log.warn(`提示：Linux 服务器请使用 Docker 部署：docker run -d -p 8001:8001 ghcr.io/xxx/we-mp-rss:latest`);
    return;
  }
  let secret = '';
  try {
    secret = fs.readFileSync(path.join(WEMP_HOME, 'data', '.secret_key'), 'utf8').trim();
  } catch { /* 首次运行由 we-mp-rss 自己生成 */ }

  // 子进程剥离代理环境变量：weread.qq.com 等国内接口走代理反而会被风控/失败
  const childEnv = { ...process.env, NO_PROXY: '*', no_proxy: '*' };
  for (const k of Object.keys(childEnv)) {
    if (/^(https?_proxy|all_proxy)$/i.test(k)) delete childEnv[k];
  }
  // P2-2 修复：强制 Python 子进程 stdout/默认文件编码为 UTF-8
  // Windows 中文 locale 下 Python stdout 默认 GBK，抓到的微信正文含 emoji（如 🧠 U+1F9E0）被 print 时
  // 触发 'gbk' codec can't encode → 正文抓取连续失败 status=5/has_content=0（feed 只剩摘要的根因之一）
  childEnv.PYTHONUTF8 = '1';
  childEnv.PYTHONIOENCODING = 'utf-8';
  // 剥离主系统的 PORT:we-mp-rss 的 config.yaml 是 `port: ${PORT:-8001}`,
  // 继承 PORT=3000 会让它抢主系统端口(Windows 允许同端口双绑,表现为 8001 永远不起)
  delete childEnv.PORT;
  if (secret) childEnv.SECRET_KEY = secret;

  const logDir = path.join(__dirname, '..', '..', 'data', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFd = fs.openSync(path.join(logDir, 'wemp.log'), 'a');

  child = spawn(pythonExe, ['main.py', '-job', 'True', '-init', 'True'], {
    cwd: WEMP_HOME,
    env: childEnv,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });
  managed = true;
  lastSpawnAt = Date.now();

  child.on('exit', (code) => {
    log.warn(`we-mp-rss 进程退出 code=${code}（日志:data/logs/wemp.log）`);
    child = null;
    try { fs.closeSync(logFd); } catch { /* fd 已关闭 */ } // P3: 关闭日志 fd，避免反复自愈重启泄漏文件描述符
    if (!managed || shuttingDown || process.env.WEMP_MANAGED === '0') return;
    // 存活超 10min 视为健康运行过，重置退避计数
    if (Date.now() - lastSpawnAt > 10 * 60e3) restartAttempts = 0;
    restartAttempts += 1;
    const delayMs = Math.min(5000 * Math.pow(2, restartAttempts - 1), 5 * 60e3);
    log.warn(`[托管自愈] ${Math.round(delayMs / 1000)}s 后第 ${restartAttempts} 次尝试重启 we-mp-rss…`);
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(async () => {
      restartTimer = null;
      if (shuttingDown) return;
      try {
        if (await isUp()) { log.info('[托管自愈] 端口 8001 已恢复（外部拉起），跳过重启'); managed = false; return; }
        await start();
      } catch (err) {
        log.error('[托管自愈] 重启失败:', err.message);
      }
    }, delayMs);
  });
  log.info('we-mp-rss 托管启动中…');

  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    if (await isUp()) {
      log.info('we-mp-rss 已就绪（公众号采集引擎在线）');
      return;
    }
    if (!child) return; // 已退出（exit 钩子会安排退避重启，此处不阻塞等待）
  }
  log.warn('we-mp-rss 60s 内未就绪（可能仍在初始化，稍后自动可用）');
}

// 父进程退出时连带清理（先置 shuttingDown，避免退出过程中触发自愈重启）
process.once('exit', killChild);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => { shuttingDown = true; killChild(); process.exit(0); });
}

module.exports = { start, isUp };
