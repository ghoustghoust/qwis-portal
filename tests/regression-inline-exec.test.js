// I1~I3 读层**内联兜底生成器**的活体执行锁（2026-09-24，44 号 spec 步1 收尾）
// 为什么（用户 09-24 授权原话：「授权一次 POST /api/daily-generate，把读层两份生成器」）：
//   读层有两份日报生成器。`api/daily-generate.js` 那一份当晚已用真 `POST` 打活（HTTP 200/33s，写 id=69）；
//   第二份 `api/[...slug].js#generateDailyInline` 的线上入口只有两个：
//     ① `GET /api/daily` 的兜底分支（今日无报告 且 北京 hour≥1）；
//     ② `POST /api/daily/regenerate` —— 它**先 DELETE 今日 daily_reports 行**再重建，
//        拿它当测试靶子会抹掉当天那份 AI 早报，属破坏性动作，用户没授权就不按。
//   所以这一条用 mock req/res 把整个 catch-all handler 跑在 `file:` 临时库上：真路由、真 SQL、真级3、**零生产写**。
//   它同时补掉一个更早就存在的洞：P6/P8/P9 那三把形态锁只能证明"接线在源码里"，
//   证明不了这个函数**运行起来**会不会在级3 上出错（E1~E3 覆盖的是 runner，不是 api/）。
// 打桩口径与 regression-prescreen-exec 相同：provider 全桩 + fetch 打死 + file: 本地库。
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runDriver } = require('./driver-runner');

const ROOT = path.join(__dirname, '..');
// 每次 run 用**自己的**库：同一个库里第二次跑会先命中"今日已有报告"的早返回分支，
// 那份对照组就变成"读了第一次的落库行"，配额与不限量的差别根本不会出现（自己踩过的假绿）。
const dbOf = (tag) => path.join(os.tmpdir(), `inline-exec-${process.pid}-${tag}.db`).replace(/\\/g, '/');
const DRIVER = path.join(ROOT, `.inline-exec-driver-${process.pid}.cjs`);
const SHAPE_DRIVER = path.join(ROOT, `.inline-exec-shape-${process.pid}.cjs`);
const made = [];
let SEQ = 0;

function run(cap) {
  const tag = cap + '-' + (++SEQ);
  const file = dbOf(tag);
  made.push(file);
  const out = runDriver(DRIVER, [String(cap), file], { timeout: 180000, payloadRe: /^OUT /m });
  const line = out.trim().split('\n').filter((l) => l.startsWith('OUT ')).pop();
  assert.ok(line, `子进程没打印结果（cap=${cap}）：\n${out}`);
  return JSON.parse(line.slice(4));
}

