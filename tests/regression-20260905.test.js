// 2026-09-05 全库审查修复回归（docs/1.CODE_REVIEW_2026-09-05.md）
// 覆盖：P0-1 鉴权中间件策略 / P0-2 报警凭据脱敏 / P1-1 fulltext aggregator SQL /
//       P1-2 syncOpml 解冻语义 / P1-4 events RangeError
require('./helpers');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { cleanup } = require('./helpers');
const { db, setSetting } = require('../server/db');

after(() => cleanup());

// ─── P0-1：鉴权中间件（读者只读公开 + 写/管理需登录）───
const { authMiddleware, generateToken, isPublic } = require('../server/middleware/auth');

function mockReqRes(method, p, token) {
  const req = { method, path: p, headers: token ? { authorization: `Bearer ${token}` } : {} };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
  };
  return { req, res };
}

function runMw(mw, req, res) {
  let called = false;
  mw(req, res, () => { called = true; });
  return called;
}

test('P0-1a: 读者只读 GET 公开（articles/videos/hot/daily/sources/groups/status/img/settings）', () => {
  for (const p of ['/articles', '/articles/123', '/videos', '/videos/1/play', '/hot', '/hot/events', '/daily', '/groups', '/sources', '/status', '/img', '/settings', '/settings/daily']) {
    const { req, res } = mockReqRes('GET', p);
    assert.ok(runMw(authMiddleware, req, res), `GET ${p} 应公开`);
  }
});

test('P0-1b: 写操作无 token 一律 401', () => {
  for (const [m, p] of [
    ['POST', '/articles/1/later'], ['POST', '/articles/read-all'], ['POST', '/videos/1/favorite'],
    ['POST', '/daily/regenerate'], ['POST', '/sources'], ['PUT', '/settings'], ['DELETE', '/sources/1'],
    ['POST', '/data/restore'], ['POST', '/hot/backfill'], ['POST', '/auth/douyin/start'],
  ]) {
    const { req, res } = mockReqRes(m, p);
    assert.ok(!runMw(authMiddleware, req, res), `${m} ${p} 不应放行`);
    assert.equal(res.statusCode, 401);
    assert.ok(res.body.needLogin);
  }
});

test('P0-1c: 敏感读接口（alerts/data/backup/queue/health/douyin status）需登录', () => {
  for (const p of ['/alerts/config', '/alerts/log', '/data/list', '/backup/latest', '/queue/pending', '/health/status', '/auth/douyin/status']) {
    const { req, res } = mockReqRes('GET', p);
    assert.ok(!runMw(authMiddleware, req, res), `GET ${p} 不应公开`);
    assert.equal(res.statusCode, 401);
  }
});

test('P0-1d: /auth/login 公开；有效 token 放行；无效 token 401', () => {
  assert.ok(isPublic({ method: 'POST', path: '/auth/login' }));
  const token = generateToken({ user: 'admin' });
  const ok = mockReqRes('POST', '/sources', token);
  assert.ok(runMw(authMiddleware, ok.req, ok.res), '有效 token 应放行写操作');
  const bad = mockReqRes('POST', '/sources', 'invalid.token.here');
  assert.ok(!runMw(authMiddleware, bad.req, bad.res));
  assert.equal(bad.res.statusCode, 401);
});

test('P0-1e: 鉴权中间件注册顺序守卫（index.js 中必须先于路由挂载循环）', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  const mwPos = src.indexOf("app.use('/api', authMiddleware)");
  const loopPos = src.indexOf('for (const [mount, file] of Object.entries(routes))');
  assert.ok(mwPos > 0 && loopPos > 0, '两处锚点都应存在');
  assert.ok(mwPos < loopPos, '鉴权中间件必须注册在路由挂载循环之前');
});

// ─── P0-2：报警渠道凭据脱敏 ───
const alerts = require('../server/services/alerts');

test('P0-2a: getPublicConfig 敏感字段全部掩码，非敏感字段保留', () => {
  setSetting('alerts', {
    channels: [
      { id: 'c1', type: 'dingtalk', name: '钉钉群', enabled: true, config: { url: 'https://oapi.dingtalk.com/robot/send?access_token=SECRET', secret: 'SEC123' } },
      { id: 'c2', type: 'telegram', name: 'TG', enabled: true, config: { token: '123:ABC', chatId: '456' } },
      { id: 'c3', type: 'bark', name: 'Bark', enabled: true, config: { deviceKey: 'DEVKEY', server: 'https://api.day.app' } },
    ],
    events: { source_error: true },
    cooldownMin: 60,
  });
  const pub = alerts.getPublicConfig();
  for (const c of pub.channels) {
    for (const k of ['url', 'secret', 'sendkey', 'deviceKey', 'token']) {
      if (c.config[k] !== undefined) assert.equal(c.config[k], alerts.SECRET_MASK, `${c.type}.${k} 应掩码`);
    }
  }
  assert.equal(pub.channels[1].config.chatId, '456', '非敏感字段 chatId 保留');
  assert.equal(pub.channels[2].config.server, 'https://api.day.app', '非敏感字段 server 保留');
  assert.equal(pub.cooldownMin, 60);
});

