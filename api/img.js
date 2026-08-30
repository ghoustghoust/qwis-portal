// GET /api/img?u= —— 图片代理(对齐主系统:代理国内不可达的图床,如 ytimg/fbcdn)
module.exports = async function handler(req, res) {
  const u = req.query.u;
  if (!u || !/^https?:\/\//i.test(u)) return res.status(400).json({ ok: false, error: 'bad url' });
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return res.status(502).json({ ok: false, error: `upstream ${r.status}` });
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const buf = Buffer.from(await r.arrayBuffer());
    res.send(buf);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
};
