// 2026-09-19 自主轮 E：云端巡检工具自身的完整性（B64/B65/B66）
// 起点是一条踩坑记录：我用仓库名 qwis-portal 当线上域名打探针，拿到 DEPLOYMENT_NOT_FOUND，
// 差点报成"Vercel 又把部署弄没了"（坑 #42）。顺着查下去发现更糟的一件事——
// tools/audit-cloud.js（专门用来发现云端问题的巡检脚本）里写死的就是这个 404 域名，
// 也就是说它从 2026-09-11 起连续 8 天什么都没测出来；而它的判据 `pass: !!verdict`
// 会把"失败理由字符串"打成 ✅，所以即使换对域名它也只会报满分（坑 #43）。
// 一个只会输出 ✅ 的检查器，比没有检查器更危险：它提供虚假的安全感。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
require('./helpers');
const { cleanup } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const CODE_DIRS = ['tools', 'lib', 'server', 'api', 'web/src', 'tests', 'queue', 'cloud'];
const SKIP_DIR_RE = /(node_modules|dist|\.next|\.git|coverage|_eval)/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR_RE.test(e.name)) walk(p, out); }
    else if (/\.(js|cjs|mjs|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const codeFiles = CODE_DIRS.flatMap((d) => walk(path.join(ROOT, d)));

test.after(() => cleanup());

test('B64-0 正向探针：云端基址确有唯一实现，且与权威文档同源', () => {
  const { CLOUD_SITE } = require('../lib/cloud-site');
  assert.match(CLOUD_SITE, /^https:\/\/[a-z0-9-]+\.vercel\.app$/, '云端基址格式不对：' + CLOUD_SITE);
  const doc = fs.readFileSync(path.join(ROOT, 'docs/FEATURE_MATRIX.md'), 'utf8');
  assert.ok(doc.includes(CLOUD_SITE), `代码里的云端域名在权威文档里没有出处（两边必有一份是错的）：${CLOUD_SITE}`);
  // 反向也要成立：文档里的域名必须就是代码用的那个
  const docHosts = [...new Set([...doc.matchAll(/https:\/\/[a-z0-9-]+\.vercel\.app/g)].map((m) => m[0]))];
  assert.deepEqual(docHosts, [CLOUD_SITE], '权威文档出现了第二个云端域名：' + docHosts.join(', '));
});

test('B64-1 云端基址全库一份：活代码里写死第二份必然漂（audit-cloud 已漂到 404 域名 8 天）', () => {
  const { CLOUD_SITE } = require('../lib/cloud-site');
  const offenders = [];
  for (const f of codeFiles) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    if (rel === 'lib/cloud-site.js') continue;
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/https:\/\/[a-z0-9.-]+\.vercel\.app/g)) {
      offenders.push(`${rel} → ${m[0]}${m[0] === CLOUD_SITE ? '（字面量，该 import lib/cloud-site）' : '（不是线上域名）'}`);
    }
  }
  assert.deepEqual(offenders, [], '云端基址只许出现在 lib/cloud-site.js：\n' + offenders.join('\n'));
});

test('B64-2 巡检脚本必须走共享基址，历史死域名 qwis-portal 不许再出现在活代码里', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools/audit-cloud.js'), 'utf8');
  assert.match(src, /require\(['"]\.\.\/lib\/cloud-site['"]\)/, '巡检脚本的基址必须来自共享实现');
  assert.doesNotMatch(src, /qwis-portal/, '死域名又回来了（2026-09-11 已下架，打过去是 DEPLOYMENT_NOT_FOUND）');
  for (const f of codeFiles) {
    if (path.basename(f) === 'audit-cloud.js' && f.includes('portal')) continue;
    const src2 = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(src2, /https:\/\/qwis-portal\.vercel\.app/,
      `${path.relative(ROOT, f)} 里还有已下架域名`);
  }
});

test('B65-1 巡检判据：check 返回字符串是"失败理由"，不是"通过的附注"（坑 #43）', () => {
  const { verdictToResult } = require('../tools/audit-cloud.js');
  assert.deepEqual(verdictToResult(true), { pass: true, note: '', skip: '' }, '正向：返回 true 才算通过');
  // 这一条就是本轮的真 bug：'应401实际405' 曾被 `!!verdict` 判成通过
  const failVerdict = verdictToResult('应401实际405');
  assert.equal(failVerdict.pass, false, '失败理由字符串必须判不过');
  assert.equal(failVerdict.note, '应401实际405');
  assert.equal(verdictToResult(false).pass, false);
  assert.equal(verdictToResult(undefined).pass, false, 'check 什么都不返回不许算通过');
  const skipped = verdictToResult('SKIP:云端无 dedup 契约');
  assert.equal(skipped.pass, false, '未验收不许算通过');
  assert.equal(skipped.skip, '云端无 dedup 契约');
  assert.equal(skipped.note, '', 'SKIP 的理由走 skip 字段，不混进失败附注');
});

test('B65-2 巡检脚本被 require 时不得自动打云端（模块级副作用会污染测试进程）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools/audit-cloud.js'), 'utf8');
  assert.match(src, /if \(require\.main === module\) main\(\)/, '缺少 require 守卫');
  const t0 = Date.now();
  const m = require('../tools/audit-cloud.js');
  assert.ok(Date.now() - t0 < 1500, 'require 就花了 ' + (Date.now() - t0) + 'ms，八成是自动跑了网络巡检');
  assert.equal(typeof m.verdictToResult, 'function');
});

