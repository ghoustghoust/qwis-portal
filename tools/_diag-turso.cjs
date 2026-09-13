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
  const now = new Date().toISOString();
  console.log('当前 UTC:', now);
  console.log('当前北京:', new Date(Date.now() + 8*3600000).toISOString().replace('T', ' ').slice(0, 19));

  // 1. 最新 5 篇
  const latest = await db.execute(`
    SELECT a.title, a.published_at, a.created_at, s.name as src
    FROM articles a LEFT JOIN sources s ON a.source_id = s.id
    ORDER BY a.created_at DESC LIMIT 5
  `);
  console.log('\n=== 最新 5 篇入库 ===');
  for (const r of latest.rows) {
    console.log(`  ${r.created_at} | pub:${r.published_at} | ${r.src} | ${(r.title||'').slice(0,50)}`);
  }

  // 2. 入库统计
  const cnt2 = await db.execute("SELECT COUNT(*) as c FROM articles WHERE created_at > datetime('now', '-2 hours')");
  const cnt24 = await db.execute("SELECT COUNT(*) as c FROM articles WHERE created_at > datetime('now', '-24 hours')");
  console.log(`\n2h 入库: ${cnt2.rows[0].c} 篇`);
  console.log(`24h 入库: ${cnt24.rows[0].c} 篇`);

  // 3. 源到期状态
  const src = await db.execute(`
    SELECT name, type, next_fetch_at, last_fetched_at, status, fail_count, enabled
    FROM sources WHERE enabled=1 AND type != 'wemp'
    ORDER BY next_fetch_at ASC LIMIT 15
  `);
  console.log('\n=== 即将到期 15 源 ===');
  for (const r of src.rows) {
    console.log(`  next:${r.next_fetch_at} | last:${r.last_fetched_at} | ${r.status} | fail:${r.fail_count} | ${r.type} | ${r.name}`);
  }

  // 4. 源类型分布
  const dist = await db.execute(`
    SELECT type, COUNT(*) as total, SUM(CASE WHEN enabled=1 THEN 1 ELSE 0 END) as enabled,
           SUM(CASE WHEN next_fetch_at <= datetime('now') AND enabled=1 THEN 1 ELSE 0 END) as due
    FROM sources WHERE type != 'wemp' GROUP BY type
  `);
  console.log('\n=== 源类型分布 ===');
  for (const r of dist.rows) {
    console.log(`  ${r.type}: ${r.total} total, ${r.enabled} enabled, ${r.due} DUE NOW`);
  }

  // 5. 总到期数
  const due = await db.execute("SELECT COUNT(*) as c FROM sources WHERE enabled=1 AND type != 'wemp' AND (next_fetch_at IS NULL OR next_fetch_at <= datetime('now'))");
  console.log(`\n当前到期待采源: ${due.rows[0].c} 个`);

  // 6. 最近采集成功的源
  const recent = await db.execute(`
    SELECT name, last_fetched_at, status FROM sources
    WHERE last_fetched_at IS NOT NULL ORDER BY last_fetched_at DESC LIMIT 5
  `);
  console.log('\n=== 最近采集的源 ===');
  for (const r of recent.rows) {
    console.log(`  ${r.last_fetched_at} | ${r.status} | ${r.name}`);
  }

  await db.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });
