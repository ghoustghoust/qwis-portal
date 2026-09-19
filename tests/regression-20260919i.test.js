// 2026-09-19 第 3 批页面批注（B84/B85/B72）的 F2P 锁
// 运行：node --test tests/regression-20260919i.test.js
// 改前基线：node tools/eval-f2p.cjs --base d679167 --tests tests/regression-20260919i.test.js --cases I
// 三条缺陷的可见面在浏览器里（已由 eval:e2e E3/E6/E10 打线上取证）；本文件钉的是**离线可判的契约**：
// 布局下限/上界是否写进组件、三份媒体栏实现是否同步带出兜底字段、路由是否有白名单外分支。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// 抽出一个组件函数的函数体（从声明到下一个顶层 ^function / ^export 之前）
function bodyOf(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) return null;
  const next = src.slice(at + decl.length).search(/^\w/m);
  return next < 0 ? src.slice(at) : src.slice(at, at + decl.length + next);
}

// 渲染某字段的元素，其**开标签**是否带宽度上界。
// 逐行匹配会误杀：界写在包裹层、字段在内层是合法写法（B85 的修法正是这样）。
function openingTagBounding(body, fieldExpr) {
  const at = body.indexOf(fieldExpr);
  if (at < 0) return { found: false };
  const open = body.lastIndexOf('<span', at);
  if (open < 0) return { found: false };
  const close = body.indexOf('>', at);
  const head = body.slice(open, close < 0 ? undefined : close);
  // 只认开标签自身的 class（内层再套一层时 head 会含内层，但界必须在其中出现才可能生效）
  return { found: true, bounded: /max-w-\[/.test(head), tag: head.replace(/\s+/g, ' ').slice(0, 180) };
}

test('I1 B85：CompactRow 标题列必须有宽度下限，来源列必须有宽度上界', () => {
  const file = read('web', 'src', 'components', 'ColumnSection.jsx');
  const row = bodyOf(file, 'function CompactRow');
  assert.ok(row, '找不到 CompactRow，本条会退化成恒真');
  // flex-1 = flex:1 1 0%：基准 0 让标题列在收缩阶段永远抢不到宽度，必须有 min-w 下限
  const title = row.match(/<span className="([^"]*flex-1[^"]*)"/);
  assert.ok(title, '标题列（flex-1）不存在');
  assert.ok(/min-w-\[\d/.test(title[1]), `标题列没有 min-width 下限（只有 min-w-0 会被挤到 0 宽）：${title[1]}`);
  assert.ok(!/\bmin-w-0\b/.test(title[1]), `标题列仍是 min-w-0：${title[1]}`);
  // 渲染 source_name 的元素必须有宽度上界：无界的 flex-none 兄弟能把基准宽之和顶过整行宽
  const src = openingTagBounding(row, 'item.source_name');
  assert.ok(src.found, 'CompactRow 里没有渲染来源名的列，判据失去对象');
  assert.ok(src.bounded, `来源列未设宽度上界：${src.tag}`);
});

test('I2 B85：MyBriefPage 列表行同族缺陷一并设界（同一 source 字段，不能只修一处）', () => {
  const file = read('web', 'src', 'pages', 'MyBriefPage.jsx');
  const row = bodyOf(file, 'function RestRow');
  assert.ok(row, '找不到 RestRow');
  const title = row.match(/<span className="([^"]*flex-1[^"]*)"/);
  assert.ok(title && /min-w-\[\d/.test(title[1]), `RestRow 标题列缺 min-width 下限：${title && title[1]}`);
  const srcCol = openingTagBounding(row, 'item.source');
  assert.ok(srcCol.found, 'RestRow 没有渲染来源的列');
  assert.ok(srcCol.bounded, `RestRow 来源列未设界：${srcCol.tag}`);
});

test('I3 B84：三份媒体栏实现（api 日报 / runner 日报 / runner 我的早报）都要带出 source_avatar', () => {
  const files = [['api', '[...slug].js'], ['tools', 'collect-turso.js']];
  let pushes = 0;
  for (const f of files) {
    const src = read(...f);
    const lines = src.split('\n').filter((l) => /mediaItems\.push\(/.test(l));
    assert.ok(lines.length >= 2, `${f.join('/')} 只找到 ${lines.length} 处 mediaItems.push，判据对象不对`);
    const bad = lines.filter((l) => !/source_avatar:/.test(l));
    assert.ok(bad.length === 0, `${f.join('/')} 有媒体项没带兜底头像字段：\n${bad.join('\n').slice(0, 240)}`);
    pushes += lines.length;
    const selects = src.split('\n').filter((l) => /AS source_avatar/.test(l) && /SELECT (v|a)\.id/.test(l));
    assert.ok(selects.length >= 2, `${f.join('/')} 只有 ${selects.length} 条媒体查询取 s.avatar（视频+播客各一条）`);
  }
  assert.ok(pushes >= 6, `媒体项 push 总数=${pushes}（api 2 + runner 日报 2 + runner 我的早报 2）——新增了副本却没同步本锁`);
});

test('I4 B84：MediaRow 无封面分支渲染 SourceAvatar，不再用 emoji 冒充图标', () => {
  const src = read('web', 'src', 'pages', 'MyBriefPage.jsx');
  const row = bodyOf(src, 'function MediaRow');
  assert.ok(row, '找不到 MediaRow');
  assert.ok(!/[🎧]/.test(row) && !/▶/.test(row), `MediaRow 仍有 emoji 角标：${(row.match(/[🎧▶]/g) || []).join('')}`);
  assert.ok(/<SourceAvatar /.test(row), 'MediaRow 无封面分支没有渲染 SourceAvatar（源头像兜底是 lib/media.js 写死的契约）');
  assert.ok(/source_avatar/.test(row), 'MediaRow 没有把 source_avatar 传给兜底头像');
  // 契约文档与实现必须同口径，否则下一轮又会"文档说有、实现没有"
  const lib = read('lib', 'media.js');
  assert.ok(/source_avatar/.test(lib), 'lib/media.js 的兜底口径没写明承载字段，读的人仍会以为只是"源头像"');
});

test('I5 B72：未知路径必须有白名单外分支，else 不得无条件渲染阅读器', () => {
  const src = read('web', 'src', 'main.jsx');
  assert.ok(/function NotFoundPage/.test(src), 'main.jsx 没有 NotFoundPage');
  assert.ok(/data-e2e="notfound"/.test(src), '404 兜底缺 data-e2e 锚点（E10 靠它定位）');
  assert.ok(!/else page = <ReaderPage \/>;/.test(src), '路由末尾仍是无条件 else → ReaderPage（B72 原样）');
  assert.ok(/else page = <NotFoundPage/.test(src), '未知路径没有落到 NotFoundPage 分支');
  assert.ok(/KNOWN_PREFIXES/.test(src), '缺白名单：无法区分"阅读器"和"打错的路径"');
});

test('I6 B72：评测接线同步——E10 从 known_gap 回到门禁位，剧本仍在', () => {
  const src = read('tools', 'eval-e2e.cjs');
  assert.ok(/id: 'E10'/.test(src), 'E10 剧本被删了（禁止用删剧本逃门禁）');
  const gaps = src.match(/const KNOWN_GAPS = \{[^}]*\}/);
  assert.ok(gaps, '找不到 KNOWN_GAPS 声明');
  assert.ok(!/E10/.test(gaps[0]), `B72 已修，E10 仍挂在 KNOWN_GAPS 上不进门禁：${gaps[0]}`);
  assert.ok(/notfound/.test(src), 'E10 没有用 404 锚点做判据（还在只判"页面有没有阅读器文案"）');
});
