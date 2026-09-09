const Database = require('better-sqlite3');
const db = new Database('./data/app.db', { readonly: true });

console.log('=== articles 表 schema ===');
const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='articles'").get();
console.log(schema.sql);

console.log('\n=== 最新 5 篇 (按 published_at) ===');
const rows1 = db.prepare(`
  SELECT a.id, a.title, a.published_at, a.created_at, s.name as source_name, s.type as source_type
  FROM articles a LEFT JOIN sources s ON a.source_id = s.id
  ORDER BY a.published_at DESC LIMIT 5
`).all();
rows1.forEach(r => console.log(JSON.stringify(r)));

console.log('\n=== 最新 5 篇 (按 created_at / 入库时间) ===');
const rows2 = db.prepare(`
  SELECT a.id, a.title, a.published_at, a.created_at, s.name as source_name
  FROM articles a LEFT JOIN sources s ON a.source_id = s.id
  ORDER BY a.created_at DESC LIMIT 5
`).all();
rows2.forEach(r => console.log(JSON.stringify(r)));

console.log('\n=== 最近采集的 10 个源 ===');
const rows3 = db.prepare(`
  SELECT name, type, status, last_fetched_at, next_fetch_at
  FROM sources WHERE status = 'enabled'
  ORDER BY last_fetched_at DESC LIMIT 10
`).all();
rows3.forEach(r => console.log(JSON.stringify(r)));

console.log('\n=== 24h 内入库的文章数 ===');
const count = db.prepare(`
  SELECT COUNT(*) as cnt FROM articles WHERE created_at > datetime('now', '-24 hours')
`).get();
console.log(JSON.stringify(count));

console.log('\n=== 各源最近入库时间 ===');
const rows4 = db.prepare(`
  SELECT s.name, s.type, MAX(a.created_at) as last_article
  FROM sources s LEFT JOIN articles a ON s.id = a.source_id
  WHERE s.status = 'enabled'
  GROUP BY s.id ORDER BY last_article DESC LIMIT 15
`).all();
rows4.forEach(r => console.log(JSON.stringify(r)));

db.close();
