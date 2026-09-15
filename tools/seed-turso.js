// 十一期 M1:把本地 sources/groups 灌入 Turso 云端库(幂等,按 url 去重)
// 手动加载 .env(不依赖 dotenv 包)
const fs0 = require('fs');
const envTxt = fs0.readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8');
for (const line of envTxt.split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { db } = require('../server/db'); // 本地
const cdb = require('../server/cloud/db'); // 云端(TURSO_* env)

async function main() {
  await cdb.ensureSchema();
  // 27b：cloud/db.js 为冻结旧 schema（无四轴列），灌库前幂等补列
  for (const alter of require('../lib/source-axes').AXES_ALTERS) {
    try { await cdb.dbRun(alter); } catch { /* 列已存在 */ }
  }
  // groups
  const groups = db.prepare('SELECT * FROM groups').all();
  for (const g of groups) {
    await cdb.dbRun(
      'INSERT INTO groups(id,kind,name,sort) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort=excluded.sort',
      g.id, g.kind, g.name, g.sort
    );
  }
  // sources（27b：四轴列一并灌入；focus 已退役但保留同步以兼容旧副本）
  const sources = db.prepare('SELECT * FROM sources').all();
  let n = 0;
  for (const s of sources) {
    await cdb.dbRun(
      `INSERT INTO sources(id,type,name,url,avatar,uid,group_id,focus,spotlight,muted,reader_visible,enabled,status,last_fetched_at,next_fetch_at,extra,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, group_id=excluded.group_id, spotlight=excluded.spotlight, muted=excluded.muted, reader_visible=excluded.reader_visible, enabled=excluded.enabled, extra=excluded.extra`,
      s.id, s.type, s.name, s.url, s.avatar, s.uid, s.group_id, s.focus ?? 0, s.spotlight ?? 0, s.muted ?? 0, s.reader_visible ?? 1, s.enabled, s.status,
      s.last_fetched_at, s.next_fetch_at, s.extra, s.created_at
    );
    n++;
  }
  // we-mp-rss 已于 2026-09-04 退役，weread 凭据同步不再需要
  console.log(`灌库完成: groups ${groups.length}, sources ${n}`);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
