// 二期前端 Playwright 静态走查：/daily/ 渲染、弹窗交互、主题切换、/reader/ AI 面板
const { chromium } = require('playwright');

const BASE = 'http://localhost:3000';
const shot = (page, name) =>
  page.screenshot({ path: `analysis/pw-${name}.png`, fullPage: false });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));

  // 1. /daily/ 有日报：页头/统计卡/栏目
  await page.goto(`${BASE}/daily/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const h1 = await page.textContent('h1');
  console.log('H1:', h1);
  console.log('has 重新生成:', await page.locator('button:has-text("重新生成")').count());
  console.log('stat cards:', await page.locator('text=候选内容').count());
  console.log('sections:', await page.locator('section h2').allTextContents());
  await shot(page, 'daily');

  // 2. 打开设置弹窗
  await page.click('button[title="日报设置"]');
  await page.waitForTimeout(600);
  console.log('settings modal:', await page.locator('text=日报设置').count());
  console.log('columns in modal:', await page.locator('text=栏目管理').count());
  console.log('focus badge:', await page.locator('text=已重点关照').count());
  await shot(page, 'daily-settings');
  await page.keyboard.press('Escape');
  await page.click('button:has-text("取消")');
  await page.waitForTimeout(300);

  // 3. 点卡片开快速学习弹窗
  const card = page.locator('article.card').first();
  console.log('cards:', await page.locator('article.card').count());
  await card.click();
  await page.waitForTimeout(800);
  console.log('quick study:', await page.locator('text=快速学习').count());
  console.log('btns:', await page.locator('button:has-text("加入收藏"), button:has-text("已收藏")').count(),
    await page.locator('button:has-text("复制链接")').count(),
    await page.locator('button:has-text("打开原文")').count());
  await shot(page, 'quick-study');
  // 复制链接 → toast
  await page.click('button:has-text("复制链接")');
  await page.waitForTimeout(300);
  console.log('toast:', await page.locator('text=已添加到剪贴板').count());
  await page.click('button[title="关闭"]');
  await page.waitForTimeout(300);

  // 4. 主题切换三轮无崩坏
  await page.click('button[title^="主题："]');
  await page.waitForTimeout(300);
  await shot(page, 'daily-theme2');
  await page.click('button[title^="主题："]');
  await page.waitForTimeout(300);
  await shot(page, 'daily-theme3');
  await page.click('button[title^="主题："]'); // 回到默认
  await page.waitForTimeout(200);

  // 5. 重新生成
  await page.click('header >> button:has-text("重新生成")');
  await page.waitForTimeout(2500);
  console.log('notice:', await page.locator('text=已生成 DeepSeek 智能日报。').count());

  // 6. /reader/ AI 速览面板
  await page.goto(`${BASE}/reader/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const rows = page.locator('div.cursor-pointer.border-b');
  const rowCount = await rows.count();
  console.log('reader rows:', rowCount);
  if (rowCount > 0) {
    await rows.first().click();
    await page.waitForTimeout(800);
    await page.click('button[title="AI 速览"]');
    await page.waitForTimeout(3000);
    console.log('ai panel:', await page.locator('text=AI 速览').count());
    const panelText = await page.locator('section article div.rounded-xl').last().textContent().catch(() => '');
    console.log('ai panel text head:', (panelText || '').slice(0, 80));
    await shot(page, 'reader-ai');
    // 设置弹窗
    await page.click('button[title="速览设置"]');
    await page.waitForTimeout(500);
    console.log('ai settings:', await page.locator('text=AI 速览设置').count());
    console.log('ranges:', await page.locator('button:has-text("最近48小时")').count());
    await shot(page, 'ai-settings');
    await page.click('button:has-text("取消")');
  }

  console.log('CONSOLE ERRORS:', JSON.stringify(errors, null, 1));
  await browser.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
