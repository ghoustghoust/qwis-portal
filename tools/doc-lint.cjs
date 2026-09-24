#!/usr/bin/env node
/**
 * 文档门禁（规则来源：docs/DOC_GOVERNANCE.md §5）。只读检查，不改文件。
 * 用法：node tools/doc-lint.cjs     退出码 0=通过（可有警告），1=有不通过项
 */
const fs = require('fs');
const path = require('path');


const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const errors = [];
const warnings = [];

const FOUNDATION = [
  'AGENTS.md', 'ARCHITECTURE.md', 'README.md',
  'docs/INDEX.md', 'docs/DOC_GOVERNANCE.md', 'docs/CLOUD_PIPELINE_GUIDE.md',
  'docs/FEATURE_MATRIX.md', 'docs/ISSUES.md', 'docs/NEXT-DEV-REQS.md',
  'docs/RUNBOOK.md', 'docs/DELIVERY_VERIFICATION.md', 'docs/DEVELOPMENT_STANDARDS.md',
  'docs/EVAL_GUIDE.md',
  'docs/DEV_GUIDE.md', 'docs/ROADMAP-2026-09.md', 'docs/HANDOFF_PROMPT.md',
  'docs/ANDROID_SUBMIT_GUIDE.md', 'docs/X_SETUP_GUIDE.md', 'docs/BESTBLOGS_BORROW.md',
  'docs/pitfalls/README.md', 'docs/HANDOVER.md',
];

// 本地设计内文件（gitignore 且永不入库）：docs/HANDOVER.md = 凭据速查（DOC_GOVERNANCE §2.1 登记的本地文件）、
// cloud/token.json = PHP 队列运行时生成的令牌。文档引用它们是制度不是悬空；CI 上没有这两个文件属正常，
// 第 1、2 条对它们一律豁免（别处别再各自开口子）。
const LOCAL_BY_DESIGN = new Set(['docs/HANDOVER.md', 'cloud/token.json']);
// ⚠️ 09-24 夜实测过的一个坑，别再犯：曾在这里加过"派生豁免"（引用未入库的取证脚本时，
// 若该脚本本地存在且体内出现 HANDOVER 就豁免）。它在本地是 0 错，但 CI 树上那支脚本**根本不存在**
// ⇒ existsSync 假 ⇒ 判悬空 ⇒ push-CI 红（sha 0a73f14）。凡是"判据依赖只在本地存在的东西"都会这样分裂：
// 要么把引用改成不指向文件（现在这么做），要么把事实落成被跟踪的清单（要生成就得连生成器一起入库）。

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const read = (p) => fs.readFileSync(p, 'utf8');
const docsFiles = walk(DOCS).filter((f) => /\.(md|json)$/.test(f));

// 1 底层文档必须有「最后更新：YYYY-MM-DD」头注
for (const f of FOUNDATION) {
  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs)) {
    if (LOCAL_BY_DESIGN.has(f)) continue; // 本地设计内文件：CI 上没有属正常（gitignore 永不入库）
    errors.push(`[缺失] 底层文档不存在：${f}`); continue;
  }
  const head = read(abs).slice(0, 1200);
  if (!/最后更新[:：]\s*20\d\d-\d\d-\d\d/.test(head)) errors.push(`[头注] ${f} 缺「> 最后更新：YYYY-MM-DD」`);
}

// 2 相对路径引用不得悬空。豁免归档/作废层（只读历史，引用已删文件是事实记录），
//   以及含 doc-lint:ignore 的行（活文档刻意引用已删路径，如 ISSUES B12）
const ARCHIVE_PREFIXES = ['docs/archive/', 'docs/deprecated/', 'docs/changes/archive/'];
const REF_RE = /(?:\.\.?\/|docs\/|archive\/|web\/|server\/|api\/|lib\/|tools\/|tests\/|prompts\/|static-data\/|opml\/|cloud\/|scripts\/|portal\/)[\w.\-/一-龥]*\.(?:md|json|cjs|mjs|jsx|tsx|css|ya?ml|bat|php|png|html|txt|db|js)(?![\w])/g;
function extractRefs(text) {
  const refs = new Set();
  for (const line of text.split('\n')) {
    if (line.includes('doc-lint:ignore')) continue;
    for (const m of line.matchAll(REF_RE)) refs.add(m[0].replace(/[),.;：，。]$/, ''));
  }
  return refs;
}
const STRICT_REF = new Set(FOUNDATION);   // 活文档：悬空引用 = 不通过
const strictOk = (f) => {
  const r = rel(f);
  return STRICT_REF.has(r) || r.startsWith('docs/features/') || r.startsWith('docs/pitfalls/') || r === 'docs/archive/README.md';
};
// 评测器自己写出的产物（F2P 证据、轮次报告、白盒基线）不参与"悬空引用"判定：
// 里面的 `../tools/eval-f2p.cjs` 是**取证当时那棵 worktree** 的相对路径，本就不该存在于主树；
// 拿人写的散文规则去扫机器输出，只会制造假悬空（本轮实测：一次取证即报 2 条）。
const MACHINE_EVIDENCE = ['docs/eval/'];
const lintTargets = [path.join(ROOT, 'AGENTS.md'), path.join(ROOT, 'ARCHITECTURE.md'), path.join(ROOT, 'README.md')]
  .concat(docsFiles)
  .filter((f) => !ARCHIVE_PREFIXES.some((p) => rel(f).startsWith(p)))
  .filter((f) => !MACHINE_EVIDENCE.some((p) => rel(f).startsWith(p)));
