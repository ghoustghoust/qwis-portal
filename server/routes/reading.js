// 我的阅读（沉淀聚合页）：已读文章 + 稍后读 + 收藏视频 的并集
// GET /api/reading — 聚合列表（tab / type / q / cursor 分页）
// POST /api/reading/batch — 批量操作（取消稍后读 / 取消收藏 / 移除已读记录）
// POST /api/reading/export — 导出选中条目为 Markdown
const express = require('express');
const { db } = require('../db');
const { nowIso } = require('../util/time');
const { readingTypeFilter, readingTypeCondSql, withReadingKinds, READING_VIDEO_COND } = require('../../lib/reading-filters');
// B107（2026-09-21 批准口径）：足迹默认排除热榜/聚合噪声，`include_hot=1` 才把它们带回来。
// 只用两轴 —— 屏蔽(muted)/未收录是另一件事，批准里没说，不顺手扩。
// 轴只有一份，见 lib/noise.js；形态选 NOT EXISTS 而不是 JOIN：源已删除的孤儿条目要留在足迹里
// （足迹是历史事实），正连接会把它们一起丢掉。
const { notNoiseExistsSql } = require('../../lib/noise');
const NOISE_ALIAS = 'sn';

// 视频侧不套：足迹视频只有 B站/抖音收藏，与热榜/聚合源类型不重叠，加了只多一次子查询
function noiseFilterSql() {
  return notNoiseExistsSql({ item: 'a', alias: NOISE_ALIAS });
}

const router = express.Router();
const PAGE_SIZE = 30;

// ---- 辅助：构造 UNION ALL 子查询的 WHERE + args ----
// ⚠️ B134（2026-09-21，由 N8 锁抓到）：这里原来用 `return null` 表示"这一侧没内容"，
// 而调用方把 null 理解成"整个筛选失败"→ 两侧一起 `WHERE 0`。后果是本地端除 tab=all&type=all
// 之外的**每个筛选组合都返回空列表**（计数却正常 → 表现是"已读写着 5 条，点进去一片空白"）。
// 云端同一处是把 '0' 只压进对应侧，所以这是本地/云端的真实分叉。空侧必须"只空一侧"。
function buildFilters(query) {
  const tab = query.tab || 'all';
  const type = query.type || 'all';
  const q = (query.q || '').trim();
  const T = readingTypeFilter(type);

  // 文章侧条件
  const aConds = [];
  const aArgs = [];
  if (!T.includeArticles) {
    aConds.push('0'); // 视频 tab：只空文章侧
  } else {
    if (tab === 'all') aConds.push('(a.read_at IS NOT NULL OR a.later = 1)');
    else if (tab === 'favorited') aConds.push('a.later = 1');
    else if (tab === 'read') aConds.push('a.read_at IS NOT NULL');
    if (T.articleCond) aConds.push(T.articleCond);
    if (query.include_hot !== '1') aConds.push(noiseFilterSql());
    if (q) {
      aConds.push('(a.title LIKE ? OR s.name LIKE ?)');
      aArgs.push(`%${q}%`, `%${q}%`);
    }
  }

  // 视频侧条件（已读 tab 不含视频；文章/播客 tab 只空视频侧）
  const vConds = [];
  const vArgs = [];
  if (!T.includeVideos || tab === 'read') {
    vConds.push('0');
  } else {
    // B29：tab=all 认「交互过」（收藏或观看过），favorited 仍只认收藏
    if (tab === 'all') vConds.push(READING_VIDEO_COND);
    else if (tab === 'favorited') vConds.push('v.favorite = 1');
    if (q) {
      vConds.push('(v.title LIKE ? OR s.name LIKE ?)');
      vArgs.push(`%${q}%`, `%${q}%`);
    }
  }

  return { aConds, aArgs, vConds, vArgs };
}

// ---- 辅助：计算各 tab 计数（受 type/q/含热榜 过滤）----
// AC4：计数与列表必须同一个表达式 —— 这里就是列表那一份的 noiseFilterSql()，不许再判一次
function calcCounts(type, q, includeNoisy) {
  const counts = { all: 0, favorited: 0, read: 0 };
  const qLike = q ? `%${q}%` : null;

  // 文章侧计数（B60：表达式与列表同源，见 lib/reading-filters）
  const aTypeCond = readingTypeCondSql(type);
  const aQCond = qLike ? ' AND (a.title LIKE ? OR s.name LIKE ?)' : '';
  const aNoiseCond = includeNoisy ? '' : `AND ${noiseFilterSql()}`;

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
        WHERE 1=1 ${aTypeCond} ${aQCond} ${aNoiseCond}
      `).get(...args);
      counts.all += (row?.total || 0);
      counts.favorited += (row?.fav || 0);
      counts.read += (row?.rd || 0);
    } catch { /* 表不存在等异常 */ }
  }

  // 视频侧计数（B60：是否贡献计数同样由共享口径决定，不再手写第二份 type 判断）
  if (readingTypeFilter(type).includeVideos) {
    const vQCond = qLike ? ' AND (v.title LIKE ? OR s.name LIKE ?)' : '';
    try {
      const args = qLike ? [qLike, qLike] : [];
      const row = db.prepare(`
        SELECT COUNT(*) AS c, SUM(CASE WHEN v.favorite = 1 THEN 1 ELSE 0 END) AS fav
        FROM videos v LEFT JOIN sources s ON s.id = v.source_id
        WHERE ${READING_VIDEO_COND} ${vQCond}
      `).get(...args);
      const c = row?.c || 0;
      counts.all += c;
      counts.favorited += (row?.fav || 0);
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
  // 空侧由 buildFilters 压一个 '0' 进去（B134：以前靠 return null，两侧一起被判空）
  const aWhere = whereClause(filters.aConds);
  const vWhere = whereClause(filters.vConds);
  const allArgs = [...filters.aArgs, ...filters.vArgs];

  // 计数（受 type/q 影响，不受 tab 影响——各 tab 独立计数）
  const q = (req.query.q || '').trim();
  const type = req.query.type || 'all';
  const counts = calcCounts(type, q, req.query.include_hot === '1');

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

  res.json({ ok: true, items: withReadingKinds(items), nextCursor, counts });
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
