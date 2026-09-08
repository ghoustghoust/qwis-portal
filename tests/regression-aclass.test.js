// A 类硬伤回归测试（2026-09-04 审计修复）
// A1  pending_items schema 不匹配（store.js 引用不存在的 source_id/created_at 列，setImmediate 无防护可崩进程）
// A2  enrichMissing 把 pending_items.id 当 articles.id 用
// A3  调度器数据清理 require 路径错误（MODULE_NOT_FOUND 被吞，清理从未执行）
// A4  全文补抓引用不存在的 articles.updated_at 列 + log.debug（log.js 无此方法）
// A5  hotlist 热度 score 入库被丢弃
// A6  DataTab：React 未导入 / backups·willDelete·sizeBytes 字段错位 / 导入快照空壳
// A7  抖音扫码登录端点缺失（DouyinTab 死链）
// A8  AlertsTab：api.delete 不存在 / 单条删除是假删除
// A9  portal src-admin：SourcesTab 重复声明 / WereadTab 未定义 / 误放 HotSettingsTab
// A10 portal/api/backfill.js 是非法 serverless 函数（导出对象且无鉴权）
// A11 scripts/restore-frozen-sources.js 清 extra='{}' 抹掉 intervalMin/etag
// A12 smoke-test.js 直写生产库 data/app.db
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const helpers = require('./helpers'); // APP_DATA_DIR 隔离，绝不触碰 data/app.db

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

after(() => helpers.cleanup());

// ---------- A5：hotlist score 落库 ----------
test('A5: saveArticles 保存 score，冲突时刷新热度，空值不清空', () => {
  const { db } = require('../server/db');
  const { saveArticles } = require('../server/services/collectors/store');
  const sid = db.prepare(
    "INSERT INTO sources(type,name,url,extra,created_at) VALUES('hotlist','t','hotlist://t','{}',datetime('now'))"
  ).run().lastInsertRowid;
  const url = 'https://a5.example.com/item';
  assert.equal(saveArticles(sid, [{ title: 'T', url, score: 1230000 }]), 1);
  assert.equal(db.prepare('SELECT score FROM articles WHERE url=?').get(url).score, 1230000);
  saveArticles(sid, [{ title: 'T', url, score: 567 }]); // 冲突：热度更新
  assert.equal(db.prepare('SELECT score FROM articles WHERE url=?').get(url).score, 567);
  saveArticles(sid, [{ title: 'T', url }]); // 无 score：不清空已有值
  assert.equal(db.prepare('SELECT score FROM articles WHERE url=?').get(url).score, 567);
});

// ---------- A1：聚合源 pending_items 入队 ----------
test('A1: 聚合源刷新后 pending_items 入队成功（真实列、不崩进程）', async () => {
  const { db } = require('../server/db');
  const registry = require('../server/services/collectors/registry');
  const { fetchSource } = require('../server/services/collectors/store');
  registry.register({
    type: 'fakeagg',
    defaultIntervalMin: 60,
    match: () => false,
    resolve: async () => ({}),
    fetch: async () => ({ articles: [{ title: 'A1', url: 'http://127.0.0.1:1/a1' }] }),
  });
  const extra = JSON.stringify({ aggregator: true });
  const sid = db.prepare(
    "INSERT INTO sources(type,name,url,extra,created_at) VALUES('fakeagg','agg','fakeagg://x',?,datetime('now'))"
  ).run(extra).lastInsertRowid;
  const r = await fetchSource({ id: Number(sid), type: 'fakeagg', name: 'agg', url: 'fakeagg://x', extra });
  assert.equal(r.articles, 1);
  await new Promise((res) => setImmediate(res)); // 等 setImmediate 回调的同步段（入队 SQL）执行完
  const row = db.prepare("SELECT * FROM pending_items WHERE type='aihot_enrich'").get();
  assert.ok(row, 'pending_items 应写入待补抓记录');
  assert.equal(row.url, 'http://127.0.0.1:1/a1');
  assert.equal(row.status, 'pending');
});

