// GET /api/videos/:id/play?mode= —— 云端无法解析直链,直接回退官方 embed / 原平台外链
const { videos } = require('../../_data');

module.exports = function handler(req, res) {
  const v = videos().find((x) => String(x.id) === String(req.query.id));
  if (!v) return res.status(404).json({ ok: false, error: 'not found' });
  if (v.platform === 'bilibili') {
    return res.json({ ok: true, mode: 'official', url: `https://player.bilibili.com/player.html?bvid=${v.vid}&autoplay=0` });
  }
  if (v.platform === 'youtube') {
    return res.json({ ok: true, mode: 'official', url: `https://www.youtube.com/embed/${v.vid}` });
  }
  res.json({ ok: true, mode: 'external', url: v.url || `https://www.douyin.com/video/${v.vid}` });
};
