// 实测 /reading/ 类型筛选：点了「视频」之后，列表与计数到底变不变（E5 判这条为产品红，先取证再落账）
const { chromium } = require('playwright');
const { CLOUD_SITE } = require('../lib/cloud-site');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.PROXY || 'http://127.0.0.1:12000' } });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const reqs = [];
  p.on('request', (r) => { const u = new URL(r.url()); if (u.pathname === '/api/reading') reqs.push(u.search); });
  await p.goto(CLOUD_SITE + '/reading/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForTimeout(20000);
  const snap = async (tag) => {
    const s = await p.evaluate(() => {
      const cards = [...document.querySelectorAll('div.card.card-lift.flex.gap-3.items-start.p-3')];
      const pills = [...document.querySelectorAll('button')].map((e) => e.innerText.trim().replace(/\s+/g, ' ')).filter((t) => /^(全部|已收藏|已读) [\d,]+$/.test(t));
      return { cards: cards.length, first: (cards[0]?.innerText || '').replace(/\s+/g, ' ').slice(0, 46), pills: pills.join(' | ') };
    });
    console.log(`${tag}: cards=${s.cards} pills=[${s.pills}] 首行="${s.first}"`);
    return s;
  };
  await snap('首屏(type=all 默认)');
  console.log('  请求序列:', JSON.stringify(reqs));
  reqs.length = 0;
  await p.getByRole('button', { name: /^视频$/ }).first().click();
  for (const t of [2000, 6000, 15000, 25000]) { await p.waitForTimeout(t === 2000 ? 2000 : 4000); await snap(`点「视频」+${t}ms`); }
  console.log('  点击后的请求:', JSON.stringify(reqs));
  reqs.length = 0;
  await p.getByRole('button', { name: /^文章$/ }).first().click();
  await p.waitForTimeout(9000); await snap('点「文章」+9s');
  console.log('  点击后的请求:', JSON.stringify(reqs));
  await b.close();
})().catch((e) => { console.log('ERR', String(e.message).split('\n')[0]); process.exit(2); });
