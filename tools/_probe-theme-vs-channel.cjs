// 只读取证 #20：把"模型没答"与"我们把答案判死了"这两条解释用**已有落库数据**分开。
// 逻辑：theme 与逐条深析走的是同一个 aiChat 通道。如果那几期 `filterStats.failed/truncated` ≈ 0
// 而 analyzed 有几百条，说明"provider 当时整体不可用"这条解释站不住 ⇒ 主嫌是判据（all_lines_rejected/picked_vetoed）。
// 只读 daily_reports（57 行、1.5 MB 量级），不扫 articles。
const fs = require('fs');
const { createClient } = require('@libsql/client');
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
const S = "json_extract(COALESCE(stats,'{}'),";
(async () => {
  const rows = (await db.execute(`SELECT id, generated_at,
      ${S}'$.theme') theme,
      ${S}'$.filterStats.analyzed') an, ${S}'$.filterStats.failed') fa, ${S}'$.filterStats.truncated') tr,
      ${S}'$.filterStats.passed') pa, ${S}'$.elapsedMin') em, ${S}'$.degraded') deg,
      json_array_length(COALESCE(json_extract(stats,'$.themes'),'[]')) nthemes
    FROM daily_reports WHERE ${S}'$.schemaVersion') >= 2 ORDER BY id DESC`)).rows;
  console.log(`AI 档 ${rows.length} 期：逐期看"通道有没有整体坏" vs "导语在不在"`);
  console.log('  id  generated_at          导语  analyzed failed trunc passed  elapsed  degraded  themes簇');
  let withTheme = 0, failedZeroNoTheme = 0;
  for (const r of rows) {
    const n = (x) => (x === null || x === undefined ? '-' : String(x));
    console.log(`  ${String(r.id).padStart(3)} ${String(r.generated_at).slice(0, 19).padEnd(20)} ${(r.theme ? '有' : '**无**').padEnd(4)} ${n(r.an).padStart(7)} ${n(r.fa).padStart(6)} ${n(r.tr).padStart(5)} ${n(r.pa).padStart(6)} ${n(r.em).padStart(7)} ${n(r.deg).padStart(8)} ${n(r.nthemes).padStart(7)}`);
    if (r.theme) withTheme++;
    else if (Number(r.fa) === 0 && Number(r.an) > 20) failedZeroNoTheme++;
  }
  console.log(`\n带导语 ${withTheme} 期；其余 ${rows.length - withTheme} 期里，`
    + `**"failed=0 且 analyzed>20"的有 ${failedZeroNoTheme} 期** ⇒ 这些期的模型通道整体是通的（几百次深析都成了），`
    + `"ai_failed 解释不了它"，主嫌落在清洗判据（all_lines_rejected / picked_vetoed）。`);
  const an = rows.map((r) => Number(r.an || 0)).filter((x) => x > 0);
  const fa = rows.map((r) => Number(r.fa || 0));
  console.log(`分母核对：analyzed 非零的期数=${an.length}，中位=${an.sort((a, b) => a - b)[Math.floor(an.length / 2)] || 0}，`
    + `failed 最大=${Math.max(0, ...fa)}（>0 就说明 provider 确实整批失败过，那时 ai_failed 才是主因）`);
})().catch((e) => { console.error('ERR', e.message); process.exitCode = 1; }).finally(() => db.close());
