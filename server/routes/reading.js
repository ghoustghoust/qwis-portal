// 我的阅读（沉淀聚合页）：已读文章 + 稍后读 + 收藏视频 的并集
// GET /api/reading — 聚合列表（tab / type / q / cursor 分页）
// POST /api/reading/batch — 批量操作（取消稍后读 / 取消收藏 / 移除已读记录）
// POST /api/reading/export — 导出选中条目为 Markdown
const express = require('express');
const { db } = require('../db');
const { nowIso } = require('../util/time');

const router = express.Router();
const PAGE_SIZE = 30;

// 类型口径（与十期源库一致）
const ARTICLE_TYPES = new Set(['article', 'podcast']);
const VIDEO_TYPES = new Set(['video']);
const ALL_TYPES = new Set([...ARTICLE_TYPES, ...VIDEO_TYPES]);

// ---- 辅助：构造 UNION ALL 子查询的 WHERE + args ----
function buildFilters(query) {
  const tab = query.tab || 'all';
  const type = query.type || 'all';
  const q = (query.q || '').trim();

  // 文章侧条件
  const aConds = [];
  const aArgs = [];
  if (tab === 'all') aConds.push('(a.read_at IS NOT NULL OR a.later = 1)');
  else if (tab === 'favorited') aConds.push('a.later = 1');
  else if (tab === 'read') aConds.push('a.read_at IS NOT NULL');
  if (type === 'article') aConds.push("s.type IN ('wechat','rss','x')");
  else if (type === 'podcast') aConds.push("s.type = 'douyin'");
  else if (type === 'video') return null; // 视频 tab 下文章侧返回空
  if (q) {
    aConds.push('(a.title LIKE ? OR s.name LIKE ?)');
    aArgs.push(`%${q}%`, `%${q}%`);
  }

  // 视频侧条件
  const vConds = [];
  const vArgs = [];
  if (tab === 'all') vConds.push('v.favorite = 1');
  else if (tab === 'favorited') vConds.push('v.favorite = 1');
  else if (tab === 'read') return null; // 已读 tab 下视频侧返回空
  if (type === 'article' || type === 'podcast') return null; // 文章/播客 tab 下视频侧返回空
  if (q) {
    vConds.push('(v.title LIKE ? OR s.name LIKE ?)');
    vArgs.push(`%${q}%`, `%${q}%`);
  }

  return { aConds, aArgs, vConds, vArgs };
}

// ---- 辅助：计算各 tab 计数（受 type/q 过滤） ----
function calcCounts(type, q) {
  const counts = { all: 0, favorited: 0, read: 0 };
  const qLike = q ? `%${q}%` : null;

  // 文章侧计数
  const aTypeCond = type === 'article' ? "AND s.type IN ('wechat','rss','x')"
    : type === 'podcast' ? "AND s.type = 'douyin'"
    : type === 'video' ? 'AND 0'
    : '';
  const aQCond = qLike ? ' AND (a.title LIKE ? OR s.name LIKE ?)' : '';

  if (aTypeCond !== 'AND 0') {
    try {
      const args = qLike ? [qLike, qLike] : [];
      // 2026-09-05 修复：counts.all 之前是 COUNT(*) 全库文章数（没加已读/稍后读条件），
      // 「我的阅读·全部」显示成 2.6 万——应为已读+稍后读并集，与列表口径一致
      const row = db.prepare(`
        SELECT
          SUM(CASE WHEN a.read_at IS NOT NULL OR a.later = 1 THEN 1 ELSE 0 END) AS total,
          SUM(CASE WHEN a.later = 1 THEN 1 ELSE 0 END) AS fav,
          SUM(CASE WHEN a.read_at IS NOT NULL THEN 1 ELSE 0 END) AS rd
        FROM articles a LEFT JOIN sources s ON s.id = a.source_id
        WHERE 1=1 ${aTypeCond} ${aQCond}
      `).get(...args);
      counts.all += (row?.total || 0);
      counts.favorited += (row?.fav || 0);
      counts.read += (row?.rd || 0);
    } catch { /* 表不存在等异常 */ }
  }

  // 视频侧计数（仅 type=all/video 时有贡献）
  if (type === 'all' || type === 'video') {
    const vQCond = qLike ? ' AND (v.title LIKE ? OR s.name LIKE ?)' : '';
    try {
      const args = qLike ? [qLike, qLike] : [];
      const row = db.prepare(`
        SELECT COUNT(*) AS c
        FROM videos v LEFT JOIN sources s ON s.id = v.source_id
        WHERE v.favorite = 1 ${vQCond}
      `).get(...args);
      const c = row?.c || 0;
      counts.all += c;
      counts.favorited += c;
      // read tab 不含视频
    } catch { /* 表不存在等异常 */ }
  }

  return counts;
}

// ---- 辅助：安全 SQL 条件拼接 ----
function whereClause(conds) {
  return conds.length ? `WHERE ${conds.join(' AND ')}` : '';
}