// 悬空判据必须按 **git 会带走的那棵树** 判，不能按工作树判 —— 否则"本地存在但 CI 不存在"的文件
// （典型：`tools/_*.cjs` 这类被 gitignore 的一次性探针）会让我在本地全绿、推到 CI 当场红。
// 本仓已为此连红两次（`_probe-behavior-corpus.cjs`、`_probe-ai-feature-presence.cjs`），故把教训下沉到判据本身。
// 口径 = `git ls-files --cached --others --exclude-standard`：跟踪的 + 未跟踪但未被 ignore 的
// （后者允许，因为"文档与它点名的新文件同批提交"是正常流程）；被 ignore 的一律算不存在。
let GIT_VISIBLE = null;
try {
  // execFileSync + argv 数组：命令与参数都不过 shell（固定字符串也不行，免得以后有人往里拼东西）
  const out = require('child_process').execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, windowsHide: true }).toString();
  GIT_VISIBLE = new Set(out.split('\0').filter(Boolean).map((p) => p.replace(/\\/g, '/')));
} catch { GIT_VISIBLE = null; } // 非 git 环境（或 git 不可用）退回工作树判据，不假装通过
const refExists = (abs) => {
  if (!fs.existsSync(abs)) return false;
  if (!GIT_VISIBLE) return true;
  const r = path.relative(ROOT, abs).replace(/\\/g, '/');
  return GIT_VISIBLE.has(r);
};
for (const f of lintTargets) {
  if (!fs.existsSync(f)) continue;
  for (const r of extractRefs(read(f))) {
    const clean = r.replace(/:\d+.*$/, '');
    if (/[<…]/.test(clean) || /xxx|XXX/.test(clean)) continue;
    if (LOCAL_BY_DESIGN.has(clean)) continue; // 本地设计内文件（凭据/令牌），CI 上不存在属正常
    const cands = [path.join(ROOT, clean), path.join(path.dirname(f), clean)];
    if (cands.some((c) => refExists(c))) continue;
    const msg = `[悬空] ${rel(f)} 引用了不存在的 ${clean}${fs.existsSync(cands[0]) ? '（工作树里有，但 git 不会带走 = CI 上必悬空）' : ''}`;
    // 历史 spec/变更记录里的引用是「当时的事实」，只提示；活文档必须零悬空
    if (strictOk(f)) errors.push(msg); else warnings.push(msg);
  }
}

// 3 docs/ 下文件必须被 INDEX.md 登记：文件名命中，或其任一上级目录已在 INDEX 出现
const indexText = read(path.join(DOCS, 'INDEX.md'));
const registered = (f) => {
  const r = rel(f);
  if (indexText.includes(path.basename(r))) return true;
  let dir = path.posix.dirname(r);
  while (dir && dir !== '.' && dir !== 'docs') {
    if (indexText.includes(dir + '/') || indexText.includes(path.posix.basename(dir))) return true;
    dir = path.posix.dirname(dir);
  }
  return indexText.includes('docs/specs/') && r.startsWith('docs/specs/');
};
for (const f of docsFiles) {
  const base = path.basename(f);
  if (base === 'INDEX.md') continue;
  if (!registered(f)) warnings.push(`[失踪] ${rel(f)} 未在 docs/INDEX.md 登记`);
}

// 4 归档件必须有依赖头注（DOC_GOVERNANCE §2.4 五字段）
for (const f of docsFiles.filter((x) => rel(x).startsWith('docs/archive/'))) {
  if (path.basename(f) === 'README.md') continue;
  const head = read(f).slice(0, 1200);
  for (const k of ['类别：', '归档自：', '关联', '状态：']) {
    if (!head.includes(k)) { errors.push(`[归档头注] ${rel(f)} 缺「${k}」`); }
  }
}

// 5 活文档超长（提示核销轮，不算不通过）
const LIMITS = { 'docs/ISSUES.md': 130, 'ARCHITECTURE.md': 400, 'docs/NEXT-DEV-REQS.md': 260, 'docs/FEATURE_MATRIX.md': 200 };
for (const [f, max] of Object.entries(LIMITS)) {
  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs)) continue;
  const n = read(abs).split('\n').length;
  if (n > max) warnings.push(`[超长] ${f} ${n} 行 > ${max}，按 DOC_GOVERNANCE §3 Step4 做核销轮`);
}

// 6 明文密钥扫描（判据本体 `lib/secrets.js`，与锁 tests/regression-secrets.test.js 同源）
//   扫描面**两块**：① git 已跟踪文件（提交出去的）② 未跟踪且没被 ignore 的文件 —— 后者是 B113 的形状：
//   `docs/eval/audit/schedule.json` 里躺着真飞书 webhook，既未跟踪也未被忽略，一次 `git add docs/` 就进历史。
//   本地设计内的凭据文件（.env / docs/HANDOVER.md / data/）由 .gitignore 挡在两块面之外，不在此列。
const sec = require('../lib/secrets');
const readRel = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let tracked = [];
let others = [];
try { tracked = sec.listTracked(ROOT); }
catch (e) { warnings.push(`[跳过密钥扫描] git ls-files 失败：${e.message}`); }
try { others = sec.listUntrackedNotIgnored(ROOT); }
catch (e) { warnings.push(`[跳过未跟踪面扫描] git ls-files --others 失败：${e.message}`); }
const secretHits = [
  ...sec.scanFiles(tracked, readRel),
  ...sec.scanFiles(others, readRel),
];
for (const h of secretHits) errors.push(`[密钥] ${h.file} 含 ${h.kind}（凭据只能在 .env / Vercel env / GH Secrets 三处；打印 settings 前必须过 lib/secrets#maskDeep —— 坑 #69）`);
warnings.push(`[密钥分母] 扫描面：已跟踪 ${tracked.length} 份 + 未跟踪未 ignore ${others.length} 份，命中 ${secretHits.length} 处`);

