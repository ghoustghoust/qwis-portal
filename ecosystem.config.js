// PM2 进程守护配置（宝塔/服务器部署用）
// 用法: pm2 start ecosystem.config.js && pm2 save && pm2 startup
// 文档: docs/DEPLOYMENT.md「Linux 服务器部署」章节
const path = require('path');

// 项目根目录（ecosystem.config.js 所在目录）
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data', 'logs');

module.exports = {
  apps: [
    {
      name: 'qwis-server',
      script: 'server/index.js',
      cwd: ROOT,
      instances: 1,           // better-sqlite3 单进程锁，不可 cluster
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // ── 崩溃自动重启 ──
      autorestart: true,
      watch: false,             // 生产环境不开 watch
      max_memory_restart: '512M',  // 内存泄漏保护
      restart_delay: 3000,      // 崩溃后等 3 秒再重启，防雪崩
      exp_backoff_restart_delay: 100, // 指数退避
      kill_timeout: 10000,      // 优雅关闭等待（让 SQLite 完成写入）
      // ── 日志 ──
      error_file: path.join(DATA_DIR, 'qwis-error.log'),
      out_file: path.join(DATA_DIR, 'qwis-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
