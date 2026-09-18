// spec 32 markdown 内联解析回归测试（纯 JS 解析器，无需渲染器）
// 验收：② 白名单五标签 ③ XSS 载体只当文本 ④ 纯文本旧数据零变化
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { mdInlineParse } = require('../web/src/components/ui/md-inline.js');

test('加粗/强调/重点/行内代码/删除线 全标记解析', () => {
  const out = mdInlineParse('这是**重点**和*强调*和==标记==和`code`和~~删~~。');
  assert.deepEqual(out, [
    { t: 'text', v: '这是' },
    { t: 'bold', v: '重点' },
    { t: 'text', v: '和' },
    { t: 'em', v: '强调' },
    { t: 'text', v: '和' },
    { t: 'mark', v: '标记' },
    { t: 'text', v: '和' },
    { t: 'code', v: 'code' },
    { t: 'text', v: '和' },
    { t: 'del', v: '删' },
    { t: 'text', v: '。' },
  ]);
});

test('XSS 载体原样当文本（不产生任何 html/script 节点）', () => {
  const out = mdInlineParse('<script>alert(1)</script><img src=x onerror=alert(2)> **ok**');
  assert.deepEqual(out[0], { t: 'text', v: '<script>alert(1)</script><img src=x onerror=alert(2)> ' });
  assert.deepEqual(out[1], { t: 'bold', v: 'ok' });
  assert.ok(out.every((s) => ['text', 'bold', 'em', 'mark', 'code', 'del'].includes(s.t)), '只允许白名单类型');
});

test('纯文本旧数据零变化（无标记=单 text 节点原样）', () => {
  const legacy = '据外媒报道，AI 行业增速放缓——没有任何标记的纯文本';
  assert.deepEqual(mdInlineParse(legacy), [{ t: 'text', v: legacy }]);
  assert.deepEqual(mdInlineParse(''), [{ t: 'text', v: '' }]);
  assert.deepEqual(mdInlineParse(null), [{ t: 'text', v: '' }]);
  assert.deepEqual(mdInlineParse(undefined), [{ t: 'text', v: '' }]);
});

test('星号两侧有空格不解析（markdown 惯例防误吞）', () => {
  const s = '增长 * 约 52% * 的数字';
  assert.deepEqual(mdInlineParse(s), [{ t: 'text', v: s }]);
});

test('不闭合标记不解析；同行合法标记正常解析', () => {
  const out = mdInlineParse('这是 **没闭合的加粗\n第二行有 **合法加粗** 内容');
  // 第一行的未闭合 ** 保持文本；第二行的成对标记正常解析
  assert.deepEqual(out[0], { t: 'text', v: '这是 **没闭合的加粗\n第二行有 ' });
  assert.deepEqual(out[1], { t: 'bold', v: '合法加粗' });
  assert.deepEqual(out[2], { t: 'text', v: ' 内容' });
});