// ─── 7~9 三条判据（放行清单 §三 #12 的文档门禁扩面；纯函数，可被 --self-test 证伪）───
// 为什么必须做成纯函数：一条"只扫真文档、没法喂坏样本"的判据，和 W14/W15 的教训一样 = 无法证明它有牙齿。

const IGNORE_MARK = 'doc-lint:ignore';

// 7 表格每行**不许超过**表头格数（B126）：内容里的裸竖线会把一行撑成多一列，
//   渲染时整行错位而路径/头注/密钥那几条全绿。正确写法是转义 `\|`（ISSUES 的 B76 那行就是）。
//   方向要说清：**少一格是合法 markdown**（缺的尾格渲染成空），只有多一格才破表 ——
//   判据第一版把「少一格」也判红，一次就在 NEXT-DEV-REQS 与 spec25 制造了 15 条假红。
function splitCells(line) {
  return line.split(/(?<!\\)\|/).slice(1, -1);   // 去掉首尾空串
}
// 7b 表头与分隔行被挤成同一行 → 整张表**脱离判据**（这才是真正的隐性事故：不是渲染错位，而是
//    `findTableBreaks` 认不出这是表，从此这张表怎么写都不红）。
//    本轮我自己就这么坏过一次：一次 Edit 少写一个换行，把 `| 号 | … |` 与 `|---|---|` 并成一行，
//    EVAL_GUIDE §4.2 整张表静默失去覆盖 —— 光靠"格数判据"永远发现不了，必须单独立一条。
function findBrokenTableHeads(text) {
  const isSep = (c) => /^\s*:?-{3,}:?\s*$/.test(c);
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (line.includes(IGNORE_MARK) || !/^\s*\|/.test(line) || !/\|\s*$/.test(line)) return;
    const cells = splitCells(line);
    const seps = cells.map((c) => isSep(c));
    const lastSep = seps.lastIndexOf(true);
    // 分隔行的特征是"整行都是分隔格"；只要**最后一个分隔格之前**出现过有内容的普通格，
    // 就是"表头（或数据行）与分隔行被并成一行" —— 这种行会让整张表脱离格数判据。
    if (lastSep >= 1 && cells.slice(0, lastSep).some((c, k) => !seps[k] && c.trim() !== '')) {
      out.push({ line: i + 1, text: line.slice(0, 60) });
    }
  });
  return out;
}

// 10 缺陷编号在**同一张登记表**里必须唯一（B124 的编号规范 + 本轮实测撞号）：
//    09-21 一轮里我登记 B128（`lib/db.js` 少三列），并行会话同一时段也登记了 B128（零引用资产），
//    两条不同事实共用一个号 —— 之后任何"按号引用"都会指错行。W 号位撞过（W18 被两处占用，
//    见 EVAL_GUIDE §4.2），B 号位也撞过（B1~B4 与 09-12 审计轮同号不同事）。
//    粒度必须是**单张表**：一张"引用索引表"里再写一遍 B8 是正常写法（本轮第一版按整份文件判，
//    立刻在 ISSUES 造出 21 条假红 —— 那正是判据第一版必错的又一次复发）。
function tableBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (!/^\s*\|/.test(lines[i]) || !/\|\s*$/.test(lines[i])) { i++; continue; }
    let j = i;
    while (j < lines.length && /^\s*\|/.test(lines[j]) && /\|\s*$/.test(lines[j])) j++;
    const block = lines.slice(i, j);
    if (block.length >= 2 && /^[\s|:-]+$/.test(block[1].replace(/\|/g, ''))) blocks.push({ start: i, header: block[0], rows: block.slice(2) });
    i = j;
  }
  return blocks;
}
function findTableBreaks(text) {
  const bad = [];
  for (const b of tableBlocks(text)) {
    const cols = splitCells(b.header).length;
    b.rows.forEach((row, k) => {
      if (row.includes(IGNORE_MARK)) return;
      const n = splitCells(row).length;
      if (n > cols) bad.push({ line: b.start + 3 + k, got: n, want: cols, text: row.replace(/^(\s*\|.{0,60}).*$/, '$1') });
    });
  }
  return bad;
}
const ID_ROW = /^\|\s*\*{0,2}(B|BL|H|W)(\d{1,3}[a-z]?)\*{0,2}\s*\|/;
function findDuplicateIds(text) {
  const dup = [];
  for (const b of tableBlocks(text)) {
    const seen = new Map();
    b.rows.forEach((line, k) => {
      const m = ID_ROW.exec(line);
      if (!m) return;
      const id = m[1] + m[2];
      if (seen.has(id)) dup.push({ id, line: b.start + 3 + k, first: seen.get(id) });
      else seen.set(id, b.start + 3 + k);
    });
  }
  return dup;
}

