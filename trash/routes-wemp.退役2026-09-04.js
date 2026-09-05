// WeRSS(we-mp-rss)集成 API(T-wemp)
// GET  /api/wemp/status              —— we-mp-rss 服务状态 + 本系统 wemp 源计数
// POST /api/wemp/sync                —— 把 we-mp-rss 订阅同步为本地 sources(type=wemp) RSS 源
// GET  /api/wemp/weread/qrcode       —— 触发微信读书扫码取码（返回图片代理路径）
// GET  /api/wemp/weread/qrcode.png   —— 二维码图片代理（前端只跟本系统端口打交道，防缓存）
// GET  /api/wemp/weread/status       —— 轮询扫码状态 {loginStatus, msg, expired}
// POST /api/wemp/weread/complete     —— 登录成功后收尾（调用 we-mp-rss qr/over 清理）
const express = require('express');
const { fetchJson } = require('../util/http');
const { db, getSetting } = require('../db');

const router = express.Router();

function wempBase() {
  return process.env.WEMP_BASE_URL || getSetting('wemp.baseUrl', 'http://127.0.0.1:8001');
}

let tokenCache = { token: null, expiresAt: 0 };

async function getWempToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const body = new URLSearchParams({
    username: process.env.WEMP_USERNAME || getSetting('wemp.username', 'admin'),
    password: process.env.WEMP_PASSWORD || getSetting('wemp.password', 'admin@123'),
  });
  const res = await fetch(`${wempBase()}/api/v1/wx/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`we-mp-rss 登录失败 HTTP ${res.status}`);
  const data = await res.json();
  const token = data && data.data && data.data.access_token;
  if (!token) throw new Error('we-mp-rss 返回无 access_token');
  tokenCache = { token, expiresAt: Date.now() + ((data.data.expires_in || 259200) * 1000) - 60000 };
  return token;
}

async function wempGet(path) {
  const token = await getWempToken();
  try {
    return await fetchJson(`${wempBase()}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch (err) {
    // token 可能因 we-mp-rss 重启/密钥重置而失效：清缓存重登后重试一次
    if (err && err.status === 401 && tokenCache.token) {
      tokenCache = { token: null, expiresAt: 0 };
      const fresh = await getWempToken();
      return fetchJson(`${wempBase()}${path}`, { headers: { Authorization: `Bearer ${fresh}` } });
    }
    throw err;
  }
}

router.get('/status', async (req, res) => {
  let remote = null;
  try {
    const r = await wempGet('/api/v1/wx/mps?page=1&size=1');
    remote = { reachable: true, totalFeeds: (r.data && r.data.total) || 0 };
  } catch (err) {
    remote = { reachable: false, error: err.message };
  }
  const local = db.prepare("SELECT count(*) AS c FROM sources WHERE type='wemp'").get().c;
  res.json({ ok: true, base: wempBase(), remote, localSources: local, lastSyncAt: getSetting('wemp.lastSyncAt', null), lastResult: getSetting('wemp.lastResult', null) });
});

router.post('/sync', async (req, res) => {
  try {
    const feeds = [];
    // we-mp-rss 列表接口是 limit/offset 分页(不是 page/size,用错参数会静默只拿到默认 10 条)
    let offset = 0;
    const LIMIT = 100;
    for (;;) {
      const r = await wempGet(`/api/v1/wx/mps?limit=${LIMIT}&offset=${offset}`);
      const list = (r.data && r.data.list) || [];
      feeds.push(...list.filter((f) => f.status === 1).map((f) => ({ id: f.id, name: f.mp_name || f.id, cover: f.mp_cover || '' })));
      const total = (r.data && r.data.total) || 0;
      offset += list.length;
      if (offset >= total || !list.length) break;
    }
    const find = db.prepare("SELECT id FROM sources WHERE type='wemp' AND url=?");
    const insert = db.prepare(
      "INSERT INTO sources(type, name, url, avatar, enabled, status, created_at) VALUES('wemp', ?, ?, ?, 1, 'ok', ?)"
    );
    const updAvatar = db.prepare("UPDATE sources SET avatar=? WHERE id=? AND (avatar IS NULL OR avatar='')");
    let added = 0;
    const nowIso = () => new Date().toISOString();
    // 公众号封面是 mmbiz.qpic.cn 防盗链图,统一走 /api/img 代理(服务端无 Referer 拉图)
    const proxied = (u) => (u && /^https?:\/\//.test(u) ? `/api/img?u=${encodeURIComponent(u)}` : null);
    for (const f of feeds) {
      const url = `${wempBase()}/feed/${f.id}.atom?limit=20`;
      const avatar = proxied(f.cover);
      const exist = find.get(url);
      if (!exist) { insert.run(f.name, url, avatar, nowIso()); added++; }
      else if (avatar) updAvatar.run(avatar, exist.id); // 存量源补头像
    }
    const result = { feeds: feeds.length, added };
    try {
      const { setSetting } = require('../db');
      setSetting('wemp.lastSyncAt', nowIso());
      setSetting('wemp.lastResult', result);
    } catch { /* 忽略 settings 写失败 */ }
    res.json({ ok: true, ...result });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// 触发取码：we-mp-rss 侧会生成 static/weread_qrcode.png 并启动扫码轮询
router.get('/weread/qrcode', async (req, res) => {
  try {
    const r = await wempGet('/api/v1/wx/weread/qr/code');
    if (!r || r.code !== 0) throw new Error((r && r.message) || '取码失败');
    res.json({ ok: true, qrUrl: `/api/wemp/weread/qrcode.png?t=${Date.now()}` });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// 二维码图片代理：流式转发，禁缓存（we-mp-rss 每次取码会覆盖同名文件）
router.get('/weread/qrcode.png', async (req, res) => {
  try {
    const token = await getWempToken();
    const upstream = await fetch(`${wempBase()}/static/weread_qrcode.png?t=${Date.now()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!upstream.ok) {
      res.status(upstream.status === 404 ? 404 : 502).json({ ok: false, error: `二维码图片不可用 HTTP ${upstream.status}` });
      return;
    }
    res.set('Content-Type', upstream.headers.get('content-type') || 'image/png');
    res.set('Cache-Control', 'no-store');
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// 轮询扫码状态：透传 we-mp-rss 状态并归一化
router.get('/weread/status', async (req, res) => {
  try {
    const r = await wempGet('/api/v1/wx/weread/qr/status');
    const d = (r && r.data) || {};
    const msg = d.msg || '';
    res.json({
      ok: true,
      loginStatus: !!d.login_status,
      msg,
      expired: msg.includes('已过期') || msg.includes('重新获取'),
      cookieInvalid: !!(d.data && d.data.logicCode === 'COOKIE_INVALID'),
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// 登录成功收尾：调用 we-mp-rss qr/over 清理二维码与轮询状态
router.post('/weread/complete', async (req, res) => {
  try {
    await wempGet('/api/v1/wx/weread/qr/over');
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

module.exports = router;
