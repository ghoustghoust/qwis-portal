const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// 数据目录默认 data/；测试/性能验证可用环境变量 APP_DATA_DIR 注入独立目录，避免污染真实库
const DATA_DIR = process.env.APP_DATA_DIR
  ? path.resolve(process.env.APP_DATA_DIR)
  : path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,             -- 'article' | 'video'
  name TEXT NOT NULL,
  sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,             -- 'wechat'|'bilibili'|'douyin'|'rss'|'x'
  name TEXT NOT NULL,
  url TEXT,                       -- RSS 链接 / 主页链接
  avatar TEXT,
  uid TEXT,                       -- B站 uid / 抖音 sec_uid
  group_id INTEGER,
  focus INTEGER DEFAULT 0,        -- 重点关照(F18)
  enabled INTEGER DEFAULT 1,
  status TEXT DEFAULT 'ok',       -- ok|error|pending
  last_fetched_at TEXT,
  next_fetch_at TEXT,
  extra TEXT,                     -- JSON：Cookie 引用、平台参数
  created_at TEXT
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
  read_at TEXT,                   -- 已读→历史存档
  later INTEGER DEFAULT 0,        -- 稍后阅读
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER,
  platform TEXT,                  -- bilibili|douyin|youtube
  title TEXT,
  url TEXT UNIQUE,
  vid TEXT,                       -- bvid / 抖音 id / yt id
  cover TEXT,
  duration INTEGER,
  author TEXT,
  intro TEXT,
  published_at TEXT,
  favorite INTEGER DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS pending_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,
  url TEXT,
  name TEXT,
  status TEXT DEFAULT 'pending',  -- pending|resolved|failed
  error TEXT,
  imported_at TEXT
);

CREATE TABLE IF NOT EXISTS daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generated_at TEXT,
  window_hours INTEGER,
  stats TEXT,                     -- JSON：候选数/文章数/视频数
  sections TEXT                   -- JSON：[{column, items:[...]}]
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT                      -- JSON 字符串
);

CREATE TABLE IF NOT EXISTS credentials (
  platform TEXT PRIMARY KEY,
  cookie TEXT,
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_url ON videos(url);
CREATE INDEX IF NOT EXISTS idx_sources_type ON sources(type);
CREATE INDEX IF NOT EXISTS idx_articles_source_read ON articles(source_id, read_at);
`);

// 增量迁移：videos.play_uri（抖音 play_addr.uri，用于播放时换取完整含声音流）
try { db.exec('ALTER TABLE videos ADD COLUMN play_uri TEXT'); } catch { /* 已存在 */ }
// 七期（F1/F2）：AIHOT 富字段——AI 评分/推荐理由/标签/官方精选/英文原文/原文链接
try { db.exec('ALTER TABLE articles ADD COLUMN score INTEGER'); } catch { /* 已存在 */ }
try { db.exec('ALTER TABLE articles ADD COLUMN reason TEXT'); } catch { /* 已存在 */ }
try { db.exec('ALTER TABLE articles ADD COLUMN tags TEXT'); } catch { /* 已存在 */ }
try { db.exec('ALTER TABLE articles ADD COLUMN featured INTEGER DEFAULT 0'); } catch { /* 已存在 */ }
try { db.exec('ALTER TABLE articles ADD COLUMN original_html TEXT'); } catch { /* 已存在 */ }
try { db.exec('ALTER TABLE articles ADD COLUMN original_url TEXT'); } catch { /* 已存在 */ }
// 六期（F4/N5）：日期范围筛选索引
db.exec('CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at)');
db.exec('CREATE INDEX IF NOT EXISTS idx_videos_published ON videos(published_at)');

// 六期（F6）：articles.category 存 feed 的 <category>（AIHOT 分类映射的主依据）
try { db.exec('ALTER TABLE articles ADD COLUMN category TEXT'); } catch { /* 列已存在 */ }
// 增量列迁移（T48）：sources.fail_count 记录连续抓取失败次数（连失 3 次自动暂停）
try { db.exec('ALTER TABLE sources ADD COLUMN fail_count INTEGER DEFAULT 0'); } catch { /* 列已存在 */ }
// 2026-09-05：articles.word_count 正文纯文本字数（写入时剥 HTML 计算；替代 LENGTH(content_html) 的虚高估算）
try { db.exec('ALTER TABLE articles ADD COLUMN word_count INTEGER'); } catch { /* 已存在 */ }
// AI 翻译列：translated_title（翻译标题）、translated_content（翻译正文 HTML）
try { db.exec('ALTER TABLE articles ADD COLUMN translated_title TEXT'); } catch { /* 已存在 */ }
try { db.exec('ALTER TABLE articles ADD COLUMN translated_content TEXT'); } catch { /* 已存在 */ }
// T47：大列表常用过滤/排序补索引（千级数据量实测见 docs/RUNBOOK.md）
db.exec(`
CREATE INDEX IF NOT EXISTS idx_articles_read_at ON articles(read_at);
CREATE INDEX IF NOT EXISTS idx_videos_source ON videos(source_id);
`);

// 重构 Phase 5：任务队列表（SQLite-backed，替代 setInterval + 串行 await）
db.exec(`
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
CREATE INDEX IF NOT EXISTS idx_jq_status_priority ON job_queue(status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_jq_source_status ON job_queue(source_id, status);

-- 3.1 操作审计日志
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user TEXT DEFAULT 'admin',
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);
`);

// 5.2 SQLite 查询缓存层：进程内 LRU 缓存（TTL 30s），写操作自动失效
const _queryCache = new Map();
const QCACHE_TTL = 30000;
const QCACHE_MAX = 100;

function cachedQuery(cacheKey, ttlMs, fetcher) {
  const now = Date.now();
  const entry = _queryCache.get(cacheKey);
  if (entry && now - entry.ts < (ttlMs || QCACHE_TTL)) return entry.val;
  const val = fetcher();
  // LRU 淘汰：超上限时删除最旧条目
  if (_queryCache.size >= QCACHE_MAX) {
    const oldest = _queryCache.keys().next().value;
    _queryCache.delete(oldest);
  }
  _queryCache.set(cacheKey, { val, ts: now });
  return val;
}

function invalidateQueryCache(prefix) {
  if (!prefix) { _queryCache.clear(); return; }
  for (const k of _queryCache.keys()) {
    if (k.startsWith(prefix)) _queryCache.delete(k);
  }
}

function getSetting(key, def = null) {
  return cachedQuery(`setting:${key}`, QCACHE_TTL, () => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!row) return def;
    try { return JSON.parse(row.value); } catch { return def; }
  });
}

function setSetting(key, val) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(val));
  invalidateQueryCache(`setting:${key}`);
}

module.exports = { db, getSetting, setSetting, DATA_DIR, cachedQuery, invalidateQueryCache };
