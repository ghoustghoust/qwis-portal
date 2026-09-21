const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: 'http://127.0.0.1:12000' } });
  for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    const p = await (await b.newContext({ viewport: vp })).newPage();
    await p.goto('https://qwis-intel.vercel.app/reader/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await p.waitForTimeout(25000);
    const n = await p.locator('div.card.card-lift.p-3.cursor-pointer.relative').count();
    const vis = await p.evaluate(() => [...document.querySelectorAll('div.card.card-lift.p-3.cursor-pointer.relative')]
      .filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none').length);
    console.log(`视口 ${vp.width}x${vp.height}: 匹配 ${n} 行，其中可见 ${vis} 行，body 字数 ${ (await p.evaluate(()=>document.body.innerText)).length}`);
    await p.close();
  }
  await b.close();
})().catch((e) => { console.log('ERR', String(e.message).split('\n')[0]); process.exit(2); });
