// 重跑 enrich：修复 original_html 错位 + 升级中文全文 + 补 category
const { db } = require('../server/db.js');
const { enrichArticle } = require('../server/services/aihot/enrich.js');
(async () => {
  const rows = db.prepare("SELECT id FROM articles WHERE source_id IN (25,26) AND original_url IS NOT NULL AND original_html IS NULL").all();
  console.log('待重抓:', rows.length);
  let done = 0, failed = 0;
  for (const r of rows) {
    try { await enrichArticle(r.id); done++; }
    catch (e) { failed++; }
    if (done % 20 === 0) console.log('进度', done, '/', rows.length);
    await new Promise((x) => setTimeout(x, 2000));
  }
  console.log('完成 done=' + done, 'failed=' + failed);
  process.exit(0);
})();
