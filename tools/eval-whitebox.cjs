#!/usr/bin/env node
/**
 * 白盒一致性检查器（41-4 / EVAL_GUIDE §4）
 * 只检「本项目真踩过、且肉眼 review 抓不到」的结构不变量；不做风格检查。
 * 用法：node tools/eval-whitebox.cjs [--json]     退出码：0=全过，1=有 fail_product
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const fails = [];
const notes = [];
const ok = (id, cond, msg) => { if (!cond) fails.push(`${id} ${msg}`); else notes.push(`  ✓ ${id}`); return cond; };
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|cjs|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
};

const THREE = ['server/services/collectors/store.js', 'api/collect.js', 'tools/collect-turso.js'];

// ── W1 三端熔断阈值：必须引用唯一实现，且不得再写死字面量 ──
{
  const shared = require('../lib/source-breaker');
  ok('W1a', shared.BREAKER_THRESHOLDS.youtube === 10 && shared.BREAKER_THRESHOLDS.default === 3,
    `唯一实现阈值应为 youtube 10 / default 3，实测 ${JSON.stringify(shared.BREAKER_THRESHOLDS)}`);
  const inlineHardcode = THREE.filter(exists).filter((f) => /===\s*'youtube'\s*\?\s*10\s*:\s*3/.test(read(f)));
  ok('W1b2', inlineHardcode.length === 0, `三端不得再各写一遍阈值（会重新分叉）：${JSON.stringify(inlineHardcode)}`);
  const notShared = THREE.filter(exists).filter((f) => !/source-breaker/.test(read(f)));
  ok('W1c', notShared.length === 0, `三端必须引用 lib/source-breaker.js：${JSON.stringify(notShared)}`);
}

// ── W1b UA 一致（坑 #19：自定义 UA 被 newsnow 拒 → 必须浏览器 UA） ──
{
  const files = ['tools/collect-turso.js', 'api/collect.js', 'lib/collectors/fetcher.js', 'server/services/collectors/fetcher.js'].filter(exists);
  const uas = [];
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/(?:const UA\s*=\s*|'User-Agent'\s*:\s*)['"]([^'"]{8,})['"]/g)) uas.push({ f, ua: m[1] });
  }
  const bad = uas.filter((u) => !/Mozilla\/5\.0/.test(u.ua));
  ok('W1b', uas.length >= 2 && bad.length === 0, `UA 必须是浏览器 UA（坑 #19），异常项 ${JSON.stringify(bad.map((b) => `${b.f}:${b.ua.slice(0, 24)}`))}`);
}

// ── W3 假开关检测：UI 能改、后端从不读的 settings 键 ──
{
  const backend = ['api/[...slug].js', 'tools/collect-turso.js', 'api/_ai.js', 'api/_alerts.js', 'api/collect.js', 'api/daily-generate.js']
    .concat(walk('server')).filter(exists);
  const backendReads = new Set();
  for (const f of backend) {
    const src = read(f);
    for (const m of src.matchAll(/getSetting\(\s*'([a-zA-Z][\w.]*)'/g)) backendReads.add(m[1]);
    for (const m of src.matchAll(/settings WHERE key\s*=\s*'?([a-zA-Z][\w.]*)'?/g)) backendReads.add(m[1]);
  }
  const uiFiles = walk('web/src');
  const written = new Set();
  for (const f of ['api/[...slug].js'].concat(walk('server/routes')).filter(exists))
    for (const m of read(f).matchAll(/setSetting\(\s*'([a-zA-Z][\w.]*)'/g)) written.add(m[1]);
  // 只报「前端有对应控件、后端却从不读」——那才是 H10/H12/B51 的假开关形态；
  // 纯状态戳（前端无控件、只写不读）降级为提示，不算门禁失败。
  const uiText = uiFiles.map(read).join('\n');
  // W3b：只用于"回显给同一个界面"的键同样是假开关（B51 就是从 W3 的缝里漏掉的——
  // ai.features 明明被 getSetting 读了，但读的那一处只是把它塞进 GET 响应里再显示一次，
  // 全库没有任何行为分支消费它。故：某键的**每一处**读都长得像响应对象的属性 → 判假开关。）
  const linesOf = {};
  for (const f of backend) linesOf[f] = read(f).split(/\r?\n/);
  const isEchoOnly = (k) => {
    let seen = 0;
    for (const f of backend) {
      const L = linesOf[f];
      for (let i = 0; i < L.length; i++) {
        if (!L[i].includes(`getSetting('${k}'`)) continue;
        seen++;
        const asProp = /^\s*[\w.]+:\s*(await\s+)?getSetting\(\s*'/.test(L[i]);
        const inResp = L.slice(Math.max(0, i - 8), i + 3).some((x) => /jsonOk\(\{|res\.json\(\{/.test(x));
        if (!(asProp && inResp)) return false;
      }
    }
    return seen > 0;
  };
  const fakeSwitches = [];
  const deadWrites = [];
  for (const k of written) {
    if (k.startsWith('alerts.')) continue;
    if (backendReads.has(k) && !isEchoOnly(k)) continue;
    (uiText.includes(k) ? fakeSwitches : deadWrites).push(k);
  }
  ok('W3', fakeSwitches.length === 0, `假开关（UI 可改但后端从不读，H10/H12/B51 家族）：${JSON.stringify(fakeSwitches)}`);
  if (deadWrites.length) notes.push(`  i W3 提示：只写不读的状态戳 ${JSON.stringify(deadWrites)}`);
}

// ── W4 序列化 null 陷阱（坑 #36）：只抓"把值写进存储/参与逻辑"的裸 typeof==='object' ──
{
  const bad = [];
  for (const f of ['tools/migrate-to-turso.js', 'api/[...slug].js', 'server/db.js', 'lib/db.js', 'tools/collect-turso.js'].filter(exists)) {
    const lines = read(f).split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return; // 注释里提到该写法是教学说明，不算命中
      const m = line.match(/typeof\s+(\w+)\s*===\s*'object'/);
      if (!m) return;
      const v = m[1];
      // 同行已有真值前置（`v && typeof v === 'object'`）即已排除 null，不算风险
      if (new RegExp(`!\\s*${v}\\b|\\b${v}\\s*&&|${v}\\s*!==\\s*null`).test(line)) return;
      if (/===\s*null|!\s*!/.test(lines.slice(Math.max(0, i - 4), i + 1).join('\n'))) return;
      bad.push(`${f}:${i + 1}`);
    });
  }
  ok('W4', bad.length === 0, `typeof==='object' 未先排除 null（会把 NULL 写成字符串 'null' 或让 null 进对象分支）：${JSON.stringify(bad)}`);
}

// ── W6 动态 WHERE 片段必须整体加括号 ──
{
  const src = read('api/[...slug].js');
  const bad = [];
  src.split('\n').forEach((line, i) => {
    if (/WHERE \$\{\s*\w+\}\$/.test(line) || /WHERE \$\{\s*\w+\}(?!\s*\})/.test(line) && /AND/i.test(line)) bad.push(`api/[...slug].js:${i + 1}: ${line.trim().slice(0, 90)}`);
  });
  ok('W6', bad.length === 0, `动态 WHERE 片段拼接未加括号，OR 条件会吞掉后续 AND（B28 同型）：${JSON.stringify(bad)}`);
}

// 基线棘轮：已知且已挂账的历史缺口记在 docs/eval/whitebox-baseline.json，
// 只对**新增**缺口判红 —— 既不让门禁因历史债长红到被人忽略，也不许再添新债。
const BASELINE = exists('docs/eval/whitebox-baseline.json')
  ? JSON.parse(read('docs/eval/whitebox-baseline.json')) : { w7_missing_cloud_routes: [], w9_pitfalls_without_test_lock: [] };
const knownW7 = new Set((BASELINE.w7_missing_cloud_routes || []).map((x) => x.path));
const knownW9 = new Set(BASELINE.w9_pitfalls_without_test_lock || []);

// ── W7 前端请求路径必须在云端路由表存在（抓 B52/B57 类"端点只在本地有"） ──
{
  const cloud = read('api/[...slug].js');
  const routed = new Set([...cloud.matchAll(/path === '(\/api\/[\w/-]+)'/g)].map((m) => m[1]));
  for (const m of cloud.matchAll(/path\.startsWith\('(\/api\/[\w/-]+)'\)/g)) routed.add(m[1]);
  const missing = new Set();
  for (const f of walk('web/src')) {
    for (const m of read(f).matchAll(/['"`](\/api\/[a-z][\w/-]*)['"`]/g)) {
      const p = m[1];
      if (/\$\{|%s/.test(p) || knownW7.has(p)) continue;
      if (!routed.has(p) && ![...routed].some((r) => p.startsWith(r + '/'))) missing.add(`${p} ← ${f}`);
    }
  }
  ok('W7', missing.size === 0, `前端请求的端点在云端路由表不存在（本地有云端无＝恒「加载中」/404）：${JSON.stringify([...missing])}`);
  const stillKnown = (BASELINE.w7_missing_cloud_routes || []).filter((x) => !routed.has(x.path));
  if (stillKnown.length < (BASELINE.w7_missing_cloud_routes || []).length) {
    notes.push(`  i W7：基线里部分缺口已修好，可精简 baseline（剩 ${stillKnown.length} 条）`);
  }
}

// ── W9 坑编号 ↔ 测试对账 ──
{
  const ids = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, 'docs/pitfalls')).filter((x) => x.endsWith('.md') && x !== 'README.md'))
    for (const m of read(`docs/pitfalls/${f}`).matchAll(/^### #(\w+)/gm)) ids.add(m[1]);
  const testText = walk('tests').map(read).join('\n');
  const uncovered = [...ids].filter((id) => /^\d+$/.test(id) && !knownW9.has(id) && !testText.includes(`#${id}`));
  ok('W9', uncovered.length === 0, `新增坑无回归锁（坑 #N 必须被某个测试引用，坑 #13/#T2 反复复发的教训）：${JSON.stringify(uncovered)}`);
  const noLock = [...ids].filter((id) => !testText.includes(id));
  if (noLock.length) notes.push(`  i W9：${noLock.length} 条历史坑仍无测试字面引用（基线内，逐步补锁）`);
}

// ── W2 多写者产物表按档位读（不变量 12） ──
{
  const guards = read('lib/brief-guards.js');
  ok('W2', /pickDailyReport|schemaVersion/.test(guards), 'lib/brief-guards.js 必须是档位读取唯一实现');
  const readers = ['api/[...slug].js', 'server/services/ai/daily.js'].filter(exists);
  const bypass = readers.filter((f) => /ORDER BY generated_at DESC LIMIT 1/.test(read(f)) && !/brief-guards|pickDailyReport/.test(read(f)));
  ok('W2b', bypass.length === 0, `读层绕过档位守卫直接取最新（坑 #32 复发）：${JSON.stringify(bypass)}`);
}

// ── W10 重复 SQL 判定：同一个「按文本特征分类」的判定抄多份 = 三端漂移的成因 ──
// B60/B61 实测：「这是不是播客」在 6 处各写一遍 LIKE 链，其中 4 份漏 .opus →
// opus 单集进不了日报、播客计数恒 0 而列表有 143 条。副本之间还各有增减，所以按
// 「LIKE 模式集合的重叠度」判重，不按字面量全等——否则正好漏掉这类漂移。
{
  const candFiles = ['api', 'server', 'lib', 'tools']
    .filter(exists).flatMap((d) => walk(d))
    .filter((p) => !path.basename(p).startsWith('_') && !/\.test\.js$/.test(p));
  const patToFiles = new Map(); // 文本特征模式 -> Set<file>
  const filePats = new Map();
  for (const p of candFiles) {
    const pats = new Set([...read(p).matchAll(/LIKE\s+'(%[^']+)'/g)].map((m) => m[1]));
    if (!pats.size) continue;
    filePats.set(p, pats);
    for (const x of pats) {
      if (!patToFiles.has(x)) patToFiles.set(x, new Set());
      patToFiles.get(x).add(p);
    }
  }
  const knownW10 = BASELINE.w10_duplicated_predicates || [];
  const isKnown = (a, b) => knownW10.some((k) => Array.isArray(k.files) && k.files.includes(a) && k.files.includes(b));
  const pairs = [];
  const files = [...filePats.keys()];
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const [a, b] = [files[i], files[j]];
      const shared = [...filePats.get(a)].filter((x) => filePats.get(b).has(x));
      // 共享 ≥3 个同一形态的模式 → 判定被抄了两份（哪怕其中一份少了扩展名）
      if (shared.length >= 3 && !isKnown(a, b)) pairs.push({ a, b, n: shared.length, sample: shared.slice(0, 3) });
    }
  }
  pairs.sort((x, y) => y.n - x.n);
  ok('W10', pairs.length === 0,
    '同一 SQL 判定被抄成多份，须收敛到 lib/ 单一实现（见 B60/B61）：' +
    pairs.slice(0, 8).map((d) => `\n      · ${d.a} ↔ ${d.b}（${d.n} 个共享模式，如 ${d.sample.join(',')}）`).join(''));
  if (knownW10.length) notes.push(`  i W10：${knownW10.length} 组重复判定已在基线（逐步清）`);
}

// ── W11 独立入口的 Provider 完整性（B71：后台入口漏挂 LanguageProvider，登录门五个文案显示裸 key）──
// 通用化判据：入口的模块图里只要有人调 useI18n()/useTheme()，入口自己就必须挂对应 Provider。
// 只查"入口文件里有没有那几个字"是抓不到的——AdminPage 自己不用 i18n，用的是它下面的 LoginModal。
{
  const read0 = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { return ''; } };
  const importsOf = (file) => [...read0(file).matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
  const resolve = (from, spec) => {
    const base = path.posix.join(path.posix.dirname(from), spec).replace(/\\/g, '/');
    for (const cand of [base, base + '.jsx', base + '.js', base + '.tsx']) {
      if (fs.existsSync(path.join(ROOT, cand))) return cand;
    }
    return null;
  };
  const closure = (entry) => {
    const seen = new Set(); const q = [entry];
    while (q.length) {
      const f = q.shift();
      if (seen.has(f)) continue;
      seen.add(f);
      for (const s of importsOf(f)) { const r = resolve(f, s); if (r && !seen.has(r)) q.push(r); }
    }
    return [...seen];
  };
  const cfg = read0('web/vite.config.js');
  const declared = [...cfg.matchAll(/['"](src\/[\w/.-]+\.jsx?)['"]/g)].map((m) => 'web/' + m[1]);
  const entries = declared.length ? declared : ['web/src/main.jsx', 'web/src/admin.jsx'];
  const need = [['useI18n(', 'LanguageProvider'], ['useTheme(', 'ThemeProvider']];
  const bad = [];
  for (const e of entries) {
    const files = closure(e);
    if (!files.length || !read0(e)) continue;
    for (const [hook, provider] of need) {
      const user = files.find((f) => read0(f).includes(hook));
      if (user && !read0(e).includes(`<${provider}`)) bad.push(`${e} 的模块图里 ${user} 用了 ${hook}，入口却没挂 <${provider}>`);
    }
  }
  ok('W11', bad.length === 0, `独立入口缺 Provider（Hook 会静默退回 createContext 默认值，界面显示裸 key 或主题失效）：\n      ${bad.join('\n      ')}`);
  if (entries.length) notes.push(`  i W11：检查了 ${entries.length} 个入口（${entries.join(', ')}）`);
}

// ── W12 早报「视频与播客」栏的字段对账（B84：三份 mediaItems 实现各写一遍，
//    消费端依赖的 source_avatar 只要有一处漏带，表现就是"某些天有图标某些天没有"）──
// 全仓库扫，不写死文件清单：新增副本必须被同一个判据抓到（坑 #40/#41 同族）。
{
  const misses = [];
  let sites = 0;
  for (const f of walk('server').concat(walk('api'), walk('tools'), walk('lib'))) {
    if (!/\.(js|cjs)$/.test(f)) continue;
    read(f).split('\n').forEach((line, i) => {
      if (!/mediaItems\.push\(/.test(line) || !/kind: '(video|podcast)'/.test(line)) return;
      sites++;
      if (!/source_avatar/.test(line)) misses.push(`${f}:${i + 1}`);
    });
  }
  ok('W12', sites >= 6 && misses.length === 0,
    `mediaItems 构造点 ${sites} 处（<6 说明判据抓不到东西了）；缺 source_avatar：${JSON.stringify(misses)}`);
}

// ── W13 日报栏目表只许一份（B10：同一张表抄了 5 份且已漂，漂的那份把关键词复述当栏目注解
//    写上了线上；更糟的是"恢复默认栏目"会把副本写进 settings，脏默认值能进生产库）──
{
  const OWNER = 'lib/daily-columns.js';
  // 认栏目的身份特征（名字 + special 标记同时出现才算一份完整副本），不按关键词数组判：
  // 关键词数组在 reading 侧另有合法用途（lib/reading-filters.js 的源类型集合含历史 wemp）
  // 负向验证补两刀（2026-09-19 对抗审查）：只认单引号 → 改成双引号就绕过；间隔写死 220 →
  // 换行排版就绕过。所以现在两种引号都认、间隔放宽到 600，并把 web/ 与脚本目录一起扫。
  const MARK = /name:\s*['"]培训课程发布['"][\s\S]{0,600}?special:\s*['"]spotlight['"]/;
  const copies = [];
  const scanDirs = ['server', 'api', 'tools', 'lib', 'web/src', 'scripts'];
  for (const d of scanDirs) {
    for (const f of walk(d)) {
      if (!/\.(js|cjs|jsx)$/.test(f) || f === OWNER) continue;
      if (MARK.test(read(f))) copies.push(f);
    }
  }
  ok('W13', copies.length === 0 && exists(OWNER) && MARK.test(read(OWNER)),
    `日报栏目表必须只有 ${OWNER} 一份实现，副本：${JSON.stringify(copies)}（多份必漂；「恢复默认栏目」会把副本写进 settings）`);
}

// ── W14 入报质量门槛必须接在**每一处生成日报并写库**的语句上（B20）──
// 这一判据本身已经错过四次，每次都因为"清单/字面量"而不是"事实"（坑 #58/#63 与 ISSUES B20）：
//  ① 手工列 3 个文件 → 真实 5 个写入函数；② 文件级 grep → 同文件第二个写入函数被算成已接；
//  ③ 只看"出现过 passesDailyQualityGate" → 把返回值扔掉、或只写进行尾注释，都照样绿；
//  ④ 在源码全文里找 SQL → 正则里的引号让注释没剥干净，且 log('TODO: applyDailyQualityGate(...)')
//     也算接线（第三轮对抗审查实测）。现在 SQL 只在**字符串字面量**里找、接线只看 masked 视图。
// 动态表名（INSERT INTO 变量）= 整表复制路径（备份恢复/迁移），门槛对它不适用，但**必须列出来**：
// 否则"把表名改成变量"就成了绕过判据的门。
{
  const { findDailyReportWriters } = require('../lib/daily-writers');
  const all = findDailyReportWriters(ROOT);
  const writers = all.filter((w) => !w.dynamic);
  const copies = all.filter((w) => w.dynamic);
  const ungated = writers.filter((w) => !w.ok);
  const notExec = writers.filter((w) => w.ok && !w.executed);
  // 下限的"5"只在这里出现一次；写入点清单的**语义**（哪五份、各由谁触发）唯一写死处是
  // docs/CLOUD_PIPELINE_GUIDE.md §不变量 12，本判据只负责"每一处有没有真接上"，不复述清单。
  ok('W14', all.length > 0 && writers.length >= 5 && ungated.length === 0 && notExec.length === 0,
    `daily_reports 写入语句 ${all.length} 处（生成类 ${writers.length}：${writers.map((w) => `${w.fn}@${w.file}:${w.line}`).join(' / ')}；` +
    `整表复制类 ${copies.length}：${copies.map((w) => `${w.fn}@${w.file}:${w.line}`).join(' / ') || '无'}）；` +
    `未接门槛：${JSON.stringify(ungated.map((w) => `${w.fn}@${w.file}:${w.line}`))}；` +
    `接了但所在函数没有执行入口：${JSON.stringify(notExec.map((w) => `${w.fn}@${w.file}:${w.line}`))}。` +
    '要求 = 该 INSERT 之前有一次"结果赋回变量"的 applyDailyQualityGate 调用（派生实现 lib/daily-writers.js；写入点语义见 CLOUD_PIPELINE_GUIDE §12）');
}

// ── W15 取"最后同步时间"的 MAX(时间列) 必须排掉字面串 'null'（B93，2026-09-19 第三次同类污染） ──
// 判据同样从事实派生（坑 #58/#59）：扫所有"MAX(<已知污染时间列>)"的出现点，要求同一表达式里有 NULLIF。
// 只收 MAX 不收 MIN：文本序 `'null' > '2026-…'`，所以被毒的是 MAX（「最后同步」变 null）；
// MIN 取到的仍是最早的真实时间，'null' 抢不到第一，故不在此判据范围内（别为了让判据对称而改无关代码）。
{
  const { stripComments } = require('../lib/src-spans');
  const POLLUTED = ['last_fetched_at']; // 实测有字面串 'null' 的列（sources.last_fetched_at）
  const MAXRE = new RegExp(`\\bMAX\\(([^)]*\\b(?:${POLLUTED.join('|')})\\b[^)]*)\\)`, 'g');
  const bad = [];
  let seenMax = 0;
  for (const f of ['server', 'api', 'tools', 'lib'].flatMap((d) => walk(d))) {
    const src = stripComments(read(f));
    for (const m of src.matchAll(MAXRE)) {
      seenMax++;
      if (!/NULLIF\s*\(/i.test(m[1])) {
        const line = src.slice(0, m.index).split('\n').length;
        bad.push(`${f}:~${line} → MAX(${m[1].trim().slice(0, 40)})`);
      }
    }
  }
  ok('W15', seenMax >= 3 && bad.length === 0,
    `MAX(${POLLUTED.join('/')}) 共 ${seenMax} 处，未排字面串 'null' 的：${JSON.stringify(bad)}` +
    '（B93：一行 \'null\' 就能让后台「最后同步」自上线起恒显示"从未同步"，且两端各写一遍必漏一端）');
}

// ── W16 「今日/北京日界」只许一份实现（B90/B96/B97/B99，2026-09-20）──
// 与回归锁 tests/regression-20260920b B4 共用 lib/time-caliber.js 那一份判据（两边各写一遍必漂）。
// 允许清单里只有两份：服务端 lib/time-window.js 与浏览器对端 web/src/beijing-date.mjs ——
// 后者不是重复实现而是同一日历在浏览器里的另一份运行时（前端不能 require CJS），
// 它的正确性由 regression-20260920c C5 **逐时刻跑数**比对，不靠文本相似。
{
  const { findTimeCaliberViolations } = require('../lib/time-caliber');
  const r = findTimeCaliberViolations(ROOT);
  ok('W16', r.scanned > 100 && r.violations.length === 0 && r.missingImport.length === 0,
    `扫 ${r.scanned} 个运行文件；时间口径第二份实现：${JSON.stringify(r.violations.slice(0, 8).map((v) => `${v.file}:${v.line} ${v.label}`))}；` +
    `不再引用唯一实现的消费点：${JSON.stringify(r.missingImport)}（允许清单：${r.allowed.join('、')}）`);
}

// ── W17 删除/保留谓词三端只许一份（B102 / spec43 D1，2026-09-20）──
// 判据与回归锁 tests/regression-retention.test.js R4 共用 lib/retention#findRetentionViolations
// 那一份实现（坑 #58/#59：判据与自证各写一套 = 没有判据）。
// 病根实测：`datamgr.CLEAN_TABLES` 曾含 articles+videos 且 `cleanup()` 无豁免，而 scheduler 每 24h
// 调一次 → 本地起满一天删掉 91% 文章与全部视频播客（AGENTS §1 的三份实现里两份会删视频、一份连豁免都没有）。
{
  const { findRetentionViolations } = require('../lib/retention');
  const r = findRetentionViolations(ROOT);
  ok('W17', r.scanned > 100 && r.violations.length === 0 && r.videosDeletable.length === 0 && r.consumed.length >= 3,
    `扫 ${r.scanned} 个源文件；第二份保留谓词（"时间列 < ?"却不经 lib/retention）：` +
    `${JSON.stringify(r.violations.slice(0, 6).map((v) => `${v.file}:${v.line} ${v.table}`))}；` +
    `把视频列入可删的作用域：${JSON.stringify(r.videosDeletable)}（2026-09-13 决策：永不删）；` +
    `引用唯一实现的消费点应 >=3（本地/runner/云端手动端点），实得 ${r.consumed.length}：${r.consumed.join('、') || '无'}`);
  if (r.exempt.length) notes.push(`  i W17：已记账待收口的第二份谓词 ${r.exempt.length} 处 —— ${Object.keys(require('../lib/retention').PENDING_UNIFY).join('、')}（豁免按**整文件**记账，所以该文件里新写的第二份谓词会被一起放过，收口前这条是已知空洞）`);
}

// ── W23 测试里的写方法必须指隔离库（B117 / spec43 §六，2026-09-21）──
// 判据与回归锁 tests/regression-test-isolation.test.js 共用 lib/test-isolation#findWriteWithoutIsolation。
// 病根：`regression-20260918` 曾对生产发 `DELETE /api/weekly/archive/999999`（真 Bearer token），
// 没删成只因为"999999 期恰好不存在"；`regression-20260913b` R6 曾对生产发 POST cleanup/preview。
// 同族事故翻过车（坑 #17：一条测试把线上 8 个订阅源清零），而 B83 那句"全部搬完"就是说满了被 B117 推翻的。
{
  const { findWriteWithoutIsolation } = require('../lib/test-isolation');
  const r = findWriteWithoutIsolation(ROOT);
  ok('W23', r.scanned >= 50 && r.violations.length === 0 && r.isolated.length >= 4,
    `扫 ${r.scanned} 份测试；写方法 + 真碰云端层 + 未隔离：${JSON.stringify(r.violations.map((v) => v.file))}；` +
    `已隔离的写方法测试应 >=4 份，实得 ${r.isolated.length}：${r.isolated.join('、') || '无'}；` +
    `只读碰云端（spec43 §六：允许）${r.readOnlyOnCloud.length} 份`);
  notes.push('  i W23：判据是**整文件**粒度（同一文件里出现过 file: 就整份放过），已知空洞见 lib/test-isolation.js 末段');
}

const asJson = process.argv.includes('--json');
if (asJson) console.log(JSON.stringify({ ok: fails.length === 0, fails, notes }, null, 1));
else { for (const n of notes) console.log(n); for (const f of fails) console.log('  ✗ ' + f); console.log(`whitebox：${fails.length ? `${fails.length} 项不通过` : '全过'}`); }
process.exitCode = fails.length ? 1 : 0;
