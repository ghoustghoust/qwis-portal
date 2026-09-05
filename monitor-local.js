// 本地挂机监控器 - 自动检测常见问题并记录
// 使用方法：node monitor-local.js (后台运行)
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'data', 'logs', 'monitor-log.txt');
const CHECK_INTERVAL = 5 * 60e3; // 每 5 分钟检查一次

// 初始化日志目录
const logDir = path.join(__dirname, 'data', 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(line.trim());
}

async function checkHealth() {
  try {
    const { db } = require('./server/db');
    
    // 1. 检查文章表健康度
    const articleCount = db.prepare("SELECT COUNT(*) AS c FROM articles").get().c;
    const shortContent = db.prepare(`
      SELECT COUNT(*) AS c FROM articles 
      WHERE LENGTH(content_html || '') < 1000 
        AND content_html IS NOT NULL
    `).get().c;
    
    log(`[健康检查] 文章总数：${articleCount}, 短内容待补抓：${shortContent}`);
    
    // 2. 检查数据库连接
    const sources = db.prepare("SELECT COUNT(*) AS c FROM sources WHERE enabled=1").get().c;
    log(`[健康检查] 启用源数：${sources}`);
    
    // 3. 检查 pending_items 队列
    const pendingEnrich = db.prepare(`
      SELECT COUNT(*) AS c FROM pending_items WHERE type='aihot_enrich'
    `).get().c;
    if (pendingEnrich > 0) {
      log(`[⚠️ 警告] pending_items 积压：${pendingEnrich}条`);
    }
    
    // 4. 检查最近错误日志
    const recentErrors = db.prepare(`
      SELECT COUNT(*) AS c FROM sources 
      WHERE status='error' AND fail_count >= 2
    `).get().c;
    if (recentErrors > 0) {
      log(`[⚠️ 警告] 连续失败 ≥2 次的源：${recentErrors}个`);
    }
    
    // （we-mp-rss 服务检测已随其退役移除，2026-09-04）
    
    return true;
  } catch (err) {
    log(`❌ 健康检查失败：${err.message}`);
    return false;
  }
}

async function startMonitoring() {
  log('=== 本地监控器启动 ===');
  
  // 首次检查
  await checkHealth();
  
  // 定期检查
  setInterval(() => {
    checkHealth().catch(err => log(`监控异常：${err.message}`));
  }, CHECK_INTERVAL);
  
  log(`监控间隔：${CHECK_INTERVAL / 60e3}分钟`);
  log(`日志文件：${LOG_FILE}`);
  log('按 Ctrl+C 停止监控');
}

// 优雅退出
process.on('SIGINT', () => {
  log('=== 监控器已停止 ===');
  process.exit(0);
});

startMonitoring().catch(err => {
  log(`启动失败：${err.message}`);
  process.exit(1);
});
