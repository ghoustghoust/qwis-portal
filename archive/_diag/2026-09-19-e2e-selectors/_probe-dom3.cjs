const { chromium } = require('playwright');
const { CLOUD_SITE } = require('../lib/cloud-site');

(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.PROXY || 'http://127.0.0.1:12000' } });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const sig = async (label) => {
    const r = await p.evaluate(() => {
      const seen = new Map();
      for (const e of document.querySelectorAll('body *')) {
        const cls = String(e.className || '').split(/\s+/).filter(Boolean).sort().join('.');
        const k = e.tagName + '.' + cls.slice(0, 70);
        seen.set(k, (seen.get(k) || 0) + 1);
      }
      return [...seen].filter(([, n]) => n >= 6).sort((a, c) => c[1] - a[1]).slice(0, 8)
        .map(([k, n]) => `${k} ×${n}`).join('\n    ');
    });
    console.log(`\n--- ${label}\n    ${r}`);
  };
  // 1) reader 点「视频」
  await p.goto(CLOUD_SITE + '/reader/', { waitUntil: 'networkidle', timeout: 90000 });
  await p.getByRole('button', { name: /^视频$/ }).first().click({ timeout: 8000 }).catch((e) => console.log('click 视频 failed', e.message.slice(0, 60)));
  await p.waitForTimeout(6000);
  await sig('reader 点视频后');
  console.log('  url=', p.url(), ' body头=', (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 160));

  // 2) reading 点「视频」+「文章」
  await p.goto(CLOUD_SITE + '/reading/', { waitUntil: 'networkidle', timeout: 90000 });
  await p.getByRole('button', { name: /^视频$/ }).first().click({ timeout: 8000 }).catch((e) => console.log('reading click 视频 failed', e.message.slice(0, 60)));
  await p.waitForTimeout(5000);
  await sig('reading 点视频后');
  console.log('  body头=', (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 200));

  // 3) daily 栏目 pill
  await p.goto(CLOUD_SITE + '/daily/', { waitUntil: 'networkidle', timeout: 90000 });
  const btns = await p.$$eval('button', (els) => els.map((e) => e.innerText.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 25));
  console.log('\n--- daily buttons\n   ', JSON.stringify(btns));
  const api = await p.evaluate(async () => { const r = await fetch('/api/daily'); const j = await r.json(); return { keys: Object.keys(j), secs: (j.sections || []).map((s) => ({ t: s.title || s.name, n: (s.items || []).length, keys: Object.keys(s) })) }; });
  console.log('   /api/daily:', JSON.stringify(api).slice(0, 600));

  // 4) mybrief 三态 + weekly 行数
  const mb = await p.evaluate(async () => { const r = await fetch('/api/mybrief'); const j = await r.json(); return { status: r.status, keys: Object.keys(j || {}) }; });
  console.log('\n/api/mybrief:', JSON.stringify(mb));
  const wk = await p.evaluate(async () => { const r = await fetch('/api/weekly'); const j = await r.json(); return { status: r.status, keys: Object.keys(j || {}), n: (j.items || j.picks || j.storylines || []).length }; });
  console.log('/api/weekly:', JSON.stringify(wk));
  const rd = await p.evaluate(async () => { const r = await fetch('/api/reading?tab=all&type=video'); const j = await r.json(); return { status: r.status, keys: Object.keys(j || {}), items: (j.items || []).length, counts: j.counts }; });
  console.log('/api/reading?type=video:', JSON.stringify(rd).slice(0, 400));
  const vd = await p.evaluate(async () => { const r = await fetch('/api/videos?tab=all'); const j = await r.json(); return { status: r.status, keys: Object.keys(j || {}), n: (j.items || j.videos || []).length }; });
  console.log('/api/videos:', JSON.stringify(vd).slice(0, 300));
  const ar = await p.evaluate(async () => { const r = await fetch('/api/articles?sort=new'); const j = await r.json(); return { status: r.status, keys: Object.keys(j || {}), n: (j.items || j.articles || []).length }; });
  console.log('/api/articles:', JSON.stringify(ar).slice(0, 300));
  const ho = await p.evaluate(async () => { const r = await fetch('/api/hot?tab=featured'); const j = await r.json(); return { status: r.status, keys: Object.keys(j || {}), n: (j.items || []).length }; });
  console.log('/api/hot?tab=featured:', JSON.stringify(ho).slice(0, 300));
  await b.close();
})().catch((e) => { console.log('ERR', String(e.message).split('\n')[0]); process.exit(2); });
