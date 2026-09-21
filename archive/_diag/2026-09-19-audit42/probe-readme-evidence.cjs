// spec 42 · 写目录 README 的证据采集器（只读）。输出：路由挂载表 / lib 被谁引用 / api 装载面 /
// web 组件引用面 / tools 现役与一次性 / tests 清单。不写任何业务文件。
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-admin', '.vercel', '.next', 'data', 'archive', '.qoder', 'portal']);
const walk = (d, acc = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name) || (e.name.startsWith('.') && e.name !== '.github')) continue; const f = path.join(d, e.name); e.isDirectory() ? walk(f, acc) : acc.push(f); } return acc; };
const files = walk(ROOT).map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
const txt = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const srcOf = (filter) => files.filter((f) => /\.(js|cjs|mjs|jsx|ts|tsx)$/.test(f) && filter(f));

console.log('### 1. server/index.js 路由挂载表（前缀 -> 文件）');
const idx = txt('server/index.js');
for (const m of idx.matchAll(/'(\/api[^']*)'\s*:\s*'\.\/routes\/([\w-]+)'/g)) console.log(`  ${m[1]} -> server/routes/${m[2]}.js`);

console.log('\n### 2. lib/*.js 被谁 require（装载方）');
for (const f of srcOf((x) => x.startsWith('lib/'))) {
  const base = f.replace(/^lib\//, '').replace(/\.js$/, '');
  const users = files.filter((g) => g !== f && /\.(js|cjs|jsx)$/.test(g) && new RegExp(`['"][^'"]*lib/${base}['"]`).test(txt(g)));
  console.log(`  ${f.padEnd(28)} 装载方 ${users.length ? users.length + ': ' + users.slice(0, 4).map((u) => u.split('/')[0] + '/…' + path.basename(u)).join(' ') : '★ 零装载'}`);
}

console.log('\n### 3. api/ 装载面（谁被 [...slug].js require）+ 白名单');
const slug = txt('api/[...slug].js');
for (const f of srcOf((x) => x.startsWith('api/'))) {
  const b = path.basename(f, '.js');
  if (b === '[...slug]') continue;
  console.log(`  ${f.padEnd(24)} 被 catch-all require: ${new RegExp(`\\./_${b}|\\./${b}`).test(slug) ? '是' : '★ 否'}`);
}
const wl = files.filter((f) => f.startsWith('tests/')).find((f) => /acllass|cloud/.test(f));
for (const f of files.filter((x) => x.startsWith('tests/'))) { const t = txt(f); const m = t.match(/\/api\/(settings|meta)[^\n]*whitelist|const\s+\w*WHITELIST\w*\s*=\s*\[[^\]]*\]/); if (m) { console.log(`  白名单出处 ${f}: ${m[0].slice(0, 200)}`); break; } }

console.log('\n### 4. web/src/components 哪些没被任何页面/组件引用');
const compDir = 'web/src/components';
const allWeb = files.filter((f) => f.startsWith('web/src/'));
for (const f of allWeb.filter((x) => x.startsWith(compDir + '/') && x.endsWith('.jsx'))) {
  const b = path.basename(f, '.jsx');
  const users = allWeb.filter((g) => g !== f && txt(g).includes(b));
  if (!users.length) console.log(`  ★ 零引用组件：${f}`);
}

console.log('\n### 5. tools/ 分类：runner/门禁/运维/一次性');
const wf = files.filter((f) => f.startsWith('.github/')).map((f) => txt(f)).join('\n');
const pkg = txt('package.json');
const eco = fs.existsSync(path.join(ROOT, 'ecosystem.config.js')) ? txt('ecosystem.config.js') : '';
const serverRefs = files.filter((f) => /^(server|api|lib|web)\//.test(f)).map((f) => txt(f)).join('\n');
let live = 0, oneshot = 0, lib = 0;
for (const f of srcOf((x) => x.startsWith('tools/'))) {
  const b = path.basename(f);
  const inWf = wf.includes(b), inPkg = pkg.includes(b), inEco = eco.includes(b), inSrc = serverRefs.includes(b);
  const isLib = /^(lib|_lib|util)/.test(b) || /^eval-|^doc-lint|helpers?\.js$/.test(b);
  if (b.startsWith('_')) { oneshot++; continue; }
  if (inWf || inPkg || inEco || inSrc) live++; else lib++;
  if (!(inWf || inPkg || inEco || inSrc)) continue;
  console.log(`  现役 ${f.padEnd(34)} ${[inWf && 'workflow', inPkg && 'npm script', inEco && 'PM2', inSrc && '被 server/api require'].filter(Boolean).join(' + ')}`);
}
console.log(`  统计：被引用现役 ${live} · 无人引用（脚本类）${lib} · 下划线一次性 ${oneshot}`);

console.log('\n### 6. tests/ 清单（按名字前缀分组）');
const tests = files.filter((f) => f.startsWith('tests/') && f.endsWith('.test.js')).map((f) => path.basename(f));
console.log('  ' + tests.join(' '));
console.log('  fixtures 目录：' + files.filter((f) => f.startsWith('tests/fixtures')).length + ' 件');
