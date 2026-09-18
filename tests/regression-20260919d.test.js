// 2026-09-19 T6 第 1 步小刺打包回归锁 —— 本文件先记 B39
// 原则（EVAL_GUIDE §6/§7）：每条断言都必须"改前会红"，且不锁代码形状而锁行为/数据。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
require('./helpers');
const { cleanup } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test.after(() => cleanup());

// ── B39 生成历史：标题写「近 7 天」，实为 ORDER BY id DESC LIMIT 7 ──
// 2026-09-19 只读实测（tools/_diag-brief-history.cjs，线上 94 行日报）：
//   近 7 天真实 59 行，接口最多露 7 行 → 52 行看不见，且列表最旧只到 09-16（标题承诺 7 天，实际 3 天）
//   近 7 天里 42 行没有 schemaVersion（裸关键词版）、16 行 sv=2（AI 增强）、1 行降级
//   → UI 无法区分，用户批注⑦「生成历史看不出哪期能用」
test('B39-1 窗口必须是"真 7 天"，不是"前 7 条"', async () => {
  const { DAILY_HISTORY_SQL, historySinceIso, HISTORY_WINDOW_DAYS } = require('../lib/brief-guards');
  assert.ok(DAILY_HISTORY_SQL, 'lib/brief-guards 必须导出历史查询（SQL 放共享模块才能被真库跑）');
  assert.match(DAILY_HISTORY_SQL, /generated_at\s*>=\s*\?/, '必须按时间窗过滤');
  assert.ok(!/LIMIT\s+7\b/.test(DAILY_HISTORY_SQL), '不得再用 LIMIT 7 冒充 7 天窗口');
  assert.equal(HISTORY_WINDOW_DAYS, 7);
  const since = Date.parse(historySinceIso(Date.parse('2026-09-19T00:00:00Z')));
  assert.ok(Math.abs((Date.parse('2026-09-19T00:00:00Z') - since) / 864e5 - 7) < 0.01, '窗口边界必须正好 7 天');
});

test('B39-2 真实数据行为：7 天窗内一行不漏、窗外一行不漏进', () => {
  const { db } = require('../server/db');
  const { DAILY_HISTORY_SQL, historySinceIso } = require('../lib/brief-guards');
  const now = Date.now();
  db.exec('DELETE FROM daily_reports');
  const ins = db.prepare('INSERT INTO daily_reports(generated_at, window_hours, stats) VALUES (?,?,?)');
  // 窗外 3 行（8~12 天前）+ 窗内 9 行（含 0.1 天前与 6.9 天前两个边界）
  for (const d of [12, 9, 8]) ins.run(new Date(now - d * 864e5).toISOString(), 30, '{}');
  for (const d of [0.1, 1, 2, 3, 4, 5, 6, 6.5, 6.9]) ins.run(new Date(now - d * 864e5).toISOString(), 30, '{"schemaVersion":2}');
  const rows = db.prepare(DAILY_HISTORY_SQL).all(historySinceIso(now));
  assert.equal(rows.length, 9, `7 天窗内应返回 9 行，实测 ${rows.length}`);
  assert.ok(rows.every((r) => Date.parse(r.generated_at) >= now - 7.01 * 864e5), '窗外行泄漏');
});

test('B39-3 档位投影：AI 增强 / 裸关键词必须由 brief-guards 单一实现判定，前端不再硬编码「近 7 天」', () => {
  const { isAiDailyReport } = require('../lib/brief-guards');
  assert.equal(isAiDailyReport({ stats: '{"schemaVersion":2}' }), true);
  assert.equal(isAiDailyReport({ stats: '{}' }), false, '无 schemaVersion 的裸关键词版必须判 false');
  assert.equal(isAiDailyReport({ stats: '{"schemaVersion":"1"}' }), false, '字符串型 sv 也必须能判（实测线上混着写）');

  const api = read('api/[...slug].js');
  assert.match(api, /isAiDailyReport/, '云端历史接口必须复用 isAiDailyReport，不得自己再判一次 schemaVersion');

  const ui = read('web/src/components/BriefCenterTab.jsx');
  assert.ok(!/生成历史（近 7 天）/.test(ui), '前端标题不得把窗口写死，必须由接口回传的 windowDays 决定');
  assert.match(ui, /windowDays|window_days/, '前端应读接口回传的窗口天数');
});

