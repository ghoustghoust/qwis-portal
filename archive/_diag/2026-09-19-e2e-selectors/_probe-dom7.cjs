// 测量主内容区行选择器（排除 aside/nav 侧栏）。上一版把侧栏源行当文章行，34↔30 的"容差"就是这么来的。
const { chromium } = require('playwright');
const { CLOUD_SITE } = require('../lib/cloud-site');
const ZONE = `
  const zone = (el) => { let n = el; while (n && n !== document.body) { if (n.tagName === 'ASIDE' || n.tagName === 'NAV') return 'aside'; if (n.tagName === 'MAIN') return 'main'; n = n.parentElement; } return 'main?'; };
`;
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.PROXY || 'http://127.0.0.1:12000' } });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const dump = async (label, sel) => {
    const r = await p.evaluate(({ sel, zone }) => {
      const z = new Function('return ' + zone)();
      void z;
      const out = {};
      for (const el of document.querySelectorAll(sel)) {
        let n = el, inAside = false;
        while (n && n !== document.body) { if (n.tagName === 'ASIDE' || n.tagName === 'NAV') { inAside = true; break; } n = n.parentElement; }
        const k = (inAside ? 'ASIDE ' : 'MAIN  ') + String(el.className).split(/\s+/).filter(Boolean).join('.');
        out[k] = out[k] || { n: 0, txt: '' };
        out[k].n++;
        if (!out[k].txt) out[k].txt = el.innerText.replace(/\s+/g, ' ').slice(0, 50);
      }
      return Object.entries(out).sort((a, c) => c[1].n - a[1].n).slice(0, 5).map(([k, v]) => `${v.n}× ${k}\n     ${v.txt}`);
    }, { sel, zone: ZONE });
    console.log(`\n### ${label}  [${sel}]`);
    console.log(r.join('\n'));
  };
  const go = async (u, wait = 12000) => { await p.goto(CLOUD_SITE + u, { waitUntil: 'domcontentloaded', timeout: 90000 }); await p.waitForTimeout(wait); };
  await go('/reader/');
  await dump('reader 文章行', 'div.cursor-pointer');
  await p.getByRole('button', { name: /^视频$/ }).first().click(); await p.waitForTimeout(9000);
  await dump('reader 视频卡', 'div.cursor-pointer');
  await go('/daily/'); await dump('daily', 'div.cursor-pointer');
  await go('/hot/'); await dump('hot', 'article, div.cursor-pointer');
  await go('/reading/'); await dump('reading', 'div.cursor-pointer');
  await p.getByRole('button', { name: /^文章$/ }).first().click(); await p.waitForTimeout(6000);
  await dump('reading 文章', 'div.cursor-pointer');
  await go('/mybrief/'); await dump('mybrief', 'article, div.cursor-pointer');
  await go('/weekly/'); await dump('weekly', 'div, li', 8000);
  await b.close();
})().catch((e) => { console.log('ERR', String(e.message).split('\n')[0]); process.exit(2); });
