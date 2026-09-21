const { chromium } = require('playwright');
const { CLOUD_SITE } = require('../lib/cloud-site');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.PROXY || 'http://127.0.0.1:12000' } });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const seen = [];
  p.on('response', async (r) => { const u = new URL(r.url()); if (u.pathname === '/api/reading') { const t0 = Date.now(); let n = -1, c = null; try { const j = JSON.parse(await r.text()); n = (j.items || []).length; c = j.counts; } catch { } seen.push({ q: u.search, items: n, counts: c, ms: Date.now() - t0, at: new Date().toISOString().slice(11, 23) }); } });
  const snap = async (tag) => {
    const s = await p.evaluate(() => ({ cards: document.querySelectorAll('div.card.card-lift.flex.gap-3.items-start.p-3').length, pills: [...document.querySelectorAll('button')].map((e) => e.innerText.trim().replace(/\s+/g, ' ')).filter((t) => /^(全部|已收藏|已读) [\d,]+$/.test(t)).join('|'), empty: document.body.innerText.includes('暂无阅读沉淀') }));
    console.log(`${tag}: cards=${s.cards} pills=[${s.pills}] 空态=${s.empty}`);
  };
  await p.goto(CLOUD_SITE + '/reading/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForTimeout(20000); await snap('首屏');
  seen.length = 0;
  await p.getByRole('button', { name: /^视频$/ }).first().click(); await p.waitForTimeout(6000); await snap('点视频+6s');
  console.log('   响应:', JSON.stringify(seen));
  seen.length = 0;
  await p.getByRole('button', { name: /^文章$/ }).first().click();
  for (const w of [5000, 10000, 20000, 30000]) { await p.waitForTimeout(w === 5000 ? 5000 : 10000); await snap(`点文章+${w / 1000}s`); }
  console.log('   响应:', JSON.stringify(seen));
  await b.close();
})().catch((e) => { console.log('ERR', String(e.message).split('\n')[0]); process.exit(2); });
