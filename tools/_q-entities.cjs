// 一次性取证（不提交）：B94 实体未解码的**真实面积**——源名 / 文章标题 / 文章摘要各有多少带 XML 实体。
// ⚠️ 匹配必须写成 `'%&amp;%'`（包含）——上一版把若干模式写成 `'&amp;%'`（**前缀**），
//    于是同一张表同时得到"源名 0 条"与"6 条"两个数；这类判据少一个 % 就会假绿（坑 #41 同族）。
const fs = require('fs');
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { createClient } = require('@libsql/client');
const ENTITIES = ['&amp;', '&quot;', '&#39;', '&apos;', '&lt;', '&gt;', '&nbsp;', '&ldquo;', '&rdquo;', '&mdash;', '&ndash;', '&#8217;'];
const cond = ENTITIES.map((e) => `col LIKE '%${e}%'`).join(' OR ');

const q = async (db, sql) => (await db.execute(sql)).rows;

(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const total = (await q(db, 'SELECT (SELECT COUNT(*) FROM sources) s, (SELECT COUNT(*) FROM articles) a, (SELECT COUNT(*) FROM videos) v'))[0];
  console.log(`总量：sources=${Number(total.s)} articles=${Number(total.a)} videos=${Number(total.v)}`);
  for (const [label, table, col] of [['源名', 'sources', 'name'], ['文章标题', 'articles', 'title'], ['文章摘要', 'articles', 'summary']]) {
    const rows = await q(db, `SELECT COUNT(*) n FROM (SELECT ${col} col FROM ${table}) WHERE ${cond}`);
    console.log(`${label} 带实体：${Number(rows[0].n)}`);
  }
  // 分实体看，顺便验证"双重转义"到底存不存在（&amp;apos; / &amp;amp;）
  const dbl = await q(db, `SELECT name FROM sources WHERE name LIKE '%&amp;ap%' OR name LIKE '%&amp;amp%' LIMIT 5`);
  console.log('疑似双重转义样本：', dbl.map((r) => r.name).join(' | ') || '（无）');
  const t2 = await q(db, `SELECT title FROM articles WHERE title LIKE '%&amp;%' OR title LIKE '%&quot;%' LIMIT 6`);
  console.log('文章标题样本：');
  for (const r of t2) console.log('   ', String(r.title).slice(0, 90));
})().catch((e) => { console.log('ERR', e.message); process.exitCode = 1; });
