// 数据管理（七期 F6）：整库快照（db.backup，WAL 安全）/ 在线恢复（八表同事务清插，免重启）/ 按天清理 / 统计
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { db, DATA_DIR } = require('../db');

const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// 恢复覆盖的八张表（顺序无依赖，全部同事务）
const TABLES = ['sources', 'groups', 'articles', 'videos', 'pending_items', 'daily_reports', 'settings', 'credentials'];
// 清理只动这四张内容表（订阅源/设置/登录态不删）
const CLEAN_TABLES = [
  { table: 'articles', col: "COALESCE(published_at, created_at)" },
  { table: 'videos', col: "COALESCE(published_at, created_at)" },
  { table: 'pending_items', col: 'imported_at' },
  { table: 'daily_reports', col: 'generated_at' },
];

function backupName() {
  const t = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `app-${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}.db`;
}

// 生成整库快照 → data/backups/app-*.db，返回 {file, sizeBytes}
async function snapshot() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = backupName();
  const dest = path.join(BACKUP_DIR, file);
  await db.backup(dest);
  const sizeBytes = fs.statSync(dest).size;
  return { file, sizeBytes };
}

// 恢复快照：打开快照库，八表在同一 transaction 里清表+全插（活库免重启）
// 列取快照与当前表交集，兼容旧快照缺新列
function restore(file) {
  const name = String(file || '');
  // 防路径穿越：只允许纯文件名
  if (!/^app-[\w-]*\.db$/.test(name) || name !== path.basename(name)) throw new Error('非法快照文件名');
  const safe = name;
  const src = path.join(BACKUP_DIR, safe);
  if (!fs.existsSync(src)) throw new Error(`快照不存在: ${safe}`);
  const snap = new Database(src, { readonly: true });
  const counts = {};
  try {
    const tx = db.transaction(() => {
      for (const table of TABLES) {
        const snapCols = snap.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
        if (!snapCols.length) { counts[table] = 0; continue; } // 快照里没这张表（旧版）→ 跳过不清
        const curCols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
        const cols = snapCols.filter((c) => curCols.has(c));
        const rows = snap.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(',')} FROM ${table}`).all();
        db.prepare(`DELETE FROM ${table}`).run();
        const ins = db.prepare(
          `INSERT INTO ${table}(${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`
        );
        for (const r of rows) ins.run(...cols.map((c) => r[c]));
        counts[table] = rows.length;
      }
    });
    tx();
  } finally {
    snap.close();
  }
  return { file: safe, restored: counts };
}

// 清理预览/执行共用 where：早于截止日（days 天前）
function cutoffIso(days) {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) throw new Error('保留天数必须为正数');
  return new Date(Date.now() - d * 86400e3).toISOString();
}

// 预览将删除的各表条数（与 cleanup 计数口径一致）
function previewCleanup(days) {
  const cutoff = cutoffIso(days);
  const willDelete = {};
  let total = 0;
  for (const { table, col } of CLEAN_TABLES) {
    const n = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${col} < ?`).get(cutoff).c;
    willDelete[table] = n;
    total += n;
  }
  return { days: Number(days), cutoff, willDelete, total };
}

// 执行清理：只删内容四表老数据（同事务），返回删除数
function cleanup(days) {
  const cutoff = cutoffIso(days);
  const deleted = {};
  let total = 0;
  const tx = db.transaction(() => {
    for (const { table, col } of CLEAN_TABLES) {
      const n = db.prepare(`DELETE FROM ${table} WHERE ${col} < ?`).run(cutoff).changes;
      deleted[table] = n;
      total += n;
    }
  });
  tx();
  return { days: Number(days), cutoff, deleted, total };
}

// 库体积 + 各表条数
function stats() {
  const dbFile = path.join(DATA_DIR, 'app.db');
  let sizeBytes = 0;
  try { sizeBytes = fs.statSync(dbFile).size; } catch { /* 忽略 */ }
  for (const suffix of ['-wal', '-shm']) {
    try { sizeBytes += fs.statSync(dbFile + suffix).size; } catch { /* 无 wal/shm 时忽略 */ }
  }
  const tables = {};
  for (const t of TABLES) {
    tables[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  }
  return { sizeBytes, tables };
}

// 快照列表（新→旧）
function list() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => /^app-.*\.db$/.test(f))
    .map((f) => ({ file: f, sizeBytes: fs.statSync(path.join(BACKUP_DIR, f)).size, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime.toISOString() }))
    .sort((a, b) => b.file.localeCompare(a.file));
}

// 保存上传的快照文件（文件名白名单 + SQLite 文件头校验，防路径穿越/假文件；同名拒绝覆盖，防误毁已有快照）
function saveUpload(name, buf) {
  if (!/^app-[\w-]*\.db$/.test(name) || name !== path.basename(name)) throw new Error('非法快照文件名');
  if (!Buffer.isBuffer(buf) || !buf.length) throw new Error('上传内容为空');
  if (buf.length < 100 || buf.slice(0, 16).toString('latin1') !== 'SQLite format 3\0') {
    throw new Error('不是有效的 SQLite 数据库文件');
  }
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = path.join(BACKUP_DIR, name);
  if (fs.existsSync(dest)) throw new Error(`快照「${name}」已存在，请先删除旧快照或重命名后再上传`);
  fs.writeFileSync(dest, buf);
  return { file: name, sizeBytes: buf.length };
}

module.exports = { snapshot, restore, previewCleanup, cleanup, stats, list, saveUpload, _internals: { BACKUP_DIR, TABLES, CLEAN_TABLES } };
