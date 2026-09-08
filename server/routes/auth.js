// 登录 API（P0）
const express = require('express');
const { login } = require('../middleware/auth');
const log = require('../util/log');

const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: '用户名和密码不能为空' });
  }
  
  try {
    const result = login(username, password, req.ip);
    if (result.ok) {
      log.info(`[Auth] 登录成功：user=${username}`);
      res.json(result);
    } else {
      log.warn(`[Auth] 登录失败：user=${username}, reason=invalid credentials`);
      res.status(401).json(result);
    }
  } catch (err) {
    log.error('[Auth] 登录异常:', err.message);
    res.status(500).json({ ok: false, error: '服务器内部错误' });
  }
});

// GET /api/auth/me —— 校验当前 Bearer token 是否有效（前端登录态探测；受鉴权中间件保护）
router.get('/me', (req, res) => {
  res.json({ ok: true, user: 'admin' });
});

// GET /api/auth/douyin/status —— 抖音登录态查询（F37，前端 DouyinTab 契约）
router.get('/douyin/status', (req, res) => {
  try {
    const st = require('../services/collectors/douyin').getLoginStatus();
    res.json({ ok: true, ...st });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/auth/douyin/start —— 拉起本机浏览器扫码登录（F38，异步；前端轮询 status）
router.post('/douyin/start', async (req, res) => {
  try {
    const r = await require('../services/collectors/douyin').startLogin();
    res.json({ ok: true, ...r });
  } catch (err) {
    log.error('[Auth] 抖音登录窗口启动失败:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
