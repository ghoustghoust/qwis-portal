// 一次性取证（不提交，按 tools/_diag-* 惯例）：
//  ① 线上日报是否真被 B20 门槛挡住低分条目  ② /api/mybrief 的阅读计数是否仍被 read_at='null' 毒害
const fs = require('fs');
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { createClient } = require('@libsql/client');
const { cloudFetch } = require('../lib/cloud-site');

(async () => {
  const meta = await (await cloudFetch('/api/meta')).json();
  const local = require('child_process').execSync('git rev-parse --short=7 origin/main').toString().trim();
  console.log(`META commit=${meta.commit} origin/main=${local} 一致=${String(meta.commit).startsWith(local) || local.startsWith(String(meta.commit))}`);

  const daily = await (await cloudFetch('/api/daily')).json();
  const r = daily.report || daily;
  const items = [];
  for (const sec of r.sections || []) for (const it of sec.items || []) items.push({ score: it.score, col: sec.key || sec.id, title: (it.title || '').slice(0, 26) });
  const scored = items.filter((x) => typeof x.score === 'number');
  const low = scored.filter((x) => x.score < 30);
  console.log(`DAILY id=${r.id} generated_at=${r.generated_at} schemaVersion=${r.schemaVersion} 条目=${items.length} 带分=${scored.length} ` +
    `min=${scored.length ? Math.min(...scored.map((x) => x.score)) : 'n/a'} 低于30=${low.length}`);
  if (low.length) console.log('  低分条目:', JSON.stringify(low.slice(0, 6)));

  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const one = async (sql) => (await db.execute(sql)).rows[0];
  const x = await one(`SELECT COUNT(*) n,
    SUM(CASE WHEN read_at='null' THEN 1 ELSE 0 END) lit_null,
    SUM(CASE WHEN read_at LIKE '____-__-__T%' THEN 1 ELSE 0 END) iso
  FROM articles WHERE read_at IS NOT NULL`);
  console.log(`READ 非空 read_at=${Number(x.n)} 字面'null'=${Number(x.lit_null)} 真 ISO=${Number(x.iso)}`);
  const mb = await (await cloudFetch('/api/mybrief')).json();
  console.log('MYBRIEF digest =', JSON.stringify(mb.digest || mb.reading || null).slice(0, 160));
})().catch((e) => { console.error('ERR', e.message); process.exitCode = 1; });
