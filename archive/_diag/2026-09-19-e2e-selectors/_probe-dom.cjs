const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: 'http://127.0.0.1:12000' } });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const log = [];
  p.on('pageerror', e => log.push('PAGEERROR ' + String(e.message).slice(0, 90)));
  const probe = async (label, url) => {
    await p.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
    const r = await p.evaluate(() => {
      const sig = new Map();
      for (const e of document.querySelectorAll('body *')) {
        const cls = String(e.className || '').split(/\s+/).filter(Boolean).sort().join('.');
        const k = e.tagName + '.' + cls.slice(0, 60);
        sig.set(k, (sig.get(k) || 0) + 1);
      }
      const top = [...sig].filter(([, n]) => n >= 6).sort((a, c) => c[1] - a[1]).slice(0, 8);
      const txt = document.body.innerText;
      return {
        title: document.title, bodyLen: txt.length,
        repeated: top.map(([k, n]) => `${k} ×${n}`),
        imgs: document.querySelectorAll('img').length,
        btns: [...document.querySelectorAll('button')].map(x => x.innerText.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 14),
        hasKindBadge: /文章|播客|视频/.test(txt),
        snippet: txt.slice(0, 130).replace(/\n/g, ' ⏎ '),
      };
    });
    console.log('\n### ' + label);
    console.log(JSON.stringify(r, null, 1));
    console.log('  console/pageerror:', log.join(' | ') || '无');
    log.length = 0;
  };
  const S = 'https://qwis-intel.vercel.app';
  await probe('阅读器', S + '/reader/');
  await probe('日报', S + '/daily/');
  await probe('热点榜', S + '/hot/');
  await probe('视频', S + '/videos/');
  await probe('后台(未登录)', S + '/admin/');
  await b.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(2); });
