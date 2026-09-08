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
// 注意：Express 按挂载顺序匹配——/api/sources/restore-all 必须先于 /api/sources，
// 否则若 sources.js 将来新增匹配该路径的路由会被静默截胡（2026-09-05b A7 修复）
const routes = {
  '/api/settings': './routes/settings',
  '/api/sources/restore-all': './routes/restore-all', // ✅ P3: 批量恢复熔断源专用接口（须先于 /api/sources）
  '/api/sources': './routes/sources',
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
  '/api/reading': './routes/reading',
  '/api/audit': './routes/audit',
  '/api/ai': './routes/ai',
};

// SSE 实时推送（须在鉴权中间件之前注册——SSE 是只读长连接，无需 Bearer）
const { sseHandler } = require('./routes/events-sse');
app.get('/api/events', sseHandler);

// P0 鉴权（2026-09-05 修复）：必须在路由挂载之前注册——Express 按注册序执行，
// 历史上挂在路由之后导致全部 /api/* 零鉴权（详见 docs/1.CODE_REVIEW_2026-09-05.md P0-1）。
// 策略：读者只读 GET 公开；写操作与管理/敏感接口要求 Bearer JWT（/api/auth/login 获取）。
app.use('/api', authMiddleware);

// 源库接口先于 sources 挂载（决策 10：/batch /autoclassify 不被 sources 路由截胡）
const sourcelibRouter = require('./routes/sourcelib');
app.use('/api/sources', sourcelibRouter);

for (const [mount, file] of Object.entries(routes)) {
  const full = path.join(__dirname, 'routes', path.basename(file) + '.js');
  if (fs.existsSync(full)) {
    const router = require(file);
    // /api/opml 与 /api/rss 共用 opml.js 内部子路由
    app.use(mount, router);
  }
}

// API 404
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'not found' }));

// 静态托管前端产物（带缓存策略：JS/CSS/图片 1 天强缓存，HTML 不缓存）
const distDir = path.join(__dirname, '..', 'web', 'dist');
app.use(express.static(distDir, {
  maxAge: '1d',
  etag: true,
  setHeaders: (res, filePath) => {
    // HTML 文件不缓存（SPA 入口需始终获取最新版本）
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// 三页面 SPA 路由（F52）+ 六期 /hot/ 热点榜（F6）+ 九期管理后台独立入口（admin.html）
// 读者前端（reader/daily/hot）→ index.html；管理后台（/admin/，/wechat/ 兼容）→ admin.html
for (const page of ['/reader/', '/daily/', '/hot/', '/reading/']) {
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
