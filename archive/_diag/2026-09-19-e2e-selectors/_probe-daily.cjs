const { chromium } = require('playwright');
const { CLOUD_SITE } = require('../lib/cloud-site');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.PROXY || 'http://127.0.0.1:12000' } });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const reqs = [];
  p.on('response', async (r) => { const u = new URL(r.url()); if (u.pathname === '/api/daily') { try { reqs.push(JSON.parse(await r.text())); } catch { } } });
  await p.goto(CLOUD_SITE + '/daily/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForTimeout(12000);
  const btns = await p.$$eval('button', (e) => e.map((x) => x.innerText.trim().replace(/\s+/g, ' ')).filter(Boolean));
  console.log('按钮:', JSON.stringify(btns, null, 0));
  const j = reqs[0] || {};
  console.log('report 顶层键:', Object.keys(j.report || {}).join(','));
  console.log('sections:', JSON.stringify(((j.report || {}).sections || []).map((s) => ({ column: s.column, items: (s.items || []).length }))));
  console.log('stats:', JSON.stringify((j.report || {}).stats || null).slice(0, 200));
  console.log('有无 schemaVersion:', 'schemaVersion' in (j.report || {}), ' stale:', j.stale, ' degraded:', (j.report || {}).degraded);
  await b.close();
})().catch((e) => { console.log('ERR', String(e.message).split('\n')[0]); process.exit(2); });
