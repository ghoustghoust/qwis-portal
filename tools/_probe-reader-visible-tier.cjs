// 只读探针 #16：读者今天打开 /api/daily 实际看到哪一档（"功能正式可用"的正面读数，不看代码看返回）
const fs = require('fs');
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { setGlobalDispatcher, ProxyAgent } = require('undici');
const { createClient } = require('@libsql/client');
// 云端基址全库只许 lib/cloud-site 一份（锁 B64-1 就是为这个红的：探针里手写一次域名，八天后就会漂成 404）
const { CLOUD_SITE, cloudFetch } = require('../lib/cloud-site');
if (process.env.HTTPS_PROXY) setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY));
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

(async () => {
  const r = await cloudFetch(`${CLOUD_SITE}/api/daily`).then((x) => x.json());
  const rep = r.report || {};
  const items = (rep.sections || []).flatMap((s) => s.items || []);
  const bj = (iso) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  console.log('① 云端 /api/daily 实际返回（读者看到的就是这一份）：');
  console.log(`   id=${rep.id}  generated_at=${rep.generated_at}（北京 ${bj(rep.generated_at)}）  schemaVersion=${rep.schemaVersion} ${Number(rep.schemaVersion) >= 2 ? '=AI 增强版' : '=关键词裸版 ⚠️'}`);
  console.log(`   栏目=${(rep.sections || []).length} 条目=${items.length} theme=${rep.theme ? '有' : '无'} degraded=${rep.degraded} issue=${rep.issue} stale=${r.stale}`);
  console.log(`   条目里带封面 ${items.filter((x) => x.cover).length}/${items.length}、带评分 ${items.filter((x) => typeof x.score === 'number').length}/${items.length}、六维齐全 ${items.filter((x) => x.dimensions || x.scores).length}/${items.length}`);

  const rows = (await db.execute("SELECT id, generated_at, json_extract(COALESCE(stats,'{}'),'$.schemaVersion') sv, json_extract(COALESCE(stats,'{}'),'$.elapsedMin') em FROM daily_reports ORDER BY generated_at DESC LIMIT 12")).rows;
  console.log('\n② 库里最近 12 期（落库时刻按北京时间；对照 cron 点位 09:03 / 21:30 / 00:32）：');
  for (const x of rows) console.log(`   id=${String(x.id).padStart(3)} 北京 ${bj(x.generated_at)}  档=${x.sv ?? '(无)'}  elapsedMin=${x.em ?? '-'}`);
  const now = Date.now();
  const in30 = rows.filter((x) => (now - Date.parse(x.generated_at)) / 3600e3 <= 30);
  console.log(`\n③ 30h 窗口内（读层"看得见才有意义"的那批）：${in30.length} 期，其中 AI 档 ${in30.filter((x) => Number(x.sv) >= 2).length} 期`);
  const bjToday = bj(new Date().toISOString()).slice(0, 10);
  const todays = (await db.execute(`SELECT COUNT(*) n, SUM(CASE WHEN json_extract(COALESCE(stats,'{}'),'$.schemaVersion')>=2 THEN 1 ELSE 0 END) ai FROM daily_reports WHERE substr(generated_at,1,10) >= ?`, [new Date(Date.now() - 20 * 3600e3).toISOString().slice(0, 10)])).rows[0];
  console.log(`   近 20h 起算：共 ${todays.n} 期 / AI 档 ${todays.ai} 期 ⇒ 北京日 ${bjToday} 的读者${Number(todays.ai) > 0 ? '有' : '没有'} AI 版可读`);
})().catch((e) => { console.error('ERR', e.message); process.exitCode = 1; }).finally(() => db.close());
