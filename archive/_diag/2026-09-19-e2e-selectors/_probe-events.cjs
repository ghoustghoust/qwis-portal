// 实测「热搜事件」视图的行元素：哪个 class 的 innerText 里含事件标题（子集判据要用它）
const { chromium } = require('playwright');
const { CLOUD_SITE } = require('../lib/cloud-site');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.PROXY || 'http://127.0.0.1:12000' } });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  let ev = null;
  p.on('response', async (r) => { const u = new URL(r.url()); if (u.pathname === '/api/hot/events') { try { ev = JSON.parse(await r.text()); } catch { } } });
  await p.goto(CLOUD_SITE + '/hot/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForTimeout(9000);
  await p.getByRole('button', { name: /^热搜事件$/ }).first().click();
  await p.waitForTimeout(12000);
  const titles = ((ev || {}).events || []).map((x) => String(x.title || '').slice(0, 10));
  for (const sel of ['div.flex-1.min-w-0', 'div.flex.items-center.gap-2', 'article.card.card-lift.cursor-pointer.p-4', 'div.relative.flex.gap-4.pb-4']) {
    const rows = await p.$$eval(sel, (els) => els.slice(0, 70).map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
    const hit = rows.filter((t) => titles.some((x) => x && t.includes(x))).length;
    console.log(`${sel.padEnd(42)} 行数=${String(rows.length).padStart(3)} 含事件标题=${hit}  例: ${rows[0] ? rows[0].slice(0, 46) : ''}`);
  }
  console.log('API events 条数 =', titles.length);
  await b.close();
})().catch((e) => { console.log('ERR', String(e.message).split('\n')[0]); process.exit(2); });
