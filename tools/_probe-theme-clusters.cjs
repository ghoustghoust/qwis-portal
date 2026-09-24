// 只读取证 #21：`themes` 主题全景 14/16 期是 0 簇 —— **改阈值前/后各能出几簇**（零模型、零写）。
// 为什么要先量再动：H30 立过一条规矩"阈值不许先动"。这一份就是把那句话变成可核对的数。
// 判据不另写一份：聚类两个函数从 `tools/collect-turso.js` 逐字复制，并在跑之前断言源码里确实有这两段（防漂移）。
const fs = require('fs');
const { createClient } = require('@libsql/client');
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const RUNNER = fs.readFileSync('tools/collect-turso.js', 'utf8').replace(/\r\n/g, '\n'); // 工作树是 CRLF，函数文本比对要先归一
function titleTokens(title) {
  return String(title || '').replace(/[^\w一-鿿]/g, ' ').split(/\s+/).filter(t => t.length >= 2);
}
function jaccard(a, b) {
  const sa = new Set(a), sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}
// 漂移守卫：线上真实现必须与这里逐字一致，否则这份扫出来的簇数不代表生产行为（不用 eval，直接取函数源码文本）
for (const fn of [titleTokens, jaccard]) {
  if (!RUNNER.includes(fn.toString())) { console.log(`✗ 判据漂移：tools/collect-turso.js 里找不到 ${fn.name} 的当前实现`); process.exit(1); }
}
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
const S = "json_extract(COALESCE(stats,'{}'),";
// 与 buildThemePanorama 同一套贪心：按顺序扫，命中第一个 jaccard>=阈值的簇就并进去（token 取并集）
function clustersOf(titles, th) {
  const clusters = [];
  for (const t of titles) {
    const tok = titleTokens(t);
    if (!tok.length) continue;
    let hit = null;
    for (const c of clusters) if (jaccard(tok, c.tokens) >= th) { hit = c; break; }
    if (hit) { hit.items.push(t); for (const x of tok) hit.tokens.add(x); }
    else clusters.push({ tokens: new Set(tok), items: [t] });
  }
  const multi = clusters.filter((c) => c.items.length >= 2);
  return { all: clusters.length, multi: multi.length, biggest: multi.reduce((n, c) => Math.max(n, c.items.length), 0) };
}
(async () => {
  const rows = (await db.execute(`SELECT id, generated_at, sections, ${S}'$.theme') theme,
      json_array_length(COALESCE(json_extract(stats,'$.themes'),'[]')) nthemes
    FROM daily_reports WHERE ${S}'$.schemaVersion') >= 2 ORDER BY id DESC`)).rows;
  const THS = [0.45, 0.35, 0.25, 0.15];
  console.log(`AI 档 ${rows.length} 期 × 阈值扫描（生产阈值=0.45，且要求"≥2 条的簇"才算主题，最多取 4 簇）：`);
  console.log('  id  期条数  线上themes簇  导语 ' + THS.map((t) => `@${t.toFixed(2)}`).join('      '));
  const agg = THS.map(() => ({ multi: 0, zero: 0 }));
  for (const r of rows) {
    let secs = [];
    try { secs = JSON.parse(r.sections || '[]'); } catch { /* 无效 JSON */ }
    const titles = secs.flatMap((s) => (s.items || []).map((i) => i.translated_title || i.title || ''));
    const cells = THS.map((th, k) => {
      const c = clustersOf(titles, th);
      agg[k].multi += c.multi; if (!c.multi) agg[k].zero++;
      return `${String(c.multi).padStart(3)}(max${c.biggest})`.padEnd(7);
    }).join('');
    console.log(`  ${String(r.id).padStart(3)} ${String(titles.length).padStart(5)}   ${String(r.nthemes ?? '-').padStart(5)}      ${(r.theme ? '有' : '无')}  ${cells}`);
  }
  console.log('\n合计（' + rows.length + ' 期）：' + THS.map((t, k) => `@${t.toFixed(2)} 共 ${agg[k].multi} 簇、${agg[k].zero} 期仍是 0 簇`).join('  |  '));
  console.log('读法：0.45 就是线上现在的阈值；往下的每一档是"如果把阈值放宽会怎样"的对照，**不构成该改的建议**（要先有 themeSkip.why）。');
})().catch((e) => { console.error('ERR', e.message); process.exitCode = 1; }).finally(() => db.close());
