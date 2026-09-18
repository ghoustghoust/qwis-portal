#!/usr/bin/env node
/**
 * 文档门禁（规则来源：docs/DOC_GOVERNANCE.md §5）。只读检查，不改文件。
 * 用法：node tools/doc-lint.cjs     退出码 0=通过（可有警告），1=有不通过项
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
  if (!fs.existsSync(abs)) { errors.push(`[缺失] 底层文档不存在：${f}`); continue; }
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
const lintTargets = [path.join(ROOT, 'AGENTS.md'), path.join(ROOT, 'ARCHITECTURE.md'), path.join(ROOT, 'README.md')]
  .concat(docsFiles)
  .filter((f) => !ARCHIVE_PREFIXES.some((p) => rel(f).startsWith(p)));
for (const f of lintTargets) {
  if (!fs.existsSync(f)) continue;
  for (const r of extractRefs(read(f))) {
    const clean = r.replace(/:\d+.*$/, '');
    if (/[<…]/.test(clean) || /xxx|XXX/.test(clean)) continue;
    const cands = [path.join(ROOT, clean), path.join(path.dirname(f), clean)];
    if (cands.some((c) => fs.existsSync(c))) continue;
    const msg = `[悬空] ${rel(f)} 引用了不存在的 ${clean}`;
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

// 6 明文密钥扫描（只扫 git 跟踪文件；本地未跟踪的 HANDOVER.md/.env 属设计内）
let tracked = [];
try { tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', maxBuffer: 32e6 }).split('\n').filter(Boolean); }
catch (e) { warnings.push(`[跳过密钥扫描] git ls-files 失败：${e.message}`); }
const SECRET = [/ghp_[\w]{20,}/, /sk-[\w]{20,}/, /libsql:\/\/[^/\s"']+:[^/\s"']+@/, /tokens\.[\w-]+\.libsql\.cloud/];
for (const t of tracked) {
  if (!/\.(md|json|js|cjs|jsx|yml|yaml|txt)$/.test(t)) continue;
  const abs = path.join(ROOT, t);
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;
  const text = read(abs);
  for (const re of SECRET) {
    if (re.test(text)) errors.push(`[密钥] ${t} 含疑似明文凭据 ${String(re).slice(1, 14)}…（凭据只能在 .env/Vercel env/GH Secrets 三处）`);
  }
}

console.log(`doc-lint：${errors.length} 错 ${warnings.length} 警`);
for (const e of errors) console.log('  ✗ ' + e);
for (const w of warnings) console.log('  ! ' + w);
process.exitCode = errors.length ? 1 : 0;
