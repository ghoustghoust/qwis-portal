// 34 行 ↔ API 30 条：多出来的 4 行到底是什么？（实测，不再猜）
const { chromium } = require('playwright');
const { CLOUD_SITE } = require('../lib/cloud-site');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.PROXY || 'http://127.0.0.1:12000' } });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  let api = null;
  p.on('response', async (r) => { const u = new URL(r.url()); if (u.pathname === '/api/articles' && u.search.includes('since')) { try { api = JSON.parse(await r.text()); } catch { } } });
  await p.goto(CLOUD_SITE + '/reader/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForSelector('div.card.card-lift.p-3.cursor-pointer.relative', { timeout: 60000 });
  await p.waitForTimeout(15000);
  const info = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('div.card.card-lift.p-3.cursor-pointer.relative')];
    return {
      n: cards.length,
      parents: [...new Set(cards.map((c) => c.parentElement.tagName + '.' + String(c.parentElement.className).split(/\s+/).slice(0, 3).join('.')))],
      texts: cards.map((c) => c.innerText.replace(/\s+/g, ' ').slice(0, 42)),
    };
  });
  const titles = (api && api.items || []).map((x) => String(x.title || '').slice(0, 16));
  const orphans = info.texts.filter((t) => !titles.some((x) => t.includes(x)));
  console.log('DOM 卡数', info.n, '| API items', titles.length, '| 父容器', JSON.stringify(info.parents));
  console.log('API 里没有的行（' + orphans.length + '）:'); orphans.slice(0, 8).forEach((t) => console.log('   · ' + t));
  await b.close();
})().catch((e) => { console.log('ERR', String(e.message).split('\n')[0]); process.exit(2); });
