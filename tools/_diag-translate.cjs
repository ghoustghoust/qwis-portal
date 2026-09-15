const fs = require('fs');
for (const l of fs.readFileSync('.env','utf8').split(/\r?\n/)) { const m = /^([A-Z_]+)=(.+)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
(async () => {
  const r = await db.execute("SELECT id, translated_title, translation_provider, length(COALESCE(translated_content,'')) tlen FROM articles WHERE id IN (741975, 741970, 754195, 741971)");
  for (const row of r.rows) console.log(row.id, '| tt:', JSON.stringify(row.translated_title || '').slice(0, 90), '| provider:', row.translation_provider, '| tlen:', row.tlen);
  const thin = await db.execute("SELECT COUNT(*) c FROM articles WHERE translated_title IS NOT NULL AND translation_provider='agnes' AND length(COALESCE(content_html,''))<1500 AND created_at > datetime('now','-7 days')");
  console.log('薄正文已翻译(agnes,7d):', thin.rows[0].c);
  const junk = await db.execute("SELECT COUNT(*) c FROM articles WHERE translated_title IS NOT NULL AND (length(trim(translated_title))<4 OR translated_title LIKE '评论：%' OR translated_title LIKE '%待提取%' OR translated_title LIKE '%未提供%' OR translated_title LIKE '暂无%')");
  console.log('垃圾译文标题(全长):', junk.rows[0].c);
  db.close(); process.exitCode = 0;
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
