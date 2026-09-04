// Turso 云端数据层(portal serverless 专用,十一期 M2)
// 与主系统 server/cloud/db.js 语义对齐,但只保留 portal 需要的子集
// 含幂等 ensureSchema + ALTER 迁移:建表不再依赖 seed-turso 顺序,首次访问自动自愈(2026-09 修复)
const { createClient } = require('@libsql/client/web');

let client = null;
let schemaReady = null;

function getClient() {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

// ---- schema 初始化(幂等,与 server/cloud/db.js SCHEMA 同构,双端同步维护) ----
const SCHEMA = `
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, name TEXT NOT NULL, sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, name TEXT NOT NULL, url TEXT, avatar TEXT,
  uid TEXT, group_id INTEGER, focus INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, status TEXT DEFAULT 'ok',
  last_fetched_at TEXT, next_fetch_at TEXT, extra TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER, title TEXT, url TEXT UNIQUE, author TEXT,
  cover TEXT, summary TEXT, content_html TEXT, published_at TEXT, read_at TEXT, later INTEGER DEFAULT 0, created_at TEXT
);
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER, platform TEXT, title TEXT, url TEXT UNIQUE,
  vid TEXT, cover TEXT, duration INTEGER, author TEXT, intro TEXT, published_at TEXT,
  favorite INTEGER DEFAULT 0, created_at TEXT, watched_at TEXT, play_uri TEXT
);
CREATE TABLE IF NOT EXISTS daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, generated_at TEXT, window_hours INTEGER, sections TEXT, stats TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS credentials (platform TEXT PRIMARY KEY, data TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source_id);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at);
`;

async function dbExec(sql) {
  const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
  for (const s of statements) await getClient().execute(s);
}

// 幂等 ALTER 迁移:老库补富字段列(本地 server/db.js 增量迁移的云端对齐版)
// 直接用 getClient() 执行,避免经 dbAll/dbRun 再次触发 ensureSchema 造成递归
async function migrate() {
  const c = getClient();
  const artCols = (await c.execute('PRAGMA table_info(articles)')).rows.map((r) => r.name);
  const artAdd = [
    ['category', 'category TEXT'],
    ['original_url', 'original_url TEXT'],
    ['score', 'score INTEGER'],
    ['reason', 'reason TEXT'],
    ['tags', 'tags TEXT'],
    ['featured', 'featured INTEGER DEFAULT 0'],
    ['original_html', 'original_html TEXT'],
  ];
  for (const [name, ddl] of artAdd) {
    if (!artCols.includes(name)) await c.execute(`ALTER TABLE articles ADD COLUMN ${ddl}`);
  }
  const srcCols = (await c.execute('PRAGMA table_info(sources)')).rows.map((r) => r.name);
  if (!srcCols.includes('fail_count')) await c.execute('ALTER TABLE sources ADD COLUMN fail_count INTEGER DEFAULT 0');
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await dbExec(SCHEMA);
      await migrate();
    })().catch((err) => {
      schemaReady = null; // 失败允许下次重试
      throw err;
    });
  }
  return schemaReady;
}

async function dbAll(sql, ...args) {
  await ensureSchema();
  const r = await getClient().execute({ sql, args });
  return r.rows;
}

async function dbGet(sql, ...args) {
  await ensureSchema();
  const r = await getClient().execute({ sql, args });
  return r.rows[0];
}

async function dbRun(sql, ...args) {
  await ensureSchema();
  const r = await getClient().execute({ sql, args });
  return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : undefined };
}

// settings(key-value JSON)
async function getSetting(key, def) {
  const row = await dbGet('SELECT value FROM settings WHERE key=?', key);
  if (!row) return def;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

async function setSetting(key, value) {
  await dbRun(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    key, JSON.stringify(value)
  );
}

function nowIso() { return new Date().toISOString(); }

module.exports = { dbAll, dbGet, dbRun, dbExec, getSetting, setSetting, nowIso, ensureSchema };
