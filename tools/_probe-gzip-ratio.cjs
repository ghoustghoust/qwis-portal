// 只读探针 #15：正文 gzip 比实测（把"控制台 170MB vs 逻辑 1.1GB"那条推断换成能自己复算的数）
// ⚠️ "只抽 400 行"省的是**常驻内存**，不省扫描：`ORDER BY RANDOM()` 要先给每一行发随机键，
//    VDBE 实测（探针 #18）回路内就取三次 content_html ⇒ 这一趟等于全列扫一遍（09-24 夜更正，此前注释写错了）。
const fs = require('fs');
const zlib = require('zlib');
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const MB = (b) => (Number(b || 0) / 1048576).toFixed(1);
(async () => {
  const rows = (await db.execute(`SELECT content_html FROM articles
    WHERE content_html IS NOT NULL AND length(content_html) > 2000
    ORDER BY RANDOM() LIMIT 400`)).rows;
  let raw = 0, gz = 0, worst = 0;
  for (const r of rows) {
    const buf = Buffer.from(String(r.content_html), 'utf8');
    raw += buf.length;
    const c = zlib.gzipSync(buf, { level: 9 }).length;
    gz += c;
    worst = Math.max(worst, buf.length);
  }
  console.log(`抽样 ${rows.length} 行（正文合计 ${MB(raw)} MB，单篇最大 ${MB(worst)} MB）`);
  const ratio = raw / gz;
  console.log(`gzip-9 之后 ${MB(gz)} MB ⇒ **压缩比 ${ratio.toFixed(2)}×**`);
  console.log(`按同一比率外推：全列 587 MB 正文若入库前压缩 ⇒ 约 ${(587 / ratio).toFixed(0)} MB（省 ${(100 - 100 / ratio).toFixed(0)}%）`);
  console.log('注意：这只证明**列内自压**的收益量级；Turso 控制台的 170MB 是否同一口径仍未证（本仓无平台 token），两者不要混用。');
})().catch((e) => { console.error('ERR', e.message); process.exitCode = 1; }).finally(() => db.close());
