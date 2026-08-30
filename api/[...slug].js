// 唯一 Serverless Function(Hobby 计划上限 12 个,全部 /api/* 走这里)
// 图片代理 /api/img?u= 也在此(与主系统 util.imgUrl 对应)
const { route } = require('./_handlers');

module.exports = async function handler(req, res) {
  try {
    // catch-all 参数兼容:Build Output API 下键名是字面量 "...slug"(值为斜杠连接字符串),
    // 本地/其他形态可能是 slug 数组 —— 两种都兼容
    const raw = req.query['...slug'] ?? req.query.slug;
    const slug = Array.isArray(raw)
      ? raw
      : String(raw || '').split(/[/,]/).filter(Boolean);
    // 图片代理单独处理(二进制响应)
    if (slug[0] === 'img') {
      const u = req.query.u;
      if (!u || !/^https?:\/\//i.test(u)) return res.status(400).json({ ok: false, error: 'bad url' });
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) return res.status(502).json({ ok: false, error: `upstream ${r.status}` });
      res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(Buffer.from(await r.arrayBuffer()));
    }
    const result = await route(req.method || 'GET', slug, req.query);
    if (!result) return res.status(404).json({ ok: false, error: 'not found' });
    res.status(result.code || 200).json(result.body);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