// ── B53 零碎死码与错字（归属 39-2，见 docs/specs/38-admin-ia-refactor/spec.md 头部订正）──
// 实测：AiSettingsTab.jsx:252 把 API 地址 .slice(0,20) 截成 "apihub.agnes-ai.com/"（看着像坏了）；
//       「Agencs」错字散在标题与根规范文档；tools/collect-turso.js:1637 llmChat() 定义后全仓零调用。

// 负向自证：本条断言若写成"匹配不到就算过"，就会在坏代码存在时也绿（第一版就是这样，
// 正则要求 apiBase 与 .slice 之间没有右括号，而真实代码中间隔着 replace(...)）。
// 所以先用一条"必须命中已知坏形态"的探针，确认检测器真的能看见它。
const APIBASE_TRUNCATION = /apiBase[\s\S]{0,80}?\.slice\(\s*0\s*,\s*20\s*\)/;
test('B53-0 检测器自检：截断探针必须能看见已知的坏写法', () => {
  const knownBad = '<div title={c.apiBase}>{c.apiBase?.replace(/^https?:\\/\\//, \'\').slice(0, 20)}</div>';
  assert.ok(APIBASE_TRUNCATION.test(knownBad), '探针失效——下面那条 B53-1 会是假绿');
});

test('B53-1 AI 设置页不得截断 API 地址（容器已有 truncate，再 slice 只剩半个域名）', () => {
  const ui = read('web/src/components/AiSettingsTab.jsx');
  assert.ok(!APIBASE_TRUNCATION.test(ui), 'API 地址展示仍在 .slice(0,20)，会被截成 "apihub.agnes-ai.com/"');
});

test('B53-2 面向用户与规范的文本不得出现「Agencs」错字（真实平台名是 Agnes）', () => {
  // 只扫"会被读到"的两种文本：界面字符串、根规范文档。
  // docs/deprecated 与记录该错字本身的行不算（历史账不涂改，见 DOC_GOVERNANCE §4）。
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.jsx?$/.test(e.name)) continue;
      if (read(p).includes('Agencs')) hits.push(p);
    }
  };
  walk('web/src');
  if (fs.existsSync(path.join(ROOT, 'docs/DEVELOPMENT_STANDARDS.md')) && read('docs/DEVELOPMENT_STANDARDS.md').includes('Agencs')) {
    hits.push('docs/DEVELOPMENT_STANDARDS.md');
  }
  assert.deepEqual(hits, [], `仍有 Agencs 错字：${hits.join(', ')}`);
});