// 8 活锚点行号越界（B115①）：`file.js:123` 指向的行不存在 —— 大多数是**我自己的修复打断的**，
//   不是自然腐烂（坑 #62 的量化补强）。硬前置：必须能区分"活锚点"与"作为反例被引用的死锚点"，
//   否则天天误报、三天后就被人加 ignore 绕过。区分方式做成显式的两条豁免，而不是靠猜：
//   ① 行内带 `doc-lint:ignore`；② 行内有"死锚点信号词"（说明这句是在**引用**一个坏锚点，不是在指向它）。
const DEAD_ANCHOR_WORDS = /已删|删除后|已移除|不存在|作废|已作废|反例|坏锚点|烂锚|已烂|曾写|原写|旧版|旧引用|过期|从未|不再|被自己|重锚|锚点失效|越界/;
const ANCHOR_RE = /([\w./[\]\-一-龥]+\.(?:js|jsx|cjs|mjs|ts|tsx|py|yml|yaml|md|css|json)):(\d{1,6})/g;
function findStaleAnchors(text, resolve) {
  const bad = [];
  let scanned = 0;
  let skippedVocabulary = 0;
  let skippedIgnore = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const hits = [...raw.matchAll(ANCHOR_RE)];
    if (!hits.length) continue;
    // 分母必须报出来：一条"0 个越界"的判据，如果不说"看了多少条锚点"，就分不清是真干净还是判据写空（坑 #41）
    for (const m of hits) if (resolve(m[1]) !== null) scanned++;
    if (raw.includes(IGNORE_MARK)) { hits.forEach((m) => { if (resolve(m[1]) !== null) skippedIgnore++; }); continue; }
    if (DEAD_ANCHOR_WORDS.test(raw)) { hits.forEach((m) => { if (resolve(m[1]) !== null) skippedVocabulary++; }); continue; }
    for (const m of hits) {
      const [, file, lineStr] = m;
      const n = resolve(file);
      if (n === null) continue;                     // 文件本身不存在 → 那是「悬空引用」判据的活，不重复报
      if (Number(lineStr) > n) bad.push({ file, line: Number(lineStr), lines: n, at: i + 1 });
    }
  }
  return { bad, scanned, skippedVocabulary, skippedIgnore };
}

// 12 裸文件名锚点（B115②）：只写 basename 的 `AlertsTab.jsx:591`。
//   为什么单独立一条而不是"顺手并入第 8 条"：第 8 条的 `resolveFile` 按**仓根相对路径**查，
//   裸名查不到就 `continue` → 这类引用今天**既不判越界、也不进分母**（`_cite-audit.cjs` 实测 8 条，
//   多义的按候选收敛 = 赌运气）。判"越界"要挑错文件，所以只能先要求"写全路径"。
//   只出提示不判错：这是书写纪律不是事实错误，判错三天后就会被整行加 ignore 绕过（坑 #64 规则①）。
//   反向样本同批备好：①仓根真有 `README.md` 这种裸路径不许报 ②哪儿都没有的归悬空判据管。
function findBareAnchors(text, { exists, resolveBare }) {
  const bare = [];
  let scanned = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.includes(IGNORE_MARK)) continue;
    for (const m of [...raw.matchAll(ANCHOR_RE)]) {
      const [, file, lineStr] = m;
      if (file.includes('/')) continue;
      if (exists(file)) continue;
      scanned++;
      const cands = resolveBare(file) || [];
      if (!cands.length) continue;
      bare.push({ file, line: Number(lineStr), at: i + 1, cands: cands.length, sample: cands[0] });
    }
  }
  return { bare, scanned };
}

// 取证台账（`--cites`，B115② 的另一半：把 `_cite-audit.cjs` 变成常驻命令）。
// 与第 8/12 条**共用同一个正则与同一份解析**，只多做一件人肉才做的事：把锚点真正指向的那行打出来。
function citeLedger(files, read, rel, { candidatesOf, resolveFile, all }) {
  const cache = new Map();
  const textOf = (c) => {
    if (!cache.has(c)) cache.set(c, read(path.join(ROOT, c)).split('\n'));
    return cache.get(c);
  };
  const rows = [];
  for (const f of files) {
    const text = read(f);
    text.split('\n').forEach((raw, idx) => {
      for (const m of [...raw.matchAll(ANCHOR_RE)]) {
        const [, file, lineStr] = m;
        const cands = candidatesOf(file);
        let status = 'MISSING';
        let at = '';
        let where = '';
        for (const c of cands) {
          const n = resolveFile(c);
          if (n === null) continue;
          if (Number(lineStr) > n) { status = cands.length > 1 ? 'AMBIG' : 'OUT'; continue; }
          status = cands.length > 1 ? 'AMBIG' : 'OK';
          where = c;
          at = (textOf(c)[Number(lineStr) - 1] || '').trim().slice(0, 58);
          break;
        }
        rows.push({ doc: rel(f), docLine: idx + 1, ref: m[0], status, where, at });
      }
    });
  }
  const n = (s) => rows.filter((r) => r.status === s).length;
  console.log(`引用台账：${files.length} 份文档，${rows.length} 条 file:line 引用`);
  console.log(`  正常 ${n('OK')} ｜ 裸文件名多义 ${n('AMBIG')} ｜ 行号越界 ${n('OUT')} ｜ 文件不存在 ${n('MISSING')}`);
  for (const r of rows.filter((x) => x.status !== 'OK')) {
    console.log(`  [${r.status}] ${r.doc}:${r.docLine} → ${r.ref}${r.where ? ` （按 ${r.where} 收敛）` : ''}`);
  }
  const ok = rows.filter((r) => r.status === 'OK');
  console.log(`\n=== 锚点指向的行（${ok.length} 条${all ? '' : '，只打印前 40 条；--all 打全部'}），供人工判"还指对吗" ===`);
  for (const r of (all ? ok : ok.slice(0, 40))) console.log(`  ${r.ref}  |  ${r.at}`);
  return rows;
}

