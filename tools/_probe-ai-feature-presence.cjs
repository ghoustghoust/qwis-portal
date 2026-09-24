// 只读探针 #17：AI 档里 T3-1 的三样东西到底有没有产出（theme 导语 / themes 主题全景 / 六维评分）
// 起因：#16 实测读者拿到的那份 sv=2 早报 theme=无 —— "有 AI 版"不等于"AI 版的功能都在"。
const fs = require('fs');
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const S = "json_extract(COALESCE(stats,'{}'),";
(async () => {
  const rows = (await db.execute(`SELECT id, generated_at,
      ${S}'$.schemaVersion') sv, ${S}'$.theme') theme, ${S}'$.degraded') deg,
      json_array_length(COALESCE(json_extract(stats,'$.themes'),'[]')) nthemes,
      ${S}'$.elapsedMin') em, ${S}'$.filterStats.passed') fpassed, ${S}'$.prescreen.keptSources') ksrc
    FROM daily_reports WHERE ${S}'$.schemaVersion') >= 2 ORDER BY id DESC LIMIT 10`)).rows;
  console.log('最近 10 期 AI 档（看 theme / themes 是不是真的在产出）：');
  for (const x of rows) {
    console.log(`  id=${String(x.id).padStart(3)} ${x.generated_at}  theme=${x.theme ? `有(${String(x.theme).slice(0, 18)}…)` : '**无**'}  themes簇=${x.nthemes ?? '(缺键)'}  degraded=${x.deg}  elapsedMin=${x.em} 筛过=${x.fpassed} 覆盖源=${x.ksrc}`);
  }
  const cnt = (await db.execute(`SELECT COUNT(*) n, SUM(CASE WHEN ${S}'$.theme') IS NULL THEN 1 ELSE 0 END) no_theme FROM daily_reports WHERE ${S}'$.schemaVersion') >= 2`)).rows[0];
  console.log(`\n全部 AI 档 ${cnt.n} 期，其中 theme 缺失 ${cnt.no_theme} 期（${(100 * cnt.no_theme / cnt.n).toFixed(0)}%）`);

  // 「期」不是读者看到的单位 —— 同一个北京日有多期，读者只拿到 pickDailyReport 挑出的那一份。
  // 所以按北京日（+8h）自算口径再滚一层：这一层的分母才是"天数"。
  const day = (await db.execute(`SELECT strftime('%Y-%m-%d', datetime(generated_at, '+8 hours')) d,
      COUNT(*) n, SUM(CASE WHEN ${S}'$.theme') IS NOT NULL THEN 1 ELSE 0 END) with_theme
      FROM daily_reports WHERE ${S}'$.schemaVersion') >= 2 GROUP BY d ORDER BY d DESC`)).rows;
  console.log(`\n按北京日滚动（AI 档；"有导语的天"= 该天至少有一期带 theme，读者能不能看到还取决于挑哪一期）：`);
  for (const x of day) console.log(`  ${x.d}  期数=${x.n}  带导语的期=${x.with_theme}${x.with_theme === 0 ? '  ← 该天读者必然看不到导语' : ''}`);
  const noThemeDays = day.filter((x) => x.with_theme === 0).length;
  console.log(`\n共 ${day.length} 天，其中 ${noThemeDays} 天（${(100 * noThemeDays / Math.max(1, day.length)).toFixed(0)}%）**一期带导语的都没有**`);
  // 逐日"读者那份"：同一天内 id 最大（最后一次生成）通常是覆盖写后仍在库里的最新一期
  const latest = (await db.execute(`SELECT d, id, theme FROM (
      SELECT strftime('%Y-%m-%d', datetime(generated_at, '+8 hours')) d, id, ${S}'$.theme') theme,
        ROW_NUMBER() OVER (PARTITION BY strftime('%Y-%m-%d', datetime(generated_at, '+8 hours')) ORDER BY id DESC) rn
      FROM daily_reports WHERE ${S}'$.schemaVersion') >= 2) WHERE rn = 1 ORDER BY d DESC`)).rows;
  console.log(`\n每天最后一期（id 最大）的导语：`);
  for (const x of latest) console.log(`  ${x.d}  id=${x.id}  theme=${x.theme ? `有(${String(x.theme).slice(0, 18)}…)` : '**无**'}`);
  console.log(`  ⇒ 该口径下 ${latest.length} 天里带导语 ${latest.filter((x) => x.theme).length} 天`);
  // 读者真正看到的那一份 = pickDailyReport 取"窗口内最新一期 AI 档"（lib/brief-guards.js:40 rows.find）。
  // 所以带导语的那一期是不是"当天的最新一期"，决定它有没有被读者读到。
  const withTheme = (await db.execute(`SELECT id, generated_at, ${S}'$.theme') theme FROM daily_reports WHERE ${S}'$.theme') IS NOT NULL ORDER BY id DESC`)).rows;
  console.log(`\n全库带导语的期（**不加档位过滤**：关键词档也能写 theme）：`);
  for (const x of withTheme) console.log(`  id=${x.id} ${x.generated_at}  theme=${String(x.theme).slice(0, 24)}…`);
  const all = (await db.execute('SELECT COUNT(*) n FROM daily_reports')).rows[0];
  console.log(`\n分母核对：daily_reports 全表 ${all.n} 期（含关键词档）→ 带导语 ${withTheme.length} 期；上面所有比率都以「期」为分母，不是以「天」`);
})().catch((e) => { console.error('ERR', e.message); process.exitCode = 1; }).finally(() => db.close());
