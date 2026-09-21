/* 一次性（只读）：查 subscription.ids 指向的源到底存不存在，以及候选的真实订阅集合。 */
const fs = require('fs');
const { createClient } = require('@libsql/client');
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const s = await db.execute("SELECT value FROM settings WHERE key='subscription.ids'");
  console.log('settings.subscription.ids =', s.rows[0] ? s.rows[0].value : '(无行)');
  const ids = JSON.parse((s.rows[0] && s.rows[0].value) || '[]');
  if (Array.isArray(ids) && ids.length) {
    const r = await db.execute({ sql: `SELECT id,name,type,enabled,COALESCE(spotlight,0) sp FROM sources WHERE id IN (${ids.map(() => '?').join(',')})`, args: ids });
    console.log('这些 id 在 sources 里的实际行：');
    console.table(r.rows.map((x) => ({ id: x.id, name: String(x.name).slice(0, 24), type: x.type, enabled: x.enabled, spotlight: x.sp })));
    console.log('  → 库里存在', r.rows.length, '个 / 声明', ids.length, '个');
  }
  const t = await db.execute("SELECT id,name,enabled,created_at FROM sources WHERE name LIKE 'TEST%' ORDER BY id DESC LIMIT 8");
  console.log('名字像测试源的行（应已由 after() 清掉）：');
  console.table(t.rows.map((x) => ({ id: x.id, name: String(x.name).slice(0, 20), enabled: x.enabled, created_at: x.created_at })));
  const cand = await db.execute('SELECT count(*) c FROM sources WHERE COALESCE(spotlight,0)=1 AND enabled=1');
  const focus = await db.execute('SELECT count(*) c FROM sources WHERE COALESCE(focus,0)=1');
  console.log('兜底 spotlight 可用源数 =', cand.rows[0].c, '；focus=1 源数 =', focus.rows[0].c);
  await db.close();
})().catch((e) => { console.log('ERR', String(e.message).split('\n')[0]); process.exitCode = 2; });
