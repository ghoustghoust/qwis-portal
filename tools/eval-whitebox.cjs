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

const asJson = process.argv.includes('--json');
if (asJson) console.log(JSON.stringify({ ok: fails.length === 0, fails, notes }, null, 1));
else { for (const n of notes) console.log(n); for (const f of fails) console.log('  ✗ ' + f); console.log(`whitebox：${fails.length ? `${fails.length} 项不通过` : '全过'}`); }
process.exitCode = fails.length ? 1 : 0;
