// 统一异步数据访问层(十一期 M1)
// 本地模式: better-sqlite3(同步包装成异步接口)
// 云端模式: @libsql/client(Turso),由 TURSO_DATABASE_URL 环境变量切换
// 用法: const { dbAll, dbGet, dbRun, dbExec, getSetting, setSetting, nowIso } = require('./db');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.APP_DATA_DIR
  ? path.resolve(process.env.APP_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');

const IS_CLOUD = !!process.env.TURSO_DATABASE_URL;
let localDb = null;
let cloudClient = null;
let schemaReady = null;

function getLocal() {
  if (!localDb) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const Database = require('better-sqlite3');
    localDb = new Database(path.join(DATA_DIR, 'app.db'));
    localDb.pragma('journal_mode = WAL');
  }
  return localDb;
}

function getCloud() {
  if (!cloudClient) {
    const { createClient } = require('@libsql/client/web');
    cloudClient = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return cloudClient;
}

// ---- 统一接口 ----
async function dbAll(sql, ...args) {
  if (IS_CLOUD) {
    const r = await getCloud().execute({ sql, args });
    return r.rows;
  }
  return getLocal().prepare(sql).all(...args);
}

async function dbGet(sql, ...args) {
  if (IS_CLOUD) {
    const r = await getCloud().execute({ sql, args });
    return r.rows[0];
  }
  return getLocal().prepare(sql).get(...args);
}

async function dbRun(sql, ...args) {
  if (IS_CLOUD) {
    const r = await getCloud().execute({ sql, args });
    return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : undefined };
  }
  return getLocal().prepare(sql).run(...args);
}

async function dbExec(sql) {
  if (IS_CLOUD) {
    const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
    for (const s of statements) await getCloud().execute(s);
    return;
  }
  getLocal().exec(sql);
}

// ---- schema 初始化(幂等,两种模式共用同一套 DDL) ----
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

async function ensureSchema() {
  if (!schemaReady) schemaReady = dbExec(SCHEMA);
  return schemaReady;
}

// ---- settings(key-value JSON) ----
async function getSetting(key, def) {
  await ensureSchema();
  const row = await dbGet('SELECT value FROM settings WHERE key=?', key);
  if (!row) return def;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

async function setSetting(key, value) {
  await ensureSchema();
  await dbRun('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    key, JSON.stringify(value));
}

function nowIso() { return new Date().toISOString(); }

module.exports = { dbAll, dbGet, dbRun, dbExec, getSetting, setSetting, nowIso, ensureSchema, IS_CLOUD };
