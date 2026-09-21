const { chromium } = require('playwright');
const { CLOUD_SITE } = require('../lib/cloud-site');

(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.PROXY || 'http://127.0.0.1:12000' } });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
  const probe = async (url) => {
    await p.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
    const r = await p.evaluate(() => {
      const out = { url: location.pathname, groups: [] };
      const seen = new Map();
      for (const e of document.querySelectorAll('body *')) {
        const cls = String(e.className || '').split(/\s+/).filter(Boolean).sort().join('.');
        const k = e.tagName + '.' + cls.slice(0, 70);
        seen.set(k, (seen.get(k) || 0) + 1);
      }
      out.groups = [...seen].filter(([, n]) => n >= 5).sort((a, c) => c[1] - a[1]).slice(0, 10).map(([k, n]) => `${k} ×${n}`);
      out.btns = [...document.querySelectorAll('button,a[role=button]')].map((x) => x.innerText.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 30);
      out.h = [...document.querySelectorAll('h1,h2,h3')].map((x) => x.innerText.trim().slice(0, 40)).filter(Boolean).slice(0, 12);
      // 抽样第一行完整 class + 文本，用来写选择器
      const first = document.querySelector('div.cursor-pointer');
      out.row0 = first ? { tag: first.tagName, cls: String(first.className), txt: first.innerText.replace(/\s+/g, ' ').slice(0, 90) } : null;
      out.txtLen = document.body.innerText.length;
      out.snippet = document.body.innerText.replace(/\s+/g, ' ').slice(0, 200);
      return out;
    });
    console.log('\n### ' + url);
    console.log(JSON.stringify(r, null, 1));
    if (errs.length) { console.log('  pageerror:', errs.join(' | ')); errs.length = 0; }
  };
  for (const u of ['/reading/', '/mybrief/', '/weekly/', '/hot/']) await probe(CLOUD_SITE + u);
  await b.close();
})().catch((e) => { console.log('ERR', String(e.message).split('\n')[0]); process.exit(2); });
