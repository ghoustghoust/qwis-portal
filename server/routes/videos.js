// 视频 API（T14）：tab=all|favorite|history、详情、播放（direct 直链 / 官方 embed 回退）、收藏
const express = require('express');
const { db } = require('../db');
const { nowIso } = require('../util/time');
const bilibili = require('../services/collectors/bilibili');

const router = express.Router();
const PAGE_SIZE = 30;

// videos 表无观看记录字段，补 watched_at（已存在则忽略）
try { db.exec('ALTER TABLE videos ADD COLUMN watched_at TEXT'); } catch { /* 列已存在 */ }

function buildWhere(query) {
  const conds = [];
  const args = [];
  const tab = query.tab || 'all';
  if (tab === 'favorite') conds.push('v.favorite=1');
  else if (tab === 'history') conds.push('v.watched_at IS NOT NULL');
  if (query.source_id) { conds.push('v.source_id=?'); args.push(Number(query.source_id)); }
  if (query.group_id) { conds.push('s.group_id=?'); args.push(Number(query.group_id)); }
  // F4：日期范围筛选（YYYY-MM-DD，按 UTC 日期边界；to 含当天全天）
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.from || '')) {
    conds.push('COALESCE(v.published_at, v.created_at) >= ?');
    args.push(`${query.from}T00:00:00.000Z`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.to || '')) {
    conds.push('COALESCE(v.published_at, v.created_at) <= ?');
    args.push(`${query.to}T23:59:59.999Z`);
  }
  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', args };
}

// GET /api/videos?tab=&source_id=&group_id=&from=&to=&cursor=&sort=new|old
// 响应带 span:{min,max}——当前过滤条件下内容的实际时间跨度（F4）
router.get('/', (req, res) => {
  const { where, args } = buildWhere(req.query);
  const dir = req.query.sort === 'old' ? 'ASC' : 'DESC';
  const keyExpr = 'COALESCE(v.published_at, v.created_at)';
  const cmp = dir === 'DESC' ? '<' : '>';
  let cursorCond = '';
  const cursorArgs = [];
  if (req.query.cursor) {
    const sep = String(req.query.cursor).lastIndexOf('|');
    if (sep > 0) {
      cursorCond = (where ? ' AND' : 'WHERE') +
        ` (${keyExpr} ${cmp} ? OR (${keyExpr} = ? AND v.id ${cmp} ?))`;
      cursorArgs.push(req.query.cursor.slice(0, sep), req.query.cursor.slice(0, sep), Number(req.query.cursor.slice(sep + 1)));
    } else {
      cursorCond = (where ? ' AND' : 'WHERE') + ` v.id ${cmp} ?`;
      cursorArgs.push(Number(req.query.cursor));
    }
  }
  const rows = db.prepare(`
    SELECT v.*, s.name AS source_name, s.avatar AS source_avatar, ${keyExpr} AS sort_key
    FROM videos v LEFT JOIN sources s ON s.id=v.source_id
    ${where}${cursorCond} ORDER BY ${keyExpr} ${dir}, v.id ${dir} LIMIT ?
  `).all(...args, ...cursorArgs, PAGE_SIZE + 1);
  const hasMore = rows.length > PAGE_SIZE;
  const items = rows.slice(0, PAGE_SIZE);
  const last = items[items.length - 1];
  const span = db.prepare(`
    SELECT MIN(${keyExpr}) AS min, MAX(${keyExpr}) AS max
    FROM videos v LEFT JOIN sources s ON s.id=v.source_id ${where}
  `).get(...args);
  // C28:侧栏导航计数契约(收藏/历史存档)
  const counts = {
    favorite: db.prepare('SELECT COUNT(*) c FROM videos WHERE favorite=1').get().c,
    history: db.prepare('SELECT COUNT(*) c FROM videos WHERE watched_at IS NOT NULL').get().c,
  };
  res.json({ ok: true, items, nextCursor: hasMore && last ? `${last.sort_key}|${last.id}` : null, span, counts });
});

// GET /api/videos/:id —— 详情，顺手记录 watched_at（入历史存档）
router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT v.*, s.name AS source_name, s.avatar AS source_avatar
    FROM videos v LEFT JOIN sources s ON s.id=v.source_id WHERE v.id=?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'not found' });
  if (!row.watched_at) {
    db.prepare('UPDATE videos SET watched_at=? WHERE id=?').run(nowIso(), row.id);
    row.watched_at = nowIso();
  }
  res.json({ ok: true, item: row });
});

// GET /api/videos/:id/play?mode=direct|official
// bilibili：direct 调 getPlayUrl，无 Cookie 或失败回退官方 embed
// youtube：官方 embed（需浏览器可达 YouTube）
// douyin：无官方 iframe embed，返回 external 由原平台打开
router.get('/:id/play', async (req, res) => {
  const row = db.prepare('SELECT * FROM videos WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'not found' });
  if (row.platform === 'bilibili') {
    const official = `https://player.bilibili.com/player.html?bvid=${row.vid}&autoplay=0`;
    if ((req.query.mode || 'direct') === 'direct') {
      try {
        const url = await bilibili.getPlayUrl(row.vid);
        if (url) return res.json({ ok: true, mode: 'direct', url });
      } catch { /* 直链解析失败 → 回退官方 embed */ }
    }
    return res.json({ ok: true, mode: 'official', url: official });
  }
  if (row.platform === 'youtube') {
    return res.json({ ok: true, mode: 'official', url: `https://www.youtube.com/embed/${row.vid}` });
  }
  // douyin：尝试解析 mp4 直链内嵌播放（带登录态，串行限速）；失败回退原平台打开
  if (row.platform === 'douyin' && (req.query.mode || 'direct') === 'direct') {
    try {
      const douyin = require('../services/collectors/douyin');
      const url = await douyin.getPlayUrl(row.vid);
      if (url) return res.json({ ok: true, mode: 'direct', url });
    } catch { /* 直链失败 → external */ }
  }
  // douyin 兜底等：不支持内嵌播放
  return res.json({ ok: true, mode: 'external', url: row.url || `https://www.douyin.com/video/${row.vid}` });
});

// POST /api/videos/:id/favorite —— 切换收藏
router.post('/:id/favorite', (req, res) => {
  const row = db.prepare('SELECT id, favorite FROM videos WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'not found' });
  const favorite = row.favorite ? 0 : 1;
  db.prepare('UPDATE videos SET favorite=? WHERE id=?').run(favorite, row.id);
  res.json({ ok: true, favorite });
});

module.exports = router;
