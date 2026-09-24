// 只读核对 #23：那 14 次"AI job 成功但新库里没行"到底是静默丢写，还是换库边界（行在老库）。
// 判据形态：在**老库**（TURSO_DATABASE_URL_OLD，本项目明令不许删、它是唯一回读来源）里按同一批日期数 AI 档行。
// 全程 SELECT；两库都不写。
const fs = require('fs');
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { createClient } = require('@libsql/client');
const S = "json_extract(COALESCE(stats,'{}'),";
const WINDOWS = ['2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'];
async function count(label, envKey, envToken) {
  const url = process.env[envKey];
  if (!url) { console.log(`${label}：未配置 ${envKey} ⇒ 无法核对`); return; }
  const db = createClient({ url, authToken: process.env[envToken] || undefined });
  try {
    const all = (await db.execute(`SELECT COUNT(*) n, MIN(generated_at) a, MAX(generated_at) b FROM daily_reports`)).rows[0];
    console.log(`\n【${label}】daily_reports 总行=${all.n}，区间 ${all.a} → ${all.b}`);
    for (const d of WINDOWS) {
      const r = (await db.execute({ sql: `SELECT COUNT(*) n, SUM(CASE WHEN ${S}'$.schemaVersion') >= 2 THEN 1 ELSE 0 END) ai,
          SUM(CASE WHEN ${S}'$.theme') IS NOT NULL THEN 1 ELSE 0 END) themed
        FROM daily_reports WHERE substr(generated_at,1,10) = ?`, args: [d] })).rows[0];
      console.log(`  ${d} 行=${String(r.n ?? 0).padStart(2)}  AI 档=${String(r.ai ?? 0).padStart(2)}  带导语=${String(r.themed ?? 0).padStart(2)}`);
    }
  } catch (e) {
    console.log(`\n【${label}】查询失败：${e.message.slice(0, 120)}（老库可能因配额被读封锁，这本身也是要记的事实）`);
  } finally { await db.close(); }
}
(async () => {
  await count('新库（现役）', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN');
  await count('老库（换库前）', 'TURSO_DATABASE_URL_OLD', 'TURSO_AUTH_TOKEN_OLD');
  console.log('\n读法：若老库在 09-12~09-19 每天都有 AI 档行 ⇒ "14 次成功没落库"是**换库边界**，不是丢写；');
  console.log('      若老库也没有 ⇒ 才是真洞（那 14 次成功到底写到哪去了），要单开一条 P0 工单。');
})().catch((e) => { console.error('ERR', e.message.slice(0, 200)); process.exitCode = 1; });
