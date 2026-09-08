// 鉴权中间件（2026-09-05 重写，修复「注册顺序错误导致形同虚设」的 P0 硬伤）
// 策略（用户拍板 2026-09-05）：读者端只读公开；一切写操作（POST/PUT/DELETE）
// 与管理/敏感读接口（/alerts /data /backup /queue /health /auth/douyin 等）需要 Bearer JWT。
// 应急回退：.env 设 AUTH_DISABLED=true 可整体关闭（仅限可信本机调试）。
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const log = require('../util/log');
const { getSetting, setSetting } = require('../db');

// 密钥：优先 .env AUTH_SECRET；否则生成随机密钥并持久化到 settings（重启后已签发 token 仍有效）
function loadSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  let s = getSetting('auth.secret', '');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    setSetting('auth.secret', s);
    log.info('[Auth] 已生成随机 AUTH_SECRET 并持久化到 settings（建议 .env 显式配置 AUTH_SECRET）');
  }
  return s;
}
const SECRET_KEY = loadSecret();

const AUTH_DISABLED = process.env.AUTH_DISABLED === 'true';

// 读者端三页面所需的只读 GET 前缀（挂载在 /api 下，此处路径已剥 /api 前缀）
const PUBLIC_GET_PREFIXES = [
  '/articles', // 文章列表/详情（详情顺带置已读，属读者正常行为）
  '/videos',   // 视频列表/详情/播放地址
  '/hot',      // 热点榜/事件榜/分类/来源
  '/daily',    // 最新日报
  '/reading',  // 我的阅读（沉淀聚合页只读）
  '/groups',   // 侧栏分组
  '/sources',  // 侧栏源列表（敏感字段已在路由层脱敏）
  '/status',   // 状态卡
  '/img',      // 图片代理（自身有 SSRF 防护）
  '/settings', // 只读配置（敏感字段已脱敏；写操作仍要求登录）
];

function isPublic(req) {
  const p = req.path; // 注意：中间件挂在 /api 下，req.path 不含 /api 前缀
  if (p === '/auth/login') return true; // 登录端点永远公开
  if (req.method === 'GET' || req.method === 'HEAD') {
    return PUBLIC_GET_PREFIXES.some((x) => p === x || p.startsWith(x + '/'));
  }
  return false;
}

// 登录接口的简单限流：同一 IP 连续失败 5 次锁 60s（防公网爆破）
const loginFails = new Map(); // ip -> {count, lockedUntil}
function loginThrottle(ip) {
  const rec = loginFails.get(ip);
  if (rec && rec.lockedUntil && Date.now() < rec.lockedUntil) {
    return Math.ceil((rec.lockedUntil - Date.now()) / 1000);
  }
  return 0;
}
function recordLoginFail(ip) {
  const rec = loginFails.get(ip) || { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= 5) {
    rec.lockedUntil = Date.now() + 60_000;
    rec.count = 0;
  }
  loginFails.set(ip, rec);
}
function clearLoginFail(ip) {
  loginFails.delete(ip);
}

function authMiddleware(req, res, next) {
  if (AUTH_DISABLED) return next();
  if (isPublic(req)) return next();
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) {
    return res.status(401).json({ ok: false, error: '未授权访问', needLogin: true });
  }
  try {
    jwt.verify(token, SECRET_KEY);
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: '登录已过期，请重新登录', needLogin: true });
  }
}

function generateToken(payload = {}) {
  return jwt.sign({ user: 'admin', role: 'admin', ...payload }, SECRET_KEY, { expiresIn: '7d' });
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest();
}

// 登录校验：.env ADMIN_USER/ADMIN_PASSWORD；缺省 admin/admin123（启动时告警，请尽快配置）
function login(username, password, ip) {
  const locked = loginThrottle(ip || 'unknown');
  if (locked > 0) {
    return { ok: false, error: `尝试次数过多，请 ${locked} 秒后再试` };
  }
  const VALID_USER = process.env.ADMIN_USER || 'admin';
  const VALID_PASS = process.env.ADMIN_PASSWORD || 'admin123';
  const passOk = crypto.timingSafeEqual(sha256(password || ''), sha256(VALID_PASS));
  if (username === VALID_USER && passOk) {
    clearLoginFail(ip || 'unknown');
    return { ok: true, token: generateToken({ user: username }) };
  }
  recordLoginFail(ip || 'unknown');
  return { ok: false, error: '用户名或密码错误' };
}

if (!process.env.ADMIN_PASSWORD && !AUTH_DISABLED) {
  log.warn('[Auth] 未配置 ADMIN_PASSWORD，当前使用默认口令 admin/admin123——上线前务必在 .env 中修改！');
}

module.exports = {
  authMiddleware,
  generateToken,
  login,
  isPublic,
  SECRET_KEY,
  AUTH_DISABLED,
};
