// 一次性：把"点开文章后详情面板是哪个容器、正文切片能否在里面找到"测清楚（E9 判据重写的依据）
const { chromium } = require('playwright');
const { CLOUD_SITE } = require('../lib/cloud-site');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.PROXY || 'http://127.0.0.1:12000' } });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const net = [];
  p.on('response', async (res) => {
    let u; try { u = new URL(res.url()); } catch { return; }
    if (!u.pathname.startsWith('/api/')) return;
    let json = null; try { json = JSON.parse(await res.text()); } catch { }
    net.push({ url: u.pathname, json, at: Date.now() });
  });
  await p.goto(CLOUD_SITE + '/reader/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForSelector('div.card.card-lift.p-3.cursor-pointer.relative', { timeout: 60000 });
  await p.waitForTimeout(8000);
  const list = net.find((r) => r.url === '/api/articles');
  const items = (list && list.json && list.json.items) || [];
  console.log('items', items.length, '第 1 条 id=', items[0] && items[0].id, 'title=', String(items[0].title).slice(0, 40),
    'translated=', String(items[0].translated_title || '').slice(0, 30));
  const before = (await p.evaluate(() => document.body.innerText)).length;
  await p.locator('div.card.card-lift.p-3.cursor-pointer.relative').first().click();
  await p.waitForTimeout(12000);
  const det = net.filter((r) => /^\/api\/articles\/\d+$/.test(r.url)).pop();
  const item = (det && det.json && (det.json.item || det.json)) || {};
  const html = String(item.content_html || '');
  const plain = html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
  console.log('详情 url=', det && det.url, 'content_html 长度', html.length, '纯文本长度', plain.length);
  const after = (await p.evaluate(() => document.body.innerText)).length;
  console.log('body 文本', before, '→', after);
  for (const [name, slice] of [['前30', plain.slice(0, 30)], ['中30', plain.slice(Math.floor(plain.length / 2), Math.floor(plain.length / 2) + 30)]]) {
    const found = await p.evaluate((s) => {
      const cand = [...document.querySelectorAll('article,section,div,p,span')]
        .filter((e) => e.innerText && e.innerText.includes(s));
      cand.sort((a, c) => a.innerText.length - c.innerText.length);
      const e = cand[0];
      return e ? { tag: e.tagName.toLowerCase(), cls: String(e.className).split(/\s+/).slice(0, 6).join('.'), len: e.innerText.length, n: cand.length } : null;
    }, slice);
    console.log(`  ${name}「${slice.slice(0, 24)}」→`, JSON.stringify(found));
  }
  await b.close();
})().catch((e) => { console.log('ERR', String(e.message).split('\n')[0]); process.exit(2); });