// 9 引用 F2P「改前红 / 改后绿」的条数必须同句带证据文件名（B114② + B106 残余）：
//   只写数字的证据等于没有证据 —— 上一轮就发生过报告写 3/3、JSON 里其实 1/3（坑 #41/#45）。
//   收窄过程（第一版的假红都要留在注释里，否则下一个人又会把判据放得更宽）：
//   · 只提 `F2P` 两个字 + 任意"N 条"就报 → 把 `docs/pitfalls/` 里讲规则的散文全判红（8 条假红）；
//   · 现在只判"**写了改前红/改后绿的 x/y 计数**"这一种取证句式，且**明说不适用的行放过**
//     （新增门禁按坑 #64 规则②本来就不套改前红，那种句子不该逼作者编一个证据文件名）。
//   · 第三条豁免与锚点判据同族（09-21 实测复发）：**引用一条被更正的旧说法**不该被再判一次红
//     —— 复核更正行必须能原样抄出旧写法，否则"落档不实陈述"这件事本身就过不了门禁。
const F2P_CITE = /改前红|改后[^，。;]{0,4}绿/;
const F2P_COUNT_SHAPE = /\d+\s*\/\s*\d+/;
// 什么算"带了出处"：①证据文件名/目录（`….json`、`docs/eval/f2p/*.json`）；
// ②**短提交号**（7+ 位十六进制）—— `docs/STAMPS.md` 是 `tools/doc-stamp.cjs` 生成的提交主题索引，
//   主题会被截断，提交信息里的 `docs/eval/f2p/….json` 常在截断处之后；那一行本身带着 `aa1697c`
//   这样的号，`git show <号>` 就能反查到证据文件，所以算出处（09-21 实测：STAMPS 两行被本条抓红）。
//   注意这不是给作者开的后门：正文里仍须写清是哪个 run 产物，只贴一个号还判红 —— 见 --self-test。
const F2P_EVIDENCE = /[\w.\-*/]+\.(?:json|jsonl)|`[0-9a-f]{7,}`/;
const F2P_NA = /不适用|不套|无需|未套|无对应旧形态|原文|此前写|曾写|已更正|复核更正|不实|自相矛盾|作废|判为/;
function findUncitedF2pCounts(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (line.includes(IGNORE_MARK) || F2P_NA.test(line)) return;
    if (F2P_CITE.test(line) && F2P_COUNT_SHAPE.test(line) && !F2P_EVIDENCE.test(line)) {
      out.push({ line: i + 1, text: line.replace(/^(\s*>?\s*.{0,60}).*$/, '$1') });
    }
  });
  return out;
}

