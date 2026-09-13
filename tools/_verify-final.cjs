const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function main() {
  // 1. 最新文章
  const latest = await db.execute(`
    SELECT a.title, a.published_at, a.created_at, s.name as source_name
    FROM articles a LEFT JOIN sources s ON a.source_id = s.id
    ORDER BY a.created_at DESC LIMIT 3
  `);
  console.log('=== Turso 最新入库 3 篇 ===');
  for (const r of latest.rows) console.log(`  ${r.created_at} | pub: ${r.published_at} | ${r.source_name} | ${r.title?.slice(0, 50)}`);

  // 2. 24h 入库数
  const cnt = await db.execute(`SELECT COUNT(*) as cnt FROM articles WHERE created_at > datetime('now', '-24 hours')`);
  console.log(`\n24h 入库: ${cnt.rows[0].cnt} 篇`);

  // 3. 最新 published_at
  const pub = await db.execute(`SELECT MAX(published_at) as latest_pub FROM articles`);
  console.log(`最新 published_at: ${pub.rows[0].latest_pub}`);

  // 4. 源状态
  const src = await db.execute(`SELECT COUNT(*) as total, SUM(CASE WHEN enabled=1 THEN 1 ELSE 0 END) as enabled FROM sources`);
  console.log(`源: ${src.rows[0].total} total, ${src.rows[0].enabled} enabled`);

  // 5. 最近采集的源
  const recentSrc = await db.execute(`SELECT name, last_fetched_at FROM sources ORDER BY last_fetched_at DESC LIMIT 3`);
  console.log('\n最近采集的源:');
  for (const r of recentSrc.rows) console.log(`  ${r.last_fetched_at} | ${r.name}`);
}

main().catch(e => console.error(e.message));