test('B65-3 巡检计数与退出码是行为，不是源码字面量（对抗性审查 I8 后重写）', () => {
  const { tally, exitCodeOf } = require('../tools/audit-cloud.js');
  assert.deepEqual(tally([{ pass: true, skip: '' }, { pass: false, skip: '', note: '失败理由' }, { pass: false, skip: '未验' }]),
    { pass: 1, fail: 1, skip: 1, total: 3 }, '三种状态必须各归各的账');
  assert.equal(exitCodeOf(tally([{ pass: true, skip: '' }])), 0, '有真通过且无失败 → 0');
  assert.equal(exitCodeOf(tally([{ pass: false, skip: '', note: 'x' }])), 1, '有失败 → 1');
  // 这一条就是审查指出的洞：判据大面积退化成 SKIP 时，旧实现照样退 0
  assert.equal(exitCodeOf(tally([{ pass: false, skip: '契约不存在' }, { pass: false, skip: '契约不存在' }])), 2,
    '全 SKIP（等于什么都没验）必须判"未评测"，不许绿灯进门禁');
  assert.equal(exitCodeOf(tally([])), 2, '一条都没跑到 = 未评测，不是通过');
});

test('B66-1 巡检不许断言不存在的契约：/api/articles 无 dedup 语义，只能明说未验收', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools/audit-cloud.js'), 'utf8');
  assert.doesNotMatch(src, /b\.deduped === true/, '`deduped` 字段在云端读层根本不存在（api/[...slug].js 只有日报内 dailyDedup 与 POST /api/sources/dedupe）');
  assert.match(src, /SKIP:云端无 dedup 契约/, '这条必须显式记为未验收（B66），不许静默删除');
  const route = fs.readFileSync(path.join(ROOT, 'api/[...slug].js'), 'utf8');
  assert.doesNotMatch(route, /query\.dedup|searchParams\.get\(['"]dedup/, '若云端真的实现了 dedup 参数，本锁要连同 B66 一起改判');
});

test('B66-0 正向探针：巡检的三条判据都对得上实测契约（字段名/状态码不是猜的）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools/audit-cloud.js'), 'utf8');
  // /api/sources 的载荷键
  assert.match(src, /\(b\.sources \|\| \[\]\)\.length > 100/, '源列表判据必须读 `sources` 键');
  // 鉴权：错误 key 的 POST 是 403（GET 是 405，方法不允许）
  assert.match(src, /r\.status === 403[\s\S]{0,200}method: 'POST'/, '采集端点鉴权判据必须用 POST 测 403');
  // 详情：200 且带 item，404 不再是"通过"
  assert.match(src, /r\.status === 200 && b && b\.ok && b\.item/, '文章详情判据必须真验载荷');
});

// ── B67：报警出口的判据（本轮最贵的一条：P0 的 BL7 在验收门禁里显示绿灯）──
const PROD_ALERT_CHANNELS = [{ id: 'test-ch', type: 'webhook', enabled: true, config: { url: 'http://127.0.0.1:1' } }];

test('B67-1 哨兵/回环/内网/元数据/坏值渠道一律不算"有出口"（生产实测就是这个形状）', () => {
  const { isRealEndpointUrl, usableChannels } = require('../lib/alert-channels');
  assert.deepEqual(usableChannels(PROD_ALERT_CHANNELS), [],
    '生产库现况：唯一渠道是 test-ch → http://127.0.0.1:1，必须判"无出口"（BL7 不得在门禁里显示绿灯）');
  for (const bad of ['http://127.0.0.1:1', 'https://localhost/hook', 'http://[::1]:9/wh', 'http://127.0.0.1:53/x',
    'undefined', 'null', '', 'http://', 'ftp://open.feishu.cn/x',
    // 对抗性审查实测：这一组旧实现全判 true（配个内网地址就能骗过"有出口"判据）
    'http://10.0.0.5:9000/hook', 'http://192.168.1.7:8080/hook', 'http://172.16.0.9/hook',
    'http://169.254.169.254/latest/meta-data', 'http://metadata.google.internal/x',
    'https://alerts.internal/hook', 'https://[fd00::12:34]:8443/hook',
    'http://admin:s3cr3t@hooks.slack.com/services/T00/B00/XXX']) {
    assert.equal(isRealEndpointUrl(bad), false, `不该算出口：${bad}`);
  }
  assert.equal(isRealEndpointUrl(undefined), false, 'null/undefined 不许当通过');
  assert.equal(isRealEndpointUrl('http://8.8.8.8/hook'), false, '裸 IP 也不给过（本项目的 webhook 从不长这样，放行只会掩盖坏配置）');
});

