// 存量 backfill 引擎(1.2 #3):对已入库的薄内容条目补抓原文页
// 语义:正文 <1000 字符或风控污染 → 按 COALESCE(published_at,created_at) DESC 取最新 10 条
//       → 串行 fetchFulltext → UPDATE content_html/summary/cover
// Vercel 60s 预算:50s 硬截止;失败条目跳过(下轮再试);YouTube 视频页不补
const { dbAll, dbRun } = require('./_turso');
const { _internals } = require('./_collect');

const MAX_ITEMS = 10;
const BUDGET_MS = 50000;

async function backfill() {
  const startedAt = Date.now();
  const rows = await dbAll(
    `SELECT a.id, a.url, a.summary, a.content_html, a.cover
     FROM articles a
     WHERE (LENGTH(COALESCE(a.content_html,'')) < 1000 OR a.content_html IS NULL)
       AND a.url != '' AND a.url NOT LIKE '%youtube.com%'
     ORDER BY COALESCE(a.published_at, a.created_at) DESC
     LIMIT ?`,
    MAX_ITEMS
  );
  const stats = { scanned: rows.length, filled: 0, failed: 0, skippedBudget: 0 };
  for (const r of rows) {
    if (Date.now() - startedAt > BUDGET_MS) {
      stats.skippedBudget = rows.length - stats.filled - stats.failed;
      break;
    }
    try {
      const full = await _internals.fetchFulltext(r.url);
      if (full) {
        const cur = r.content_html || '';
        if (_internals.isJunkContent(cur) || full.content.length > cur.length) {
          let summary = r.summary || '';
          if (!summary || /^\s*[{\[]/.test(summary) || /"@context"|\\+"/.test(summary)) {
            summary = _internals.summarize(full.content);
          }
          await dbRun(
            'UPDATE articles SET content_html=?, summary=?, cover=COALESCE(cover, ?) WHERE id=?',
            full.content, summary, full.cover, r.id
          );
          stats.filled++;
          continue;
        }
      }
    } catch { /* 单条失败跳过,下轮再试 */ }
    stats.failed++;
  }
  return { ok: true, stats };
}

module.exports = { backfill };
