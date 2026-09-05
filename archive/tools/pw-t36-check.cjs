// T36 临时走查：/wechat/ 队列折叠区与待处理区渲染（后端 queue 路由未就绪，预期优雅降级）
const { chromium } = require('playwright');

const BASE = 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`${BASE}/wechat/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // 公众号 Tab：F24 待提交区 + F25 折叠区
  console.log('wechat F24 title:', await page.locator('text=待提交公众号信息').count());
  console.log('wechat F25 summary:', await page.locator('summary:has-text("公众号队列 API")').count());
  console.log('wechat empty hint:', await page.locator('text=暂无待提交条目').count());
  // 展开折叠区
  await page.click('summary:has-text("公众号队列 API")');
  await page.waitForTimeout(400);
  console.log('queue fields:', await page.locator('text=队列 API 地址').count(),
    await page.locator('input[type="password"]').count(),
    await page.locator('button:has-text("保存队列设置")').count(),
    await page.locator('button:has-text("同步队列")').count());
  console.log('token status:', (await page.locator('text=已保存 Token：').first().textContent().catch(() => '')));
  console.log('endpoint hint:', (await page.locator('text=wechat-rss-queue.php').first().textContent().catch(() => '')));
  // 点同步队列（后端未就绪 → 应显示错误详情不崩）
  await page.click('button:has-text("同步队列")');
  await page.waitForTimeout(1500);
  console.log('sync error shown:', await page.locator('text=同步失败').count());
  await page.screenshot({ path: 'analysis/pw-t36-wechat.png', fullPage: true });

  // B站 Tab：F31 折叠区 + F32 待处理列表
  await page.click('button:has-text("B站")');
  await page.waitForTimeout(800);
  console.log('bili F31 summary:', await page.locator('summary:has-text("B站队列同步")').count());
  console.log('bili F32 title:', await page.locator('text=本地待处理订阅').count());
  console.log('bili F32 empty:', await page.locator('text=暂无待处理订阅').count());
  await page.click('summary:has-text("B站队列同步")');
  await page.waitForTimeout(400);
  console.log('bili endpoint hint:', (await page.locator('text=bilibili-video-queue.php').first().textContent().catch(() => '')));
  await page.screenshot({ path: 'analysis/pw-t36-bilibili.png', fullPage: true });

  console.log('PAGE ERRORS:', JSON.stringify(errors));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
