/* 一次性：在**同一进程**里复现 regression-my-brief 的 test2→test3 序列，
   打印每次轮询时「处理层返回什么」与「直连库里行在不在」，用来分辨缓存 vs 写入可见性。用完即删。
   注意：这会短暂改写生产 settings.mybrief.latest，结束时还原（与回归测试本身的动作同范围）。 */
const fs = require('fs');
const { createClient } = require('@libsql/client');
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const handler = require('../api/[...slug].js');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const callGet = async () => {
  const res = { _status: 200, _body: null };
  res.setHeader = () => res; res.status = (s) => { res._status = s; return res; };
  res.json = (b) => { res._body = b; return res; }; res.send = (b) => { res._body = b; return res; }; res.end = () => res;
  await handler({ method: 'GET', url: '/api/mybrief', query: {}, headers: {} }, res);
  return res._body;
};
const FAKE = { date: '2026-09-12', theme: '测试导语', keywords: ['AI'], sections: { top: [{ id: 1, title: 't1' }], featured: [], rest: [] } };
const rowState = async () => {
  const r = await db.execute("SELECT length(value) n, substr(value,1,40) h FROM settings WHERE key='mybrief.latest'");
  return r.rows[0] ? `在(${r.rows[0].n}字 ${String(r.rows[0].h).slice(0, 24)})` : '不在';
};
(async () => {
  const snap = await db.execute("SELECT value FROM settings WHERE key='mybrief.latest'");
  const orig = snap.rows[0] ? snap.rows[0].value : null;
  console.log('起始：', orig ? `${orig.length}字` : '无行');
  try {
    await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('mybrief.latest',?)", args: [JSON.stringify(FAKE)] });
    for (let i = 1; i <= 12; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const d = await callGet();
      const s = await rowState();
      console.log(`[写假报告后 ${i * 5}s] 库=${s} 响应=${d && d.empty ? 'empty:' + d.empty : 'report:' + (d && d.report ? String(d.report.theme) : JSON.stringify(d).slice(0, 40))}`);
      if (d && d.report && d.report.theme === '测试导语') { console.log('  → 处理层已看到假报告（缓存已热）'); break; }
    }
    await db.execute("DELETE FROM settings WHERE key='mybrief.latest'");
    console.log('删除后直连复查：', await rowState());
    for (let i = 1; i <= 12; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const d = await callGet();
      const s = await rowState();
      console.log(`[删除后 ${i * 5}s] 库=${s} 响应=${d && d.empty ? 'empty:' + d.empty : 'report:' + (d && d.report ? String(d.report.theme) : JSON.stringify(d).slice(0, 40))}`);
    }
  } finally {
    if (orig !== null) await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('mybrief.latest',?)", args: [orig] });
    console.log('还原后：', await rowState());
    await db.close();
  }
})().catch((e) => { console.log('ERR', String(e.message).split('\n')[0]); process.exitCode = 2; });
