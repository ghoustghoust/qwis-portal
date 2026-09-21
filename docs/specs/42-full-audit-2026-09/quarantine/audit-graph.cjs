// 审计 spec 42 · W0 地基：入口可达图 + 调度登记表 + 目录索引草稿
// 只读遍历仓库；唯一写入目标是 docs/eval/audit/ 下的三个产物。
// 用法：node tools/audit-graph.cjs
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'eval', 'audit');
const SRC_EXT = new Set(['.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-admin', '.vercel', '.vercelignore', '.next', 'data', 'shots', 'coverage', 'db']);
const TEXT_EXT = new Set(['.md', '.json', '.yml', '.yaml', '.js', '.cjs', '.mjs', '.jsx', '.bat', '.sh', '.html', '.txt', '.opml']);

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const walk = (dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
};

const allFiles = walk(ROOT).map(rel);
const srcFiles = allFiles.filter((f) => SRC_EXT.has(path.extname(f)));

// ---- 1. 入口清单（tier 决定「谁能养活一个文件」）----
const entries = new Map(); // path -> tier
const addEntry = (p, tier) => { if (p && fs.existsSync(path.join(ROOT, p))) entries.set(p, tier); };

addEntry('server/index.js', 'runtime');
addEntry('smoke-test.js', 'runtime');
addEntry('monitor-local.js', 'runtime');
addEntry('ecosystem.config.js', 'runtime');
for (const f of srcFiles.filter((x) => x.startsWith('api/'))) addEntry(f, 'runtime');
for (const f of srcFiles.filter((x) => x.startsWith('web/src/') && /(^|\/)(main|index|admin)\.(jsx|tsx|js)$/.test(x))) addEntry(f, 'runtime');
for (const f of srcFiles.filter((x) => x.startsWith('scripts/'))) addEntry(f, 'runtime');