test('A1(静态): fetcher.js 的 pending_items 插入只使用真实列且 setImmediate 有防护（重构 Phase 2 从 store.js 提取）', () => {
  const src = read('server/services/collectors/fetcher.js');
  assert.ok(!/INTO pending_items\(\s*source_id/.test(src), 'pending_items 无 source_id 列');
  assert.match(src, /INSERT INTO pending_items\(type, url, name, status, imported_at\)/);
  // setImmediate 块内必须同时有 try 和 catch（只验存在性,不绑死注释/格式）
  const si = src.indexOf('setImmediate(() => {');
  assert.ok(si > -1);
  const block = src.slice(si, src.indexOf('});', si));
  assert.ok(block.includes('try {'), '异步回调必须有 try');
  assert.ok(block.includes('catch'), '异步回调必须有 catch 防 uncaughtException');
});

// ---------- A2：enrichMissing 用对 id ----------
test('A2: enrichMissing 用 articles.id 补抓、用 pending_id 删记录', () => {
  const src = read('server/services/aihot/enrich.js');
  assert.match(src, /a\.id AS article_id/, '必须显式取 articles.id');
  assert.match(src, /enrichArticle\(r\.article_id\)/, '补抓必须用文章 id');
  assert.match(src, /DELETE FROM pending_items WHERE id=\?'\)\.run\(r\.pending_id\)/, '删除必须用 pending id');
  assert.ok(!/p\.source_id|p\.created_at/.test(src), 'pending_items 无 source_id/created_at 列');
});

// ---------- A3：调度器清理路径 ----------
test('A3: 调度器数据清理引用 ../datamgr 并支持 retentionDays 覆盖（重构 Phase 3 已移至 jobs/maintenance.js）', () => {
  const src = read('server/services/scheduler/jobs/maintenance.js');
  assert.ok(!src.includes("require('../services/datamgr')"), '错误路径解析为 services/services/datamgr');
  assert.match(src, /require\('\.\.\/\.\.\/datamgr'\)\.cleanup\(/);
  assert.match(src, /retentionDays/, '保留天数应读 settings.data.retentionDays');
  // 路径真实可解析
  require('../server/services/datamgr');
});

// ---------- A4：全文补抓 SQL/日志 ----------
test('A4: 全文补抓不再引用 updated_at 列、log.debug 与编号参数', () => {
  const src = read('server/services/scheduler/index.js');
  assert.ok(!/updated_at\s*=\s*CURRENT_TIMESTAMP/.test(src), 'articles 表无 updated_at 列，SQL 不得写入它');
  assert.ok(!/log\s*\.\s*debug|log\[["']debug["']\]/.test(src), 'util/log 只有 info/warn/error');
  assert.ok(!/SET content_html = \?1/.test(src), 'better-sqlite3 编号参数 ?1 不支持位置绑定，必须用匿名 ?');
});

// ---------- A6：DataTab 契约 ----------
test('A6: DataTab 无未定义 React 引用，字段契约与后端一致', () => {
  const src = read('web/src/components/DataTab.jsx');
  assert.ok(!/[^.]React\.useRef|^\s*React\./m.test(src), 'DataTab 只具名导入，不能用 React.xxx');
  assert.match(src, /d\?\.backups/, '快照列表必须读 backups 键（后端 /api/data/list 返回 backups）');
  assert.match(src, /d\?\.willDelete/, '清理预览必须读 willDelete 键');
  assert.match(src, /stats\?\.sizeBytes/, '库体积必须读 sizeBytes 键');
  assert.match(src, /s\.sizeBytes \?\?/, '快照大小必须读 sizeBytes 键');
  assert.match(src, /\/api\/data\/upload\?name=/, '导入必须走真实上传接口');
});

test('A6: datamgr.saveUpload 校验文件名白名单、SQLite 文件头与同名拒绝', () => {
  const datamgr = require('../server/services/datamgr');
  assert.throws(() => datamgr.saveUpload('../evil.db', Buffer.alloc(200)), /非法快照文件名/);
  assert.throws(() => datamgr.saveUpload('app-x.db', Buffer.from('definitely not sqlite')), /不是有效的 SQLite/);
  const buf = Buffer.concat([Buffer.from('SQLite format 3\0', 'latin1'), Buffer.alloc(200)]);
  const r = datamgr.saveUpload('app-20990101-000000.db', buf);
  assert.equal(r.file, 'app-20990101-000000.db');
  assert.equal(r.sizeBytes, buf.length);
  assert.ok(datamgr.list().some((s) => s.file === 'app-20990101-000000.db'), '上传后应出现在快照列表');
  // 同名上传必须拒绝（防静默覆盖损毁已有快照）
  assert.throws(() => datamgr.saveUpload('app-20990101-000000.db', buf), /已存在/);
  const again = datamgr.list().find((s) => s.file === 'app-20990101-000000.db');
  assert.equal(again.sizeBytes, buf.length, '原快照不得被覆盖');
});

// ---------- A7：抖音登录端点 ----------
test('A7: 抖音登录契约端点存在，getLoginStatus 可读', () => {
  const auth = read('server/routes/auth.js');
  assert.match(auth, /\/douyin\/status/);
  assert.match(auth, /\/douyin\/start/);
  const douyin = require('../server/services/collectors/douyin');
  assert.equal(typeof douyin.startLogin, 'function');
  const st = douyin.getLoginStatus();
  assert.equal(st.loggedIn, false); // 测试库无凭据
  assert.equal(st.updatedAt, null);
});

// ---------- A8：AlertsTab 删除 ----------
test('A8: AlertsTab 删除走真实接口（带 at 指纹防 TOCTOU），后端有单条删除路由', () => {
  const src = read('web/src/components/AlertsTab.jsx');
  assert.ok(!/api\s*\.\s*delete\s*\(/.test(src), 'api 封装只导出 del，没有 delete');
  assert.match(src, /api\.del\(`\/api\/alerts\/log\/\$\{index\}\?at=/, '单条删除必须带 at 指纹调后端');
  const routes = read('server/routes/alerts.js');
  assert.match(routes, /router\.delete\('\/log\/:index'/);
  assert.match(routes, /findIndex\(\(r\) => r\.at === at\)/, '下标位移时必须按 at 指纹重新定位');
});

test('A8(附带): clearCooldowns 清的是真正生效的 alerts.cooldowns 键', async () => {
  const { setSetting, getSetting } = require('../server/db');
  const alerts = require('../server/services/alerts');
  setSetting('alerts.cooldowns', { 'source_error:1': new Date().toISOString() });
  alerts.clearCooldowns();
  assert.deepEqual(getSetting('alerts.cooldowns'), {}, '冷却记录必须真正清空');
});

// ---------- A9：portal src-admin ----------
test('A9: portal src-admin 无重复声明，WereadTab 正名，无误放组件', () => {
  const src = read('portal/src-admin/App.jsx');
  assert.equal((src.match(/function SourcesTab\(/g) || []).length, 1, 'SourcesTab 只能声明一次');
  assert.equal((src.match(/function WereadTab\(/g) || []).length, 1, 'WereadTab 必须有定义');
  assert.ok(!src.includes('HotSettingsTab'), '云端无热点榜后端，不得引入 HotSettingsTab');
  assert.ok(!fs.existsSync(path.join(ROOT, 'portal/src-admin/components/HotSettingsTab.jsx')));
});

// ---------- A10：portal backfill ----------
test('A10: backfill 已改为 _backfill.js（不再是独立 serverless 函数）', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'portal/api/backfill.js')), 'api/ 下非下划线文件会被 Vercel 当函数');
  assert.ok(fs.existsSync(path.join(ROOT, 'portal/api/_backfill.js')));
  assert.match(read('portal/api/_handlers.js'), /require\('\.\/_backfill'\)\.backfill\(\)/);
});

// ---------- A11：解冻脚本保留 extra ----------
test('A11: 批量解冻脚本只清错误字段，不抹 extra', () => {
  const src = read('scripts/restore-frozen-sources.js');
  assert.ok(!/extra\s*=\s*['"]\{\}['"]/.test(src), '清空 extra 会抹掉 intervalMin/etag（P0-1 故障重现）');
  assert.match(src, /unfreezeSource/, '必须走统一解冻实现（保留 intervalMin/etag）');
});

// ---------- A12：smoke-test 隔离 ----------
test('A12: smoke-test 先设 APP_DATA_DIR 副本再加载 db', () => {
  const src = read('smoke-test.js');
  const idxSet = src.indexOf('process.env.APP_DATA_DIR = TMP_DIR');
  const idxReq = src.indexOf("require('./server/db')");
  assert.ok(idxSet > -1, '必须设置 APP_DATA_DIR');
  assert.ok(idxReq > -1 && idxSet < idxReq, 'APP_DATA_DIR 必须先于 require server/db');
  assert.match(src, /src\.backup\(/, '必须用 WAL 安全备份而非直接拷贝文件');
});

// ---------- 对抗性审查二轮修复（2026-09-04） ----------
test('R2-1: aihot-parse 等测试文件必须先隔离再加载 server 模块', () => {
  // 所有引用 server/* 的测试文件都必须先 require helpers（否则以读写模式打开生产库）
  const files = fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.test.js'));
  for (const f of files) {
    const src = read(`tests/${f}`);
    if (!src.includes("require('../server/") && !src.includes('require("../server/')) continue;
    const idxHelpers = src.indexOf("require('./helpers')");
    const idxServer = src.search(/require\(['"]\.\.\/server\//);
    assert.ok(idxHelpers > -1, `${f} 引用 server 模块但未隔离 APP_DATA_DIR`);
    assert.ok(idxHelpers < idxServer, `${f} 的 helpers 必须先于 server 模块加载`);
  }
});

test('R2-2: 抖音 startLogin 有并发占位（loginInFlight），不会拉起多个浏览器', () => {
  const src = read('server/services/collectors/douyin/index.js');
  assert.match(src, /loginInFlight/, '必须有启动中 Promise 占位消除竞态窗口');
  assert.match(src, /if \(loginInFlight \|\| loginBrowser\) return Promise\.resolve/, '并发双击必须返回 already');
});

test('R2-3: smoke-test 引导失败也清理临时副本（mkdtemp 在 existsSync 之后，catch 兜底 rmSync）', () => {
  const src = read('smoke-test.js');
  assert.ok(src.indexOf('fs.existsSync(SRC_DB)') < src.indexOf('fs.mkdtempSync'), '必须先确认生产库存在再建临时目录');
  assert.match(src, /catch \(err\) \{[\s\S]{0,200}rmSync\(TMP_DIR/, '失败路径必须清理含 credentials 的临时副本');
});

test('R2-4: enrichMissing 入口预清理悬挂 pending（替代不可达的死分支）', () => {
  const src = read('server/services/aihot/enrich.js');
  assert.match(src, /DELETE FROM pending_items WHERE type='aihot_enrich' AND url NOT IN \(SELECT url FROM articles\)/);
  assert.ok(!/if \([^)]*文章不存在[^)]*\.test\(/.test(src), 'enrichMissing 里基于「文章不存在」的删除分支不可达，应已移除');
});

test('R2-5: saveUpload 拒绝同名覆盖', () => {
  const src = read('server/services/datamgr.js');
  assert.match(src, /fs\.existsSync\(dest\)\) throw new Error/, '同名上传必须拒绝，防静默损毁已有快照');
});

test('R2-6: 调度器 retentionDays 有下限保护（防误配清库）（重构 Phase 3 已移至 jobs/maintenance.js）', () => {
  const src = read('server/services/scheduler/jobs/maintenance.js');
  assert.match(src, /retentionDays[\s\S]{0,120}rd >= 1/, '保留天数必须 >=1，防 0.x 天几乎清库');
});