before(() => {
  fs.writeFileSync(DRIVER, `
process.env.TURSO_DATABASE_URL = 'file:' + process.argv[3];
process.env.TURSO_AUTH_TOKEN = '';
process.env.AGNES_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
globalThis.fetch = async () => { throw new Error('inline-exec 用例不应有真实网络调用'); };
const { createClient } = require('@libsql/client');
const ROOT = ${JSON.stringify(ROOT)};
const CAP = process.argv[2];
// 时钟只在"触发门槛"这一处造假：兜底分支要 北京 hour>=1，卡在 00:xx 跑会整条判据哑掉。
// 日报窗口本身用**真** dailyReportWindowIso() 算，种进去的行才落在真窗口里。
const tw = require(ROOT + '/lib/time-window.js');
const realWindow = tw.dailyReportWindowIso.bind(tw);
const realNow = Date.now;
tw.beijingNow = () => { const d = new Date(realNow()); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9, 0, 0)); };
const handler = require(ROOT + '/api/[...slug].js');

(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL });
  await db.executeMultiple(\`
    CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE sources(id INTEGER PRIMARY KEY, name TEXT, type TEXT, enabled INTEGER, spotlight INTEGER DEFAULT 0, extra TEXT, avatar TEXT);
    CREATE TABLE articles(id INTEGER PRIMARY KEY, source_id INTEGER, title TEXT, url TEXT, summary TEXT,
                          published_at TEXT, score REAL, cover TEXT, translated_title TEXT, content_html TEXT);
    CREATE TABLE videos(id INTEGER PRIMARY KEY, source_id INTEGER, title TEXT, url TEXT, cover TEXT,
                        published_at TEXT, intro TEXT, duration INTEGER, score REAL);
    CREATE TABLE daily_reports(id INTEGER PRIMARY KEY AUTOINCREMENT, generated_at TEXT, window_hours INTEGER, stats TEXT, sections TEXT);
  \`);
  const { startIso, endIso } = realWindow();
  const mid = new Date((Date.parse(startIso) + Date.parse(endIso)) / 2).toISOString();
  // 时间戳必须**分层**：大源更新、小源稍旧。全部并列时 ORDER BY published_at DESC 的次序不确定，
  // 限量臂与不限量臂会取到同一批源 → 对照组白做（09-24 第一次写就踩了这个：两臂 keptSources 都是 250）。
  const newT = new Date(Date.parse(endIso) - 3600e3).toISOString();
  const oldT = new Date(Date.parse(startIso) + 3600e3).toISOString();
  // 池 = 6 大源 × 250 + 400 小源 × 2 = 2,300 篇 / 406 源；Σmin(n,2) = 12 + 800 = 812 > 500 → 两臂都填得满 500 坑。
  // 总数故意**不等于**旧常数 2000：等于的话"池没被截断"与"池被截在 2000"两种世界读起来一样（判据歧义）。
  void mid;
  // 幂等种子：每次 run 都建**新库文件**（见测试侧的 tag 计数），这里仍显式清空以防被复用
  await db.executeMultiple('DELETE FROM articles; DELETE FROM sources; DELETE FROM daily_reports; DELETE FROM settings;');
  const put = (k, v) => db.execute({ sql: 'INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', args: [k, v] });
  await put('ai', JSON.stringify({ apiKey: 'local-fake-key', model: 'stub', dailyMinScore: 30 }));
  await put('prescreen.perSourceCap', CAP);
  await put('daily', JSON.stringify({ articleSourceIds: [] }));

  // 6 个大源 × 200 篇 + 300 个小源 × 1 篇 = 1,500 篇（< 6000，所以宽池读不再截断；> 旧值 2000 会截）
  let id = 1;
  const seed = [];
  for (let s = 1; s <= 6; s++) {
    seed.push({ sql: 'INSERT INTO sources(id,name,type,enabled,spotlight,extra) VALUES(?,?,?,?,0,\\'{}\\')', args: [s, 'BIG-' + s, 'rss', 1] });
    for (let i = 0; i < 250; i++) seed.push({
      sql: 'INSERT INTO articles(id,source_id,title,url,summary,published_at,score,cover,translated_title,content_html) VALUES(?,?,?,?,?,?,?,?,NULL,NULL)',
      args: [id++, s, 'BIG-' + s + ' 标题 ' + i + ' 够长够真实', 'https://ex.test/big' + s + '-' + i, '摘要文本', newT, 80],
    });
  }
  for (let s = 100; s < 500; s++) {
    seed.push({ sql: 'INSERT INTO sources(id,name,type,enabled,spotlight,extra) VALUES(?,?,?,?,0,\\'{}\\')', args: [s, 'SMALL-' + s, 'rss', 1] });
    for (let i = 0; i < 2; i++) seed.push({
      sql: 'INSERT INTO articles(id,source_id,title,url,summary,published_at,score,cover,translated_title,content_html) VALUES(?,?,?,?,?,?,?,?,NULL,NULL)',
      args: [id++, s, 'SMALL-' + s + ' 单篇标题够长 ' + i, 'https://ex.test/small' + s + '-' + i, '摘要文本', oldT, 80],
    });
  }
  for (const s of seed) await db.execute(s); // 本仓的 @libsql/client 没有 executeBatch（实测 TypeError），逐条写

  let status = 0, body = null;
  const res = {
    setHeader() { return this; },
    status(c) { status = c; return this; },
    json(j) { body = j; return this; },
    send(j) { body = j; return this; },
    end() { return this; },
  };
  await handler({ method: 'GET', url: '/api/daily', query: {}, headers: {}, on() {}, resume() {} }, res);
  const rep = (body && body.report) || {};
  const st = rep.stats || {};
  const ps = st.prescreen || {};
  const rows = await db.execute('SELECT COUNT(*) c FROM daily_reports');
  const diag = await db.execute('SELECT COUNT(*) a, COUNT(DISTINCT source_id) s FROM articles');
  const diagSrc = await db.execute("SELECT COUNT(*) c FROM sources WHERE enabled=1 AND type IN ('wechat','rss','x')");
  console.log('OUT ' + JSON.stringify({
    diagArticles: Number(diag.rows[0].a), diagSources: Number(diag.rows[0].s), diagSrcOk: Number(diagSrc.rows[0].c),
    cap: Number(CAP), status, ps: { cap: ps.cap, pool: ps.pool, poolSources: ps.poolSources, kept: ps.kept, keptSources: ps.keptSources },
    candidates: st.candidates, gateDropped: st.gateDropped, schemaVersion: st.schemaVersion,
    sections: (rep.sections || []).length, items: (rep.sections || []).reduce((n, x) => n + (x.items || []).length, 0),
    rowsWritten: Number(rows.rows[0].c), generated_at: rep.generated_at || null,
  }));
  process.exitCode = 0;
})().catch((e) => { console.error('DRIVER-FATAL', (e && e.stack) || e); process.exitCode = 3; });
`);
  // I4 的驱动：同一份表结构，只种 12 篇（快），然后把读层 catch-all 的**四条早报分支**各调一次。
  fs.writeFileSync(SHAPE_DRIVER, `
process.env.TURSO_DATABASE_URL = 'file:' + process.argv[2];
process.env.TURSO_AUTH_TOKEN = '';
process.env.AGNES_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
globalThis.fetch = async () => { throw new Error('shape 用例不应有真实网络调用'); };
const { createClient } = require('@libsql/client');
const jwt = require('jsonwebtoken');
const ROOT = ${JSON.stringify(ROOT)};
const tw = require(ROOT + '/lib/time-window.js');
const realNow = Date.now;
let FAKE_HOUR = 9;
tw.beijingNow = () => { const d = new Date(realNow()); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), FAKE_HOUR, 0, 0)); };
const handler = require(ROOT + '/api/[...slug].js');
const DDL = 'CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);'
  + 'CREATE TABLE sources(id INTEGER PRIMARY KEY, name TEXT, type TEXT, enabled INTEGER, spotlight INTEGER DEFAULT 0, extra TEXT, avatar TEXT);'
  + 'CREATE TABLE articles(id INTEGER PRIMARY KEY, source_id INTEGER, title TEXT, url TEXT, summary TEXT, published_at TEXT, score REAL, cover TEXT, translated_title TEXT, content_html TEXT);'
  + 'CREATE TABLE videos(id INTEGER PRIMARY KEY, source_id INTEGER, title TEXT, url TEXT, cover TEXT, published_at TEXT, intro TEXT, duration INTEGER, score REAL);'
  + 'CREATE TABLE daily_reports(id INTEGER PRIMARY KEY AUTOINCREMENT, generated_at TEXT, window_hours INTEGER, stats TEXT, sections TEXT);';
(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL });
  await db.executeMultiple(DDL);
  const win = tw.dailyReportWindowIso.call(tw);
  const mid = new Date((Date.parse(win.startIso) + Date.parse(win.endIso)) / 2).toISOString();
  await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('ai',?)", args: [JSON.stringify({ apiKey: 'local-fake-key', model: 'stub', dailyMinScore: 30 })] });
  await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('daily',?)", args: [JSON.stringify({ articleSourceIds: [] })] });
  await db.execute({ sql: "INSERT OR REPLACE INTO settings(key,value) VALUES('prescreen.perSourceCap','2')" });
  let id = 1;
  for (let s = 1; s <= 3; s++) {
    await db.execute({ sql: "INSERT INTO sources(id,name,type,enabled,spotlight,extra) VALUES(?,?,?,?,0,'{}')", args: [s, 'SHAPE-' + s, 'rss', 1] });
    for (let i = 0; i < 4; i++) {
      await db.execute({ sql: 'INSERT INTO articles(id,source_id,title,url,summary,published_at,score) VALUES(?,?,?,?,?,?,?)',
        args: [id++, s, 'SHAPE 标题 ' + s + '-' + i + ' 够长够真实', 'https://ex.test/' + s + '-' + i, '摘要文本', mid, 80] });
    }
  }
  const call = async (method, url, headers) => {
    let status = 0, body = null;
    const res = { setHeader() { return this; }, status(c) { status = c; return this; }, json(j) { body = j; return this; }, send(j) { body = j; return this; }, end() { return this; } };
    await handler(Object.assign({ method, url, query: {}, headers: headers || {}, on() {}, resume() {} }, {}), res);
    return { status, body };
  };
  const shape = (r) => {
    const rep = (r.body && r.body.report) || {};
    return { status: r.status, hasReport: !!(r.body && r.body.report), keys: Object.keys(rep),
      theme: rep.theme, schemaVersion: rep.schemaVersion, degraded: rep.degraded, stale: r.body && r.body.stale,
      autoGenerated: r.body && r.body.autoGenerated };
  };
  const out = { diagArticles: 0, autoGenerated: {}, fresh: {}, stale: {}, regenerate: {} };
  // A 空表 + 北京 9 点 ⇒ 走"现场生成"兜底分支
  out.autoGenerated = shape(await call('GET', '/api/daily'));
  // B 库里已有"今天"的一份 AI 档（stats 带 theme/degraded）⇒ 走新鲜分支
  await db.execute({ sql: 'DELETE FROM daily_reports' });
  const seededStats = JSON.stringify({ schemaVersion: 2, theme: '测试导语', degraded: true, candidates: 12, articles: 12, sections: 3, totalItems: 12 });
  await db.execute({ sql: 'INSERT INTO daily_reports(generated_at,window_hours,stats,sections) VALUES(?,?,?,?)',
    args: [new Date(realNow()).toISOString(), 30, seededStats, '[]'] });
  out.fresh = shape(await call('GET', '/api/daily'));
  // C 同一份行但 generated_at 挪到 2020 ⇒ 不是今天、也不是"够新的 AI 档"；再把时钟挪到北京 0 点，
  //    否则 hour>=1 会先去现场生成，过期分支永远够不着（这就是它漏字段 6 天没人发现的原因）
  await db.execute({ sql: 'UPDATE daily_reports SET generated_at = ?', args: ['2020-01-01T00:00:00.000Z'] });
  FAKE_HOUR = 0;
  out.stale = shape(await call('GET', '/api/daily'));
  // D 手动重算（POST，要带 JWT；临时库上 DELETE+重建，零生产写）
  FAKE_HOUR = 9;
  out.regenerate = shape(await call('POST', '/api/daily/regenerate', { authorization: 'Bearer ' + jwt.sign({}, process.env.AUTH_SECRET || 'dev-secret') }));
  out.diagArticles = Number((await db.execute('SELECT COUNT(*) a FROM articles')).rows[0].a);
  console.log('OUT ' + JSON.stringify(out));
  process.exitCode = 0;
})().catch((e) => { console.error('DRIVER-FATAL', (e && e.stack) || e); process.exitCode = 3; });
`);
});

