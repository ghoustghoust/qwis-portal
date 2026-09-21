// 诊断：把 /reader/ 上所有 cursor-pointer 行按「所在容器（main/aside/nav）+ 完整 class」列出来，
// 用来挑一个**只命中文章行**的选择器（上一版 flex.gap-2 把侧栏源行也框进来了）
const { chromium } = require('playwright');
const { CLOUD_SITE } = require('../lib/cloud-site');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.PROXY || 'http://127.0.0.1:12000' } });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await p.goto(CLOUD_SITE + '/reader/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForTimeout(20000);
  const info = await p.evaluate(() => {
    const zone = (el) => {
      let n = el;
      while (n && n !== document.body) {
        if (n.tagName === 'ASIDE' || n.tagName === 'NAV') return n.tagName.toLowerCase();
        if (n.tagName === 'MAIN') return 'main';
        n = n.parentElement;
      }
      return 'other';
    };
    const out = {};
    for (const el of document.querySelectorAll('div.cursor-pointer')) {
      const k = `${zone(el)} | ${String(el.className).split(/\s+/).filter(Boolean).join('.')}`;
      out[k] = out[k] || { n: 0, txt: '' };
      out[k].n++;
      if (!out[k].txt) out[k].txt = el.innerText.replace(/\s+/g, ' ').slice(0, 55);
    }
    return { main: p0(), list: Object.entries(out).sort((a, c) => c[1].n - a[1].n).slice(0, 14).map(([k, v]) => `${v.n}×  ${k}\n      ${v.txt}`) };
    function p0() { return document.title; }
  });
  console.log(info.list.join('\n'));
  await b.close();
})().catch((e) => { console.log('ERR', String(e.message).split('\n')[0]); process.exit(2); });
