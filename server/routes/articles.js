// 文章 API（T13）：tab=all|later|history、q 搜索、cursor 分页（每页 30）、阅读状态流转
const express = require('express');
const { db } = require('../db');
const { nowIso } = require('../util/time');

const router = express.Router();
const PAGE_SIZE = 30;

const LIST_FIELDS = `a.id, a.source_id, a.title, a.url, a.author, a.cover, a.summary,
  a.published_at, a.read_at, a.later, a.created_at, s.name AS source_name`;

// C28:侧栏导航计数契约——列表响应统一带 counts(稍后读/历史存档)
function articleCounts() {
  return {
    later: db.prepare('SELECT COUNT(*) c FROM articles WHERE later=1').get().c,
    history: db.prepare('SELECT COUNT(*) c FROM articles WHERE read_at IS NOT NULL').get().c,
  };
}

// 按 tab + 过滤条件构造 WHERE（articles a JOIN sources s）
function buildWhere(query) {
  const conds = [];
  const args = [];
  const tab = query.tab || 'all';
  if (tab === 'later') conds.push('a.later=1');
  else if (tab === 'history') conds.push('a.read_at IS NOT NULL');
  // all：全部文章（含已读，未读蓝点标记未读；用户要求已读不消失）
  if (query.source_id) { conds.push('a.source_id=?'); args.push(Number(query.source_id)); }
  if (query.group_id) { conds.push('s.group_id=?'); args.push(Number(query.group_id)); }
  if (query.q) {
    conds.push('(a.title LIKE ? OR a.content_html LIKE ?)');
    args.push(`%${query.q}%`, `%${query.q}%`);
  }
  // F4：日期范围筛选（YYYY-MM-DD，按 UTC 日期边界；to 含当天全天）
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.from || '')) {
    conds.push('COALESCE(a.published_at, a.created_at) >= ?');
    args.push(`${query.from}T00:00:00.000Z`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.to || '')) {
    conds.push('COALESCE(a.published_at, a.created_at) <= ?');
    args.push(`${query.to}T23:59:59.999Z`);
  }
  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', args };
}