test('B67-0 正向探针：真公网 webhook 必须算有出口（防判据写成"永远红"）', () => {
  const { isRealEndpointUrl, usableChannels } = require('../lib/alert-channels');
  for (const good of ['https://open.feishu.cn/open-apis/bot/v2/hook/aaaa-bbbb',
    'https://oapi.dingtalk.com/robot/send?access_token=xxx',
    'https://hooks.slack.com/services/T00/B00/XXX',
    'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc']) {
    assert.equal(isRealEndpointUrl(good), true, `该算出口：${good}`);
  }
  const chans = [{ id: 'feishu-1', enabled: true, config: { url: 'https://open.feishu.cn/open-apis/bot/v2/hook/x' } }];
  assert.equal(usableChannels(chans).length, 1);
  assert.equal(usableChannels([{ id: 'feishu-1', enabled: false, config: { url: 'https://open.feishu.cn/x' } }]).length, 0,
    '禁用渠道不许算出口');
});

test('B67-4 掩码必须到 host 为止：token 在 query、凭据在 userinfo 都不许漏进报告', () => {
  const { maskEndpointUrl } = require('../lib/alert-channels');
  const m = maskEndpointUrl('https://oapi.dingtalk.com/robot/send?access_token=SECRET123');
  assert.equal(m, 'https://oapi.dingtalk.com/…', '掩码结果：' + m);
  assert.ok(!/SECRET123/.test(m));
  const ui = maskEndpointUrl('http://admin:passw0rd@hooks.example.com/x');
  assert.ok(!/admin|passw0rd/.test(ui), 'userinfo 漏进掩码结果：' + ui);
  assert.equal(maskEndpointUrl('undefined'), '(不可解析)');
});

test('B67-2 dispatched ≠ delivered：最新一条决定状态，老成功不许掩盖新断链', () => {
  const { deliveryState } = require('../lib/alert-channels');
  const now = Date.parse('2026-09-18T00:00:00.000Z');
  const failing = [{ at: '2026-09-17T08:34:24.125Z', event: 'source_error', results: [{ channel: 'TEST', ok: false, error: 'fetch failed' }] }];
  const d1 = deliveryState(failing, 7 * 864e5, now);
  assert.equal(d1.state, 'failing', '生产实测形状（全链 fetch failed）必须判 failing');
  assert.match(d1.detail, /fetch failed/);
  // 审查指出的洞：9-16 成功过一次、9-17 起全断 → 旧实现按"7 天内有成功"判 ok
  const masked = [
    { at: '2026-09-16T10:00:00.000Z', results: [{ channel: 'feishu', ok: true }] },
    { at: '2026-09-17T08:34:24.125Z', results: [{ channel: 'feishu', ok: false, error: 'fetch failed' }] },
  ];
  assert.equal(deliveryState(masked, 7 * 864e5, now).state, 'failing', '最新一条失败必须判 failing，历史成功只作附注');
  assert.equal(deliveryState([], 7 * 864e5, now).state, 'unknown', '没有投递记录不许算"已验证"');
  assert.equal(deliveryState(failing, 7 * 864e5, Date.parse('2026-12-01T00:00:00Z')).state, 'unknown',
    '窗口外的旧记录不算近期证据');
  assert.equal(deliveryState([{ at: '2099-01-01T00:00:00Z', results: [{ ok: true }] }], 7 * 864e5, now).state, 'broken',
    '未来时间戳是坏数据，必须点名而不是当成"刚送达"');
  assert.equal(deliveryState([{ at: '昨天', results: [{ ok: true }] }], 7 * 864e5, now).state, 'broken',
    '时间戳解析失败要报"坏数据"，不许静默过滤成"无记录"');
  assert.equal(deliveryState([{ at: '2026-09-17T08:34:24.125Z', results: [{ channel: 'feishu', ok: true }] }], 7 * 864e5, now).state, 'ok');
});

test('B67-3 preflight 必须引用共享判据（唯一的接线契约，其余都按行为测）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools/eval-preflight.cjs'), 'utf8');
  assert.match(src, /require\(['"]\.\.\/lib\/alert-channels['"]\)/, '报警出口判据必须来自 lib/alert-channels.js（唯一实现）');
  assert.match(src, /maskEndpointUrl\(/, '掩码必须走共享实现，不许在调用方各写一份正则（本轮审查发现旧正则会漏 userinfo）');
  assert.doesNotMatch(src, /startsWith\('http'\)\)/, '又写回 `url.startsWith("http")` 这种宽判据了：哨兵渠道会把它变绿灯');
});
