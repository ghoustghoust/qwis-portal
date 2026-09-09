const fs = require('fs');
const path = require('path');

// 手动加载 .env
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  console.log('=== Turso 连接测试 ===');
  try {
    const r = await db.execute('SELECT 1 as ok');
    console.log('连接成功:', JSON.stringify(r.rows));
  } catch (e) {
    console.log('连接失败:', e.message);
    process.exit(1);
  }

  console.log('\n=== Turso 最新 5 篇 (按 published_at) ===');
  try {
    const r = await db.execute(`
      SELECT a.id, a.title, a.published_at, a.created_at, s.name as source_name, s.type as source_type
      FROM articles a LEFT JOIN sources s ON a.source_id = s.id
      ORDER BY a.published_at DESC LIMIT 5
    `);
    for (const row of r.rows) console.log(JSON.stringify(row));
  } catch (e) { console.log('查询失败:', e.message); }

  console.log('\n=== Turso 最新 5 篇 (按 created_at) ===');
  try {
    const r = await db.execute(`
      SELECT a.id, a.title, a.published_at, a.created_at, s.name as source_name
      FROM articles a LEFT JOIN sources s ON a.source_id = s.id
      ORDER BY a.created_at DESC LIMIT 5
    `);
    for (const row of r.rows) console.log(JSON.stringify(row));
  } catch (e) { console.log('查询失败:', e.message); }

  console.log('\n=== Turso 到期源 (next_fetch_at <= now) ===');
  try {
    const now = new Date().toISOString();
    const r = await db.execute({
      sql: `SELECT id, name, type, status, last_fetched_at, next_fetch_at, enabled
            FROM sources WHERE enabled=1 AND type != 'wemp'
            AND (next_fetch_at IS NULL OR next_fetch_at <= ?)
            ORDER BY next_fetch_at ASC LIMIT 10`,
      args: [now],
    });
    console.log('到期源数量:', r.rows.length);
    for (const row of r.rows) console.log(JSON.stringify(row));
  } catch (e) { console.log('查询失败:', e.message); }

  console.log('\n=== Turso 最近采集的 10 个源 ===');
  try {
    const r = await db.execute(`
      SELECT name, type, status, last_fetched_at, next_fetch_at, enabled
      FROM sources ORDER BY last_fetched_at DESC LIMIT 10
    `);
    for (const row of r.rows) console.log(JSON.stringify(row));
  } catch (e) { console.log('查询失败:', e.message); }

  console.log('\n=== Turso 24h 内入库文章数 ===');
  try {
    const r = await db.execute(`
      SELECT COUNT(*) as cnt FROM articles WHERE created_at > datetime('now', '-24 hours')
    `);
    console.log(JSON.stringify(r.rows[0]));
  } catch (e) { console.log('查询失败:', e.message); }

  console.log('\n=== Turso 各源最近入库时间 ===');
  try {
    const r = await db.execute(`
      SELECT s.name, s.type, MAX(a.created_at) as last_article
      FROM sources s LEFT JOIN articles a ON s.id = a.source_id
      WHERE s.enabled = 1
      GROUP BY s.id ORDER BY last_article DESC LIMIT 10
    `);
    for (const row of r.rows) console.log(JSON.stringify(row));
  } catch (e) { console.log('查询失败:', e.message); }

  console.log('\n=== Turso 源总数 / 启用数 ===');
  try {
    const r = await db.execute(`
      SELECT COUNT(*) as total, SUM(CASE WHEN enabled=1 THEN 1 ELSE 0 END) as enabled_cnt
      FROM sources
    `);
    console.log(JSON.stringify(r.rows[0]));
  } catch (e) { console.log('查询失败:', e.message); }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
