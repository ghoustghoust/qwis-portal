// T42/T44 无头走查（四期前端，后端抖音路由并行施工中，仅验证前端渲染与降级）
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000/wechat/';
const OUT = 'analysis';
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

await page.goto(BASE, { waitUntil: 'networkidle' });

// 1. 抖音 Tab 整体渲染
await page.click('button:has-text("抖音")');
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/pw-t42-douyin-tab.png`, fullPage: true });

// 2. 登录状态卡（未登录态：后端 404 → 降级显示）+ 扫码弹窗
const loginCard = await page.textContent('body');
console.log('登录卡未登录文案:', loginCard.includes('未添加抖音订阅/需要时再扫码登录'));
await page.click('button:has-text("扫码登录")');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/pw-t42-login-modal.png` });
console.log('弹窗标题:', await page.isVisible('text=需要重新登录抖音'));
await page.click('button:has-text("稍后处理")');
await page.waitForTimeout(300);

// 3. 添加失败原文提示展示（后端并行期返回「未知订阅源类型」，验证透传展示链路）
await page.fill('input[placeholder*="sec_uid"]', 'bad-input-123');
await page.click('section:has-text("添加抖音作者") button:has-text("添加")');
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/pw-t42-add-error.png` });

// 4. 主题走查（左下主题按钮循环：warm-paper → blue-white → dark）
const themeBtn = page.locator('button[title*="主题"], .theme-btn').first();
for (const t of ['blue-white', 'dark']) {
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  // 找不到专用按钮就遍历左下角固定定位按钮
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.bottom > window.innerHeight - 80 && r.left < 80;
    });
    btns[0]?.click();
  });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  console.log(`主题切换: ${before} → ${after}`);
  await page.screenshot({ path: `${OUT}/pw-t42-theme-${after || t}.png`, fullPage: true });
}
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].filter((b) => {
    const r = b.getBoundingClientRect();
    return r.bottom > window.innerHeight - 80 && r.left < 80;
  });
  btns[0]?.click();
}); // 回到默认主题

// 5. T44：扩展源区（公众号 Tab）
await page.click('button:has-text("公众号 RSS")');
await page.waitForTimeout(800);
await page.selectOption('select', 'x');
await page.fill('input[placeholder*="X 用户名"]', '@elonmusk');
await page.screenshot({ path: `${OUT}/pw-t44-ext-form.png`, fullPage: true });
await page.click('section:has-text("扩展源（RSS / YouTube / X）") button:has-text("添加")');
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/pw-t44-ext-result.png`, fullPage: true });
const body2 = await page.textContent('body');
console.log('扩展源区渲染:', body2.includes('扩展源（RSS / YouTube / X）'), '| 依赖说明:', body2.includes('X 依赖第三方 RSS 服务'));

console.log('JS errors:', errors.length ? errors : '无');
await browser.close();
