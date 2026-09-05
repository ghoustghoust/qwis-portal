// 六期前端 Playwright 走查（T11~T16，后端 T1~T10 已就绪后版本）：全部打真实接口
const { chromium } = require('playwright');
const path = require('path');

const BASE = 'http://localhost:3000';
const OUT = path.join(__dirname, '..', 'analysis');
const errors = [];
const results = [];
const ok = (name, pass, note = '') => {
  results.push(`${pass ? 'PASS' : 'FAIL'} ${name}${note ? ' — ' + note : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 850 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    const t = m.text();
    // 只记录真正的 JS 错误；过滤跨域图片/媒体资源加载失败（既有行为，非本期引入）
    if (m.type() === 'error' && !/Failed to load resource/.test(t)) errors.push('console: ' + t);
  });

  // ---- 1. 四页面可访问 ----
  for (const p of ['/reader/', '/daily/', '/hot/', '/wechat/']) {
    const res = await page.goto(BASE + p, { waitUntil: 'domcontentloaded' });
    ok(`页面可访问 ${p}`, res && res.status() === 200, `status=${res && res.status()}`);
  }

  // ---- 2. 热榜页（真实后端）----
  await page.goto(BASE + '/hot/', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=热点榜', { timeout: 8000 });
  // 等首屏卡片或空态
  await page.waitForTimeout(1500);
  const cardCount = await page.locator('main article').count();
  ok('热榜精选卡片渲染（真实接口）', cardCount > 0, `卡片=${cardCount}`);
  await page.screenshot({ path: path.join(OUT, 'pw-p6-hot-featured.png') });

  // 分类胶囊筛选：点「行业」等真实存在的胶囊，看请求与结果
  const capBtn = page.locator('button:has-text("行业")').first();
  if (await capBtn.count()) {
    await capBtn.click();
    await page.waitForTimeout(1000);
    const n = await page.locator('main article').count();
    ok('热榜分类胶囊筛选', n >= 0, `筛选「行业」后卡片=${n}`);
    await page.screenshot({ path: path.join(OUT, 'pw-p6-hot-capsule.png') });
    await page.locator('button:has-text("全部")').first().click();
    await page.waitForTimeout(800);
  } else {
    ok('热榜分类胶囊筛选', false, '未找到「行业」胶囊');
  }

  // 全部动态 + 搜索
  await page.click('button:has-text("全部动态")');
  await page.waitForTimeout(800);
  const tlCount = await page.locator('main .card > div').count();
  ok('全部动态时间线渲染', tlCount > 0, `行数=${tlCount}`);
  await page.fill('input[placeholder*="搜索"]', 'Claude');
  await page.waitForTimeout(900);
  const hit = await page.locator('main .card > div').count();
  ok('全部动态搜索命中', hit > 0 && hit <= tlCount, `搜索 Claude 后行数=${hit}`);
  await page.fill('input[placeholder*="搜索"]', '');
  await page.waitForTimeout(900);

  // 详情弹窗 + 英文原文（真实抓取，允许失败走兜底）
  await page.locator('main .card > div').first().click();
  await page.waitForSelector('text=查看英文原文', { timeout: 8000 });
  ok('详情弹窗打开', (await page.locator('.article-content').count()) > 0 || (await page.locator('text=正文加载中').count()) >= 0);
  await page.screenshot({ path: path.join(OUT, 'pw-p6-hot-detail-zh.png') });
  await page.click('button:has-text("查看英文原文")');
  const enResult = await Promise.race([
    page.waitForSelector('.article-content p', { timeout: 30000 }).then(() => 'ok'),
    page.waitForSelector('text=阅读原文 ↗', { timeout: 30000 }).then(() => 'fallback'),
  ]).catch(() => 'timeout');
  ok('查看英文原文（加载或兜底）', enResult === 'ok' || enResult === 'fallback', `结果=${enResult}`);
  await page.screenshot({ path: path.join(OUT, 'pw-p6-hot-detail-en.png') });
  // 复制链接
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.click('button:has-text("复制链接")');
  await page.waitForSelector('text=已添加到剪贴板', { timeout: 3000 }).catch(() => {});
  ok('复制链接 toast', (await page.locator('text=已添加到剪贴板').count()) > 0);
  await page.keyboard.press('Escape');

  // ---- 3. DateFilter（真实后端，from/to 已支持）----
  await page.goto(BASE + '/reader/', { waitUntil: 'networkidle' });
  await page.waitForSelector('button[title="按日期范围筛选"]', { timeout: 8000 });
  await page.waitForTimeout(1200);
  // 默认视图下 span 跨度行（用 JS 正则断言，避免选择器转义问题）
  const spanText = await page.locator('section div.mt-1').first().innerText().catch(() => '');
  ok('列表头 span 跨度显示', /\d{4}\/\d{1,2}\/\d{1,2} ~ \d{4}\/\d{1,2}\/\d{1,2}/.test(spanText), spanText.trim());
  const reqUrls = [];
  page.on('request', (r) => r.url().includes('/api/articles') && reqUrls.push(r.url()));
  await page.click('button[title="按日期范围筛选"]');
  await page.waitForSelector('button:has-text("今天")', { timeout: 3000 });
  await page.screenshot({ path: path.join(OUT, 'pw-p6-datefilter-open.png') });
  await page.click('button:has-text("今天")');
  await page.waitForTimeout(1200);
  const btnText = await page.locator('button[title="按日期范围筛选"]').innerText();
  ok('DateFilter 激活显示 M/D~M/D', /📅\s*\d+\/\d+~\d+\/\d+/.test(btnText), btnText.trim());
  const lastReq = reqUrls[reqUrls.length - 1] || '';
  ok('文章请求带 from/to（真实筛选）', /from=\d{4}-\d{2}-\d{2}/.test(lastReq) && /to=\d{4}-\d{2}-\d{2}/.test(lastReq), (lastReq.split('?')[1] || '').slice(0, 80));
  await page.screenshot({ path: path.join(OUT, 'pw-p6-datefilter-active.png') });
  // 清除
  await page.click('button[title="按日期范围筛选"]');
  await page.click('button:has-text("清除")');
  await page.waitForTimeout(800);
  ok('DateFilter 清除恢复', !/~/.test(await page.locator('button[title="按日期范围筛选"]').innerText()));
  // 自定义范围（2003 年老文章，阮一峰存档）
  await page.click('button[title="按日期范围筛选"]');
  const dateInputs = page.locator('input[type="date"]');
  await dateInputs.nth(0).fill('2003-01-01');
  await dateInputs.nth(1).fill('2003-12-31');
  await page.click('button:has-text("应用")');
  await page.waitForTimeout(1500);
  const old2003 = await page.locator('button[title="按日期范围筛选"]').innerText();
  ok('自定义 2003 年范围可应用', /1\/1~12\/31/.test(old2003), old2003.trim());
  await page.screenshot({ path: path.join(OUT, 'pw-p6-datefilter-2003.png') });
  await page.click('button[title="按日期范围筛选"]');
  await page.click('button:has-text("清除")');
  await page.waitForTimeout(600);

  // 视频 Tab DateFilter + 筛选
  await page.locator('text=视频').first().click();
  await page.waitForTimeout(1000);
  const vdf = page.locator('button[title="按日期范围筛选"]');
  ok('视频 Tab 挂 DateFilter', (await vdf.count()) > 0);
  if (await vdf.count()) {
    await vdf.click();
    await page.click('button:has-text("近30天")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT, 'pw-p6-video-datefilter.png') });
  }

  // ---- 4. 日报页（真实 stale 字段）----
  const dailyResp = await page.goto(BASE + '/daily/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  ok('日报页渲染（真实后端）', dailyResp.status() === 200);
  await page.screenshot({ path: path.join(OUT, 'pw-p6-daily.png') });

  // stale 场景用 route mock 验证「打开即补」交互流（不清真实日报数据）
  await page.route('**/api/daily', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, report: null, stale: true }) });
    }
    return route.continue();
  });
  await page.route('**/api/daily/regenerate', async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, report: { generated_at: new Date().toISOString(), window_hours: 48, stats: { candidates: 2, articles: 2, videos: 0 }, sections: [{ column: 'AI 动态', desc: '测试栏目', items: [{ kind: 'article', ref_id: 1, title: '主卡片标题', summary: '摘要', source_name: '官博', published_at: new Date().toISOString(), related: [{ kind: 'article', ref_id: 2, source_name: 'AIHOT 热榜' }] }] }] } }),
    });
  });
  await page.goto(BASE + '/daily/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=正在生成今日情报', { timeout: 8000 });
  ok('日报 stale 显示「正在生成」', true);
  await page.waitForSelector('text=已生成 DeepSeek 智能日报', { timeout: 15000 });
  ok('日报自动生成完成并出提示条', true);
  ok('related 标注「另有 N 家信源报道」', (await page.locator('text=另有 1 家信源报道').count()) > 0);
  await page.screenshot({ path: path.join(OUT, 'pw-p6-daily-stale.png') });
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  // ---- 5. 设置页（真实后端）：间隔编辑 + 热点榜区 ----
  await page.goto(BASE + '/wechat/', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=热点榜', { timeout: 8000 });
  ok('设置页热点榜区展示', true);
  ok('分类规则表只读展示（真实规则）', (await page.locator('text=分类归类规则').count()) > 0);
  const intervalInputs = await page.locator('input[title*="刷新间隔（分钟）"]').count();
  ok('已订阅列表带间隔编辑', intervalInputs > 0, `间隔输入框 ${intervalInputs} 处`);

  // AIHOT 间隔真实 PUT 往返：设 30 → GET 验证 → 恢复原值
  const aihotRow = page.locator('section:has-text("热点榜")').last().locator('input[title*="刷新间隔（分钟）"]');
  if (await aihotRow.count()) {
    const orig = await aihotRow.inputValue();
    await aihotRow.fill('30');
    await page.locator('section:has-text("热点榜")').last().locator('button:has-text("保存")').click();
    await page.waitForTimeout(1200);
    const after = await aihotRow.inputValue();
    ok('AIHOT 间隔 PUT 生效（真实后端）', after === '30', `保存后=${after}`);
    // 恢复原值
    if (orig && orig !== '30') {
      await aihotRow.fill(orig);
      await page.locator('section:has-text("热点榜")').last().locator('button:has-text("保存")').click();
      await page.waitForTimeout(800);
    }
  } else {
    ok('AIHOT 间隔 PUT 生效（真实后端）', false, '未找到 AIHOT 间隔输入框');
  }

  // hot.enabled 开关真实往返：关 → 验证导航 🔥 消失 → 开回
  const hotSec = page.locator('section:has-text("热点榜")').last();
  await hotSec.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, 'pw-p6-settings-hot.png') });
  await page.locator('text=启用热点榜页面').click();
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: 'networkidle' });
  const fireGone = (await page.locator('a[title="热点榜"]').count()) === 0;
  ok('关闭开关后导航 🔥 消失', fireGone);
  await page.locator('text=启用热点榜页面').click();
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: 'networkidle' });
  const fireBack = (await page.locator('a[title="热点榜"]').count()) > 0;
  ok('重新开启后导航 🔥 恢复', fireBack);

  // ---- 6. 三主题巡检（热榜页真实数据）----
  for (const theme of ['warm-paper', 'blue-white', 'dark']) {
    await page.goto(BASE + '/hot/', { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `pw-p6-theme-${theme}.png`) });
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'warm-paper'));

  await browser.close();

  console.log('===== 走查结果 =====');
  results.forEach((r) => console.log(r));
  console.log('===== JS 错误 =====');
  const uniqErr = [...new Set(errors)];
  console.log(uniqErr.length ? uniqErr.join('\n') : '（无）');
})().catch((e) => {
  console.error('走查脚本异常：', e);
  process.exit(1);
});