// GET /api/articles?tab=&source_id=&group_id=&q=&from=&to=&cursor=&sort=new|old&dedup=1
// 排序按发布时间（published_at 缺失回退 created_at）；游标为「排序键|id」复合键
// dedup=1(九期):同事件条目按标题 Jaccard 聚类合并,每条带 relatedCount/related;游标=簇序号
// 响应带 span:{min,max}——当前过滤条件下内容的实际时间跨度（F4）
router.get('/', (req, res) => {
  const { where, args } = buildWhere(req.query);
  const dir = req.query.sort === 'old' ? 'ASC' : 'DESC';
  const keyExpr = 'COALESCE(a.published_at, a.created_at)';

  // ---- dedup=1:同事件合并模式 ----
  if (req.query.dedup === '1') {
    const { titleTokens, jaccard } = require('../services/ai/daily');
    const rows = db.prepare(`
      SELECT ${LIST_FIELDS}, ${keyExpr} AS sort_key FROM articles a LEFT JOIN sources s ON s.id=a.source_id
      ${where} ORDER BY ${keyExpr} DESC, a.id DESC LIMIT 500
    `).all(...args);
    const clusters = [];
    for (const r of rows) {
      const tokens = titleTokens(r.title);
      if (!tokens.size) { clusters.push({ rep: r, related: [], tokens }); continue; }
      let hit = null;
      for (const c of clusters) {
        if (jaccard(tokens, c.tokens) >= 0.5) { hit = c; break; }
      }
      if (!hit) clusters.push({ rep: r, related: [], tokens });
      else {
        hit.related.push({ source_name: r.source_name, url: r.url, id: r.id });
        for (const t of tokens) hit.tokens.add(t);
        if ((r.sort_key || '') > (hit.rep.sort_key || '')) {
          // 更新时间更晚的为代表(信息最新)
          hit.related.push({ source_name: hit.rep.source_name, url: hit.rep.url, id: hit.rep.id });
          hit.rep = r;
        }
      }
    }
    const offset = Number(req.query.cursor) || 0;
    const page = clusters.slice(offset, offset + PAGE_SIZE).map((c) => ({
      ...c.rep, relatedCount: c.related.length, related: c.related,
    }));
    const nextCursor = offset + PAGE_SIZE < clusters.length ? String(offset + PAGE_SIZE) : null;
    const span = db.prepare(`
      SELECT MIN(${keyExpr}) AS min, MAX(${keyExpr}) AS max
      FROM articles a LEFT JOIN sources s ON s.id=a.source_id ${where}
    `).get(...args);
    return res.json({ ok: true, items: page, nextCursor, span, deduped: true, totalClusters: clusters.length, counts: articleCounts() });
  }

  // ---- 原始模式 ----
  const cmp = dir === 'DESC' ? '<' : '>';
  let cursorCond = '';
  const cursorArgs = [];
  if (req.query.cursor) {
    const sep = String(req.query.cursor).lastIndexOf('|');
    if (sep > 0) {
      cursorCond = (where ? ' AND' : 'WHERE') +
        ` (${keyExpr} ${cmp} ? OR (${keyExpr} = ? AND a.id ${cmp} ?))`;
      cursorArgs.push(req.query.cursor.slice(0, sep), req.query.cursor.slice(0, sep), Number(req.query.cursor.slice(sep + 1)));
    } else {
      // 兼容旧版纯 id 游标
      cursorCond = (where ? ' AND' : 'WHERE') + ` a.id ${cmp} ?`;
      cursorArgs.push(Number(req.query.cursor));
    }
  }
  const rows = db.prepare(`
    SELECT ${LIST_FIELDS}, ${keyExpr} AS sort_key FROM articles a LEFT JOIN sources s ON s.id=a.source_id
    ${where}${cursorCond} ORDER BY ${keyExpr} ${dir}, a.id ${dir} LIMIT ?
  `).all(...args, ...cursorArgs, PAGE_SIZE + 1);
  const hasMore = rows.length > PAGE_SIZE;
  const items = rows.slice(0, PAGE_SIZE);
  const last = items[items.length - 1];
  const span = db.prepare(`
    SELECT MIN(${keyExpr}) AS min, MAX(${keyExpr}) AS max
    FROM articles a LEFT JOIN sources s ON s.id=a.source_id ${where}
  `).get(...args);
  res.json({ ok: true, items, nextCursor: hasMore && last ? `${last.sort_key}|${last.id}` : null, span, counts: articleCounts() });
});

// POST /api/articles/read-all —— 按当前过滤条件全部标为已读（须先注册于 /:id 之前）
router.post('/read-all', (req, res) => {
  const { where, args } = buildWhere(req.body || {});
  const r = db.prepare(`
    UPDATE articles SET read_at=? WHERE read_at IS NULL AND id IN (
      SELECT a.id FROM articles a LEFT JOIN sources s ON s.id=a.source_id ${where}
    )
  `).run(nowIso(), ...args);
  res.json({ ok: true, updated: r.changes });
});

// GET /api/articles/:id —— 返回全文，顺手置 read_at（入历史存档）
router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT a.*, s.name AS source_name FROM articles a LEFT JOIN sources s ON s.id=a.source_id WHERE a.id=?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'not found' });
  if (!row.read_at) {
    db.prepare('UPDATE articles SET read_at=? WHERE id=?').run(nowIso(), row.id);
    row.read_at = nowIso();
  }
  res.json({ ok: true, item: row });
});

// POST /api/articles/:id/later —— 切换稍后阅读
router.post('/:id/later', (req, res) => {
  const row = db.prepare('SELECT id, later FROM articles WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'not found' });
  const later = row.later ? 0 : 1;
  db.prepare('UPDATE articles SET later=? WHERE id=?').run(later, row.id);
  res.json({ ok: true, later });
});

module.exports = router;
