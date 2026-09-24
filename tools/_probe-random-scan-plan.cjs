// 只读探针 #18：给"探针自身的读放大"这条记账补一手证据 —— ORDER BY RANDOM() LIMIT 400 到底省不省扫描。
// EXPLAIN 只返回 VDBE 程序，不执行查询 ⇒ 零数据读取。
const fs = require('fs');
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const Q = `EXPLAIN SELECT content_html FROM articles
  WHERE content_html IS NOT NULL AND length(content_html) > 2000
  ORDER BY RANDOM() LIMIT 400`;
(async () => {
  const rows = (await db.execute(Q)).rows;
  console.log(`列名=${Object.keys(rows[0] || {}).join(',')}  总指令数=${rows.length}`);
  for (const r of rows) {
    console.log(`${String(r.addr).padStart(3)} ${String(r.opcode).padEnd(16)} p1=${r.p1} p2=${r.p2} p3=${r.p3} p4=${r.p4 === undefined ? '' : r.p4} ${r.comment || ''}`);
  }
})().catch((e) => { console.error('ERR', e.message); process.exitCode = 1; }).finally(() => db.close());
