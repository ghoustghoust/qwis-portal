// 一次性对账（不提交）：为什么同一个"源名带实体"的统计，两种写法给出 11 与 0 两个数
const fs = require('fs');
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { createClient } = require('@libsql/client');
(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const one = async (sql) => (await db.execute(sql)).rows[0];
  console.log('A 直写：', Number((await one("SELECT COUNT(*) n FROM sources WHERE name LIKE '%&amp;%' OR name LIKE '%&quot;%'")).n));
  console.log('B 子查询别名：', Number((await one("SELECT COUNT(*) n FROM (SELECT name col FROM sources) WHERE col LIKE '%&amp;%' OR col LIKE '%&quot;%'")).n));
  const r = await db.execute("SELECT name, instr(name, '&amp;') i FROM sources WHERE instr(name, '&amp;') > 0 LIMIT 5");
  console.log('instr 命中：', r.rows.length, r.rows.map((x) => `${x.name} @${x.i}`).join(' | '));
  const hex = await db.execute("SELECT name, hex(substr(name, instr(name,'&'), 6)) h FROM sources WHERE instr(name, '&amp;') > 0 LIMIT 3");
  console.log('字节层：', hex.rows.map((x) => `${x.name} → ${x.h}`).join(' | '));
  // 到底存的是 &amp; 还是 &amp;amp;（双重转义）
  console.log('含 &amp;amp; 的：', Number((await one("SELECT COUNT(*) n FROM sources WHERE instr(name,'&amp;amp;')>0")).n));
  console.log('含裸 & 的：', Number((await one("SELECT COUNT(*) n FROM sources WHERE instr(name,'&')>0")).n));
})().catch((e) => console.log('ERR', e.message));