// 11 父 spec 的「背景」段里的实测断言必须带编号或指路（B116 的第③条）。
//    病根：09-21 实测有 4 条父 spec 的"背景事实"当夜就被同轮后续实测推翻（`40` 域行数、
//    `reading.digest` 是否已存在、`subscription.ids` 是空数组还是悬空 id、`schemaVersion` 类型），
//    照父 spec 动工就是按假前提开工。
//    **故意只做提示级**：这是文本语义判据，比前几条软 —— 一上来就判红只会逼人加 ignore
//    （坑 #45 说的就是这个动作）。先让它每月被看见，攒够真样本再决定要不要升成不通过。
const BACKGROUND_HEAD = /^#{2,4}\s*.*(背景|现状|事实)/;
const FACTISH = /(实测|目前|从未|恒 |不存在|已存在|没有|全是|只到|停在)/;
const ANCHORED = /B\d{1,3}\b|BL\d|见\s|`docs\/|`api\/|`server\/|`tools\/|`lib\/|`web\//;
function findUnanchoredFacts(text) {
  const lines = text.split('\n');
  const out = [];
  let inBg = false;
  lines.forEach((raw, i) => {
    if (/^#{1,4}\s/.test(raw)) { inBg = BACKGROUND_HEAD.test(raw); return; }
    if (!inBg || raw.startsWith('> 已作废') || !raw.trim().startsWith('-') || raw.includes(IGNORE_MARK)) return;
    if (FACTISH.test(raw) && !ANCHORED.test(raw)) out.push({ line: i + 1, text: raw.replace(/^(\s*-.{0,50}).*$/, '$1') });
  });
  return out;
}

const SELF_TEST = process.argv.includes('--self-test');
if (SELF_TEST) {
  // 双向自证：坏样本必须红、好样本必须不红（缺任何一半都算判据不存在）
  const fails = [];
  let cases = 0;
  const expect = (name, got, want) => { cases++; if (got !== want) fails.push(`${name}：期望 ${want} 实得 ${got}`); };
  // 7 表格
  expect('表格-多一格必须红', findTableBreaks('| a | b |\n|---|---|\n| 1 | 2 |\n| 1 | 2 | 3 |\n').length, 1);
  expect('表格-少一格是合法 markdown，不许红', findTableBreaks('| a | b |\n|---|---|\n| 1 |\n').length, 0);
  expect('表格-转义竖线不许误判', findTableBreaks('| a | b |\n|---|---|\n| x \\| y | 2 |\n').length, 0);
  expect('表格-对齐正常必须绿', findTableBreaks('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n').length, 0);
  expect('表格-非表的两行不误判', findTableBreaks('| a | b |\n| c | d |\n').length, 0);
  expect('表格-ignore 行放过', findTableBreaks('| a | b |\n|---|---|\n| 1 | 2 | 3 | <!-- doc-lint:ignore -->\n').length, 0);
  expect('表格-裸竖线含代码样式也要红（B125 那族逻辑或）', findTableBreaks('| a | b |\n|---|---|\n| x || y | 2 | z |\n').length, 1);
  // 8 锚点
  const resolve = (f) => ({ 'a.js': 10 }[f] ?? null);
  expect('锚点-越界必须红', findStaleAnchors('见 a.js:99 那行', resolve).bad.length, 1);
  expect('锚点-界内必须绿', findStaleAnchors('见 a.js:9 那行', resolve).bad.length, 0);
  expect('锚点-作为反例被引用不许红', findStaleAnchors('原写 a.js:99 是坏锚点（已删）', resolve).bad.length, 0);
  expect('锚点-ignore 行不许红', findStaleAnchors('a.js:99 <!-- doc-lint:ignore -->', resolve).bad.length, 0);
  expect('锚点-文件不在的归悬空判据管', findStaleAnchors('见 gone.js:99', resolve).bad.length, 0);
  // 豁免靠词表，词表漏一个同义词 = 把**照实引用烂锚**的好文档判红（本轮实测：第 8 条一扩到裸文件名，
  // `docs/specs/09-*/task.md:146` 那句"旧引用 Sidebar.jsx:186 是烂锚"就红了 —— 原表只有「坏锚点」）
  expect('锚点-同义词「烂锚/旧引用」也要放过',
    findStaleAnchors('旧引用 Sidebar.jsx:186 是烂锚', (f) => (f === 'Sidebar.jsx' ? 165 : null)).bad.length, 0);
  // 分母可见性：放过的那几条必须被数出来，否则"0 越界"分不清是真干净还是判据写空
  expect('锚点-放过的反例要能报出分母', findStaleAnchors('原写 a.js:99 已删\n见 a.js:5 那行', resolve).scanned, 2);
  expect('锚点-死锚点词放过的条数单列', findStaleAnchors('原写 a.js:99 已删', resolve).skippedVocabulary, 1);
  // 9 F2P 条数
  expect('F2P-裸条数必须红', findUncitedF2pCounts('改前红 3/3、改后全绿').length, 1);
  expect('F2P-带证据文件名必须绿', findUncitedF2pCounts('改前红 3/3（`docs/eval/f2p/2026-09-21000000.json`）').length, 0);
  // 生成物那一格：STAMPS 的行带反引号短提交号（主题被截断，证据路径在截断处之后）→ 算出处
  expect('F2P-反引号短提交号算出处（生成物索引不假红）', findUncitedF2pCounts('| docs/ISSUES.md | 2026-09-21 | 一致 | `aa1697c` 2026-09-21 06:27 改前红 7/7').length, 0);
  // 反向：正文只贴一个号、不带任何可反查的产物名 → 仍须红（否则本条对人写的话失效）
  expect('F2P-裸提交号不加反查信息仍要红', findUncitedF2pCounts('本批 F2P 成立，改前红 3/3、改后全绿（见 aa1697c3）。').length, 0 + 1);
  expect('F2P-写 glob 形式的证据目录也算带出处', findUncitedF2pCounts('结论落盘 `docs/eval/f2p/*.json`，改前红 6/6').length, 0);
  expect('F2P-抄出被更正的旧写法不许红（落档不实陈述要能写下来）',
    findUncitedF2pCounts('原文那句"改前红 2 条 → 改后 3/3 绿"两侧分母自相矛盾，判为不实').length, 0);
  expect('F2P-没提条数不许红', findUncitedF2pCounts('F2P 已出证').length, 0);
  expect('F2P-ignore 行放过', findUncitedF2pCounts('改前红 3/3 <!-- doc-lint:ignore -->').length, 0);
  expect('F2P-讲规则的散文不许红', findUncitedF2pCounts('- 症状：取证器对 5 个锁文件报 F2P 全绿，其实只跑到 2 个').length, 0);
  expect('F2P-明说"不套改前红"的行不许红（坑 #64 规则②）',
    findUncitedF2pCounts('本批属新增门禁，按坑 #64 规则②不套 F2P 改前红，证据 = 锁 D1~D10（10/10）').length, 0);
  expect('表格断裂-头与分隔并成一行必须红', findBrokenTableHeads('| 号 | 判据 ||---|---|\n| W1 | x | y |\n').length, 1);
  expect('表格断裂-正常分隔行不许红', findBrokenTableHeads('| 号 | 判据 |\n|---|---|\n| W1 | x |\n').length, 0);
  expect('表格断裂-纯分隔行单独出现不算', findBrokenTableHeads('|---|---|\n').length, 0);
  // 反向：断裂的那张表在格数判据下是"隐形"的 —— 这条要钉住，否则 7b 会被误以为多余
  expect('表格断裂-格数判据确实看不见（所以必须单独立条）',
    findTableBreaks('| 号 | 判据 ||---|---|\n| W1 | x | y | 多出来的一格 |\n').length, 0);
  // 10 编号唯一（粒度＝单张表）
  const TBL = (rows) => `| # | 问题 |\n|---|---|\n${rows}`;
  expect('编号-同表两行同号必须红', findDuplicateIds(TBL('| B12 | 甲 |\n| B12 | 乙 |\n')).length, 1);
  expect('编号-加粗与否要视为同一个号', findDuplicateIds(TBL('| **W18** | 甲 |\n| W18 | 乙 |\n')).length, 1);
  expect('编号-不同号必须绿', findDuplicateIds(TBL('| B12 | 甲 |\n| B13 | 乙 |\n| H1 | 丙 |\n')).length, 0);
  expect('编号-跨表再写一遍是正常引用', findDuplicateIds(TBL('| B8 | 甲 |\n') + '\n' + TBL('| B8 | 乙（引用索引）|\n')).length, 0);
  expect('编号-正文里提到同号不算（只判行首登记位）',
    findDuplicateIds(TBL('| B12 | 甲 |\n| B13 | 见 B12 那一行 |\n')).length, 0);
  // 11 父 spec 背景段的实测断言要带出处（提示级）
  const BG = '## 一、背景\n\n- `articles` 表里没有 `score` 列\n- 源列表共 8 个类型，见 `docs/specs/36`\n- 每日清理从未触发（B101）\n';
  expect('背景-没出处的实测断言要提示', findUnanchoredFacts(BG).length, 1);
  expect('背景-带编号或指路的不提示', findUnanchoredFacts(BG).every((x) => !/B101|docs\/specs\/36/.test(x.text)), true);
  expect('背景-非背景段不判', findUnanchoredFacts('## 二、验收\n\n- `articles` 表里没有 `score` 列\n').length, 0);
  expect('背景-作废标注行不判（§2.4 要求原文留着）',
    findUnanchoredFacts('## 一、背景\n\n> 已作废：旧写法「清理每天跑」\n').length, 0);
  // 12 裸文件名锚点（B115②）：坏样本 = 只写 basename 且仓内多个同名；反向 = 写了全路径 / 仓根真有该文件
  const BARE_ON = { exists: () => false, resolveBare: () => ['web/src/a/AlertsTab.jsx', 'web/src/b/AlertsTab.jsx'] };
  expect('裸名-多义必须提示并带候选数', findBareAnchors('见 AlertsTab.jsx:591 那行', BARE_ON).bare[0].cands, 2);
  expect('裸名-写了全路径的不算', findBareAnchors('见 web/src/a/AlertsTab.jsx:591 那行', BARE_ON).bare.length, 0);
  expect('裸名-全路径也不进分母', findBareAnchors('见 web/src/a/AlertsTab.jsx:591 那行', BARE_ON).scanned, 0);
  expect('裸名-ignore 行放过', findBareAnchors('AlertsTab.jsx:591 <!-- doc-lint:ignore -->', BARE_ON).bare.length, 0);
  // 分母仍然要数到它：一条"仓根查不到"的引用即使哪都没有，也不能悄悄消失（坑 #41）
  expect('裸名-哪儿都没有的仍计分母、但不提示（归悬空判据管）',
    findBareAnchors('见 gone.jsx:9', { exists: () => false, resolveBare: () => [] }).bare.length, 0);
  expect('裸名-仓根真有同名文件的不算裸名',
    findBareAnchors('见 README.md:3 那行', { exists: (f) => f === 'README.md', resolveBare: () => ['README.md'] }).bare.length, 0);
  console.log(fails.length ? `doc-lint --self-test：${fails.length} 条不通过\n  ` + fails.join('\n  ')
    : `doc-lint --self-test：判据双向自证通过（${cases} 例，全过）`);
  process.exit(fails.length ? 1 : 0);   // 必须直接退出：只设 process.exitCode 会被后面的真实扫描段覆盖成"0 错 ⇒ 绿"
}

if (!SELF_TEST) {
// 扫真实文档：活文档（FOUNDATION）判错，其它判提示；表格与锚点是渲染/取证面，spec 也算活文档
const lineCountCache = new Map();
const resolveFile = (f) => {
  const clean = f.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');
  const abs = path.join(ROOT, clean);
  if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return null;
  if (!lineCountCache.has(abs)) lineCountCache.set(abs, read(abs).split('\n').length);
  return lineCountCache.get(abs);
};
// basename → 仓内相对路径清单：第 12 条与 `--cites` 共用这一份（`_cite-audit.cjs` 原来自己建了一份，
// 于是"锚点解析"有了两套事实 —— 那正是本项目反复判红的东西，所以这次是把那个一次性脚本**收进来**，不是并存）
const INDEX_SKIP = new Set(['node_modules', '.git', 'dist', 'data', '.tmpchk', '.cluster', 'trash']);
// 扩展名清单与上面 ANCHOR_RE 是同一份语义（改那边要改这里）：索引只收"可能被当锚点引用"的文件
const INDEX_BARE_RE = /\.(?:js|jsx|cjs|mjs|ts|tsx|py|yml|yaml|md|css|json)$/;
const BASE_INDEX = new Map();
(function indexTree(dir) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (INDEX_SKIP.has(e.name)) continue;
    const relp = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) { indexTree(relp); continue; }
    if (!INDEX_BARE_RE.test(e.name)) continue;
    if (!BASE_INDEX.has(e.name)) BASE_INDEX.set(e.name, []);
    BASE_INDEX.get(e.name).push(relp);
  }
})('');
const resolveBare = (f) => BASE_INDEX.get(f) || [];
// 只写尾段的半截路径（`scheduler/index.js:138` 这种）也要能收敛回来 —— 一次性探针原来有这条
// `endsWith` 兜底，第一版搬丢了就会把"文件其实在"判成 MISSING（假警报方向）。
const suffixHits = (f) => {
  const base = f.split('/').pop();
  return (BASE_INDEX.get(base) || []).filter((p) => p === f || p.endsWith('/' + f));
};
const existsRel = (f) => resolveFile(f) !== null;
// 第 8 条原来的盲区：`resolveFile` 只按仓根相对路径查，裸文件名一律返回 null → 那条锚点
// **既不判越界也不进分母**。这里补上"唯一候选才收敛"：多义的不猜（猜错会把好文档判红），
// 实测补完抓到 1 条真越界（`docs/specs/09-.../task.md:146` 的 `Sidebar.jsx:186`，本轮一并改掉）。
const resolveAny = (f) => {
  const direct = resolveFile(f);
  if (direct !== null) return direct;
  const c = candidatesOf(f);
  return c.length === 1 ? resolveFile(c[0]) : null;
};
// 台账用的候选解析：全路径直查 → 半截路径按尾段收敛 → 裸文件名按 basename 索引
const candidatesOf = (f) => {
  const clean = f.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');
  if (resolveFile(clean) !== null) return [clean];
  return f.includes('/') ? suffixHits(clean) : resolveBare(f);
};

