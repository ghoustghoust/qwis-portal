// we-mp-rss 退役 + bestblogs 迁移回归测试（2026-09-04）
// BUG-1 P0: rss 适配器 YouTube 分支 result=null 时 !!result.notModified 必抛 TypeError
// BUG-2 P1: 读者侧栏不得展示停用源
// BUG-3 P2: 播客导入不做跨 OPML 同名去重
// 退役守卫: /api/wemp 不挂载 / wempSupervisor 不存在 / 适配器表无 wemp
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const helpers = require('./helpers');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

after(() => helpers.cleanup());

test('BUG-1: YouTube 分支 notModified 判空（P0 回归守卫）', () => {
  const src = read('server/services/collectors/rss/index.js');
  assert.ok(!/!!result\.notModified/.test(src.replace(/!!\(result && result\.notModified\)/, '')),
    'result 在非条件请求路径恒为 null，不得裸用 !!result.notModified');
  assert.match(src, /!!\(result && result\.notModified\)/);
});

test('BUG-2: 读者侧栏只拉启用源', () => {
  assert.match(read('web/src/components/Sidebar.jsx'), /\/api\/sources\?enabled=1/);
});

test('BUG-3: 播客导入不做同名去重（与公众号同品牌不同媒介）', () => {
  const src = read('tools/import-bestblogs-opml.js');
  assert.match(src, /dedupName: false/);
  assert.match(src, /f\.dedupName !== false && existingNameType/);
});

test('退役守卫: wemp 管线无活跃引用', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'server/services/wempSupervisor.js')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'server/routes/wemp.js')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'server/services/collectors/wemp')));
  assert.ok(!read('server/index.js').includes('routes/wemp'), '/api/wemp 不得挂载');
  assert.ok(!read('server/services/collectors/registry.js').includes("'wemp'"), '适配器表不得含 wemp');
  assert.ok(!read('server/services/alerts.js').includes('wempDown'), '报警不得含 wemp 事件');
  assert.ok(!read('server/services/scheduler/index.js').includes('wempSupervisor'), '调度器不得有 wemp 心跳');
  assert.ok(!read('server/services/ai/daily.js').includes("'wemp'"), '日报候选类型不得含 wemp');
  assert.ok(!read('web/src/pages/AdminPage.jsx').includes('WempTab'), '管理台不得有 WempTab');
});

test('退役守卫: .env 无 WEMP_* 残留', () => {
  const env = read('.env');
  assert.ok(!/^WEMP_/m.test(env), '.env 不得残留 WEMP_* 变量');
});

test('disabled 源不进调度 tick（SQL 级守卫）', () => {
  const src = read('server/services/scheduler/index.js');
  assert.match(src, /WHERE enabled=1 AND \(next_fetch_at IS NULL OR next_fetch_at <= \?\)/);
});

test('迁移幂等守卫: import 脚本 URL 去重先于一切', () => {
  const src = read('tools/import-bestblogs-opml.js');
  assert.ok(src.indexOf('existingUrl.get') < src.indexOf('existingNameType.get'), 'URL 去重必须先执行');
});