after(() => {
  try { fs.rmSync(DRIVER, { force: true }); } catch { /* 尽力清理 */ }
  try { fs.rmSync(SHAPE_DRIVER, { force: true }); } catch { /* 尽力清理 */ }
  for (const f of made) { try { fs.rmSync(f, { force: true }); } catch { /* 尽力清理 */ } }
});

test('I1 内联兜底真跑通：公开 GET /api/daily 生成并落库一行，stats.prescreen 齐形', () => {
  const r = run(2);
  assert.equal(r.status, 200, `handler 返回 ${r.status} —— 内联生成器根本没跑起来`);
  assert.equal(r.rowsWritten, 1, '应当恰好写进一行（临时库，不是生产库）');
  assert.equal(r.ps.cap, 2, 'settings 里的 prescreen.perSourceCap 要真被读到');
  assert.equal(r.ps.pool, 2300, `宽池读应取到全量 2,300 行；实得 ${r.ps.pool} —— 池读又被截断了（旧常数 2000 会正好少 300 行）`);
  assert.equal(r.ps.poolSources, 406, `全池源数应为 6 大 + 400 小 = 406；实得 ${r.ps.poolSources} —— 全量读数 ${JSON.stringify(r)}`);
  assert.ok(r.items > 0 && r.sections > 0, '没出栏没出条目 = 这份生成器等于没跑');
  assert.notEqual(r.gateDropped, undefined, 'stats.gateDropped 必须落库（H23 的同一条口径）');
});

