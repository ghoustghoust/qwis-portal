// 一次性:给文化生活/科技热榜两组近 24h 的标题级热榜条目补全文(每源限 10 条,限速 2s)
const path = require('path');
process.env.APP_DATA_DIR = process.env.APP_DATA_DIR || path.join(__dirname, '..', 'data');
const { db } = require('../server/db');
const { _internals } = require('../server/services/collectors/rss');

async function main() {
  const rows = db.prepare(`
    SELECT a.id, a.url, a.title, s.name AS sname FROM articles a
    JOIN sources s ON s.id = a.source_id
    JOIN groups g ON g.id = s.group_id
    WHERE g.name IN ('文化生活','科技热榜') AND s.type='hotlist'
      AND length(a.content_html) < 1000 AND a.published_at >= datetime('now','-1 day')
    ORDER BY a.source_id, a.published_at DESC
  `).all();
  const perSource = new Map();
  const queue = rows.filter((r) => {
    const n = perSource.get(r.sname) || 0;
    if (n >= 10) return false;
    perSource.set(r.sname, n + 1);
    return true;
  });
  console.log(`候选 ${rows.length},限流后待补 ${queue.length}`);
  const upd = db.prepare('UPDATE articles SET content_html=?, summary=? WHERE id=?');
  let ok = 0, dead = 0;
  for (const r of queue) {
    try {
      const full = await _internals.fetchFulltext(r.url);
      if (full && full.content.length > 500 && !_internals.isJunkContent(full.content)) {
        const sum = full.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
        upd.run(full.content, sum, r.id);
        ok++;
      } else dead++;
    } catch { dead++; }
    await new Promise((x) => setTimeout(x, 2000));
  }
  console.log(`补抓完成: 全文 ${ok}, 失败(登录墙/删除等) ${dead}`);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
