// Turso 云端数据层(portal serverless 专用,十一期 M2)
// 与主系统 server/cloud/db.js 语义对齐,但只保留 portal 需要的子集
const { createClient } = require('@libsql/client/web');

let client = null;

function getClient() {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

async function dbAll(sql, ...args) {
  const r = await getClient().execute({ sql, args });
  return r.rows;
}

async function dbGet(sql, ...args) {
  const r = await getClient().execute({ sql, args });
  return r.rows[0];
}

async function dbRun(sql, ...args) {
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

module.exports = { dbAll, dbGet, dbRun, getSetting, setSetting, nowIso };
