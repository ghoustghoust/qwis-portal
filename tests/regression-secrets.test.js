// 凭据卫生的回归锁（B110/B113/B122/B125 同族 · 坑 #69）。
// 判据本体 `lib/secrets.js`，门禁 `tools/doc-lint.cjs` 第 6 条与本锁同源。
// 标题里带「坑 #69」是**故意的**：白盒 W9 收紧后只认 `test()` 标题/断言消息里的坑号（写在注释里不算）。
//
// 另一个故意：本文件里的样本一律**运行时拼接**生成，不写整串字面量 ——
// 因为本锁自己就在扫描面内（未跟踪且未 ignore），写死一条"看着像真凭据"的串会被自己的判据命中，
// 结果只能是给人加 ignore（错的方向）或把样本删掉（更错）。这是坑 #63 自指族的新形态。
'use strict';
require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
// 惰性取（#64-1 口径）：本锁与 lib/secrets.js 同批落地
const sec = () => require('../lib/secrets');
const ROOT = path.join(__dirname, '..');

const HEX = '0123456789abcdef';
const feishuHook = () => `https://open.feishu.cn/open-apis/bot/v2/hook/${HEX + HEX + 'a1b2c3d4'}`;
const dingHook = () => `https://oapi.dingtalk.com/robot/send?access_token=${HEX + 'deadbeefcafe'}`;
const wecomHook = () => `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${HEX.slice(0, 8)}-1234-5678-9abc-${HEX}`;

test('S1 坑 #69：递归掩码必须掩到嵌套 config.url（B110 就是只掩顶层键漏了它）', () => {
  const settingsAlerts = {
    channels: [{ id: 'feishu-1', name: '飞书', enabled: 1, config: { url: feishuHook() } }],
    events: { source_fail: 1 },
  };
  const { value, masked } = sec().maskDeep(settingsAlerts);
  const url = value.channels[0].config.url;
  assert.ok(!url.includes(HEX.slice(0, 8)) || /\*/.test(url), `嵌套 webhook 没被掩掉：${url}`);
  assert.match(url, /\*{6,}/, '掩码位太短，等于还能反推出前缀');
  assert.ok(masked.some((p) => p.includes('channels[0].config.url')), `必须说清掩了哪条路径：${masked.join(' ')}`);
});

test('S2 反向样本：普通 RSS 地址不许被吞（把证据全糊掉等于探针白做）', () => {
  const src = { sources: [{ name: 'OpenAI Blog', url: 'https://openai.com/blog/rss.xml' }] };
  const { value, masked } = sec().maskDeep(src);
  assert.equal(value.sources[0].url, 'https://openai.com/blog/rss.xml');
  assert.deepEqual(masked, [], `不该掩的掩了：${masked.join(' ')}`);
});

test('S3 四类凭据形态必须逐个抓得住（缺任一类＝B125 说的模式表盲区）', () => {
  // 注意：这几条**不能写成整串字面量** —— 本文件本身在扫描面内，写死了就会被自己的判据命中
  const cases = [
    ['飞书 webhook', feishuHook()], ['钉钉 webhook', dingHook()], ['企微 webhook', wecomHook()],
    ['GitHub PAT', `ghp_${'a'.repeat(24)}`], ['sk key', `sk-${'b'.repeat(24)}`],
    ['libsql 带口令', ['lib', 'sql://db.turso', 'io:my-secret-pw@'].join('')],
    ['Turso 主机', ['tokens.', 'abc-123', '.libsql.', 'cloud'].join('')],
    ['长 Bearer', `Authorization: Bearer ${'c'.repeat(48)}`],
  ];
  for (const [kind, text] of cases) {
    assert.ok(sec().scanText(text).length > 0, `模式表抓不到 ${kind}`);
    const m = sec().maskDeep({ v: text });
    assert.match(m.value.v, /\*/ , `${kind} 走 maskDeep 也没掩：${m.value.v}`);
  }
});

test('S4 反向：普通文本与无口令连接串不许报密钥（假红会让人给判据加 ignore）', () => {
  for (const text of [
    'https://openai.com/blog/rss.xml',
    'libsql://db-xyz.turso.io',                      // 只有主机，没带口令
    'npm test 500 条全绿',
    'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',  // key 太短，形态不完整
  ]) assert.deepEqual(sec().scanText(text), [], `误报：${text}`);
});

test('S5 扫描面必须含"未跟踪且未被 ignore"那一面（B113 的形状）', () => {
  const files = ['docs/eval/audit/schedule.json', 'notes.txt', 'img.png'];
  const fake = { 'docs/eval/audit/schedule.json': JSON.stringify({ dbState: { settings: [{ value: JSON.stringify({ channels: [{ config: { url: feishuHook() } }] }) }] } }) };
  const hits = sec().scanFiles(files, (f) => fake[f] ?? (() => { throw new Error('no file'); })());
  assert.equal(hits.length, 1, `只该命中那份产物：${JSON.stringify(hits)}`);
  assert.equal(hits[0].kind, '飞书 webhook');
  // 非文本后缀与读不到的文件要跳过，而不是抛穿整个门禁
  assert.doesNotThrow(() => sec().scanFiles(['img.png', '不存在.md'], () => { throw new Error('ENOENT'); }));
});

test('S6 真库两面都必须 0 命中，且分母非空（"0 处"必须同时报看了多少份）', () => {
  const fs = require('fs');
  const readRel = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const tracked = sec().listTracked(ROOT);
  const others = sec().listUntrackedNotIgnored(ROOT);
  assert.ok(tracked.length > 1000, `已跟踪面只 ${tracked.length} 份，取法可疑`);
  // 未跟踪面的分母与门禁自报数对账（同一份 lib/secrets.js 取数，一致 = 没在扫空气）。
  // 旧写法断言 >100，那是"工作区必然很脏"的暗含假设——09-21 清洁轮把 787 份收敛到个位数后它把清洁误判成红
  const lintOut = require('child_process').execFileSync('node', ['tools/doc-lint.cjs'], { cwd: ROOT, encoding: 'utf8' });
  const m = /未跟踪未 ignore (\d+) 份/.exec(lintOut);
  assert.ok(m, '门禁没打印密钥分母');
  assert.equal(Number(m[1]), others.length, `门禁看到的未跟踪面(${m[1]})与本锁(${others.length})不一致 → 取数口径漂移`);
  const hits = [...sec().scanFiles(tracked, readRel), ...sec().scanFiles(others, readRel)];
  assert.deepEqual(hits, [], `仓库里有明文凭据（含未跟踪产物）：${JSON.stringify(hits.slice(0, 5))}`);
});

test('S7 maskDeep 是纯函数：不许就地改坏探针还要用的原对象', () => {
  const src = { apiKey: 'sk-' + 'd'.repeat(24), keep: { url: feishuHook() } };
  const snapshot = JSON.stringify(src);
  sec().maskDeep(src);
  assert.equal(JSON.stringify(src), snapshot, '原对象被就地改了（探针后续断言会拿到掩码值）');
});

test('S8 键名形态也要掩：token/password/authorization 三类都不许漏（静默少掩最危险）', () => {
  for (const k of ['token', 'password', 'AUTH_SECRET', 'authToken', 'api-key']) {
    const { value, masked } = sec().maskDeep({ [k]: 'E'.repeat(40) });
    assert.match(String(value[k]), /\*/, `${k} 没被掩：${value[k]}`);
    assert.ok(masked.some((p) => p.includes(k)), `${k} 掩了却没报路径`);
  }
});
