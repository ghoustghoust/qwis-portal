// 21-bilibili-runner 回归测试：签名一致性 / saveVideos 幂等 / 诊断三态 / 采集兜底
// **2026-09-19 起改在本地 libsql 文件库上跑（B83 / 坑 #52）**。
// 旧版用真凭据连生产 Turso，第 2 条会：
//   · 往生产 sources 插一行 'TEST-B站源'、往 videos 插 BV_TEST_21（after() 再删，中断即留孤行）；
//   · 更糟的是那句 `CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_vid ON videos(vid)` 是**在生产库改表结构**。
// 第 3/4 条还要打真实 B站公开接口：网络抖一下就被 try/catch 吞掉只打一行日志——红不了但也什么都没测到。
// 现在：夹具 + 本地库；B站接口按线上响应形状打桩（离线可复现，且断言真的会红）。
// 表结构取自生产实测 DDL（只读导出 sqlite_master）；idx_videos_vid 与 tools/collect-turso.js 每次批次
// 建的那条唯一索引一致——saveVideos 的 INSERT OR IGNORE 去重就依赖它。
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(os.tmpdir(), `bilibili-${process.pid}.db`).replace(/\\/g, '/');
// 驱动脚本必须落在仓库内：Node 从脚本所在目录往上找 node_modules（放临时目录先撞 Cannot find module）
const DRIVER = path.join(ROOT, `.bilibili-driver-${process.pid}.cjs`);
const bili = require('../api/_bilibili'); // 只有纯函数 signWbi 在本进程判，不碰任何库