// spec 39-2 AC2 的机器化：定义了没人调 = 下一次改 AI 链路时骗人以为有统一通道
test('B53-3 runner 里不得留 llmChat() 这种"定义了没人调"的 AI 通道', () => {
  const runner = read('tools/collect-turso.js');
  const defs = (runner.match(/(?:async\s+)?function\s+llmChat\b/g) || []).length;
  const calls = (runner.match(/\bllmChat\s*\(/g) || []).length - defs;
  assert.equal(defs, 0, 'tools/collect-turso.js 仍定义 llmChat()');
  assert.ok(calls <= 0, `llmChat 有 ${calls} 个调用点，删除前先确认不是死码判断错了`);
  assert.ok(!/function\s+llmChat\b/.test(read('api/_ai.js')), 'api/_ai.js 不得有第二份 llmChat');
});

// ── B62 前端播客徽章是第七份分类副本（B60 的前端尾巴）──
// MyReadingPage.jsx:22 `sourceType === 'douyin'` 判播客，而筛选口径已改成音频特征：
// 结果"播客 Tab 筛得出条目、每条徽章却写文章"。kind 必须由 lib/reading-filters 出，两端 + 前端共用。
const DOUYIN_PODCAST_GUESS = /sourceType\s*===\s*'douyin'/;
test('B62-0 检测器自检：douyin 猜播客的坏写法必须能被探针命中（EVAL_GUIDE §4.1）', () => {
  assert.ok(DOUYIN_PODCAST_GUESS.test("if (sourceType === 'douyin') return t('reading.podcast');"), '探针失效');
});

test('B62-1 kind 由单一实现判定：视频/播客/文章三态', () => {
  const { readingItemKind } = require('../lib/reading-filters');
  assert.equal(readingItemKind({ item_type: 'video', cover: 'x' }), 'video');
  assert.equal(readingItemKind({ item_type: 'article', cover: 'https://media.xyzcdn.net/a/ep.m4a' }), 'podcast');
  assert.equal(readingItemKind({ item_type: 'article', cover: 'https://cdn.example/hero.jpg' }), 'article');
  assert.equal(readingItemKind({ item_type: 'article', cover: null }), 'article');
});

test('B62-2 两端列表响应都必须带 kind，前端不得再自己猜', () => {
  for (const f of ['api/[...slug].js', 'server/routes/reading.js']) {
    assert.match(read(f), /withReadingKinds/, `${f} 未用共享 kind 标注`);
  }
  const ui = read('web/src/pages/MyReadingPage.jsx').replace(/^\s*(\/\/|\*).*$/gm, '');
  assert.ok(!DOUYIN_PODCAST_GUESS.test(ui), '前端仍在用 sourceType===douyin 猜播客');
  assert.match(ui, /\.kind/, '前端徽章必须读接口回传的 kind');
});

// ── B54 「保留天数」改了不保存 ──
// 原实现把 PUT /api/settings 写在 doCleanup 的成功分支里（DataTab.jsx:236），
// 而执行按钮又 disabled={previewTotal === 0}（:349）→ 没有可删内容时，改数字永远存不下来。
const RETENTION_INSIDE_CLEANUP = /doCleanup[\s\S]{0,900}?put\(['"]\/api\/settings/;
test('B54-0 检测器自检：必须能看见"保存写在清理里"的坏形态', () => {
  const knownBad = 'const doCleanup = async () => { await api.post(\'/api/data/cleanup\'); await api.put(\'/api/settings\', { data: { retentionDays } }); };';
  assert.ok(RETENTION_INSIDE_CLEANUP.test(knownBad), '探针失效，B54-1 会是假绿');
});

test('B54-1 保留天数必须有独立保存通道，且不再依赖清理成功', () => {
  const src = read('web/src/components/DataTab.jsx');
  assert.match(src, /saveRetention/, '缺独立保存函数');
  assert.ok(!RETENTION_INSIDE_CLEANUP.test(src), 'PUT /api/settings 仍写在 doCleanup 成功分支里');
  const puts = (src.match(/put\(['"]\/api\/settings['"],\s*\{\s*\n?\s*data:\s*\{\s*retentionDays/g) || []).length;
  assert.ok(puts >= 1, 'saveRetention 必须真的 PUT data.retentionDays');
});

test('B54-2 保存入口不受"有没有可删内容"限制', () => {
  const src = read('web/src/components/DataTab.jsx');
  const btn = src.match(/onClick=\{saveRetention\}[\s\S]{0,200}?|disabled=\{[^}]*\}[\s\S]{0,60}?onClick=\{saveRetention\}/);
  assert.ok(btn, '找不到保存按钮与其 disabled 的关系');
  assert.ok(!/previewTotal\s*===\s*0/.test(src.match(/disabled=\{[^}]*\}\s*onClick=\{saveRetention\}/)?.[0] || ''),
    '保存按钮不得被 previewTotal===0 禁掉');
});
