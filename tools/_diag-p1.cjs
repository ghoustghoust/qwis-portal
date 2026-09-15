const fs = require('fs');
for (const l of fs.readFileSync('.env','utf8').split(/\r?\n/)) { const m = /^([A-Z_]+)=(.+)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
function collect(obj, out) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) { obj.forEach(v => collect(v, out)); return; }
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'id' && Number.isFinite(v) && v > 0) out.add(v);
    else if (v && typeof v === 'object') collect(v, out);
  }
}
(async () => {
  const r0 = await db.execute('SELECT id, generated_at, sections FROM daily_reports ORDER BY generated_at DESC LIMIT 1');
  const rep = r0.rows[0];
  console.log('最新日报:', rep.id, rep.generated_at);
  const ids = new Set(); collect(JSON.parse(rep.sections || '[]'), ids);
  console.log('日报条目 id 数:', ids.size);
  const arr = [...ids];
  if (arr.length) {
    const r2 = await db.execute(`SELECT COUNT(*) c FROM articles WHERE id IN (${arr.map(()=>'?').join(',')}) AND translated_title IS NULL AND translated_content IS NULL AND content_html IS NOT NULL AND content_html != ''`, arr);
    console.log('其中未翻译且有正文:', r2.rows[0].c);
    const r5 = await db.execute("SELECT COUNT(*) c FROM articles WHERE created_at > (SELECT MIN(created_at) FROM articles WHERE id IN (" + arr.map(()=>'?').join(',') + "))", arr);
    console.log('比日报最旧条目更新的文章数（若>5000 则候选池扫不到）:', r5.rows[0].c);
  }
  db.close(); process.exitCode = 0;
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
