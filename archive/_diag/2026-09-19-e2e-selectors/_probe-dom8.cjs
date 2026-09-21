const { chromium } = require('playwright');
const { CLOUD_SITE } = require('../lib/cloud-site');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.PROXY || 'http://127.0.0.1:12000' } });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await p.goto(CLOUD_SITE + '/hot/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForTimeout(9000);
  for (const label of ['AI 精选', 'AI 信息实时流', '热搜事件']) {
    await p.getByRole('button', { name: new RegExp('^' + label + '$') }).first().click().catch(() => console.log('click fail', label));
    await p.waitForTimeout(7000);
    const r = await p.evaluate(() => {
      const out = {};
      for (const el of document.querySelectorAll('div,article,li')) {
        let n = el, aside = false;
        while (n && n !== document.body) { if (n.tagName === 'ASIDE' || n.tagName === 'NAV') { aside = true; break; } n = n.parentElement; }
        if (aside) continue;
        if (!el.className || typeof el.className !== 'string') continue;
        const k = el.tagName.toLowerCase() + '.' + el.className.split(/\s+/).filter(Boolean).join('.');
        out[k] = out[k] || { n: 0, t: '' }; out[k].n++;
        if (!out[k].t) out[k].t = el.innerText.replace(/\s+/g, ' ').slice(0, 40);
      }
      return Object.entries(out).filter(([, v]) => v.n >= 8).sort((a, c) => c[1].n - a[1].n).slice(0, 6).map(([k, v]) => `${v.n}× ${k}\n     ${v.t}`);
    });
    console.log(`\n### ${label}\n` + r.join('\n'));
  }
  await b.close();
})().catch((e) => { console.log('ERR', String(e.message).split('\n')[0]); process.exit(2); });
