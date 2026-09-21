// 目录索引看门人（spec 42 · 工程化基建）
// 立场：README 正文是**人和 Agent 写的文档**，机器永不覆盖。机器只做三件事：
//   1) 目录缺 README → 生成骨架（scaffold，含待填提问）；
//   2) --check：目录里实际存在、但 README 没提到的条目 → 警「未登记」；
//   3) --check：README 用反引号提到、但仓库里哪都不存在的路径 → 警「疑似悬空」。
// 用法：node tools/gen-dir-index.cjs [--check]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHECK = process.argv.includes('--check');
const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-admin', '.vercel', '.next', 'coverage', '.qoder']);
const NO_INDEX = new Set(['data', 'static-data', 'public', 'logs', 'screenshots', 'shots']);
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || (e.name.startsWith('.') && e.name !== '.github')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}
const files = walk(ROOT).map(rel);
const isDir = (d) => { try { return fs.statSync(path.join(ROOT, d)).isDirectory(); } catch { return false; } };
const srcCount = (d) => files.filter((f) => f.startsWith(d + '/') && /\.(js|cjs|mjs|jsx|ts|tsx)$/.test(f)).length;

// 覆盖范围：一级目录 + 源码文件 ≥ 10 的目录（docs/ 已有 INDEX.md，叶子目录按阈值不建）
const topDirs = [...new Set(files.map((f) => f.split('/')[0]))].filter((d) => !d.includes('.') && isDir(d));
const targets = new Set();
for (const d of topDirs) if (!NO_INDEX.has(d) && d !== 'docs' && d !== 'portal') targets.add(d);
for (const d of new Set(files.map((f) => path.dirname(f)).filter((x) => x !== '.'))) {
  if (NO_INDEX.has(d.split('/')[0]) || d.startsWith('archive/') || d.startsWith('docs/')) continue;
  if (srcCount(d) >= 10) targets.add(d);
}

// 本目录的「应登记条目」：一级子目录 + 本级文件（README 自身除外）
function entriesOf(dir) {
  const depth = dir.split('/').length;
  const subs = [...new Set(files.filter((f) => f.startsWith(dir + '/')).map((f) => f.split('/').slice(0, depth + 1).join('/')))]
    .filter((d) => d !== dir && isDir(d)).sort();
  const own = files.filter((f) => path.dirname(f) === dir && path.basename(f) !== 'README.md').map((f) => path.basename(f)).sort();
  const dirsWithNoFiles = [...new Set(files.filter((f) => f.startsWith(dir + '/')).map((f) => f.split('/')[0]))]
    .filter((d) => d !== dir && isDir(d) && !files.some((f) => path.dirname(f) === d));
  return { subs: [...new Set([...subs.map((s) => path.basename(s) + '/'), ...dirsWithNoFiles])], own };
}

// README 里用反引号标出的条目名（`foo/` 或 `bar.md`）视为已登记
function registered(readme) {
  const s = new Set();
  for (const m of readme.matchAll(/`([^`\n]+)`/g)) {
    const t = m[1].trim();
    s.add(t);
    s.add(t.replace(/\/$/, ''));
    s.add(path.basename(t).replace(/\/$/, ''));
  }
  return s;
}

const SCAFFOLD = (dir, e) => `# \`${dir}/\` — （一句话定位：这个目录存在的理由）

（一到两句：谁在用、什么时候该往这里放东西、什么时候不该。）

## 内容

| 内容 | 说明 |
|---|---|
${[...e.subs, ...e.own].slice(0, 40).map((x) => `| \`${x}\` | （待填：它是什么、现役还是已停、被谁替代） |`).join('\n')}

**不放什么**：（待填——负定义比正定义有用）

**状态**：active / frozen / 归档候选 / unknown（没把握就写 unknown，禁止猜）

<!-- 骨架由 node tools/gen-dir-index.cjs 生成；正文请人和 Agent 维护，机器不会覆盖本文件 -->
`;

const report = [];
let scaffolded = 0;
for (const dir of [...targets].sort()) {
  const p = path.join(ROOT, dir, 'README.md');
  const e = entriesOf(dir);
  if (!fs.existsSync(p)) {
    if (CHECK) { report.push(`${dir}/README.md 缺失`); continue; }
    fs.writeFileSync(p, SCAFFOLD(dir, e));
    scaffolded++;
    continue;
  }
  if (!CHECK) continue;
  const txt = fs.readFileSync(p, 'utf8');
  const reg = registered(txt);
  // 逐文件点名只在小目录要求：大目录逼着列 45 行只会产出废话（DOC_GOVERNANCE §2.5「别写到最细」）
  const ownNeed = e.own.length <= 20 ? e.own : [];
  const missing = [...e.subs, ...ownNeed].filter((x) => !reg.has(x) && !reg.has(x.replace(/\/$/, '')));
  if (missing.length) report.push(`${dir}/README.md 有 ${missing.length} 个条目未登记：${missing.slice(0, 8).join(' ')}${missing.length > 8 ? ' …' : ''}`);

  const dangling = [...new Set([...txt.matchAll(/`([^`\n]+\/[^`\n]+)`/g)].map((m) => m[1].trim()))]
    .filter((x) => /^[A-Za-z0-9._@/-]+$/.test(x) && !x.includes('*') && (x.endsWith('/') || /\.[a-z0-9]{1,6}$/i.test(x)))
    .filter((x) => !fs.existsSync(path.join(ROOT, x)) && !files.some((f) => f === x || f.endsWith('/' + path.basename(x))));

  if (dangling.length) report.push(`${dir}/README.md 疑似悬空引用：${dangling.slice(0, 5).join(' ')}`);
}

if (CHECK) {
  if (report.length) { console.log(`目录索引待维护 ${report.length} 处：`); for (const r of report) console.log('  ! ' + r); }
  else console.log(`目录索引：${targets.size} 个目录的 README 已覆盖各自条目，无未登记/悬空`);
  process.exitCode = 0; // 维护提示按警处理，不阻塞在途开发
} else {
  console.log(scaffolded ? `已为 ${scaffolded} 个目录生成 README 骨架（正文待人/Agent 填）；已有正文的目录一律不动。` : '所有目标目录都已有 README，机器不覆盖正文。');
  console.log('维护检查：node tools/gen-dir-index.cjs --check（报未登记条目与悬空引用）');
}
