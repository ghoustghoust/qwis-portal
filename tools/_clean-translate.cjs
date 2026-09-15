// 一次性清洗（2026-09-15 翻译污染事故）：元评论/垃圾标题回炉 + 早报/周刊占位金句清除
const fs = require('fs');
for (const l of fs.readFileSync('.env','utf8').split(/\r?\n/)) { const m = /^([A-Z_]+)=(.+)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const PLACEHOLDER = /待提取|待原文|待补充|未提供正文|未提供.*内容|暂无原文|无法提取|无法提供|原文缺失|未见正文/;
(async () => {
  // ① 污染译文回炉（NULL 后 runner 会按新优先级重翻，新清洗器拦截再污染）
  const bad = await db.execute(`SELECT id, substr(translated_title,1,40) t FROM articles WHERE translated_title IS NOT NULL AND (
      translated_title LIKE '用户要求%' OR translated_title LIKE '我已收到%' OR translated_title LIKE '让我仔细%'
      OR translated_title LIKE '我已完成%' OR translated_title LIKE 'Here%s thinking%' OR translated_title LIKE '%术语校对专家%'
      OR translated_title LIKE '我已收到您的翻译请求%' OR length(trim(translated_title)) < 4
      OR translated_title LIKE '评论：%' OR translated_title LIKE '%待提取%' OR translated_title LIKE '%未提供%'
      OR translated_title LIKE '暂无%' OR translated_title LIKE '%待补充%')`);
  console.log('回炉条目:', bad.rows.length, bad.rows.map(r=>r.id).join(','));
  for (const row of bad.rows) {
    await db.execute({ sql: 'UPDATE articles SET translated_title=NULL, translated_content=NULL, translation_provider=NULL WHERE id=?', args: [row.id] });
  }
  // ② mybrief/weekly 报告 JSON 里的占位金句清除
  for (const key of ['mybrief.latest', 'weekly.latest']) {
    const r = await db.execute({ sql: 'SELECT value FROM settings WHERE key=?', args: [key] });
    if (!r.rows[0]) continue;
    let rep; try { rep = JSON.parse(r.rows[0].value); } catch { continue; }
    let n = 0;
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (typeof o.quote === 'string' && PLACEHOLDER.test(o.quote)) { o.quote = ''; n++; }
      if (Array.isArray(o.points)) {
        const keep = o.points.filter((p) => !(typeof p === 'string' && PLACEHOLDER.test(p)));
        if (keep.length !== o.points.length) { n += o.points.length - keep.length; o.points = keep; }
      }
      for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
    };
    walk(rep);
    if (n) {
      await db.execute({ sql: 'INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', args: [key, JSON.stringify(rep)] });
      console.log(`${key}: 清除占位金句/要点 ${n} 处`);
    } else console.log(`${key}: 无占位`);
  }
  db.close(); process.exitCode = 0;
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
