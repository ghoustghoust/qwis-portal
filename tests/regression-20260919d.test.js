// 2026-09-19 T6 第 1 步小刺打包回归锁：B39 / B53 / B62 / B51 / B58 / B54 / B56
// 本文件同时是 docs/pitfalls/backend.md 坑 #38「能力差异只用给人看的文案表达」的回归锁。
// F6-1/2/3 另锁 docs/pitfalls/collection.md 坑 #39「大规模失败先分环境类与源侧，分母必须含成功」。
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

// ── B51 假开关（用户已裁决：摘除。见 docs/ISSUES.md「已裁决不再待批」）──
// 实测：ai.features 只有两处"读者"——GET 时把它回显给同一个界面、PUT 时写回去。
// 全库没有任何行为分支读 features.translate/summary/classify/analyze。
// 「摘要」「栏目分类」「事件关联」其实是规则实现（summarize() 截取、api/_classify.js、SQL 聚合）。
// 所以这不是"开关没生效"，是"根本没有开关"。
const FAKE_SWITCH_UI = /FEATURES\.map\([\s\S]{0,200}?type="checkbox"/;
test('B51-0 检测器自检：必须能看见假开关 UI 的已知形态', () => {
  const knownBad = '{FEATURES.map(f => (<label><input type="checkbox" checked={!!features[f.key]} /></label>))}';
  assert.ok(FAKE_SWITCH_UI.test(knownBad), '探针失效');
});

test('B51-1 假开关、假统计、假流程折叠必须摘除', () => {
  const src = read('web/src/components/AiSettingsTab.jsx');
  const code = src.replace(/^\s*(\/\/|\*).*$/gm, '');
  assert.ok(!FAKE_SWITCH_UI.test(code), '4 个假复选框仍在');
  assert.ok(!/已启用功能/.test(code), '「x/4 已启用功能」假统计仍在');
  assert.ok(!/操作流程说明/.test(code), '「操作流程说明」是纯文案冒充功能，按批注⑬应做成 tips');
  assert.ok(!/\bFEATURES\b/.test(code), 'FEATURES 常量应随开关一起删除');
});

test('B51-2 两端不得再有 ai.features 的读写面（没有行为就不要有持久化）', () => {
  for (const f of ['api/[...slug].js', 'server/routes/ai.js']) {
    const src = read(f).replace(/^\s*(\/\/|\*).*$/gm, '');
    assert.ok(!/setSetting\(\s*['"]ai\.features['"]/.test(src), `${f} 仍在写 ai.features`);
    assert.ok(!/getSetting\(\s*['"]ai\.features['"]/.test(src), `${f} 仍在回显 ai.features`);
  }
});

// ── B58 热点榜分类表显示的是前端硬编码默认，不是线上生效值 ──
// 实测三方：线上 settings['hot.categories'] 的「模型」含 3 项（多出「AI 模型」）；
// 前端 DEFAULT_MAP 只有 2 项且漏「AI 产品/论文/研究/技巧观点」；
// 而云端 GET /api/hot/categories 返回 {categories:[...]}\u2014\u2014把读到的映射丢了，本地端返回 {categories, map}。
// 结果：前端 `if (d?.map)` 永远不成立 → 表格里 6 行有 4 行是假的，且 .catch(() => {}) 让这件事完全静默。
test('B58-0 检测器自检：必须能看见"云端丢映射"的响应形态', () => {
  const knownBad = 'return jsonOk({ categories: Object.keys(custom) });';
  assert.ok(/jsonOk\(\{\s*categories:/.test(knownBad), '探针失效');
  // 反向：要求"必须含 map"的那条断言，对旧的坏响应必须不匹配——否则它就是假绿
  assert.ok(!/jsonOk\(\{[^}]*categories[^}]*\bmap\b/.test(knownBad),
    'B58-2 的 map 断言太松：旧的不返回映射的写法也能过');
});

test('B58-1 分类映射常量只许有一份实现（lib），前端不得再抄一份默认表', () => {
  const lib = require('../lib/hot-categories');
  assert.deepEqual(Object.keys(lib.DEFAULT_CATEGORY_MAP), lib.CATEGORIES, '默认表必须覆盖六类');
  assert.ok(lib.DEFAULT_CATEGORY_MAP['模型'].includes('AI 模型'), '默认表必须含线上实际 feed 名');
  const ui = read('web/src/components/HotSettings.jsx').replace(/^\s*(\/\/|\*).*$/gm, '');
  assert.ok(!/const DEFAULT_MAP/.test(ui), '前端仍有第二份默认映射表');
  const svc = read('server/services/hot.js');
  assert.match(svc, /require\([^)]*lib\/hot-categories/, '本地服务层必须复用同一份定义');
});

test('B58-2 云端必须把生效映射与来源一起返回，前端不得静默降级', () => {
  const api = read('api/[...slug].js');
  assert.match(api, /jsonOk\(\{[^}]*categories[^}]*\bmap\b/, '云端 /api/hot/categories 必须同时返回 categories 与 map（简写 map, 亦可）');
  assert.match(api, /categorySource|source:\s*['"](settings|default)['"]/, '必须说明映射来自线上设置还是内置默认');
  const ui = read('web/src/components/HotSettings.jsx');
  assert.ok(!/\.catch\(\(\) => \{\}\)/.test(ui), '分类表加载失败不得静默吞掉（用户会一直看到假默认）');
});

// ── B56 快照区在云端说谎 ──
// 实测：云端 GET /api/data/list 返回 200 + {backups: [], note: '云端 Turso 不支持文件型快照…'}，
// 前端把 note 丢掉、ready 置 true、snaps 空 → 显示「暂无快照」（暗示"有这功能但还没快照"），
// 而三个动作按钮照常可点，只有点了才吃到 501 toast。
const FAKE_EMPTY_STATE = /ready \? '暂无快照'/;
test('B56-0 检测器自检：必须能看见"只凭 ready 就说暂无快照"的形态', () => {
  assert.ok(FAKE_EMPTY_STATE.test("{ready ? '暂无快照' : '接口未就绪'}"), '探针失效');
});

test('B56-1 两端必须用布尔声明文件快照能力，不能只写给人看的 note', () => {
  const cloud = read('api/[...slug].js');
  assert.match(cloud, /fileSnapshots:\s*false/, '云端 /api/data/list 必须显式声明 fileSnapshots:false');
  const local = read('server/routes/data.js');
  assert.match(local, /fileSnapshots:\s*true/, '本地 /api/data/list 必须声明 fileSnapshots:true');
});

test('B56-2 不支持时不得再出现「暂无快照」，动作按钮必须禁用', () => {
  const ui = read('web/src/components/DataTab.jsx');
  const code = ui.replace(/^\s*(\/\/|\*).*$/gm, '');
  // 「暂无快照」在本地端仍是正确文案，所以判据不是"不许出现这四个字"，
  // 而是：空态条件链的**第一个**分支必须是能力位——否则不支持时仍会走到"暂无"。
  const at = code.indexOf("'暂无快照'");
  assert.ok(at > 0, '本地端仍应保留「暂无快照」文案');
  const guard = code.indexOf('snapshotsUnsupported ?');
  const emptyLen = code.indexOf('snaps.length === 0 ?');
  assert.ok(guard > 0 && guard < at, '「暂无快照」之前必须先判能力位（云端不支持时会把"做不到"说成"还没做"）');
  assert.ok(emptyLen > guard, '能力位必须是空态条件链的第一分支，排在长度判断之前');
  assert.match(code, /snapshotsUnsupported/, '界面必须持有"本端不支持文件快照"的状态');
  assert.ok((code.match(/disabled=\{[^}]*snapshotsUnsupported/g) || []).length >= 2,
    '快照相关的动作按钮都要被能力位禁用（至少生成/导入两个）');
});

// ── 35A-F6 系统性故障不折算成单源失败（spec 35A AC5；T6 第 1 步已批准那"一条判据"）──
// 事故原型：一次代理故障把 458 个本地源集体记失败并逐个熔断（坑 #35）。
test('F6-1 判据本身：只有网络/环境类的大规模同源失败才抑制', () => {
  const sb = require('../lib/source-breaker');
  const R = (o) => sb.detectSystemicFailure(o);
  const proxyStorm = R(Array.from({ length: 50 }, (_, i) => ({ ok: false, error: 'connect ECONNREFUSED 127.0.0.1:789' + i })));
  assert.equal(proxyStorm.systemic, true, '代理全挂必须判系统性（这正是 458 源误杀的场景）');
  assert.equal(proxyStorm.dominantShare, 1, '端口不同不该把指纹打散');

  const timeoutStorm = R([...Array.from({ length: 25 }, (_, i) => ({ ok: false, error: 'read ETIMEDOUT peer ' + i })),
    ...Array.from({ length: 200 }, () => ({ ok: true }))]);
  assert.equal(timeoutStorm.systemic, true, '比例不高但绝对量级已达事故且同指纹 → 仍抑制');

  const real404s = R([...Array.from({ length: 30 }, (_, i) => ({ ok: false, error: 'HTTP 404 for feed ' + i })),
    ...Array.from({ length: 100 }, () => ({ ok: true }))]);
  assert.equal(real404s.systemic, false, '一批同源 404 是源真死了，不许借"系统性"赦免');

  const scattered = R(Array.from({ length: 6 }, (_, i) => ({ ok: false, error: 'HTTP 50' + i + ' origin weird' })));
  assert.equal(scattered.systemic, false, '指纹分散的失败要照常计入各源');
  assert.equal(R([{ ok: false, error: 'ETIMEDOUT' }, { ok: false, error: 'ETIMEDOUT' }]).systemic, false,
    '样本过小（2 个）不判系统性，否则 1/1 就是 100%');
});

test('F6-2 指纹归一：同一故障换个端口/IP/数字不该被打散', () => {
  const { errorFingerprint: fp } = require('../lib/source-breaker');
  assert.equal(fp('connect ECONNREFUSED 127.0.0.1:7890'), fp('connect ECONNREFUSED 127.0.0.1:10809'));
  assert.equal(fp('GET https://feeds.example.com/a.xml failed'), fp('GET https://feeds.example.com/b.xml failed'));
  assert.notEqual(fp('HTTP 404 Not Found'), fp('connect ECONNREFUSED 127.0.0.1:7890'));
});

test('F6-3 runner 真的用这条判据决定不熔断（不是只有函数没人调）', () => {
  const runner = read('tools/collect-turso.js');
  assert.match(runner, /detectSystemicFailure\(stats\.outcomes\)/, 'runner 未接判据');
  assert.match(runner, /if \(systemic\) \{[\s\S]{0,240}?不累加|return \{ autoPaused: false, suppressed: true \}/,
    'updateSourceError 在系统性时必须跳过 fail_count 与熔断');
  // 分母必须含成功：只统计失败会让比例恒为 100%，抑制器就成了永久免死金牌
  assert.match(runner, /\(stats\.outcomes \|\| \(stats\.outcomes = \[\]\)\)\.push\(\{ ok: true \}\)/,
    '成功侧也必须记 outcome，否则失败率分母里没有成功');
});

// ── 41-7 过程性二值检查器：工具自身的锁（评测器不自检 = 假门禁）──
test('41-7 过程检查器自检必须 7/7 通过（每项都要"坏样本会红、好样本会绿"）', () => {
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(process.execPath, ['tools/eval-process-checks.cjs', '--self-test'],
    { cwd: ROOT, encoding: 'utf8' });
  const m = out.match(/自检：(\d+)\/(\d+) 通过/);
  assert.ok(m, '自检没输出计数，等于没跑：' + out.slice(0, 200));
  assert.equal(m[1], m[2], `有检查器没通过自检（未通过的一律视为假门禁）：\n${out}`);
  assert.equal(Number(m[2]), 7, '检查器数量变了，EVAL_GUIDE §3.6 与小 spec 41-7 要同步');
});

test('41-7 检查器要求参数出处与退出码诚实（本轮真踩过的两个坑，判据不许退化）', () => {
  const t = require('../tools/eval-process-checks.cjs');
  const names = Object.keys(t.CHECKS);
  for (const n of ['check_probe_params_sourced', 'check_exit_code_honest', 'check_no_stub_text', 'check_assertions_executed']) {
    assert.ok(names.includes(n), `缺检查 ${n}`);
  }
  // 猜参数（无 source）必须红；带 file:line 必须绿
  const bad = t.CHECKS.check_probe_params_sourced({ cases: [{ id: 'x', requests: [{ params: { tab: { value: 'article' } } }] }] });
  assert.equal(bad.ok, false, '无出处的探针参数必须判不过');
  const good = t.CHECKS.check_probe_params_sourced({ cases: [{ id: 'x', requests: [{ params: { type: { value: 'article', source: 'api/[...slug].js:1021' } } }] }] });
  assert.equal(good.ok, true, '带 file:line 出处的参数该过：' + good.why);
  // `cmd | tail` 吞退出码必须红（真发生过）
  assert.equal(t.CHECKS.check_exit_code_honest({ commands: [{ cmd: 'npm test | tail' }] }).ok, false);
});

// ── 41-3 F2P 取证器 ──
// 它自己第一版就被 Windows cmd 坑过：`--base ca42cd5^` 里的 ^ 被 cmd 当转义符吃掉，
// base 静默变成"改动本身"，于是报出"改前也全绿"→ 反过来冤枉真锁。见坑 #40。
test('41-3 取证器：git ref 的 ^ 必须原样送到 git（不经 cmd 解释）', () => {
  const { git } = require('../tools/eval-f2p.cjs');
  const head = git(['rev-parse', 'HEAD']);
  const parent = git(['rev-parse', 'HEAD^']);
  assert.match(head, /^[0-9a-f]{40}$/, 'HEAD 没解析成 sha');
  assert.match(parent, /^[0-9a-f]{40}$/, 'HEAD^ 没解析成 sha（^ 很可能又被 shell 吃掉了）');
  assert.notEqual(head, parent, 'HEAD^ 必须与 HEAD 不同——相同就说明参数被 cmd 篡改了');
  assert.notEqual(git(['rev-parse', 'HEAD^{commit}']), head + 'x');
});

test('41-3 判据本身：假锁/环境红/改后仍红 都必须判不过', () => {
  const { parseSummary, verdict } = require('../tools/eval-f2p.cjs');
  const red = parseSummary('ℹ tests 3\nℹ pass 0\nℹ fail 3\n✖ F6-1 x (1ms)\n✖ F6-2 y (1ms)\n✖ F6-3 z (1ms)\n');
  const green = parseSummary('ℹ tests 3\nℹ pass 3\nℹ fail 0\n');
  assert.equal(verdict(red, green, ['F6-1']).ok, true, '真锁该判成立');
  assert.equal(verdict(green, green, ['F6-1']).ok, false, '改前也绿 = 假锁，必须判不过');
  const envRed = parseSummary("ℹ tests 1\nℹ pass 0\nℹ fail 1\n✖ t (1ms)\nError: Cannot find module 'better-sqlite3'\n");
  assert.equal(verdict(envRed, green, ['t']).ok, false, 'worktree 缺依赖的"环境红"不许当改前证据');
  assert.equal(verdict(red, red, ['F6-1']).ok, false, '改后仍红 = 没修好');
  assert.equal(parseSummary('没有汇总行'), null, '解析不到汇总必须返回 null，不能当通过');
});

// 本轮实测：凭记忆挑的 base（64124b7）其实是修复提交 5aa8118 的子孙，
// 于是 8 条真锁被判"改前也全绿 = 假锁"，而 §6 给假锁的处置是删用例。见坑 #41。
test('41-3 基线守卫：选错基线要判"基线错"（退 2），不许长得像"锁是假的"（退 1）', () => {
  const t = require('../tools/eval-f2p.cjs');
  const f = 'tests/regression-20260919c.test.js';
  const intro = t.lockIntroCommit(f, 'B60-1');
  assert.ok(intro && /^[0-9a-f]{40}$/.test(intro), '反查不到锁的引入提交，守卫等于不存在');
  assert.deepEqual(t.baseIsStale({ 'B60-1': [intro] }, t.git(['rev-parse', 'HEAD'])), ['B60-1'],
    'base=HEAD 早已包含该修复，必须判基线错');
  // 正向探针：守卫反了方向会把所有取证拒死（suggestBase 的祖先判断真反过一次）
  assert.deepEqual(t.baseIsStale({ 'B60-1': [intro] }, t.git(['rev-parse', intro + '^'])), [],
    'base 在修复之前必须放行');
  const { execFileSync } = require('node:child_process');
  let code = 0, out = '';
  try {
    execFileSync(process.execPath, ['tools/eval-f2p.cjs', '--base', 'HEAD^', '--tests', f],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { code = e.status; out = String(e.stdout || '') + String(e.stderr || ''); }
  assert.equal(code, 2, `错基线必须退 2；退 1 会被读成"锁是假的"，处置动作就是删用例：\n${out}`);
  assert.match(out, /不要按 §6 删用例/, '报错文案必须把"别删用例"写进去：' + out.slice(0, 300));
});

test('41-3 两种红要分开：裸包名=环境红（不算证据），相对路径=修复新建文件（产品红，算证据）', () => {
  const { parseSummary, verdict } = require('../tools/eval-f2p.cjs');
  const own = parseSummary("ℹ tests 1\nℹ pass 0\nℹ fail 1\n✖ B60-1 x (1ms)\nError: Cannot find module '../lib/reading-filters'\n");
  assert.equal(own.envBroken, false, '收敛型修复新建的文件在旧树里本就没有；判成环境红 = 这类修复永远取不到证据');
  assert.deepEqual(own.missingOwn, ['../lib/reading-filters']);
  const dep = parseSummary("ℹ tests 1\nℹ pass 0\nℹ fail 1\n✖ t (1ms)\nError: Cannot find module 'better-sqlite3'\n");
  assert.deepEqual(dep.missingDeps, ['better-sqlite3'], '裸包名必须归环境类');
  assert.equal(verdict(dep, parseSummary('ℹ tests 1\nℹ pass 1\nℹ fail 0\n'), ['t']).ok, false, '环境红仍不许当改前证据');
  const green = parseSummary('ℹ tests 1\nℹ pass 1\nℹ fail 0\n');
  assert.equal(verdict(own, green, ['B60-1']).ok, true, '产品红（缺新建共享模块）该判成立');
  assert.match(verdict(own, green, ['B60-1']).why, /改前缺本次修复新建的文件/, '成立理由里必须写明红在"缺新文件"，别让人以为是断言打红');
});

// 自检项数不写死在文档里（写死就会漂）：这里只钉"必须全绿"，数量由工具自己报
test('41-3 取证器自检必须全绿（探针数与通过数相等，且不许少于 15 项）', () => {
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(process.execPath, ['tools/eval-f2p.cjs', '--self-test'], { cwd: ROOT, encoding: 'utf8' });
  const m = out.match(/自检：(\d+)\/(\d+) 通过/);
  assert.ok(m, '自检没输出计数，等于没跑：' + out.slice(0, 200));
  assert.equal(m[1], m[2], `有探针没通过（未通过一律视为假门禁）：\n${out}`);
  assert.ok(Number(m[2]) >= 15, `探针数量退化了（${m[2]}），取证器的负向验证不能省`);
});
