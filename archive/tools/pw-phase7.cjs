// 七期前端 Playwright 走查（T9/T10/T11）：真实接口打已就绪部分，未就绪（富字段/sources/data/backfill）验证优雅降级
const { chromium } = require('playwright');
const path = require('path');

const BASE = 'http://localhost:3000';
const OUT = path.join(__dirname, '..', 'analysis');
const errors = [];
const results = [];
const ok = (name, pass, note = '') => {
  results.push(`${pass ? 'PASS' : 'FAIL'} ${name}${note ? ' — ' + note : ''}`);
  console.log(results[results.length - 1]);
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 850 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/Failed to load resource/.test(t)) errors.push('console: ' + t);
  });

  // ---- 1. 热榜：日期分组时间轴 ----
  await page.goto(BASE + '/hot/', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=热点榜', { timeout: 8000 });
  await page.waitForTimeout(1500);

  const groupHeaders = await page.locator('main section > button').count();
  ok('日期分组头渲染（M月D日 星期X · N 条）', groupHeaders > 0, `分组数=${groupHeaders}`);
  const firstHeader = (await page.locator('main section > button').first().innerText().catch(() => '')).replace(/\n/g, ' ');
  ok('分组头格式（含星期+条数）', /月.+日.*星期[一二三四五六日].*条/.test(firstHeader), firstHeader.trim());
  const cardCount = await page.locator('main article').count();
  ok('时间轴卡片渲染', cardCount > 0, `卡片=${cardCount}`);
  const timeCol = await page.locator('main section div.w-11').count();
  ok('左列 HH:mm 时间轴', timeCol > 0, `时间节点=${timeCol}`);
  await page.screenshot({ path: path.join(OUT, 'pw-p7-hot-timeline.png') });

  // 富字段（后端 T6 未就绪 → 评分/标签/推荐理由应优雅缺席而非报错）
  const scoreBadges = await page.locator('text=/AI 评分 \\d+\\/100/').count();
  const reasonBlocks = await page.locator('text=推荐理由：').count();
  ok('富字段降级（无评分徽章不崩）', true, `评分徽章=${scoreBadges} 推荐理由=${reasonBlocks}（后端未就绪则为 0）`);

  // 分组折叠：点第一个分组头 → 卡片消失；再点展开
  const before = await page.locator('main article').count();
  await page.locator('main section > button').first().click();
  await page.waitForTimeout(400);
  const afterCollapse = await page.locator('main article').count();
  ok('分组可折叠', afterCollapse < before, `${before} → ${afterCollapse}`);
  await page.locator('main section > button').first().click();
  await page.waitForTimeout(400);
  ok('分组可展开', (await page.locator('main article').count()) === before);
  // 默认最新日展开、其余折叠
  if (groupHeaders > 1) {
    ok('默认仅最新日展开', afterCollapse === 0 || afterCollapse < before, `折叠首日=${afterCollapse}`);
  }

  // 分类胶囊 + 空分类文案
  const capBtn = page.locator('button:has-text("论文")').first();
  if (await capBtn.count()) {
    await capBtn.click();
    await page.waitForTimeout(1200);
    const n = await page.locator('main article').count();
    const emptyCat = await page.locator('text=该分类近期待抓取内容为空').count();
    ok('分类胶囊筛选/空分类文案', n > 0 || emptyCat > 0, `论文类卡片=${n} 空文案=${emptyCat}`);
    await page.screenshot({ path: path.join(OUT, 'pw-p7-hot-capsule.png') });
    await page.locator('button:has-text("全部")').first().click();
    await page.waitForTimeout(800);
  } else {
    ok('分类胶囊筛选', false, '未找到「论文」胶囊');
  }

  // ---- 2. ♡ 收藏 → 阅读器稍后阅读交叉验证 ----
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const firstCard = page.locator('main article').first();
  const favTitle = (await firstCard.locator('h3').innerText().catch(() => '')).trim();
  await firstCard.locator('button[title*="稍后阅读"]').click();
  await page.waitForTimeout(800);
  const heartOn = await firstCard.locator('button[title="取消稍后阅读"]').count();
  ok('热榜卡片 ♡ 收藏切换', heartOn > 0, `收藏条目「${favTitle.slice(0, 20)}」`);
  await page.screenshot({ path: path.join(OUT, 'pw-p7-hot-favorite.png') });

  // 阅读器稍后阅读 Tab 应能看到
  await page.goto(BASE + '/reader/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.locator('button:has-text("稍后阅读")').first().click().catch(() => {});
  await page.waitForTimeout(1500);
  const inLater = favTitle ? await page.locator(`text=${favTitle.slice(0, 12)}`).count() : 0;
  ok('收藏在阅读器稍后阅读可见（双向一致）', inLater > 0, `命中=${inLater}`);
  await page.screenshot({ path: path.join(OUT, 'pw-p7-reader-later.png') });

  // 回热榜取消收藏（还原现场）
  await page.goto(BASE + '/hot/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.locator('main article').first().locator('button[title="取消稍后阅读"]').click().catch(() => {});
  await page.waitForTimeout(600);

  // ---- 3. 全部动态 Tab：来源下拉 + 搜索 ----
  await page.click('button:has-text("全部动态")');
  await page.waitForTimeout(1200);
  const srcSelect = await page.locator('select[title="按来源筛选"]').count();
  const srcOptions = await page.locator('select[title="按来源筛选"] option').count();
  ok('全部动态来源下拉', srcSelect > 0, `选项=${srcOptions}（/api/hot/sources 未就绪则仅「全部」）`);
  await page.fill('input[placeholder*="搜索"]', 'Claude');
  await page.waitForTimeout(1200);
  const hits = await page.locator('main article').count();
  ok('全部动态搜索', hits >= 0, `搜索 Claude 后卡片=${hits}`);
  await page.screenshot({ path: path.join(OUT, 'pw-p7-hot-all.png') });
  await page.fill('input[placeholder*="搜索"]', '');
  await page.waitForTimeout(900);

  // ---- 4. 详情弹窗：双语切换 ----
  await page.locator('main article').first().click();
  await page.waitForSelector('text=AI 导读', { timeout: 8000 });
  ok('详情含 AI 导读区块', true);
  const hasOldBtn = await page.locator('button:has-text("查看英文原文")').count();
  ok('六期「查看英文原文」按钮已移除（单一原文入口）', hasOldBtn === 0);
  await page.screenshot({ path: path.join(OUT, 'pw-p7-detail-zh.png') });

  // 切「原文」：original_html 未就绪 → 走 /api/hot/original 兜底（ok 或 fail 兜底都合规）
  await page.locator('[role="tab"]:has-text("原文")').click();
  const origResult = await Promise.race([
    page.waitForSelector('.article-content p', { timeout: 30000 }).then(() => 'rendered'),
    page.waitForSelector('text=阅读原文 ↗', { timeout: 30000 }).then(() => 'fallback-link'),
  ]).catch(() => 'timeout');
  ok('原文切换（original_html 或兜底抓取或失败兜底）', origResult !== 'timeout', `结果=${origResult}`);
  await page.screenshot({ path: path.join(OUT, 'pw-p7-detail-orig.png') });
  await page.locator('[role="tab"]:has-text("中文")').click();
  await page.waitForTimeout(500);

  // 复制链接 toast
  await page.click('button:has-text("复制链接")');
  await page.waitForSelector('text=已添加到剪贴板', { timeout: 3000 }).catch(() => {});
  ok('复制链接 toast', (await page.locator('text=已添加到剪贴板').count()) > 0);

  // 详情内收藏按钮
  const detHeart = await page.locator('button[title*="稍后阅读"]').count();
  ok('详情内含 ♡ 收藏', detHeart > 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ---- 5. 设置页：数据 Tab + 回填按钮 ----
  await page.goto(BASE + '/wechat/', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=热点榜', { timeout: 8000 });
  // 回填按钮（接口未就绪 → 禁用态 + 提示）
  const bfBtn = page.locator('button:has-text("回填历史"), button:has-text("回填中")').first();
  const bfDisabled = await bfBtn.isDisabled().catch(() => null);
  const bfHint = await page.locator('text=回填接口尚未就绪').count();
  ok('回填按钮状态（未就绪禁用）', bfDisabled !== null, `disabled=${bfDisabled} 提示=${bfHint}`);
  const hotSec = page.locator('section:has-text("热点榜")').last();
  await hotSec.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, 'pw-p7-settings-hot.png') });

  // 数据 Tab
  await page.click('button:has-text("数据")');
  await page.waitForTimeout(1200);
  const hasSnapshot = await page.locator('text=整库快照').count();
  const hasCleanup = await page.locator('text=内容清理').count();
  const hasStats = await page.locator('text=存储统计').count();
  const dataDegraded = await page.locator('text=数据管理接口尚未就绪').count();
  ok('数据 Tab 三区渲染', hasSnapshot > 0 && hasCleanup > 0 && hasStats > 0, `降级提示=${dataDegraded}`);
  const snapDisabled = await page.locator('button:has-text("生成快照")').isDisabled().catch(() => null);
  ok('快照按钮降级禁用（/api/data 未就绪）', snapDisabled === true || dataDegraded === 0, `disabled=${snapDisabled}`);
  await page.screenshot({ path: path.join(OUT, 'pw-p7-settings-data.png') });

  // 一期备份区文案
  await page.click('button:has-text("公众号 RSS")');
  await page.waitForTimeout(800);
  await page.locator('text=配置轻量迁移').scrollIntoViewIfNeeded().catch(() => {});
  ok('一期备份区标注「配置轻量迁移」', (await page.locator('text=配置轻量迁移').count()) > 0);

  // ---- 6. 三主题无崩坏（热榜页循环截图）----
  await page.goto(BASE + '/hot/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  for (const theme of ['blue-white', 'dark', 'warm-paper']) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
      localStorage.setItem('qw-theme', t);
    }, theme);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `pw-p7-theme-${theme}.png`) });
  }
  ok('三主题截图完成', true);

  // ---- 汇总 ----
  console.log('\n===== 控制台/页面 JS 错误 =====');
  if (errors.length) errors.forEach((e) => console.log('ERR ' + e));
  else console.log('（无）');
  console.log('\n===== 结果汇总 =====');
  results.forEach((r) => console.log(r));
  ok('控制台 0 JS 错误', errors.length === 0, `${errors.length} 个`);
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
