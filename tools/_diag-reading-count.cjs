// 只读诊断：把 /api/reading 的 count 与 list 口径差异量化
const fs = require('fs');
for (const line of fs.readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;

const READ = '(a.read_at IS NOT NULL OR a.later = 1)';
const AUDIO = "(a.cover LIKE '%.m4a%' OR a.cover LIKE '%.mp3%' OR a.cover LIKE '%.aac%' OR a.cover LIKE '%.ogg%' OR a.cover LIKE '%.opus%' OR a.cover LIKE '%media.xyzcdn.net%')";

async function main() {
  const c1 = (await q('SELECT COUNT(*) c FROM videos WHERE favorite=1'))[0].c;
  const c2 = (await q('SELECT COUNT(*) c FROM videos'))[0].c;
  console.log('videos favorite=1      :', c1, ' / videos total:', c2);
  console.log('read|later total       :', (await q(`SELECT COUNT(*) c FROM articles a WHERE ${READ}`))[0].c);
  console.log('by src type            :', JSON.stringify(await q(`SELECT s.type t, COUNT(*) c FROM articles a LEFT JOIN sources s ON s.id=a.source_id WHERE ${READ} GROUP BY s.type ORDER BY c DESC`)));
  console.log('article 新口径含 wemp  :', (await q(`SELECT COUNT(*) c FROM articles a LEFT JOIN sources s ON s.id=a.source_id WHERE ${READ} AND s.type IN ('wemp','wechat','rss','x')`))[0].c);
  console.log('article 旧口径漏 wemp  :', (await q(`SELECT COUNT(*) c FROM articles a LEFT JOIN sources s ON s.id=a.source_id WHERE ${READ} AND s.type IN ('wechat','rss','x')`))[0].c);
  console.log('podcast 新口径(音频壳) :', (await q(`SELECT COUNT(*) c FROM articles a WHERE ${READ} AND ${AUDIO}`))[0].c);
  console.log('podcast 旧口径 douyin  :', (await q(`SELECT COUNT(*) c FROM articles a LEFT JOIN sources s ON s.id=a.source_id WHERE ${READ} AND s.type='douyin'`))[0].c);
  console.log('podcast 新口径样本     :', JSON.stringify(await q(`SELECT s.type t, substr(a.title,1,26) title, substr(a.cover,1,44) cov FROM articles a LEFT JOIN sources s ON s.id=a.source_id WHERE ${READ} AND ${AUDIO} LIMIT 6`)));
  await db.close();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