if (process.argv.includes('--cites')) {
  citeLedger(lintTargets, read, rel, {
    candidatesOf, resolveFile, all: process.argv.includes('--all'),
  });
  // 台账是**取证面**（"锚点还指对吗"只有人能判），红线仍然是 `npm run lint:docs`：
  // 这里退出码恒 0，免得一个只读报告被当成第二套门禁、天天与第 8 条抢着判红（坑 #64 规则①）。
  process.exit(0);
}
let anchorScanned = 0, anchorSkipped = 0, bareScanned = 0;
for (const f of lintTargets) {
  if (!fs.existsSync(f)) continue;
  const text = read(f);
  const strict = strictOk(f) || rel(f).startsWith('docs/specs/');
  const push = strict ? errors : warnings;
  for (const b of findTableBreaks(text)) push.push(`[表格] ${rel(f)}:${b.line} 该行 ${b.got} 格 > 表头 ${b.want} 格（裸竖线请写成 \\|）：${b.text}`);
  for (const b of findBrokenTableHeads(text)) push.push(`[表格断裂] ${rel(f)}:${b.line} 表头与分隔行被并成一行，整张表会脱离格数判据：${b.text}`);
  const a = findStaleAnchors(text, resolveAny);
  anchorScanned += a.scanned; anchorSkipped += a.skippedVocabulary + a.skippedIgnore;
  for (const s of a.bad) push.push(`[锚点越界] ${rel(f)}:${s.at} 指向 ${s.file}:${s.line}，该文件实有 ${s.lines} 行`);
  const ba = findBareAnchors(text, { exists: existsRel, resolveBare });
  bareScanned += ba.scanned;
  // 只判**真多义**的那几条（B115② 的实测口径：审计当时点出的 8 条就是多义集）。
  // 唯一候选的裸文件名只进分母不提示 —— 否则一版就新增 50+ 条提示，天天刷屏的提示等于没有提示（坑 #64 规则①）。
  for (const s of ba.bare) {
    if (s.cands < 2) continue;
    warnings.push(`[裸文件名] ${rel(f)}:${s.at} 的 ${s.file}:${s.line} 没写全路径，仓内有 ${s.cands} 个同名文件（${s.sample} 等）—— 多义时按哪个收敛全凭运气`);
  }
  for (const c of findUncitedF2pCounts(text)) push.push(`[F2P出处] ${rel(f)}:${c.line} 写了改前/改后条数却没带证据文件名：${c.text}`);
  for (const d of findDuplicateIds(text)) push.push(`[编号撞号] ${rel(f)}:${d.line} 的 ${d.id} 与第 ${d.first} 行同号 —— 两条不同事实共用一个号，之后按号引用必指错行`);
  // 11 只对**父 spec**（docs/specs/NN-*/spec.md）判，且只出提示（判据比前几条软，见函数注释）
  if (/^docs\/specs\/\d[^/]*\/spec\.md$/.test(rel(f))) {
    for (const g of findUnanchoredFacts(text)) warnings.push(`[背景出处] ${rel(f)}:${g.line} 背景段的实测断言没带 B 编号也没指路：${g.text}`);
  }
}
warnings.push(`[锚点分母] 本次看到 ${anchorScanned} 条指向存在的 file:line 锚点，其中 ${anchorSkipped} 条按"死锚点信号词/ignore"放过（那是被当作反例引用的，不是漏判）；另有 ${bareScanned} 条只写裸文件名 —— 唯一候选的已由第 8 条按候选收敛后一起判越界，多义与查无此文件的**只进本条分母**（不猜文件，猜错会把好文档判红）`);
}

console.log(`doc-lint：${errors.length} 错 ${warnings.length} 警`);
for (const e of errors) console.log('  ✗ ' + e);
for (const w of warnings) console.log('  ! ' + w);
process.exitCode = errors.length ? 1 : 0;
