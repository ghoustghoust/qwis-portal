// B8（P2-2）：块级排版——mdBlocks 切分器行为 + 长文点位换用 MdRich
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');

// md-inline.js 是 ESM；node:test 里用动态 import 拿到它（纯函数，无 JSX）
async function loadBlocks() {
  const { pathToFileURL } = require('url');
  const m = await import(pathToFileURL(path.join(ROOT, 'web', 'src', 'components', 'ui', 'md-inline.js')).href);
  return m.mdBlocks;
}

test('MB1 mdBlocks：标题/无序/有序/段落混合样例精确断言 + 纯文本零变化（B8）', async () => {
  const mdBlocks = await loadBlocks();
  const out = mdBlocks('导语。\n\n### 本周主线\n\n- 第一条\n- 第二条\n\n1. 步骤一\n2. 步骤二\n\n收尾。');
  assert.deepEqual(out, [
    { t: 'p', v: '导语。' },
    { t: 'h', level: 3, v: '本周主线' },
    { t: 'ul', items: ['第一条', '第二条'] },
    { t: 'ol', items: ['步骤一', '步骤二'] },
    { t: 'p', v: '收尾。' },
  ]);
  assert.deepEqual(mdBlocks('没有标记的一段话'), [{ t: 'p', v: '没有标记的一段话' }], '纯文本旧数据必须零变化');
});

test('MB2 边界：空行分段、列表被段落打断后重开、块内换行保留（B8）', async () => {
  const mdBlocks = await loadBlocks();
  assert.deepEqual(mdBlocks('甲\n\n乙').map((b) => b.v), ['甲', '乙'], '空行没分段');
  const mixed = mdBlocks('- 一\n段落\n- 二');
  assert.deepEqual(mixed.map((b) => b.t), ['ul', 'p', 'ul'], '列表被段落打断后应重开');
  assert.deepEqual(mdBlocks('第一行\n第二行')[0].v, '第一行\n第二行', '段内换行丢了');
});

test('MB3 长文点位全部换用 MdRich（B8 的可见面）', () => {
  const weekly = fs.readFileSync(path.join(ROOT, 'web', 'src', 'pages', 'WeeklyPage.jsx'), 'utf8');
  const daily = fs.readFileSync(path.join(ROOT, 'web', 'src', 'pages', 'DailyPage.jsx'), 'utf8');
  const hot = fs.readFileSync(path.join(ROOT, 'web', 'src', 'components', 'HotDetail.jsx'), 'utf8');
  for (const [name, src, spots] of [
    ['WeeklyPage', weekly, ['report.theme', 'report.editorNote', 'sl.narrative', 'report.weeklySummary']],
    ['DailyPage', daily, ['report.theme']],
    ['HotDetail', hot, ['summary']],
  ]) {
    assert.ok(src.includes('MdRich'), `${name} 没引 MdRich`);
    for (const sp of spots) assert.ok(src.includes(`<MdRich text={${sp}}`),
      `${name} 的 ${sp} 没走 MdRich`);
  }
  // div 不许再包在 p 里（MdRich 输出 div，嵌进 p 是非法 HTML）
  assert.ok(!/<p[^>]*>\s*<MdRich/.test(daily + weekly + hot), 'MdRich 被包在 <p> 里（非法嵌套）');
});

test('MB4 块级样式类在 index.css 有定义（B8）', () => {
  const css = fs.readFileSync(path.join(ROOT, 'web', 'src', 'index.css'), 'utf8');
  for (const c of ['.md-h', '.md-ul', '.md-ol', '.md-p']) assert.ok(css.includes(c), `index.css 缺 ${c}`);
});
