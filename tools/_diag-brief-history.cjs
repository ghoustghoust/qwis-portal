const fs = require('fs');
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (s) => (await db.execute({ sql: s, args: [] })).rows;

async function main() {
  console.log('daily_reports 总行数 :', JSON.stringify(await q('SELECT COUNT(*) c FROM daily_reports')));
  console.log('近 7 天真实行数      :', JSON.stringify(await q("SELECT COUNT(*) c FROM daily_reports WHERE generated_at >= datetime('now','-7 day')")));
  console.log('接口现在最多露出     : 7 行（LIMIT 7）');
  console.log('近 7 天按天分布      :', JSON.stringify(await q("SELECT substr(generated_at,1,10) d, COUNT(*) c FROM daily_reports WHERE generated_at >= datetime('now','-7 day') GROUP BY d ORDER BY d DESC")));
  console.log('schemaVersion 分布   :', JSON.stringify(await q("SELECT COALESCE(json_extract(stats,'$.schemaVersion'),'-') sv, COUNT(*) c, SUM(CASE WHEN json_extract(stats,'$.degraded')=1 THEN 1 ELSE 0 END) deg FROM daily_reports WHERE generated_at >= datetime('now','-7 day') GROUP BY sv")));
  console.log('LIMIT 7 最旧一行日期 :', JSON.stringify(await q('SELECT substr(generated_at,1,10) d FROM daily_reports ORDER BY id DESC LIMIT 1 OFFSET 6')));
  await db.close();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
