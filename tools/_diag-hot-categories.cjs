const fs = require('fs');
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
async function main() {
  const rows = await (await db.execute({ sql: "SELECT key, value FROM settings WHERE key LIKE 'hot%' OR key LIKE 'aihot%'", args: [] })).rows;
  for (const r of rows) console.log(r.key, '=>', String(r.value).slice(0, 260));
  if (!rows.length) console.log('（无 hot* 行）');
  await db.close();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
