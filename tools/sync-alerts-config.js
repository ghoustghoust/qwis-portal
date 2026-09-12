#!/usr/bin/env node
// 一次性迁移：本地 settings.alerts（渠道配置）→ Turso（15-cloud-alerts F6）
// 用法: node tools/sync-alerts-config.js [--force]
// 默认 Turso 已有非空 channels 时跳过；--force 强制覆盖
const path = require('path');
const fs = require('fs');
const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
for (const line of envTxt.split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const Database = require('better-sqlite3');
const { createClient } = require('@libsql/client');

(async () => {
  const force = process.argv.includes('--force');
  const local = new Database(path.join(__dirname, '..', 'data', 'app.db'), { readonly: true });
  const row = local.prepare("SELECT value FROM settings WHERE key='alerts'").get();
  local.close();
  if (!row) { console.log('本地无 alerts 配置，无需迁移'); process.exitCode = 0; return; }
  const cfg = JSON.parse(row.value);
  const channels = Array.isArray(cfg.channels) ? cfg.channels : [];
  console.log(`本地渠道数: ${channels.length}（${channels.map((c) => `${c.type}:${c.name}`).join(', ') || '无'}）`);

  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const cur = await db.execute("SELECT value FROM settings WHERE key='alerts'");
  if (!force && cur.rows[0]) {
    const curCfg = JSON.parse(cur.rows[0].value);
    if (Array.isArray(curCfg.channels) && curCfg.channels.length) {
      console.log(`Turso 已有 ${curCfg.channels.length} 个渠道，跳过（--force 覆盖）`);
      db.close(); process.exitCode = 0; return;
    }
  }
  await db.execute({ sql: "INSERT OR REPLACE INTO settings(key, value) VALUES('alerts', ?)", args: [JSON.stringify(cfg)] });
  console.log('✅ 已写入 Turso settings.alerts');
  db.close();
  process.exitCode = 0;
})().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
