// Express 入口：REST API + 静态托管 web/dist + 三页面路由（F52）
const path = require('path');
const fs = require('fs');
// 轻量 .env 加载（不引外部依赖）
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const lineRaw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq > 0 && !process.env[line.slice(0, eq)]) {
      process.env[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }
}
const express = require('express');
// 代理支持：.env 配置 HTTPS_PROXY 后，全局 fetch 走代理（YouTube/X 等海外源需要）
// NO_PROXY 内的地址（本地、云端队列、DeepSeek 等国内服务）保持直连
if (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy) {
  try {
    const { EnvHttpProxyAgent, setGlobalDispatcher } = require('undici');
    setGlobalDispatcher(new EnvHttpProxyAgent());
    console.log('[proxy] 全局 fetch 已启用环境代理');
  } catch (err) {
    console.warn('[proxy] 代理初始化失败，将直连：', err.message);
  }
}
require('./db'); // 启动时执行建表迁移
const log = require('./util/log');

// P0: 鉴权中间件
const { authMiddleware } = require('./middleware/auth');

const app = express();
app.use(express.json({ limit: '5mb' }));

// API 路由
const routes = {
  '/api/settings': './routes/settings',
  '/api/sources': './routes/sources',
  '/api/sources/restore-all': './routes/restore-all', // ✅ P3: 批量恢复熔断源专用接口
  '/api/groups': './routes/groups',
  '/api/articles': './routes/articles',
  '/api/videos': './routes/videos',
  '/api/opml': './routes/opml',
  '/api/rss': './routes/opml',
  '/api/status': './routes/status',
  '/api/backup': './routes/backup',
  '/api/queue': './routes/queue',
  '/api/img': './routes/img',
  '/api/daily': './routes/daily',
  '/api/hot': './routes/hot',
  '/api/data': './routes/data',
  '/api/auth': './routes/auth',
  '/api/alerts': './routes/alerts',
  '/api/health': './routes/health',
};

for (const [mount, file] of Object.entries(routes)) {
  const full = path.join(__dirname, 'routes', path.basename(file) + '.js');
  if (fs.existsSync(full)) {
    const router = require(file);
    // /api/opml 与 /api/rss 共用 opml.js 内部子路由
    app.use(mount, router);
  }
}

// P0: API 鉴权中间件（当前采用「统一放行」策略）。
// ⚠️ 注册顺序说明：本中间件在上方路由挂载循环（L60-67）之后注册，Express 按注册序执行，
//   已挂载的 /api/* 路由会先响应、不经过本中间件（历史上导致「鉴权形同虚设」：实测无 token 访问 /api/sources、/api/daily 返回 200）。
//   现统一放行：.env 不设 API_TOKEN → middleware/auth.js 的 REQUIRE_TOKEN=false，本机/可信局域网下行为一致
//   （所有 /api 放行，未挂载路径落到下方 404，不再有 /api/columns 的困惑 401）。
//   如需真正启用鉴权：须把本行移到路由挂载循环之前，并配套前端登录 + Bearer 注入（属新功能，需评估前端无 token 导致的白屏风险）。
app.use('/api', authMiddleware);

// API 404
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'not found' }));

// 静态托管前端产物
const distDir = path.join(__dirname, '..', 'web', 'dist');
app.use(express.static(distDir));

// 三页面 SPA 路由（F52）+ 六期 /hot/ 热点榜（F6）+ 九期管理后台独立入口（admin.html）
// 读者前端（reader/daily/hot）→ index.html；管理后台（/admin/，/wechat/ 兼容）→ admin.html
for (const page of ['/reader/', '/daily/', '/hot/']) {
  app.get(page, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}
for (const page of ['/admin/', '/wechat/']) {
  app.get(page, (req, res) => res.sendFile(path.join(distDir, 'admin.html')));
}
app.get('/', (req, res) => res.redirect('/reader/'));

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  log.info(`全网情报系统已启动: http://localhost:${PORT} (/reader/ /daily/ /wechat/)`);
  // 启动调度中心
  try {
    require('./services/scheduler').start();
  } catch (err) {
    log.error('调度中心启动失败', err.message);
  }
  // we-mp-rss 已于 2026-09-04 退役（公众号改走 wechat2rss RSS 源），不再托管子进程
});
