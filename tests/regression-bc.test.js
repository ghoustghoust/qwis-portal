// B/C 类回归测试（2026-09-04）：云端冻结期安全项 + 本地功能冲突/职责重叠收敛
// B15 云端危险写接口收鉴权 | B18 云端图片代理 SSRF 防护
// C21 WempTab 只列 wemp 源 | C22 解冻语义统一 unfreezeSource | C24 daily 双写校验对齐
// C25 opml refresh 走 markSourceError | C27 SourceTable 批量选择可达/死代码清除 | C28 侧栏 counts 契约
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const helpers = require('./helpers');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

after(() => helpers.cleanup());

// ---------- B15/B18：portal 冻结期安全项 ----------
test('B18: 图片代理走 safeimg（DNS 校验 + 重定向逐跳 + 流式上限），双端同语义', () => {
  for (const f of ['server/util/safeimg.js', 'portal/api/_safeimg.js']) {
    const src = read(f);
    assert.match(src, /dns\.lookup/, `${f} 必须做 DNS 解析后校验`);
    assert.match(src, /redirect: 'manual'/, `${f} 必须手动跟随重定向并逐跳校验`);
    assert.match(src, /::ffff:/, `${f} 必须归一 IPv4-mapped IPv6`);
    assert.match(src, /total > MAX_BYTES/, `${f} 必须流式累计字节上限`);
  }
  assert.match(read('server/routes/img.js'), /fetchImageSafe/);
  assert.match(read('portal/api/[...slug].js'), /_safeimg/);
});

test('B18(动态): isPrivateIp 覆盖全部绕过变体', () => {
  const { isPrivateIp } = require('../server/util/safeimg');
  for (const bad of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '172.31.255.255',
    '169.254.1.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '[::1]',
    'fe80::1', 'fc00::1', 'fd12::1', '224.0.0.1', '255.255.255.255']) {
    assert.ok(isPrivateIp(bad), `${bad} 应判为内网/保留地址`);
  }
  for (const good of ['8.8.8.8', '1.1.1.1', '172.32.0.1', 'example.com']) {
    assert.ok(!isPrivateIp(good), `${good} 是公网/域名,不应拦截`);
  }
});

test('B15: 云端 read-all 与 daily/regenerate 需管理员口令', () => {
  const src = read('portal/api/_handlers.js');
  const readAllIdx = src.indexOf("b === 'read-all'");
  const regenIdx = src.indexOf("b === 'regenerate'");
  assert.ok(readAllIdx > -1 && regenIdx > -1);
  // 两个入口附近必须有 isAuthed 鉴权
  assert.match(src.slice(readAllIdx - 300, readAllIdx + 300), /isAuthed/, 'read-all 必须鉴权');
  assert.match(src.slice(regenIdx - 300, regenIdx + 300), /isAuthed/, 'daily/regenerate 必须鉴权');
});

// ---------- C21：WempTab（已随 we-mp-rss 退役，2026-09-04） ----------
test('C21: WempTab 已随 we-mp-rss 退役移除，AdminPage 无残留引用', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'web/src/components/WempTab.jsx')), 'WempTab 已退役');
  assert.ok(!read('web/src/pages/AdminPage.jsx').includes('WempTab'), 'AdminPage 不得残留 WempTab');
  assert.ok(!read('server/index.js').includes("routes/wemp"), 'server 不得挂载 /api/wemp');
});

// ---------- C22：解冻语义统一 ----------
test('C22: unfreezeSource 统一语义——清计数/启用/清错误字段，保留 intervalMin/etag', () => {
  const { db } = require('../server/db');
  const { unfreezeSource } = require('../server/services/collectors/store');
  const extra = JSON.stringify({ intervalMin: 30, etag: 'W/"abc"', lastError: 'boom', lastErrorAt: '2026-01-01' });
  const id = db.prepare(
    "INSERT INTO sources(type,name,url,enabled,status,fail_count,extra,created_at) VALUES('rss','t','https://c22.example.com/feed',0,'error',5,?,'2026-01-01')"
  ).run(extra).lastInsertRowid;
  assert.ok(unfreezeSource(id));
  const row = db.prepare('SELECT * FROM sources WHERE id=?').get(id);
  assert.equal(row.enabled, 1);
  assert.equal(row.fail_count, 0);
  assert.equal(row.status, 'ok');
  const ex = JSON.parse(row.extra);
  assert.equal(ex.intervalMin, 30, 'intervalMin 必须保留');
  assert.equal(ex.etag, 'W/"abc"', 'etag 必须保留');
  assert.equal(ex.lastError, undefined);
  assert.equal(ex.lastErrorAt, undefined);
  assert.equal(unfreezeSource(999999), false, '不存在的 id 返回 false');
});

