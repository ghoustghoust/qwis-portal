// 只读核对 #24：那 14 次"AI job success 但新库无行"在 runner 自己的心跳里有没有留痕。
// `settings['cloud.collect'].history` 是 runner 每批写的一条记录（含 mode/ok/error/stats），它是**写侧唯一自证**。
// 判据：按日期列出所有 mode 含 daily-ai 的条目，看有没有 error / 有没有"写了但 rowsWritten=0"这种形态。
const fs = require('fs');
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
(async () => {
  for (const key of ['cloud.collect', 'collect.daily-ai', 'collect.history', 'runner.lastErrors']) {
    const r = (await db.execute({ sql: 'SELECT value FROM settings WHERE key = ?', args: [key] })).rows[0];
    if (!r) { console.log(`${key}：无此行`); continue; }
    let v; try { v = JSON.parse(r.value); } catch { console.log(`${key}：非 JSON`); continue; }
    const hist = Array.isArray(v) ? v : (v && Array.isArray(v.history) ? v.history : null);
    console.log(`\n【${key}】${hist ? `history ${hist.length} 条，字段样例=${Object.keys(hist[hist.length - 1] || {}).join(',')}` : '顶层对象，字段=' + Object.keys(v).join(',')}`);
    if (!hist) continue;
    const ai = hist.filter((h) => /daily-ai/.test(JSON.stringify(h)));
    console.log(`  含 daily-ai 字样的条目 ${ai.length} 条：`);
    for (const h of ai.slice(0, 20)) console.log('   ', JSON.stringify(h).slice(0, 240));
    const win = hist.filter((h) => String(h.at || h.ts || h.time || '').slice(0, 10) >= '2026-09-12'
      && String(h.at || h.ts || h.time || '').slice(0, 10) <= '2026-09-19');
    console.log(`  落在 09-12~09-19 窗口内的条目=${win.length} 条（其中报错的=${win.filter((x) => x.error || x.ok === false).length}）：`);
    for (const h of win.slice(0, 12)) console.log('   ', JSON.stringify(h).slice(0, 240));
  }
})().catch((e) => { console.error('ERR', e.message.slice(0, 160)); process.exitCode = 1; }).finally(() => db.close());