test('P0-2b: mergeChannelSecrets 掩码/空值保留旧密钥，新值允许覆盖，新渠道原样通过', () => {
  const old = [{ id: 'c1', type: 'dingtalk', name: '钉钉', config: { url: 'https://real-webhook', secret: 'SEC' } }];
  const merged = alerts.mergeChannelSecrets(old, [
    { id: 'c1', type: 'dingtalk', name: '钉钉', enabled: false, config: { url: alerts.SECRET_MASK, secret: '' } }, // 前端回写掩码
    { id: 'c2', type: 'bark', name: '新Bark', config: { deviceKey: 'NEWKEY' } }, // 新增渠道
  ]);
  assert.equal(merged[0].config.url, 'https://real-webhook', '掩码回写应保留旧 url');
  assert.equal(merged[0].config.secret, 'SEC', '空串回写应保留旧 secret');
  assert.equal(merged[0].enabled, false, '非敏感字段（enabled）正常更新');
  assert.equal(merged[1].config.deviceKey, 'NEWKEY', '新渠道密钥原样写入');
  // 显式换新值也应生效
  const replaced = alerts.mergeChannelSecrets(old, [{ id: 'c1', type: 'dingtalk', name: '钉钉', config: { url: 'https://new-webhook' } }]);
  assert.equal(replaced[0].config.url, 'https://new-webhook');
  assert.equal(replaced[0].config.secret, 'SEC', '未提交的可选 secret 保留旧值');
});

// ─── P1-1：全文补抓 aggregator 排除必须是 extra JSON 标志（静态守卫）───
test('P1-1: fulltext.js 用 json_extract(extra) 排除 aggregator，而非恒真的 type 比较', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server/services/scheduler/jobs/fulltext.js'), 'utf8');
  // 剥掉注释，只检查实际 SQL 代码
  const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!code.includes("s.type != 'aggregator'"), '不得再用 sources.type 判 aggregator（恒真 bug）');
  assert.ok(code.includes("json_extract(COALESCE(s.extra,'{}'),'$.aggregator')"), '应走 extra.aggregator JSON 标志');
});

// ─── P1-2：syncOpml 恢复走统一解冻语义（静态守卫）───
test('P1-2: wechat syncOpml 恢复源走 unfreezeSource（清 fail_count）', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server/services/collectors/wechat/index.js'), 'utf8');
  assert.ok(src.includes('unfreezeSource'), 'syncOpml 恢复必须走统一解冻入口');
  assert.ok(!src.includes("SET enabled=1, status='ok'"), '不得再手写半套恢复 SQL（不清 fail_count）');
});

// ─── P1-4：events 聚合对全坏 published_at 不抛 RangeError（动态）───
test('P1-4: events 聚合遇到不可解析 published_at 不崩溃', () => {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO sources(type, name, url, enabled, status, created_at) VALUES('rss','测试源A','http://test-a.example',1,'ok',?)").run(now);
  db.prepare("INSERT INTO sources(type, name, url, enabled, status, created_at) VALUES('rss','测试源B','http://test-b.example',1,'ok',?)").run(now);
  const sa = db.prepare("SELECT id FROM sources WHERE url='http://test-a.example'").get().id;
  const sb = db.prepare("SELECT id FROM sources WHERE url='http://test-b.example'").get().id;
  // published_at 为非法日期字符串（字典序 >= cutoff 能过 SQL 过滤，但 Date.parse 为 NaN）
  const ins = db.prepare("INSERT INTO articles(source_id, title, url, published_at, created_at) VALUES(?,?,?,?,?)");
  ins.run(sa, '某公司发布全新一代大模型产品', 'http://test-a.example/1', 'not-a-date', now);
  ins.run(sb, '某公司发布全新一代大模型产品', 'http://test-b.example/1', 'also-bad', now);
  const events = require('../server/services/events');
  events.invalidate();
  const list = events.getEvents('all');
  assert.ok(Array.isArray(list), '聚合不应抛异常');
  const ev = list.find((e) => e.title.includes('大模型'));
  assert.ok(ev, '两源同标题应聚成事件');
  assert.ok(ev.firstAt && !Number.isNaN(Date.parse(ev.firstAt)), 'firstAt 必须是合法时间');
});
