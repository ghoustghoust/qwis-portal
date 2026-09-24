#!/usr/bin/env node
/*
 * 文档改动戳生成器（规则来源：docs/DOC_GOVERNANCE.md §2.6）。只读 git，不改任何文档。
 * 产物 docs/STAMPS.md：每份 tracked .md 的「最近改动 = 短号 + 日期时分 + 提交主题」。
 *
 * 为什么不把 commit 号写进各文档头部（设计约束，两条都是实测来的）：
 *   1) 自引用：写戳这次提交本身成为该文件的新提交，头部只能指向上一条 → 永远滞后一格。
 *   2) git log -1 不等于"最后内容改动"：只加头注/只改错别字的元提交会把日期顶新
 *      （样本 2026-09-20 实测 4 例：README、ANDROID_SUBMIT_GUIDE、DEVELOPMENT_STANDARDS、DEV_GUIDE）。
 *   所以这里给的是**带主题的提交史**，元改动由读者按主题分辨，机器不猜。
 *
 * 输出确定性：只用已提交的数据，不写"生成于 <now>"，否则每次跑都产生一条无意义 diff。
 * 用法：node tools/doc-stamp.cjs        生成/刷新 docs/STAMPS.md
 *       node tools/doc-stamp.cjs --check 只比对，不一致退 1（门禁扩面时接 §5）
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_REL = 'docs/STAMPS.md';
const HISTORY_DEPTH = 3;

const git = (args) =>
  execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });

const trackedDocs = git(['ls-files', '-z', '--', '*.md'])
  .split('\0')
  .filter(Boolean)
  .filter((f) => f !== OUT_REL);

const uncommitted = new Set(
  git(['diff', '--name-only', '-z', 'HEAD', '--', '*.md'])
    .split('\0')
    .filter(Boolean)
);

const history = new Map();
const raw = git([
  'log',
  `--format=\x01%h|%ad|%s`,
  '--date=format:%Y-%m-%d %H:%M',
  '--name-only',
  '--',
  '*.md',
]);
for (const chunk of raw.split('\x01').slice(1)) {
  const lines = chunk.split('\n');
  const [sha, when, ...subject] = lines[0].split('|');
  const entry = { sha, when, subject: subject.join('|') };
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].trim();
    if (!f.endsWith('.md')) continue;
    const list = history.get(f) || [];
    if (list.length < HISTORY_DEPTH) list.push(entry);
    if (list.length <= HISTORY_DEPTH) history.set(f, list);
  }
}

const headerDate = (rel) => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  const head = fs.readFileSync(abs, 'utf8').split('\n').slice(0, 12).join('\n');
  const m = head.match(/最后更新[:：]\s*(20\d\d-\d\d-\d\d)/);
  return m ? m[1] : null;
};

// 底层文档白名单不另抄一份：DOC_GOVERNANCE §2.1 的表格就是唯一事实源
// （tools/doc-lint.cjs 里的 FOUNDATION 数组是它的手抄副本，两处各抄一次即第三份事实源，B107 同族）。
const FOUNDATION = new Set(
  (() => {
    const gov = fs.readFileSync(path.join(ROOT, 'docs/DOC_GOVERNANCE.md'), 'utf8');
    const sec = gov.split(/^### 2\.1/m)[1] || '';
    const body = sec.split(/^### 2\.2/m)[0] || '';
    return [...body.matchAll(/^\|\s*`([^`]+\.md)`\s*\|/gm)].map((m) => m[1]);
  })()
);

const verdict = (rel) => {
  if (!FOUNDATION.has(rel)) return '不要求头注';
  const hdr = headerDate(rel);
  const latest = (history.get(rel) || [])[0];
  if (!latest) return '无提交史';
  const gday = latest.when.slice(0, 10);
  if (!hdr) return '缺头注';
  if (hdr > gday) return '头部超前';
  if (hdr === gday) return '一致';
  return '待判';
};

const row = (rel) => {
  const hdr = headerDate(rel) || '—';
  const list = history.get(rel) || [];
  const marks = [];
  if (uncommitted.has(rel)) marks.push('工作区有未提交改动');
  const h = list
    .slice(0, FOUNDATION.has(rel) ? HISTORY_DEPTH : 2)
    // 提交主题里出现 `|` 会把 STAMPS 那一行撑成多余的表格单元（09-24 夜实测：我自己一条写"裸 ||"的提交
    // 主题就把 docs/STAMPS.md 撑出两条 [表格] 警告）。生成物必须自己合格，别让门禁去怪被记录的提交。
    .map((e) => `\`${e.sha}\` ${e.when} ${String(e.subject).replace(/\|/g, '\\|')}`)
    .join('<br>');
  return `| ${rel} | ${hdr} | ${verdict(rel)}${marks.length ? ' ⚠' : ''} | ${h || '—'} |`;
};

const section = (title, files) => {
  if (!files.length) return '';
  const head = `### ${title}（${files.length} 份）\n\n| 文档 | 头部声明 | 判定 | 提交史（短号 · 日期 时:分 · 主题） |\n|---|---|---|---|\n`;
  return head + files.map(row).join('\n') + '\n\n';
};

const byPath = (a, b) => a.localeCompare(b, 'en');
const foundationFiles = [...FOUNDATION].filter((f) => trackedDocs.includes(f)).sort(byPath);
const restFiles = trackedDocs.filter((f) => !FOUNDATION.has(f)).sort(byPath);

const counts = {};
for (const f of trackedDocs) {
  const v = verdict(f);
  counts[v] = (counts[v] || 0) + 1;
}
const c = (k) => counts[k] || 0;

const body =
  `# 文档改动戳（机器生成，勿手改）\n\n` +
  `> 由 \`node tools/doc-stamp.cjs\` 生成；规则见 \`docs/DOC_GOVERNANCE.md\` §2.6。\n` +
  `> **每格都是已提交的历史事实**，所以本表不含"生成时间"——那会让自己每次重跑都产生一条无意义 diff。\n` +
  `> 判定列的语义：\`一致\` = 头部日期 == 最近提交日；\`待判\` = 头部比最近提交旧，**可能是真过时，也可能那次提交只是改头注/改错字**（本表把提交主题列出来就是为了让人一眼分辨，机器不替人判）；\`头部超前\` = 写了尚未提交的日期（提交前出现它是正常态，已 push 仍超前才是硬伤）；\`⚠\` = 工作区还有未提交改动。\n` +
  `> 已知局限：① 本表按路径查历史，**文件改名/搬家前的历史不跟随**（\`--follow\` 只能逐文件跑），搬过的文档其提交史从搬家那次起算。② 本表读已提交历史，**正在提交的这一次必然不进表**（显式滞后一轮，配合 \`⚠\` 可见），下一轮重跑即补上。\n` +
  `> 未跟踪件不入表：如本地文件 \`docs/HANDOVER.md\` 按设计永不提交，本就没有提交史可记。\n\n` +
  `**统计**：底层文档 一致 ${c('一致')} · 待判 ${c('待判')} · 头部超前 ${c('头部超前')} · 缺头注 ${c('缺头注')}　|　不要求头注 ${c('不要求头注')} 份　|　工作区未提交 ${uncommitted.size} 份　|　总计 ${trackedDocs.length} 份\n\n` +
  section('底层文档（DOC_GOVERNANCE §2.1 白名单，列最近 3 次改动）', foundationFiles) +
  section('其余受管文档（列最近 2 次）', restFiles);

if (process.argv.includes('--check')) {
  const cur = fs.existsSync(path.join(ROOT, OUT_REL))
    ? fs.readFileSync(path.join(ROOT, OUT_REL), 'utf8')
    : '';
  if (cur !== body) {
    console.log(`${OUT_REL} 与 git 实际历史不一致，需重跑：node tools/doc-stamp.cjs`);
    process.exitCode = 1;
  } else {
    console.log(`${OUT_REL} 与 git 实际历史一致`);
  }
} else {
  fs.writeFileSync(path.join(ROOT, OUT_REL), body, 'utf8');
  const red = c('待判') + c('缺头注') + c('头部超前');
  console.log(
    `已写 ${OUT_REL}：${trackedDocs.length} 份（一致 ${c('一致')} / 需看 ${red}），未提交 ${uncommitted.size} 份`
  );
  if (red) console.log('  注：需看 ≠ 有错。逐条看"提交史"列再定，见 §2.6。');
}