function run(caseName) {
  const out = execFileSync(process.execPath, [DRIVER, caseName, DB_FILE],
    { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  const line = out.trim().split('\n').filter((l) => l.startsWith('OUT ')).pop();
  assert.ok(line, `子进程没打印结果（${caseName}）：\n${out}`);
  return JSON.parse(line.slice(4));
}

before(() => {
  fs.writeFileSync(DRIVER, `
process.env.TURSO_DATABASE_URL = 'file:' + process.argv[3];
process.env.TURSO_AUTH_TOKEN = '';
const { createClient } = require('@libsql/client');
const bili = require(${JSON.stringify(path.join(ROOT, 'api', '_bilibili.js'))});
const CASE = process.argv[2];
const NOW = new Date().toISOString();
const DDL = [
  "CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)",
  "CREATE TABLE IF NOT EXISTS credentials (platform TEXT PRIMARY KEY, cookie TEXT, updated_at TEXT)",
  "CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, name TEXT NOT NULL, url TEXT, avatar TEXT, uid TEXT, group_id INTEGER, focus INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, status TEXT DEFAULT 'ok', last_fetched_at TEXT, next_fetch_at TEXT, extra TEXT, created_at TEXT, fail_count INTEGER DEFAULT 0, spotlight INTEGER DEFAULT 0, muted INTEGER DEFAULT 0, reader_visible INTEGER DEFAULT 1)",
  "CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER, platform TEXT, title TEXT, url TEXT UNIQUE, vid TEXT, cover TEXT, duration INTEGER, author TEXT, intro TEXT, published_at TEXT, favorite INTEGER DEFAULT 0, created_at TEXT, watched_at TEXT, play_uri TEXT)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_vid ON videos(vid)",
];
// ── B站接口打桩：响应形状照线上协议写；nav 的 isLogin 取决于有没有带 Cookie（诊断三态就靠这条区分）──
let WBI_MODE = 'ok';
const wbiCalls = { n: 0 };
const NAV = (logged) => ({ code: logged ? 0 : -101, message: logged ? '0' : 'need login',
  data: { isLogin: !!logged, uname: logged ? 'TEST-UP' : null,
    wbi_img: { img_url: 'https://i0.hdslb.com/bfs/face/0123456789abcdef0123456789abcdef.jpg',
               sub_url: 'https://i0.hdslb.com/bfs/face/fedcba9876543210fedcba9876543210.jpg' } } });
const json = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
globalThis.fetch = async (url, init) => {
  const u = String(url);
  const cookie = ((init || {}).headers || {}).Cookie || '';
  if (u.includes('/x/web-interface/nav')) return json(NAV(cookie));
  if (u.includes('/x/frontend/finger/spi')) return json({ code: 0, data: { b_3: 'b3stub', b_4: 'b4stub' } });
  if (u.includes('/x/space/wbi/arc/search')) {
    wbiCalls.n++;
    if (WBI_MODE !== 'ok') return json({ code: -403, message: 'signed error' });
    return json({ code: 0, data: { list: { vlist: [
      { bvid: 'BV1mainAA', title: '主链视频', pic: '//i0.hdslb.com/bfs/main.jpg', length: '12:34',
        author: 'TEST-UP', description: '主链简介', created: 1700000000 },
    ] } } });
  }
  if (u.includes('/x/polymer/web-space/seasons_series_list')) {
    return json({ code: 0, data: { items_lists: { page: { total: 1 }, seasons_list: [{
      meta: { description: '合集简介' },
      archives: [{ bvid: 'BV1seriesBB', title: '合集视频', pic: '//i0.hdslb.com/bfs/series.jpg',
        duration: 90, pubdate: 1700000050 }],
    }] } } });
  }
  if (u.includes('/x/web-interface/search/type')) {
    return json({ code: 0, data: { result: [
      { bvid: 'BV1searchCC', title: '<em class="keyword">搜索</em>视频', author: 'TEST-UP',
        description: '搜索简介', pic: '//i0.hdslb.com/bfs/search.jpg', duration: '02:00',
        pubdate: 1700000100, mid: '546195' },
      { bvid: 'BV1otherDD', title: '别人的视频', author: 'x', pic: '', pubdate: 1, mid: '999999' },
    ] } });
  }
  throw new Error('B83：未预期的网络请求 ' + u);
};
(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL });
  for (const sql of DDL) await db.execute(sql);
  const out = {};
  if (CASE === 'save-videos') {
    await db.execute({ sql: "INSERT INTO sources(type,name,url,enabled,status,created_at) VALUES('bilibili','TEST-B站源','https://space.bilibili.com/999',1,'pending',?)", args: [NOW] });
    const srcId = Number((await db.execute('SELECT MAX(id) m FROM sources')).rows[0].m);
    out.srcId = srcId;
    const vid = 'BV_TEST_21';
    const ins = () => db.execute({
      sql: 'INSERT OR IGNORE INTO videos(source_id,title,url,vid,author,published_at,created_at) VALUES(?,?,?,?,?,?,?)',
      args: [srcId, '测试视频', 'https://www.bilibili.com/video/' + vid, vid, 'TEST', NOW, NOW],
    });
    const r1 = await ins();
    const r2 = await ins();
    out.affected1 = r1.rowsAffected;
    out.affected2 = r2.rowsAffected;
    out.count = Number((await db.execute({ sql: 'SELECT COUNT(*) c FROM videos WHERE vid=?', args: [vid] })).rows[0].c);
    out.orphans = Number((await db.execute('SELECT COUNT(*) c FROM videos')).rows[0].c);
  }
  if (CASE === 'diagnose') {
    await db.execute({ sql: "INSERT OR REPLACE INTO credentials(platform,cookie,updated_at) VALUES('bilibili','SESSDATA=local-fake',?)", args: [NOW] });
    out.withCookie = await bili.diagnose();
    await db.execute("DELETE FROM credentials WHERE platform='bilibili'");
    out.noCookie = await bili.diagnose();
  }
  if (CASE === 'fetch') {
    const source = { uid: '546195', name: '老蒋巨靠谱', url: 'https://space.bilibili.com/546195' };
    WBI_MODE = 'ok';
    out.main = (await bili.fetchBiliVideos(source)).videos;
    WBI_MODE = 'blocked';
    out.wbiCallsBefore = wbiCalls.n;
    out.fallback = (await bili.fetchBiliVideos(source)).videos;
    out.wbiCallsAfter = wbiCalls.n;
  }
  console.log('OUT ' + JSON.stringify(out));
  await db.close();
})().catch((e) => { console.error('DRIVERERR ' + e.message); process.exitCode = 3; });
`);
});
after(() => {
  for (const f of [DRIVER, DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) {
    try { fs.rmSync(f, { force: true }); } catch { /* 关不掉就留给系统临时目录 */ }
  }
});

test('1. signWbi 签名确定性（与本地实现逐字比对）', () => {
  // 复现本地 signWbi 算法独立计算，与 _bilibili 导出比对
  const MIXIN = 'abcdefghijklmnopqrstuvwxyz123456';
  const params = { mid: '123', wts: 1700000000, ps: 30 };
  const out = bili.signWbi(params, MIXIN);
  // 本地算法复算
  const clean = {};
  for (const [k, v] of Object.entries(params)) clean[k] = String(v).replace(/[!'()*]/g, '');
  const query = Object.keys(clean).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(clean[k])}`).join('&');
  const expect = `${query}&w_rid=${crypto.createHash('md5').update(query + MIXIN).digest('hex')}`;
  assert.equal(out, expect);
  assert.match(out, /w_rid=[0-9a-f]{32}$/);
});

test('2. saveVideos 幂等（模拟 batch INSERT OR IGNORE）', () => {
  const r = run('save-videos');
  assert.ok(r.srcId > 0, '夹具源没建出来');
  assert.equal(r.affected1, 1);
  assert.equal(r.affected2, 0, '重复 vid 不应重复插入');
  assert.equal(r.count, 1);
  assert.equal(r.orphans, 1, '除测试行外不该有别的视频行——夹具没隔离干净');
});

test('3. diagnose 返回三态结构（且三态由本地 credentials 驱动）', () => {
  const r = run('diagnose');
  for (const k of ['cookieConfigured', 'wbiKeyRefreshed', 'loginOk']) {
    assert.ok(k in r.withCookie, `缺键 ${k}：${JSON.stringify(r.withCookie)}`);
    assert.ok(k in r.noCookie, `缺键 ${k}：${JSON.stringify(r.noCookie)}`);
  }
  assert.equal(r.withCookie.cookieConfigured, true, 'credentials 里有夹具 Cookie 却判未配置');
  assert.equal(r.withCookie.wbiKeyRefreshed, true, JSON.stringify(r.withCookie));
  assert.equal(r.withCookie.loginOk, true, JSON.stringify(r.withCookie));
  // 没 Cookie 的那一支：不能假装登录态有效，也不能整页打死（结构仍完整）
  assert.equal(r.noCookie.cookieConfigured, false, JSON.stringify(r.noCookie));
  assert.equal(r.noCookie.loginOk, false, JSON.stringify(r.noCookie));
});

test('4. 采集：wbi 主链映射 + 主链被风控时改合集/搜索兜底', () => {
  const r = run('fetch');
  // 主链（线上真跑的那条）字段映射
  assert.ok(r.main.length > 0, '主链没拿到视频');
  assert.ok(r.main[0].vid.startsWith('BV'));
  assert.equal(r.main[0].title, '主链视频');
  assert.equal(r.main[0].cover, 'https://i0.hdslb.com/bfs/main.jpg', '协议相对地址要补 https:');
  assert.equal(r.main[0].duration, 754, 'length 12:34 应解析成 754 秒');
  assert.equal(r.main[0].published_at, new Date(1700000000 * 1000).toISOString());
  // 主链 -403 → 强制刷新密钥重试一次，再落合集/搜索兜底
  assert.ok(r.fallback.length > 0, '兜底链路没拿到视频');
  assert.ok(r.fallback.every((v) => v.vid.startsWith('BV')));
  assert.equal(r.wbiCallsAfter - r.wbiCallsBefore, 2, 'wbi 签名失败应重试一次（共 2 次请求）');
  assert.equal(r.fallback[0].vid, 'BV1searchCC', '兜底结果要按发布时间倒序');
  assert.equal(r.fallback[0].title, '搜索视频', '搜索结果标题要剥掉 <em> 高亮');
  assert.ok(!r.fallback.some((v) => v.vid === 'BV1otherDD'), '搜索兜底必须按 mid 过滤别人的视频');
});

test('5. 自证：本文件不再碰生产库（B83/坑 #52 的门禁）', () => {
  const full = fs.readFileSync(path.join(__dirname, 'regression-bilibili.test.js'), 'utf8');
  const cut = full.indexOf("test('5.");
  assert.ok(cut > 0, '找不到自证条目起点，本条会退化成恒真');
  const src = full.slice(0, cut);
  assert.ok(!/['"]\.env['"]/.test(src), '还在读 .env → 又要拿真凭据连生产库了');
  assert.ok(!/authToken:\s*process\.env/.test(src), 'createClient 带真实 authToken → 会打到生产 Turso');
  assert.match(src, /TURSO_DATABASE_URL = 'file:'/, '子进程必须被指到本地文件库');
  assert.match(src, /globalThis\.fetch = async/, 'B站用例必须打桩，不许依赖真实接口');
});
