// E2E 验证（2026-09-11）：无感刷新 banner 端到端
// 1. 打开 /reader/ 等页面加载
// 2. 向 Turso 插入一条 published_at=now 的测试文章（source_id 用一个启用的非热榜源）
// 3. 等待前端 60s 轮询发现 → banner 出现
// 4. 截图 → 清理测试文章
const path = require('path');
const fs = require('fs');
try {
  const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  for (const line of envTxt.split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {}
const { chromium } = require('playwright');
const { createClient } = require('@libsql/client');

const FAKE_URL = 'https://example.com/e2e-poll-test-' + Date.now();
const OUT = 'C:/Users/17619/.cache/qwis-diag/e2e-banner.png';

(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

  const browser = await chromium.launch({
    headless: true,
    proxy: { server: 'http://127.0.0.1:7890' },
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

  console.log('1. 打开阅读器...');
  await page.goto('https://qwis-intel.vercel.app/reader/', { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(3000);

  console.log('2. 插入测试文章...');
  const src = await db.execute("SELECT id FROM sources WHERE enabled=1 AND type='rss' LIMIT 1");
  const sourceId = src.rows[0].id;
  const now = new Date().toISOString();
  await db.execute({
    sql: 'INSERT INTO articles(source_id,title,url,author,summary,content_html,published_at,created_at) VALUES(?,?,?,?,?,?,?,?)',
    args: [sourceId, 'E2E轮询验证文章（稍后被自动删除）', FAKE_URL, 'e2e', '测试', '<p>测试</p>', now, now],
  });
  console.log('   已插入, source_id=', sourceId);

  console.log('3. 等待轮询发现（最长 100s）...');
  let bannerFound = false;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(5000);
    // banner 常见文案：「更新了 N 篇」/「N 条新内容」
    const txt = await page.evaluate(() => document.body.innerText);
    if (/更新了?\s*\d+\s*篇|\d+\s*条新|新增\s*\d+/.test(txt)) { bannerFound = true; break; }
  }
  console.log('   banner 出现:', bannerFound);
  await page.screenshot({ path: OUT, fullPage: false });
  console.log('   截图:', OUT);

  console.log('4. 清理测试文章...');
  await db.execute({ sql: 'DELETE FROM articles WHERE url = ?', args: [FAKE_URL] });
  console.log('   已清理');

  await browser.close();
  db.close();
  console.log(bannerFound ? 'E2E PASS' : 'E2E FAIL: banner 未出现');
  process.exitCode = bannerFound ? 0 : 1;
})().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
