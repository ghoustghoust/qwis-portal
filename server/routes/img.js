// 图片代理（海外封面在浏览器未翻墙时也可显示）：服务端经 HTTPS_PROXY 拉图并转发
// GET /api/img?u=<url> —— 仅 http(s) 图片，SSRF 防护走 util/safeimg（DNS 解析校验 + 重定向逐跳校验 + 流式大小上限），7 天缓存
const express = require('express');
const { fetchImageSafe } = require('../util/safeimg');

const router = express.Router();

router.get('/', async (req, res) => {
  const u = String(req.query.u || '');
  if (!/^https?:\/\//i.test(u)) return res.status(400).json({ ok: false, error: 'bad url' });
  try {
    const { contentType, body } = await fetchImageSafe(u, {
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      // B站等防盗链：不带 Referer
      Referer: '',
    });
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=604800'); // 7 天
    res.send(body);
  } catch (err) {
    const clientErr = /forbidden host|bad url|DNS 解析失败/.test(err.message);
    res.status(clientErr ? 403 : 502).json({ ok: false, error: err.message });
  }
});

module.exports = router;