// GET /api/reading?tab=all|favorited|read&type=all|article|podcast|video&q=&cursor=
router.get('/', (req, res) => {
  const tab = req.query.tab || 'all';
  const filters = buildFilters(req.query);

  // 某侧返回 null 意味着该侧无匹配（如 video tab 下文章侧为空）
  const aWhere = filters ? whereClause(filters.aConds) : 'WHERE 0';
  const vWhere = filters ? whereClause(filters.vConds) : 'WHERE 0';
  const allArgs = [...(filters?.aArgs || []), ...(filters?.vArgs || [])];

  // 计数（受 type/q 影响，不受 tab 影响——各 tab 独立计数）
  const q = (req.query.q || '').trim();
  const type = req.query.type || 'all';
  const counts = calcCounts(type, q);

  // 游标分页
  const cmp = '<';
  let cursorCond = '';
  const cursorArgs = [];
  if (req.query.cursor) {
    cursorCond = ` AND sort_key ${cmp} ?`;
    cursorArgs.push(String(req.query.cursor));
  }

  const rows = db.prepare(`
    SELECT * FROM (
      SELECT
        a.id, 'article' AS item_type, a.title, a.url, a.cover, a.summary,
        COALESCE(a.published_at, a.created_at) AS date,
        s.name AS source_name, s.type AS source_type, s.avatar AS source_avatar,
        a.read_at, a.later, 0 AS favorite,
        ${`COALESCE(a.published_at, a.created_at)`} AS sort_key
      FROM articles a LEFT JOIN sources s ON s.id = a.source_id
      ${aWhere}
      UNION ALL
      SELECT
        v.id, 'video' AS item_type, v.title, v.url, v.cover, v.intro AS summary,
        v.published_at AS date,
        s.name AS source_name, s.type AS source_type, s.avatar AS source_avatar,
        NULL AS read_at, 0 AS later, v.favorite,
        v.published_at AS sort_key
      FROM videos v LEFT JOIN sources s ON s.id = v.source_id
      ${vWhere}
    ) combined
    WHERE 1=1 ${cursorCond}
    ORDER BY sort_key DESC, id DESC
    LIMIT ?
  `).all(...allArgs, ...cursorArgs, PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const items = rows.slice(0, PAGE_SIZE);
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? last.sort_key : null;

  res.json({ ok: true, items, nextCursor, counts });
});

// POST /api/reading/batch — 批量操作
// body: { action: 'unlater'|'unfavorite'|'clear_read', items: [{type:'article',id:1}, ...] }
router.post('/batch', (req, res) => {
  const { action, items } = req.body || {};
  if (!action || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ ok: false, error: '缺少 action 或 items' });
  }
  const validActions = ['unlater', 'unfavorite', 'clear_read'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ ok: false, error: `无效操作: ${action}` });
  }

  const articleIds = items.filter((i) => i.type === 'article').map((i) => Number(i.id)).filter(Boolean);
  const videoIds = items.filter((i) => i.type === 'video').map((i) => Number(i.id)).filter(Boolean);
  let updated = 0;

  if (action === 'unlater') {
    if (articleIds.length) {
      const placeholders = articleIds.map(() => '?').join(',');
      const r = db.prepare(`UPDATE articles SET later = 0 WHERE id IN (${placeholders})`).run(...articleIds);
      updated += r.changes;
    }
  } else if (action === 'unfavorite') {
    if (videoIds.length) {
      const placeholders = videoIds.map(() => '?').join(',');
      const r = db.prepare(`UPDATE videos SET favorite = 0 WHERE id IN (${placeholders})`).run(...videoIds);
      updated += r.changes;
    }
  } else if (action === 'clear_read') {
    if (articleIds.length) {
      const placeholders = articleIds.map(() => '?').join(',');
      const r = db.prepare(`UPDATE articles SET read_at = NULL WHERE id IN (${placeholders}) AND read_at IS NOT NULL`).run(...articleIds);
      updated += r.changes;
    }
  }

  res.json({ ok: true, updated });
});

// POST /api/reading/export — 导出选中条目为 Markdown
// body: { items: [{type:'article',id:1}, ...] }
router.post('/export', (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ ok: false, error: '缺少 items' });
  }

  const articleIds = items.filter((i) => i.type === 'article').map((i) => Number(i.id)).filter(Boolean);
  const videoIds = items.filter((i) => i.type === 'video').map((i) => Number(i.id)).filter(Boolean);

  const rows = [];
  if (articleIds.length) {
    const placeholders = articleIds.map(() => '?').join(',');
    const arts = db.prepare(`
      SELECT a.id, 'article' AS item_type, a.title, a.url, a.summary,
             COALESCE(a.published_at, a.created_at) AS date,
             s.name AS source_name, s.type AS source_type
      FROM articles a LEFT JOIN sources s ON s.id = a.source_id
      WHERE a.id IN (${placeholders})
    `).all(...articleIds);
    rows.push(...arts);
  }
  if (videoIds.length) {
    const placeholders = videoIds.map(() => '?').join(',');
    const vids = db.prepare(`
      SELECT v.id, 'video' AS item_type, v.title, v.url, v.intro AS summary,
             v.published_at AS date,
             s.name AS source_name, s.type AS source_type
      FROM videos v LEFT JOIN sources s ON s.id = v.source_id
      WHERE v.id IN (${placeholders})
    `).all(...videoIds);
    rows.push(...vids);
  }

  // 按日期降序排列
  rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // 生成 Markdown
  const typeLabel = (t) => {
    if (t === 'video') return '视频';
    if (t === 'podcast') return '播客';
    return '文章';
  };
  const lines = ['# 我的阅读导出', '', `> 导出时间：${nowIso()}`, ''];
  for (const r of rows) {
    const date = r.date ? r.date.slice(0, 10) : '未知日期';
    lines.push(`## ${r.title || '无标题'}`);
    lines.push('');
    lines.push(`- **类型**：${typeLabel(r.item_type)}`);
    lines.push(`- **来源**：${r.source_name || '未知'}`);
    lines.push(`- **日期**：${date}`);
    lines.push(`- **链接**：${r.url || ''}`);
    if (r.summary) lines.push(`- **摘要**：${r.summary.slice(0, 200)}`);
    lines.push('');
  }

  res.json({ ok: true, markdown: lines.join('\n'), count: rows.length });
});

module.exports = router;
