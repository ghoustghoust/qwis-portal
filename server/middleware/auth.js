// 鉴权中间件（P0）
// 功能：JWT 令牌校验 + 白名单豁免 + 错误日志
const jwt = require('jsonwebtoken');
const log = require('../util/log');

const SECRET_KEY = process.env.AUTH_SECRET || 'change-me-in-production-random-secret-key-123456789';
const TOKEN = process.env.API_TOKEN || '';

// 白名单路径（无需鉴权）
const WHITELIST_PATHS = [
  '/health',           // 健康检查
  '/api/status',       // 状态检查
  '/reader/',          // 读者前端静态资源
  '/daily/',           // 每日情报静态资源
  '/hot/',             // 热点榜静态资源
  '/admin/',           // 管理后台静态资源
  '/wechat/',          // WeChat 前端静态资源
];

// 可选：强制 token 认证（如果配置了 API_TOKEN）
const REQUIRE_TOKEN = !!TOKEN;

/**
 * 鉴权中间件
 * @param {import('express').Request} req 
 * @param {import('express').Response} res 
 * @param {Function} next 
 */
function authMiddleware(req, res, next) {
  const path = req.path.toLowerCase();
  
  // 1. 白名单豁免
  if (WHITELIST_PATHS.some(p => path.startsWith(p))) {
    return next();
  }
  
  // 2. 如果是 GET 请求且路径包含静态资源（如/dist/），放行
  if (req.method === 'GET' && /\/static\//.test(path) || /\.css$/.test(path) || /\.js$/.test(path)) {
    return next();
  }
  
  // 3. 需要 Token 认证的情况
  if (REQUIRE_TOKEN) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      log.warn(`[Auth] 缺少 Token: ${req.method} ${path}`);
      return res.status(401).json({ ok: false, error: '未授权访问' });
    }
    
    const token = authHeader.split(' ')[1];
    
    try {
      const decoded = jwt.verify(token, SECRET_KEY);
      log.info(`[Auth] 认证成功: user=${decoded.user}, path=${path}`);
      return next();
    } catch (err) {
      log.warn(`[Auth] Token 无效：${err.message}`);
      return res.status(401).json({ ok: false, error: 'Token 无效或已过期' });
    }
  }
  
  // 4. 如果没有配置 Token，暂时放行（仅开发环境使用）
  log.warn('[Auth] 系统未配置 API_TOKEN，所有请求将被放行（生产环境请配置 AUTH_SECRET 和 API_TOKEN）');
  return next();
}

/**
 * 生成 Token
 * @param {Object} payload 
 * @returns {string}
 */
function generateToken(payload = {}) {
  const defaultPayload = {
    user: 'admin',
    role: 'admin',
    iat: Math.floor(Date.now() / 1000),
  };
  
  return jwt.sign({ ...defaultPayload, ...payload }, SECRET_KEY, {
    expiresIn: '7d',  // Token 有效期 7 天
  });
}

/**
 * 登录路由处理器
 * @param {string} username 
 * @param {string} password 
 * @returns {object}
 */
function login(username, password) {
  // 简单示例：支持用户名密码（实际项目应存入数据库或使用 bcrypt 加密）
  const VALID_USER = process.env.ADMIN_USER || 'admin';
  const VALID_PASS = process.env.ADMIN_PASSWORD || 'admin123';
  
  if (username === VALID_USER && password === VALID_PASS) {
    return {
      ok: true,
      token: generateToken({ user: username }),
    };
  }
  
  return {
    ok: false,
    error: '用户名或密码错误',
  };
}

module.exports = {
  authMiddleware,
  generateToken,
  login,
  SECRET_KEY,
  REQUIRE_TOKEN,
};
