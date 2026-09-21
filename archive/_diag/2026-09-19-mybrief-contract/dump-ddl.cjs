/* 一次性（只读）：导出 B83 迁移要的三张表 DDL，好让测试能在本地文件库里建出与生产一致的结构。
   刻意只做 SELECT sqlite_master —— 不写任何数据。用完即归档。 */
const fs = require('fs');
const { createClient } = require('@libsql/client');
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const r = await db.execute("SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN ('settings','sources','audit_log') ORDER BY name");
  for (const row of r.rows) console.log('/*====*/\n' + row.sql + ';');
  await db.close();
})().catch((e) => { console.log('ERR', String(e.message).split('\n')[0]); process.exitCode = 2; });
