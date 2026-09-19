// 一次性取证（不提交）：B20 门槛在真实取数窗口上的"杀伤面"——
// 未评分（NULL）/ 低分（<30）/ 高分各多少，接上门槛后还剩多少条出报。
const fs = require('fs');
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { createClient } = require('@libsql/client');

const SQL = `SELECT a.score s FROM articles a LEFT JOIN sources sm ON sm.id=a.source_id
  WHERE a.published_at>=? AND a.published_at<=? AND sm.enabled=1
    AND sm.type IN ('wechat','rss','x')
    AND sm.type!='hotlist' AND COALESCE(json_extract(COALESCE(sm.extra,'{}'),'$.aggregator'),0)!=1
  ORDER BY a.published_at DESC LIMIT 500`;

(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const now = new Date(), bj = new Date(now.getTime() + 8 * 3600e3);
  const ts = new Date(bj); ts.setUTCHours(0, 0, 0, 0);
  const cutS = new Date(ts.getTime() - 24 * 3600e3 - 8 * 3600e3).toISOString();
  const cutE = new Date(ts.getTime() + 6 * 3600e3 - 8 * 3600e3).toISOString();
  const rows = (await db.execute({ sql: SQL, args: [cutS, cutE] })).rows;
  const nul = rows.filter((x) => x.s === null || x.s === undefined).length;
  const low = rows.filter((x) => typeof x.s === 'number' && x.s < 30).length;
  const high = rows.filter((x) => typeof x.s === 'number' && x.s >= 30).length;
  console.log(`窗口 ${cutS.slice(0, 16)} ~ ${cutE.slice(0, 16)}`);
  console.log(`候选 ${rows.length} 条 | NULL 未评分(放行) ${nul} | <30(将被剔) ${low} | >=30 ${high}`);
  console.log(`门槛后剩余 ${rows.length - low} 条（若按旧实现 Number(null)===0 会把 ${nul} 条 NULL 一起杀掉，剩余 ${high} 条）`);
  const dist = {};
  for (const x of rows) { const k = x.s === null ? 'NULL' : (Math.floor(x.s / 10) * 10); dist[k] = (dist[k] || 0) + 1; }
  console.log('分布(按 10 分档):', JSON.stringify(dist));
})().catch((e) => { console.log('ERR', e.message); process.exitCode = 1; });