test('C22(静态): 四个解冻入口全部收敛到 store.unfreezeSource', () => {
  for (const f of ['server/routes/sources.js', 'server/routes/health.js', 'server/routes/restore-all.js', 'scripts/restore-frozen-sources.js']) {
    assert.match(read(f), /unfreezeSource/, `${f} 必须使用统一解冻实现`);
  }
});

// ---------- C24：daily 双写校验对齐 ----------
test('C24: validateDailyPatch 校验 time/windowHours，两入口共用', () => {
  const { validateDailyPatch } = require('../server/routes/daily');
  assert.throws(() => validateDailyPatch({ time: '25:00' }), /HH:MM/);
  assert.throws(() => validateDailyPatch({ time: 'abc' }), /HH:MM/);
  assert.throws(() => validateDailyPatch({ windowHours: -5 }), /正数/);
  assert.deepEqual(validateDailyPatch({ time: '8:05', windowHours: '48' }), { time: '08:05', windowHours: 48 });
  const settingsSrc = read('server/routes/settings.js');
  assert.match(settingsSrc, /validateDailyPatch/, 'settings.js 必须复用同一校验');
  // 校验必须先于任何 mergeSetting 写入(防「400 但 intervals 已落库」的部分写入)
  assert.ok(
    settingsSrc.indexOf('validateDailyPatch') < settingsSrc.indexOf("mergeSetting('intervals'"),
    'daily 校验必须先于 intervals 写入'
  );
});

// ---------- C25：opml refresh 走熔断体系 ----------
test('C25: opml /refresh 失败走 markSourceError（计 fail_count/熔断/报警）', () => {
  const src = read('server/routes/opml.js');
  assert.match(src, /markSourceError\(s, err\.message(, \{ silent: true \})?\)/);
  assert.ok(!src.includes("SET status='error' WHERE id=?"), '不得再绕开熔断体系只置 status');
});

// ---------- C27：SourceTable 死功能清除 ----------
test('C27: SourceTable 无消费方的批量选择已整体移除，伪防抖已删', () => {
  const src = read('web/src/components/SourceTable.jsx');
  assert.ok(!src.includes('selectedIds'), '无消费方的批量选择必须移除');
  assert.ok(!src.includes('setSearch(search)'), '伪防抖必须删除');
  assert.ok(!src.includes('checkbox'), '复选框列必须移除');
  assert.ok(!fs.existsSync(path.join(ROOT, 'web/src/components/DailySettingsModal.jsx')), '双实现弹窗已移除');
  for (const f of ['web/src/components/BilibiliTab.jsx', 'web/src/components/DouyinTab.jsx']) {
    assert.ok(!/const refreshAll = /.test(read(f)), `${f} 不得保留无引用的 refreshAll`);
  }
});

// ---------- C28：侧栏 counts 契约 ----------
test('C28: 文章/视频列表接口返回 counts（侧栏导航计数）', () => {
  assert.match(read('server/routes/articles.js'), /counts: articleCounts\(\)/);
  const v = read('server/routes/videos.js');
  assert.match(v, /favorite: db\.prepare\('SELECT COUNT\(\*\) c FROM videos WHERE favorite=1'\)/);
  // 空态文案指向 /admin/ 而非已删除的「订阅设置」页
  assert.ok(!read('web/src/components/Sidebar.jsx').includes('订阅设置」页'), 'Sidebar 空态文案');
  assert.ok(!read('web/src/components/VideoGrid.jsx').includes('订阅设置」页'), 'VideoGrid 空态文案');
});

// ---------- ARCHITECTURE.md 决策记录 ----------
test('文档: ARCHITECTURE.md 记录宝塔全量部署决策与 portal 冻结态', () => {
  const src = read('ARCHITECTURE.md');
  assert.match(src, /宝塔\/自有服务器全量部署/);
  assert.match(src, /冻结态/);
  assert.ok(!src.includes('两套部署同构同码'), '「同构同码」表述已更正（语义已漂移）');
});

// ---------- 对抗性审查三轮修复（2026-09-04） ----------
test('R3-1: 批量刷新路径静默逐源报警 + 结尾汇总一条', () => {
  const store = read('server/services/collectors/store.js');
  assert.match(store, /opts\.silent/, 'markSourceError 必须支持 silent');
  for (const f of ['server/routes/sources.js', 'server/routes/opml.js']) {
    const src = read(f);
    assert.match(src, /silent: true/, `${f} 批量路径必须静默`);
    assert.match(src, /dispatch\('source_error'/, `${f} 结尾必须有汇总报警`);
  }
});

test('R3-2: restore-all 不虚报 restored（unfreezeSource 返回 false 时跳过）', () => {
  assert.match(read('server/routes/restore-all.js'), /if \(!unfreezeSource\(s\.id\)\) continue/);
});
