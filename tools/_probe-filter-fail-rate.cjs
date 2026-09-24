// 一次性**只读**探针（H35 / 用户 09-24「补这两个字段……还要探索什么内容在大量读取 turso」）：
// 把每一期 AI 档的"初筛到底筛了多少、失败多少、各段花多久"从库里直接算出来。
// 为什么要有这一支：`GET /api/daily` 只回最新一期，而"34% 失败率是常态还是偶发"必须有分母；
//   新落的 `filterStats.{attempted,rejected,failed}` 与 `timeSplit` 就是为这个问题准备的，
//   但读数本身跨期没人滚过。
// 边界：只做 SELECT；读的是 .env 里的**新库**只读连接（不打印任何凭据，不读 HANDOVER）。
const fs = require('fs');
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const S = "json_extract(COALESCE(stats,'{}'),";
const F = (k) => `${S}'$.filterStats.${k}')`;
const T = (k) => `${S}'$.timeSplit.${k}')`;
(async () => {
  const rows = (await db.execute(`SELECT id, generated_at,
      ${F('attempted')} att, ${F('passed')} pax, ${F('rejected')} rej, ${F('analyzed')} anz,
      ${F('failed')} fl, ${F('truncated')} tr, ${F('candidates')} cand,
      ${T('filterMin')} fmin, ${T('analyzeMin')} amin, ${T('mediaMin')} mmin,
      ${S}'$.elapsedMin') em, ${S}'$.prescreen.pool') pool, ${S}'$.prescreen.poolSources') ps,
      ${S}'$.prescreen.kept') kept, ${S}'$.prescreen.keptSources') ks, ${S}'$.prescreen.cap') cap,
      ${S}'$.theme') theme, json_array_length(COALESCE(json_extract(stats,'$.themes'),'[]')) nthemes,
      ${S}'$.themePanorama') pano, ${S}'$.degraded') deg
    FROM daily_reports WHERE ${S}'$.schemaVersion') >= 2 ORDER BY id DESC LIMIT 40`)).rows;
  console.log(`最近 ${rows.length} 期 AI 档（只读；空值 = 该期还没这两个字段，不是 0）\n`);
  console.log('id   generated_at            候选 尝试 通过 剔除 失败 失败率 筛后析 截断  筛min 析min 总min  宽池/源        留/覆盖源  导语 簇 degraded');
  let n = 0, sumRate = 0, worst = null;
  for (const r of rows) {
    const has = r.att != null && r.fl != null;
    const rate = has && Number(r.att) > 0 ? Number(r.fl) / Number(r.att) : null;
    if (rate != null) { n++; sumRate += rate; if (!worst || rate > worst.rate) worst = { id: r.id, rate, fl: r.fl, att: r.att }; }
    const pad = (v, w) => String(v ?? '—').padStart(w);
    console.log(
      `${pad(r.id, 4)} ${String(r.generated_at).padEnd(24)}${pad(r.cand, 5)}${pad(r.att, 6)}${pad(r.pax, 6)}${pad(r.rej, 5)}${pad(r.fl, 6)}` +
      `${rate == null ? '     —  ' : ` ${(rate * 100).toFixed(1).padStart(5)}% `}${pad(r.anz, 6)}` +
      `${r.tr === 1 ? ' 是' : ' 否'}  ${pad(r.fmin, 5)}${pad(r.amin, 6)}${pad(r.em, 6)}  ` +
      `${String(r.pool ?? '—')}/${r.ps ?? '—'}  ${String(r.kept ?? '—')}/${r.ks ?? '—'}(cap${r.cap ?? '?'})  ` +
      `${r.theme ? '有' : '无'}  ${pad(r.nthemes, 2)}  ${r.deg}`);
  }
  console.log(`\n【失败率】有该读数的期数 ${n}，均值 ${(100 * sumRate / Math.max(n, 1)).toFixed(1)}%，报警线 20%（lib/filter-observe.js）`);
  if (worst) console.log(`       最差一期 id=${worst.id}：失败 ${worst.fl}/${worst.att} = ${(worst.rate * 100).toFixed(1)}%`);
  const over = rows.filter((r) => Number(r.att) > 0 && Number(r.fl) / Number(r.att) >= 0.2).length;
  console.log(`       ≥20%（应当发飞书）的期数：${over}/${n || 0}`);
  const pano = rows.filter((r) => r.pano != null).map((r) => r.id);
  console.log(`【themePanorama】已落库的期：${pano.length ? pano.join(',') : '还没有一期（该字段 09-24 21:08Z 才进主线，job 取的是**启动时**的提交）'}`);
  const noTheme = rows.filter((r) => !r.theme).length;
  console.log(`【导语】最近 ${rows.length} 期里 ${noTheme} 期没有导语（${((100 * noTheme) / rows.length).toFixed(0)}%）`);
  // 预算边界：真实用掉的墙钟 vs 300min 预算 / 130min 初筛帽
  const ems = rows.map((r) => Number(r.em)).filter((v) => v > 0);
  if (ems.length) {
    const sorted = [...ems].sort((a, b) => a - b);
    console.log(`【耗时】elapsedMin 中位 ${sorted[Math.floor(sorted.length / 2)]}、最大 ${sorted[sorted.length - 1]}（预算 300min ⇒ 峰值占 ${((100 * sorted[sorted.length - 1]) / 300).toFixed(0)}%）`);
  }
})().catch((e) => { console.error('PROBE ERR', e.message); process.exitCode = 1; });
