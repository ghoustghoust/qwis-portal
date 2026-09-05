// 备份/恢复服务（F26）：sources/groups/settings → data/backups/subscriptions-yyyymmdd-hhmmss.json
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('../db');
const { nowIso } = require('../util/time');

const BACKUP_DIR = path.join(DATA_DIR, 'backups');

function ensureDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function timestamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function listBackups() {
  ensureDir();
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => /^subscriptions-\d{8}-\d{6}\.json$/.test(f))
    .sort()
    .reverse();
}

function backup() {
  ensureDir();
  const sources = db.prepare('SELECT * FROM sources').all();
  const groups = db.prepare('SELECT * FROM groups').all();
  const settings = db.prepare('SELECT * FROM settings').all();
  const data = { created_at: nowIso(), sources, groups, settings };
  const file = `subscriptions-${timestamp()}.json`;
  fs.writeFileSync(path.join(BACKUP_DIR, file), JSON.stringify(data, null, 2), 'utf8');
  return { file, time: data.created_at, count: sources.length };
}

function latest() {
  const file = listBackups()[0];
  if (!file) return null;
  try {
    const data = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, file), 'utf8'));
    return { file, time: data.created_at || null, count: (data.sources || []).length };
  } catch {
    return { file, time: null, count: 0 };
  }
}

// 读最新备份覆盖 sources/groups/settings
function restore() {
  const file = listBackups()[0];
  if (!file) throw new Error('没有找到备份文件');
  const data = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, file), 'utf8'));
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM sources').run();
    db.prepare('DELETE FROM groups').run();
    db.prepare('DELETE FROM settings').run();
    const insSource = db.prepare(`INSERT INTO sources(id, type, name, url, avatar, uid, group_id, focus, enabled, status, last_fetched_at, next_fetch_at, extra, created_at)
      VALUES (@id, @type, @name, @url, @avatar, @uid, @group_id, @focus, @enabled, @status, @last_fetched_at, @next_fetch_at, @extra, @created_at)`);
    for (const s of data.sources || []) {
      insSource.run({
        id: s.id, type: s.type, name: s.name, url: s.url ?? null, avatar: s.avatar ?? null,
        uid: s.uid ?? null, group_id: s.group_id ?? null, focus: s.focus ?? 0, enabled: s.enabled ?? 1,
        status: s.status ?? 'ok', last_fetched_at: s.last_fetched_at ?? null,
        next_fetch_at: s.next_fetch_at ?? null, extra: s.extra ?? null, created_at: s.created_at ?? null,
      });
    }
    const insGroup = db.prepare('INSERT INTO groups(id, kind, name, sort) VALUES (@id, @kind, @name, @sort)');
    for (const g of data.groups || []) {
      insGroup.run({ id: g.id, kind: g.kind, name: g.name, sort: g.sort ?? 0 });
    }
    const insSetting = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?)');
    for (const row of data.settings || []) {
      insSetting.run(row.key, row.value);
    }
  });
  tx();
  return { file, count: (data.sources || []).length };
}

module.exports = { backup, restore, latest, listBackups };
