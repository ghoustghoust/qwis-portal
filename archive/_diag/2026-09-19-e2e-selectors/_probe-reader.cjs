const { chromium } = require('playwright');
const { CLOUD_SITE } = require('../lib/cloud-site');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.PROXY || 'http://127.0.0.1:12000' } });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  let resp = null;
  p.on('response', async (r) => { const u = new URL(r.url()); if (u.pathname === '/api/articles') { try { resp = JSON.parse(await r.text()); } catch { } } });
  await p.goto(CLOUD_SITE + '/reader/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForTimeout(20000);
  const info = await p.evaluate(() => {
    const zone = (el) => { let n = el; while (n && n !== document.body) { if (n.tagName === 'ASIDE' || n.tagName === 'NAV') return 'aside'; if (n.tagName === 'MAIN') return 'main'; n = n.parentElement; } return '?'; };
    const rows = {};
    for (const el of document.querySelectorAll('div.cursor-pointer')) {
      const k = zone(el) + ' ' + String(el.className).split(/\s+/).filter(Boolean).slice(0, 5).join('.');
      rows[k] = (rows[k] || 0) + 1;
    }
    return { rows, body: document.body.innerText };
  });
  const items = (resp && resp.items) || [];
  console.log('API items =', items.length, ' 请求参数 =', decodeURIComponent(resp && resp.__q || ''));
  const inBody = (t) => info.body.includes(String(t || '').slice(0, 14));
  console.log('title 命中:', items.slice(0, 12).map((x) => (inBody(x.title) ? '✓' : '·') + ' ' + String(x.title).slice(0, 30)).join('\n           '));
  console.log('translated 命中:', items.slice(0, 12).filter((x) => x.translated_title && !inBody(x.title)).map((x) => (inBody(x.translated_title) ? '✓' : '·') + ' ' + String(x.translated_title).slice(0, 30)).join('\n           ') || '（无仅译文条目）');
  console.log('DOM 行分布:'); console.log(Object.entries(info.rows).filter(([, n]) => n > 2).sort((a, c) => c[1] - a[1]).slice(0, 8).map(([k, n]) => `  ${n}× ${k}`).join('\n'));
  await b.close();
})().catch((e) => { console.log('ERR', String(e.message).split('\n')[0]); process.exit(2); });
