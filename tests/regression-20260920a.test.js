// 2026-09-20 批次 A：B94 未解码 XML 实体（源名/标题上屏 `&quot;`）的锁
// 运行：node --test tests/regression-20260920a.test.js
// 改前基线：node tools/eval-f2p.cjs --auto-base --tests tests/regression-20260920a.test.js --cases A
// 实测面积（只读，tools/_q-entities.cjs）：sources.name 13 行 / articles.title 177 行 / articles.summary 4095 行带实体。
// 本批只修**标题类字段**（源名 + 条目标题 + 视频标题）；summary 故意不修，理由见 A4。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const { decodeXmlEntities, cleanTitle } = require('../lib/text-clean.js');

test('A1 实体解码只认得存在的实体，两种方向都要钉（B94）', () => {
  assert.equal(decodeXmlEntities('A &amp; B'), 'A & B', '命名实体 &amp; 必须解');
  assert.equal(decodeXmlEntities('号称&quot;100%人类撰写&quot;'), '号称"100%人类撰写"', '线上实样：文章标题里的 &quot;');
  assert.equal(decodeXmlEntities('Fei&apos;s &nbsp;Tour'), "Fei's  Tour", '&apos; 与 &nbsp;');
  assert.equal(decodeXmlEntities('&#39;quoted&#39;'), "'quoted'", '十进制数字实体');
  assert.equal(decodeXmlEntities('&#x27;hex&#x27;'), "'hex'", '十六进制数字实体');
  assert.equal(decodeXmlEntities('Dash — and …'), 'Dash — and …', '普通文本不许被动');
  // 反向：不认识的实体必须原样留着（"猜"会把内容改掉），以及裸 & 不该被误当作实体起点
  assert.equal(decodeXmlEntities('&foobar;'), '&foobar;', '未知实体不许猜');
  assert.equal(decodeXmlEntities('a & b'), 'a & b', '没有分号的裸 & 不许动');
  assert.equal(decodeXmlEntities('&amp;amp;'), '&amp;', '只解一次：双重转义留给数据订正，不在采集层连解两次');
  assert.equal(decodeXmlEntities(null), null, 'null 原样返回（由调用方决定默认值）');
  assert.equal(decodeXmlEntities(''), '', '空串不抛');
});

test('A2 cleanTitle 的 null 与空白口径（否则库里会多出一批字符串 "null" 标题）', () => {
  assert.equal(cleanTitle(null), '', 'null 必须变空串——B15/坑 #60 那一族的 ' +
    "'null' 字面串就是这类 `String(null)` 造成的");
  assert.equal(cleanTitle(undefined), '');
  assert.equal(cleanTitle('  Reddit · Linux &amp; AI  '), 'Reddit · Linux & AI', '解码后还要 trim');
  assert.equal(cleanTitle(0), '0', '数字 0 不是空，不许被吞');
});

test('A3 三端五处标题/源名构造点必须全部走同一份 cleanTitle（AGENTS §1 三份实现同步）', () => {
  const SITES = [
    ['server/services/collectors/rss/index.js', '条目 title', /title:\s*cleanTitle\(item\.title\)/],
    ['server/services/collectors/rss/index.js', 'YouTube title', /title:\s*cleanTitle\(item\.title\)/],
    ['server/services/collectors/rss/index.js', '源名 feed.title', /name:\s*cleanTitle\(feed\.title\)/],
    ['api/collect.js', '云端读层 title', /title:\s*cleanTitle\(item\.title\)/],
    ['tools/collect-turso.js', 'runner title', /title:\s*cleanTitle\(item\.title\)/],
  ];
  for (const [f, label, re] of SITES) {
    assert.ok(re.test(read(...f.split('/'))), `${f} 的「${label}」没接 cleanTitle`);
  }
  // 反向：老的裸写法一处不许再留（否则等于新写入点绕过清洗，某些天又冒出 &quot;）
  const leftovers = [];
  for (const f of ['server/services/collectors/rss/index.js', 'api/collect.js', 'tools/collect-turso.js']) {
    const src = read(...f.split('/'));
    src.split(/\r?\n/).forEach((l, i) => {
      if (/title:\s*\(item\.title \|\| ''\)\.trim\(\)/.test(l)) leftovers.push(`${f}:${i + 1}`);
      if (/name:\s*\(feed\.title \|\| input\)\.trim\(\)/.test(l)) leftovers.push(`${f}:${i + 1}(源名)`);
    });
  }
  assert.deepEqual(leftovers, [], `还有没接清洗的标题/源名构造点：${leftovers.join(', ')}`);
  // 实现只许一份：本轮把全库 9 处各自解实体的写法全部收敛到 lib/text-clean
  // （4 处自抄映射表 + 5 处只解 `&amp;` 的 URL 属性解码），所以这里**不设豁免**：
  // 任何一处 `.replace(/&实体/` 重新出现，就是有人又开始抄第二份表。
  const copiers = [];
  for (const dir of ['server', 'api', 'tools', 'lib']) {
    for (const f of walkFiles(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      if (rel === 'lib/text-clean.js') continue;
      if (/replace\(\/&(?:amp|quot|apos|nbsp|lt|gt|#39|#x27)\//.test(read(rel))) copiers.push(rel);
    }
  }
  assert.deepEqual(copiers, [], `实体解码出现第二份实现：${copiers.join(', ')}（多份必漂——B94 的成因就是 9 份各解各的）`);
});

test('A4 摘要/正文故意不解码——防把"被转义的标签"变成真标签（越权解码比不修更糟）', () => {
  // summary 里 `&lt;b&gt;` 是被转义的**内容**；解一次就变成 `<b>`，前端 RichText 的
  // "像不像 HTML"判据会因此把它当 HTML 分支渲染 —— 等于用 B94 换来一个新 bug。
  for (const f of ['server/services/collectors/rss/index.js', 'api/collect.js', 'tools/collect-turso.js']) {
    const src = read(...f.split('/'));
    for (const m of src.matchAll(/summary:\s*cleanTitle\(/g)) {
      assert.fail(`${f} 对 summary 用了 cleanTitle（会把转义标签解成真标签）@${src.slice(0, m.index).split('\n').length}`);
    }
  }
  // 这条判据必须"会红"：喂一个含转义标签的摘要，确认解码前后的可见差异
  assert.equal(decodeXmlEntities('&lt;b&gt;粗&lt;/b&gt;'), '<b>粗</b>', '证明"解一次就会造出标签"这件事是真的');
  assert.equal(cleanTitle('&lt;b&gt;粗&lt;/b&gt;'), '<b>粗</b>', '所以标题类字段一旦含转义标签也会变标签：由 sanitize/消毒层兜，不在这里改口径');
});

function walkFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (/\.(js|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}