test('I2 因果证明：同一份数据、同样 500 个坑，配额换来的源覆盖必须显著抬高', () => {
  // 这是"级3 换覆盖"这句话在**读层这份代码**上的执行证明（P3 只在纯函数上证过一次）。
  const q = run(2);    // 每源 ≤2
  const nq = run(100); // 实际上等于不限量（每源最多 200 篇）
  assert.equal(q.ps.kept, 500, '配额后仍应填满 500 个坑 —— 坑数不是这次改动的对象');
  assert.equal(nq.ps.kept, 500, '对照组同样 500 个坑，唯一变量是 cap');
  assert.ok(q.ps.keptSources > nq.ps.keptSources * 3,
    `配额覆盖 ${q.ps.keptSources} 源，不限量 ${nq.ps.keptSources} 源 —— 不足 3 倍说明这一份里级3 没生效`);
});

test('I3 零生产写：这份用例不许碰到真 Turso / 真模型', () => {
  // 判据是"驱动里的 fetch 被打死 + URL 是 file:"，两条都在驱动文本里；此锁防的是将来有人把它改成打生产。
  const src = fs.readFileSync(DRIVER, 'utf8');
  assert.match(src, /TURSO_DATABASE_URL = 'file:'/, '驱动必须绑 file: 临时库');
  assert.match(src, /globalThis\.fetch = async \(\) => \{ throw/, '真 fetch 必须打死');
  assert.doesNotMatch(src, /vercel\.app|turso\.io/, '驱动里出现云端点 = 测试在打生产');
});

// ── I4：读层早报**四条返回分支**的执行级同形证明（09-24 夜，补 T6 那条静态窗口判据的空洞）──
// 为什么：T6 只看源码里 `report: {` 后 700 个字符有没有 `theme:` —— 注释里写一句 `theme:` 就能满足，
// 而字段真值取错来源（比如从 `row` 而不是 `stats`）它照样绿。用户 09-24 的原话是要"功能正式可用"，
// 所以这一条直接在 file: 临时库上把四条分支各跑一遍，断言**响应体里真的带着三个键、且值来自 stats**。
function runShape() {
  const tag = 'shape-' + (++SEQ);
  const file = dbOf(tag);
  made.push(file);
  const out = runDriver(SHAPE_DRIVER, [file], { timeout: 180000, payloadRe: /^OUT /m });
  const line = out.trim().split('\n').filter((l) => l.startsWith('OUT ')).pop();
  assert.ok(line, `shape 驱动没打印结果：\n${out}`);
  return JSON.parse(line.slice(4));
}
const NEED = ['theme', 'schemaVersion', 'degraded'];

test('I4 四条分支（自动生成/新鲜/过期/手动重算）响应体都带 theme+schemaVersion+degraded', () => {
  const r = runShape();
  assert.equal(r.diagArticles, 12, `种子数据没到位（articles=${r.diagArticles}）`);
  for (const k of ['autoGenerated', 'fresh', 'stale', 'regenerate']) {
    const b = r[k] || {};
    assert.equal(b.status, 200, `${k} 分支 HTTP=${b.status}（分支根本没跑到，判据会空转）`);
    assert.ok(b.hasReport, `${k} 分支没有 report 体`);
    for (const key of NEED) assert.ok(b.keys.includes(key), `${k} 分支的 report 缺键 ${key} —— 走这条分支的读者看不到导语/档位`);
  }
  // 值必须真从 stats 里来（不是"键在但永远是 null"）
  assert.equal(r.fresh.theme, '测试导语', '新鲜分支的 theme 没取到 stats.theme ⇒ 判据只证明了"键存在"');
  assert.equal(r.fresh.schemaVersion, 2, '新鲜分支没把 stats.schemaVersion 透出来');
  assert.equal(r.fresh.degraded, true, '新鲜分支的 degraded 没透出来（前端靠它标降级）');
  assert.equal(r.stale.stale, true, '过期分支没标 stale');
  assert.equal(r.stale.theme, '测试导语', '过期分支漏导语 —— 这正是 09-24 审查抓出的那一条');
  // 内联生成的是关键词档：theme 必须显式为 null（不是缺键）
  assert.equal(r.autoGenerated.theme, null, '自动生成分支的 theme 要显式 null');
  assert.equal(r.autoGenerated.schemaVersion, 1, '内联兜底是关键词档 ⇒ schemaVersion 应为 1');
  assert.equal(r.regenerate.schemaVersion, 1, '手动重算也走内联生成器');
});
