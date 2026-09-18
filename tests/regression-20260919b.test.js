// 2026-09-19 批注轮小刺打包的回归锁（对应 docs/ISSUES.md B22/B27/B28/B29/B47/B48/B52/B59 + 坑 #35/#36）
// 原则：每条都锚在「改前会红」的具体形态上，不写自证式空断言（EVAL_GUIDE §6/§7）。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── B27 /read 快路径漏 date ──
test('B27: 云端 /api/reading 两条路径都必须产出 date 别名', () => {
  const src = read('api/[...slug].js');
  const m = src.match(/SELECT a\.id, a\.title, a\.url, a\.cover, a\.summary, a\.published_at, a\.created_at,\s*\n?\s*([^]*?)\s*\n\s*s\.name AS source_name[\s\S]*?FROM articles a LEFT JOIN sources/);
  assert.ok(m, '未找到 /api/reading 快路径 SELECT');
  assert.match(m[1], /COALESCE\(a\.published_at, a\.created_at\) AS date/, '快路径必须 AS date（否则前端分组出「未知日期」）');
  assert.match(src, /COALESCE\(\.\.\.\)|AS date/, '至少一条路径产出 date');
});

// ── B28 动态 WHERE 片段必须整体加括号 ──
test('B28: 云端 /api/reading 的 tabCond 必须被括号包住，否则类型条件被 OR 吞掉', () => {
  const src = read('api/[...slug].js');
  assert.match(src, /WHERE \(\$\{tabCond\}\)\$\{aExtra\}/, 'aBranch 必须 WHERE (${tabCond})${aExtra}');
  assert.ok(!/WHERE \$\{tabCond\}\$\{aExtra\}/.test(src), '不得残留未加括号的拼接');
});

// ── B29 类型口径：文章含 wemp、播客按音频 enclosure ──
// 2026-09-19 重锚：原断言锁的是 `if (type === 'article') aConds.push("...")` 这个**代码形状**，
// B60 把四处副本收敛成 lib/reading-filters.js 一份后形状变了（形状锁 = 自证式断言，EVAL_GUIDE §7）。
// 现在锁行为：口径必须真的含 wemp、播客必须是音频判定而不是 s.type='douyin'。
test('B29: 阅读页类型口径必须含 wemp，且播客不再按 douyin 判定', () => {
  const { readingTypeFilter } = require('../lib/reading-filters');
  const article = readingTypeFilter('article').articleCond;
  const podcast = readingTypeFilter('podcast').articleCond;
  assert.match(article, /'wemp'/, `文章类型必须含 wemp（线上 869 篇已读公众号此前隐身），实测 ${article}`);
  assert.ok(!/douyin/.test(podcast), '播客口径必须是音频特征，不是 s.type=douyin（云端 douyin 文章数=0）');
  assert.match(podcast, /LIKE/, '播客必须由封面/enclosure 特征判定');
});

// ── B22 三主题必须定义分档色 ──
test('B22: index.css 必须定义 t-success/t-warn/t-danger 与三主题 --warn', () => {
  const css = read('web/src/index.css');
  for (const cls of ['.t-success', '.t-warn', '.t-danger']) {
    assert.ok(new RegExp(`\\${cls.replace('.', '')}\\s*\\{`).test(css) || css.includes(`${cls} {`), `缺工具类 ${cls}`);
  }
  assert.equal((css.match(/--warn:/g) || []).length, 3, '三主题各定义一个 --warn');
  assert.match(css, /\.t-warn\s*\{\s*color:\s*var\(--warn\)/, '.t-warn 必须走 var(--warn)');
});

// ── B47 任务队列字段形状 ──
test('B47: MonitorTab 必须读 queueStats.overall（后端返回 {overall,byType}）', () => {
  assert.match(read('web/src/components/MonitorTab.jsx'), /queueStats\?\.overall \|\| queueStats/);
});

// ── B48 JSX 文本里的 \\uff08 不会被解析 ──
test('B48: AlertsTab 不得再把全角括号写成 JSX 文本转义', () => {
  const src = read('web/src/components/AlertsTab.jsx');
  assert.ok(!/>\s*\\uff08/.test(src), 'JSX 文本子节点不解析 \\u 转义，会渲染成字面串');
  assert.match(src, /\{'（'\}\{rr\.error\}\{'）'\}/);
});

// ── B52 云端缺路由时不得恒「加载中」 ──
test('B52: TranslateSkillTab 加载失败必须显式报错，不能停在加载中', () => {
  const src = read('web/src/components/TranslateSkillTab.jsx');
  assert.match(src, /setLoadError/);
  assert.match(src, /if \(!loadError\)[\s\S]*加载中/, '只有「仍在请求中」才显示加载中');
  assert.match(src, /翻译配置端点不可用/);
});

// ── B59 云端补 /api/auth/me（本地早有，云端漏移植） ──
test('B59: 云端必须有 /api/auth/me，且未鉴权时返回 401', () => {
  const cloud = read('api/[...slug].js');
  assert.match(cloud, /path === '\/api\/auth\/me' && method === 'GET'/);
  assert.match(cloud.slice(cloud.indexOf("'/api/auth/me'"), cloud.indexOf("'/api/auth/me'") + 400), /401/);
  assert.match(read('server/routes/auth.js'), /router\.get\('\/me'/, '本地端点必须同在（三端一致）');
});

// ── 坑 #35 熔断阈值唯一实现 ──
test('坑#35: 熔断阈值三端必须走 lib/source-breaker 同一实现', () => {
  const { breakerThreshold, shouldPauseOnFail } = require('../lib/source-breaker');
  assert.equal(breakerThreshold('youtube'), 10);
  assert.equal(breakerThreshold('rss'), 3);
  assert.equal(breakerThreshold(undefined), 3);
  assert.equal(shouldPauseOnFail('youtube', 9), false);
  assert.equal(shouldPauseOnFail('youtube', 10), true);
  assert.equal(shouldPauseOnFail('rss', 3), true);
  for (const f of ['server/services/collectors/store.js', 'api/collect.js', 'tools/collect-turso.js', 'lib/collectors/fetcher.js']) {
    assert.match(read(f), /source-breaker/, `${f} 必须引用唯一实现`);
  }
});

// ── 坑 #36 迁移序列化不得把 NULL 变成 'null' ──
test('坑#36: 迁移序列化对 null 必须短路，不能落库成字符串 null', () => {
  const src = read('tools/migrate-to-turso.js');
  const site = src.slice(src.indexOf('const values = columns.map'), src.indexOf('const values = columns.map') + 500);
  assert.match(site, /v === undefined \|\| v === null/, '必须先判 null 再走 JSON.stringify 分支');
  assert.ok(!/if \(v === undefined\) return null;\s*\n\s*if \(typeof v === 'object'\)/.test(site), '不得回到只挡 undefined 的旧写法');
});
