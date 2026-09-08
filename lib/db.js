// 统一异步数据访问层 —— 全网情报系统 Vercel 迁移核心
// 本地模式: better-sqlite3（同步包装为 async 接口）
// 云端模式: @libsql/client（Turso HTTP 协议，Serverless 友好）
// 切换条件: 设置 TURSO_DATABASE_URL 环境变量即走云端，否则走本地
//
// 用法:
//   const { dbAll, dbGet, dbRun, dbExec, getSetting, setSetting, ensureSchema, nowIso, IS_CLOUD } = require('../lib/db');
//   const rows = await dbAll('SELECT * FROM articles WHERE source_id = ?', sourceId);

const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.APP_DATA_DIR
  ? path.resolve(process.env.APP_DATA_DIR)
  : path.join(__dirname, '..', 'data');

const IS_CLOUD = !!process.env.TURSO_DATABASE_URL;
let localDb = null;
let cloudClient = null;
let schemaReady = null;

// ─── 连接管理 ───

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
    const { createClient } = require('@libsql/client');
    cloudClient = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return cloudClient;
}

// ─── 统一异步查询接口 ───

async function dbAll(sql, ...args) {
  if (IS_CLOUD) {
    const r = await getCloud().execute({ sql, args });
    return Array.from(r.rows);
  }
  return getLocal().prepare(sql).all(...args);
}

async function dbGet(sql, ...args) {
  if (IS_CLOUD) {
    const r = await getCloud().execute({ sql, args });
    const rows = Array.from(r.rows);
    return rows[0] || undefined;
  }
  return getLocal().prepare(sql).get(...args);
}

async function dbRun(sql, ...args) {
  if (IS_CLOUD) {
    const r = await getCloud().execute({ sql, args });
    return {
      changes: r.rowsAffected,
      lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : undefined,
    };
  }
  const result = getLocal().prepare(sql).run(...args);
  return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
}

async function dbExec(sql) {
  if (IS_CLOUD) {
    // Turso 不支持多语句 execute，需逐条发送
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const s of statements) {
      await getCloud().execute(s);
    }
    return;
  }
  getLocal().exec(sql);
}

// 批量执行（事务）——迁移脚本和采集写入用
async function dbBatch(statements) {
  if (IS_CLOUD) {
    // Turso batch API：原子执行一组语句
    const { batch } = getCloud();
    const steps = statements.map(sql => ({ q: sql }));
    await batch(steps);
    return;
  }
  const db = getLocal();
  const txn = db.transaction(() => {
    for (const sql of statements) {
      db.exec(sql);
    }
  });
  txn();
}

// ─── Schema 定义（完整对齐 server/db.js，修复 cloud/db.js 已知漂移） ───