// GitHub workflow 里被真实调用的脚本 = runner 入口
const workflowCrons = [];
for (const f of allFiles.filter((x) => x.startsWith('.github/workflows/'))) {
  const txt = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const c = line.match(/^\s*-\s*cron:\s*['"]([^'"]+)['"]/);
    if (c) workflowCrons.push({ workflow: f, cron: c[1] });
    const n = line.match(/(?:node|pnpm node)\s+((?:[\w.\-/]+\.(?:js|cjs|mjs)))/);
    if (n) addEntry(n[1].replace(/^\.\//, ''), 'runtime');
    const w = line.match(/node\s+([\w.\-/]+\.(?:js|cjs|mjs))\s+(\S+)/);
    if (w) workflowCrons.push({ workflow: f, cmd: w[0].trim(), sub: w[2] });
  }
}
// 一次性工具与测试：能证明"有人在用"，但不能证明"线上在用"
for (const f of srcFiles.filter((x) => x.startsWith('tools/'))) addEntry(f, 'cli');
for (const f of srcFiles.filter((x) => x.startsWith('tests/'))) addEntry(f, 'test');
for (const f of srcFiles.filter((x) => !x.includes('/') && SRC_EXT.has(path.extname(x)))) addEntry(f, 'cli');

// ---- 2. require/import 解析 ----
const ALIAS = { '@/': 'web/src/', 'server/': 'server/' };
function resolve(fromFile, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('/') && !Object.keys(ALIAS).some((a) => spec.startsWith(a))) return null; // 外部包
  let base;
  const ali = Object.keys(ALIAS).find((a) => spec.startsWith(a));
  if (ali) base = path.join(ROOT, ALIAS[ali], spec.slice(ali.length));
  else if (spec.startsWith('/')) base = path.join(ROOT, spec.slice(1));
  else base = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec);
  const cands = [base, base + '.js', base + '.cjs', base + '.mjs', base + '.jsx', base + '.ts', base + '.tsx',
    path.join(base, 'index.js'), path.join(base, 'index.jsx'), path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
  for (const c of cands) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return rel(c);
  }
  return null;
}
const REQ_RE = /(?:require\(|from\s+|import\()\s*['"]([^'"]+)['"]/g;
// 动态注册面：路由表与适配器登记把模块路径写成字符串字面量，再由变量 require() 装载
const LIT_PATH_RE = /['"](\.{1,2}\/[\w./-]+)['"]/g;
const DYN_PREFIX = /require\(\s*['"]\.\/['"]\s*\+/;
function dynamicSiblings(cur) {
  const dir = path.dirname(path.join(ROOT, cur));
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    for (const f of ['index.js', 'index.ts', 'index.jsx']) {
      const p = path.join(dir, e.name, f);
      if (fs.existsSync(p)) out.push(rel(p));
    }
  }
  return out;
}


const reachedBy = new Map(); // file -> Set(entry)
const edges = new Map();
for (const [entry, tier] of entries) {
  const seen = new Set([entry]);
  const q = [entry];
  while (q.length) {
    const cur = q.shift();
    if (!reachedBy.has(cur)) reachedBy.set(cur, new Set());
    reachedBy.get(cur).add(entry);
    let txt;
    try { txt = fs.readFileSync(path.join(ROOT, cur), 'utf8'); } catch { continue; }
    const deps = [];
    for (const m of txt.matchAll(REQ_RE)) {
      const r = resolve(cur, m[1]);
      if (r) deps.push(r);
    }
    for (const m of txt.matchAll(LIT_PATH_RE)) {
      const r = resolve(cur, m[1]);
      if (r) deps.push(r);
    }
    if (DYN_PREFIX.test(txt)) deps.push(...dynamicSiblings(cur));
    edges.set(cur, deps);
    for (const d of deps) if (!seen.has(d)) { seen.add(d); q.push(d); }
  }
}

// ---- 3. 孤儿判定 + 字符串引用反查（AU-4 三条硬判据的前两条）----
const textFiles = allFiles.filter((f) => TEXT_EXT.has(path.extname(f)) && !SKIP_DIRS.has(path.dirname(f).split('/')[0]) && !f.startsWith('docs/eval/audit/'));
const textCache = new Map();
const readText = (f) => { if (!textCache.has(f)) textCache.set(f, fs.readFileSync(path.join(ROOT, f), 'utf8')); return textCache.get(f); };
function stringRefs(target) {
  const base = path.basename(target);
  const pathHits = [];
  const nameHits = [];
  for (const f of textFiles) {
    if (f === target) continue;
    const t = readText(f);
    if (t.includes(target)) pathHits.push(f);
    else if (t.includes(base) && !/^(index|main|db|log)\./.test(base)) nameHits.push(f);
  }
  return { pathHits, nameHits };
}

const orphans = [];
const scopeOf = (f) => (f.startsWith('archive/') ? 'archive'
  : /^(server|api|web|lib|scripts)\//.test(f) ? 'main-runtime'
  : f.startsWith('tools/') ? 'main-tools' : 'other');
for (const f of srcFiles) {
  if (/\.config\.[cm]?js$/.test(f)) continue; // vite/postcss/tailwind 配置由构建工具装载，不参与孤儿判定
  const by = reachedBy.get(f);
  if (by && by.size) continue;
  const refs = stringRefs(f);
  orphans.push({ file: f, scope: scopeOf(f), lines: readText(f).split(/\r?\n/).length,
    pathRefs: refs.pathHits.slice(0, 6), pathRefCount: refs.pathHits.length,
    nameRefs: refs.nameHits.slice(0, 4), nameRefCount: refs.nameHits.length });
}

// 只被 cli/test 养活、runtime 完全不可达的"半死"文件（runtime 视角孤儿）
const runtimeEntries = new Set([...entries].filter(([, t]) => t === 'runtime').map(([e]) => e));
const runtimeReached = new Set();
for (const [f, set] of reachedBy) if ([...set].some((e) => runtimeEntries.has(e))) runtimeReached.add(f);
const cliOnly = srcFiles.filter((f) => reachedBy.has(f) && reachedBy.get(f).size > 0 && !runtimeReached.has(f) && !entries.has(f))
  .map((f) => ({ file: f, via: [...reachedBy.get(f)].slice(0, 4) }));

// ---- 4. 调度登记表 ----
const timers = [];
for (const f of srcFiles.filter((x) => !x.startsWith('tests/') && !x.startsWith('archive/'))) {
  const lines = readText(f).split(/\r?\n/);
  lines.forEach((l, i) => {
    const m = l.match(/setInterval\((.{0,80}),\s*([^)]+\)?[^,]*)\s*\)/);
    if (m) timers.push({ file: f, line: i + 1, body: m[1].trim().slice(0, 60), every: m[2].trim().slice(0, 40) });
    if (/setTimeout\(/.test(l) && /\d{4,}/.test(l)) timers.push({ file: f, line: i + 1, kind: 'timeout', every: (l.match(/,\s*([\d\s*e+m]+)/) || [, '?'])[1].trim() });
  });
}
let dbState = {};
try {
  const db = require('better-sqlite3')(path.join(ROOT, 'data', 'app.db'), { readonly: true });
  const mask = (v) => String(v).replace(/"(token|apiKey|api_key|password|secret|auth)("\s*:\s*")([^"]+)(")/gi, (mm, a, b, val, c) => `${a}${b}<masked:${val.length}B>${c}`);
  dbState.settings = db.prepare("SELECT key, value FROM settings WHERE key IN ('intervals','queue','daily','portal','ai','alerts')").all()
    .map((r) => ({ key: r.key, value: mask(r.value) }));
  dbState.sources = db.prepare('SELECT COUNT(*) total, SUM(enabled=1) enabled, SUM(CASE WHEN enabled=1 AND next_fetch_at<=? THEN 1 ELSE 0 END) overdue FROM sources').get(new Date().toISOString());
  db.close();
} catch (e) { dbState.error = e.message; }

// ---- 5. 目录索引草稿 ----
const dirAgg = new Map();
for (const f of allFiles) {
  const d = path.dirname(f);
  if (!dirAgg.has(d)) dirAgg.set(d, { n: 0, src: 0, orphan: 0, bytes: 0 });
  const a = dirAgg.get(d);
  a.n++; if (SRC_EXT.has(path.extname(f))) a.src++;
  if (orphans.some((o) => o.file === f)) a.orphan++;
}
const topDirs = [...new Set(allFiles.map((f) => f.split('/')[0]).filter((x) => x.includes('.') === false))];
const draft = [];
for (const d of [...new Set([...topDirs, ...[...dirAgg.keys()].filter((x) => dirAgg.get(x).src >= 8)])]) {
  const a = dirAgg.get(d) || { n: 0, src: 0, orphan: 0 };
  const children = [...dirAgg.keys()].filter((x) => x !== d && x.startsWith(d + '/') && x.split('/').length === d.split('/').length + 1).sort();
  draft.push({ dir: d, files: a.n, src: a.src, orphans: a.orphan, subdirs: children });
}

// ---- 6. 落盘 ----
fs.mkdirSync(OUT, { recursive: true });
const summary = {
  generatedAt: new Date().toISOString(),
  rootHead: (() => { try { return require('child_process').execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { return '?'; } })(),
  sourceFiles: srcFiles.length,
  entries: { runtime: runtimeEntries.size, cli: [...entries].filter(([, t]) => t === 'cli').length, test: [...entries].filter(([, t]) => t === 'test').length },
  reachedFromRuntime: runtimeReached.size,
  cliOrTestOnly: cliOnly.length,
  orphans: orphans.length,
  orphanMainRuntime: orphans.filter((o) => o.scope === 'main-runtime').length,
  orphanMainRuntimeLines: orphans.filter((o) => o.scope === 'main-runtime').reduce((s, o) => s + o.lines, 0),
  orphanMainTools: orphans.filter((o) => o.scope === 'main-tools').length,
  orphanArchive: orphans.filter((o) => o.scope === 'archive').length,
  timersFound: timers.length,
  workflowCrons: workflowCrons.filter((c) => c.cron).length,
};
fs.writeFileSync(path.join(OUT, 'reach.json'), JSON.stringify({ summary, entries: [...entries].map(([p, t]) => ({ file: p, tier: t })), orphans, cliOrTestOnly: cliOnly }, null, 2));
fs.writeFileSync(path.join(OUT, 'schedule.json'), JSON.stringify({ summary: { timers: timers.length, workflowCrons }, timers, workflowCrons, dbState }, null, 2));
fs.writeFileSync(path.join(OUT, 'dir-index-draft.md'),
  ['<!-- 由 node tools/audit-graph.cjs 生成，勿手改。生死列需人工/审计判定，草稿只给计数。 -->', '',
    '| 目录 | 文件 | 源码 | 零引用孤儿 | 一级子目录 |', '|---|---|---|---|---|',
    ...draft.sort((a, b) => b.src - a.src).map((d) => `| \`${d.dir}/\` | ${d.files} | ${d.src} | ${d.orphans} | ${d.subdirs.join(' ') || '—'} |`)].join('\n'));

console.log(JSON.stringify(summary, null, 2));
const mainOrphans = orphans.filter((o) => o.scope === 'main-runtime' || o.scope === 'main-tools');
console.log(`\n=== 主仓库零引用孤儿 ${mainOrphans.length} 个（archive/ 内另有 ${orphans.length - mainOrphans.length} 个，属历史归档不计入主结论）===`);
for (const o of mainOrphans.sort((a, b) => b.lines - a.lines).slice(0, 30)) console.log(`${String(o.lines).padStart(5)} 行  [${o.scope}]  ${o.file}  全路径引用 ${o.pathRefCount} 处${o.pathRefs.length ? ' ← ' + o.pathRefs.join(', ') : ''}（弱同名引用 ${o.nameRefCount}）`);
console.log('\n=== 定时器注册点 ===');
for (const t of timers.filter((x) => !x.kind)) console.log(`${t.file}:${t.line}  every=${t.every}`);
