// 一次性诊断：找出"文章行"的精确且不过宽的选择器（父容器 + 行 class），并统计各类匹配数
const { chromium } = require('playwright');
const { CLOUD_SITE } = require('../lib/cloud-site');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.PROXY || 'http://127.0.0.1:12000' } });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const resp = await p.goto(CLOUD_SITE + '/reader/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForSelector('div.cursor-pointer.flex.gap-2', { timeout: 60000 });
  await p.waitForTimeout(6000);
  const info = await p.evaluate(() => {
    const api = window.__apiItems;
    const rows = [...document.querySelectorAll('div.cursor-pointer.flex.gap-2')];
    const byParent = new Map();
    for (const r of rows) {
      const par = r.parentElement;
      const k = par.tagName + '.' + String(par.className).split(/\s+/).filter(Boolean).sort().join('.');
      byParent.set(k, (byParent.get(k) || 0) + 1);
    }
    const titled = rows.filter((r) => r.querySelector('img')).length;
    return {
      total: rows.length,
      withImg: titled,
      parents: [...byParent].sort((a, c) => c[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} → ${n} 行`),
      sampleNoImg: rows.filter((r) => !r.querySelector('img')).slice(0, 3).map((r) => r.innerText.replace(/\s+/g, ' ').slice(0, 70)),
      sampleWithImg: rows.filter((r) => r.querySelector('img')).slice(0, 2).map((r) => r.innerText.replace(/\s+/g, ' ').slice(0, 70)),
    };
  });
  console.log(JSON.stringify(info, null, 1));
  // 页面自己发出的 /api/articles 拿到的条数
  const n = await p.evaluate(async () => { const r = await fetch('/api/articles' + location.search ? '' : ''); return 0; }).catch(() => 0);
  const j = await p.evaluate(async () => {
    const t = await (await fetch('/api/articles?' + new URLSearchParams({ tab: 'all', sort: 'smart', since: new Date(Date.now() - 864e5).toISOString(), dedup: '1' }))).text();
    try { return JSON.parse(t); } catch { return { bad: t.slice(0, 80) }; }
  });
  console.log('same-params API items =', (j.items || []).length, 'nextCursor?', !!j.nextCursor);
  await b.close();
})().catch((e) => { console.log('ERR', String(e.message).split('\n')[0]); process.exit(2); });