const SCHEMA = `
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  avatar TEXT,
  uid TEXT,
  group_id INTEGER,
  focus INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  status TEXT DEFAULT 'ok',
  last_fetched_at TEXT,
  next_fetch_at TEXT,
  extra TEXT,
  created_at TEXT,
  fail_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER,
  title TEXT,
  url TEXT UNIQUE,
  author TEXT,
  cover TEXT,
  summary TEXT,
  content_html TEXT,
  published_at TEXT,
  read_at TEXT,
  later INTEGER DEFAULT 0,
  created_at TEXT,
  score INTEGER,
  reason TEXT,
  tags TEXT,
  featured INTEGER DEFAULT 0,
  original_html TEXT,
  original_url TEXT,
  category TEXT,
  word_count INTEGER
);

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER,
  platform TEXT,
  title TEXT,
  url TEXT UNIQUE,
  vid TEXT,
  cover TEXT,
  duration INTEGER,
  author TEXT,
  intro TEXT,
  published_at TEXT,
  favorite INTEGER DEFAULT 0,
  created_at TEXT,
  play_uri TEXT
);

CREATE TABLE IF NOT EXISTS pending_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,
  url TEXT,
  name TEXT,
  status TEXT DEFAULT 'pending',
  error TEXT,
  imported_at TEXT
);

CREATE TABLE IF NOT EXISTS daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generated_at TEXT,
  window_hours INTEGER,
  stats TEXT,
  sections TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS credentials (
  platform TEXT PRIMARY KEY,
  cookie TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS job_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  retries INTEGER DEFAULT 3,
  attempts INTEGER DEFAULT 0,
  source_id INTEGER,
  error TEXT,
  created_at TEXT,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user TEXT DEFAULT 'admin',
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  ip TEXT
);

CREATE TABLE IF NOT EXISTS articles_archive (
  id INTEGER PRIMARY KEY,
  source_id INTEGER,
  title TEXT,
  url TEXT,
  author TEXT,
  cover TEXT,
  summary TEXT,
  content_html TEXT,
  published_at TEXT,
  read_at TEXT,
  later INTEGER DEFAULT 0,
  created_at TEXT,
  score INTEGER,
  reason TEXT,
  tags TEXT,
  featured INTEGER DEFAULT 0,
  original_html TEXT,
  original_url TEXT,
  category TEXT,
  word_count INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_url ON videos(url);
CREATE INDEX IF NOT EXISTS idx_sources_type ON sources(type);
CREATE INDEX IF NOT EXISTS idx_articles_source_read ON articles(source_id, read_at);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at);
CREATE INDEX IF NOT EXISTS idx_videos_published ON videos(published_at);
CREATE INDEX IF NOT EXISTS idx_articles_read_at ON articles(read_at);
CREATE INDEX IF NOT EXISTS idx_videos_source ON videos(source_id);
CREATE INDEX IF NOT EXISTS idx_jq_status_priority ON job_queue(status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_jq_source_status ON job_queue(source_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);
CREATE INDEX IF NOT EXISTS idx_archive_published ON articles_archive(published_at);
CREATE INDEX IF NOT EXISTS idx_archive_source ON articles_archive(source_id);
`;

// 增量 ALTER（对已有数据库补列，幂等）
const ALTERS = [
  // 这些列已包含上面的 CREATE TABLE IF NOT EXISTS 中，
  // 但如果数据库是从旧版 schema 创建的，需要补列
  'ALTER TABLE videos ADD COLUMN play_uri TEXT',
  'ALTER TABLE articles ADD COLUMN score INTEGER',
  'ALTER TABLE articles ADD COLUMN reason TEXT',
  'ALTER TABLE articles ADD COLUMN tags TEXT',
  'ALTER TABLE articles ADD COLUMN featured INTEGER DEFAULT 0',
  'ALTER TABLE articles ADD COLUMN original_html TEXT',
  'ALTER TABLE articles ADD COLUMN original_url TEXT',
  'ALTER TABLE articles ADD COLUMN category TEXT',
  'ALTER TABLE articles ADD COLUMN word_count INTEGER',
  'ALTER TABLE sources ADD COLUMN fail_count INTEGER DEFAULT 0',
];

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await dbExec(SCHEMA);
      // 幂等补列（已存在则忽略错误）
      for (const alter of ALTERS) {
        try { await dbRun(alter); } catch { /* 列已存在 */ }
      }
    })();
  }
  return schemaReady;
}

// ─── Settings 读写 ───

async function getSetting(key, def = null) {
  await ensureSchema();
  const row = await dbGet('SELECT value FROM settings WHERE key = ?', key);
  if (!row) return def;
  try { return JSON.parse(row.value); } catch { return def; }
}

async function setSetting(key, val) {
  await ensureSchema();
  await dbRun(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, JSON.stringify(val)
  );
}

// ─── 工具函数 ───

function nowIso() {
  return new Date().toISOString();
}

// 关闭连接（进程退出时调用）
async function close() {
  if (localDb) {
    localDb.close();
    localDb = null;
  }
  if (cloudClient) {
    cloudClient.close();
    cloudClient = null;
  }
  schemaReady = null;
}

module.exports = {
  // 查询接口
  dbAll, dbGet, dbRun, dbExec, dbBatch,
  // Schema
  ensureSchema, SCHEMA, ALTERS,
  // Settings
  getSetting, setSetting,
  // 工具
  nowIso, close, IS_CLOUD, DATA_DIR,
  // 连接（测试/迁移用）
  getLocal, getCloud,
};
