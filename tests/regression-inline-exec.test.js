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
const SHAPE_DRIVER = path.join(ROOT, `.inline-exec-shape-driver-${process.pid}.cjs`);
// 文件名必须落在 `.gitignore` 的 `.*-driver-*.cjs` 里（09-24 第四轮审查抓出：上一版叫
// `.inline-exec-shape-<pid>.cjs`，不匹配 → 跑一次就在仓库根留一个未忽略未跟踪的残留文件）。
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
    const st = rep.stats || {};
    // consistent：三个顶层字段必须等于同一份响应里 stats 的真值（缺键按 null/1/false 归一）——
    // 这一条专抓"键在但值取错来源"和"写死 null"，形态判据对这两类是瞎的。
    const consistent = rep.theme === (st.theme ?? null)
      && rep.schemaVersion === (st.schemaVersion ?? 1)
      && rep.degraded === !!st.degraded;
    return { status: r.status, hasReport: !!(r.body && r.body.report), keys: Object.keys(rep), consistent,
      theme: rep.theme, schemaVersion: rep.schemaVersion, degraded: rep.degraded, stale: r.body && r.body.stale,
      autoGenerated: r.body && r.body.autoGenerated };
  };
  const out = { diagArticles: 0, autoGenerated: {}, fresh: {}, stale: {}, regenerate: {}, dailyGenerate: {}, dailyGenerateForbidden: {} };
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
  // E 部署面**第 5 处**：另一个文件、另一个 handler —— POST /api/daily-generate 的写入回执。
  //   第四轮审查点出这一处"只有形态锁、没有执行锁"，所以这里也真跑一遍；同时带一次错 key 的反例，
  //   证明这支不是"悄悄 403 然后被 status===200 判成没跑到"。
  const gen = require(ROOT + '/api/daily-generate.js');
  process.env.COLLECT_KEY = 'shape-test-key';
  const gcall = async (key) => {
    let status = 0, body = null;
    const res = { setHeader() { return this; }, status(c) { status = c; return this; }, json(j) { body = j; return this; }, send(j) { body = j; return this; }, end() { return this; } };
    await gen({ method: 'POST', url: '/api/daily-generate', query: { key }, headers: {}, on() {}, resume() {} }, res);
    return { status, body };
  };
  out.dailyGenerate = shape(await gcall('shape-test-key'));
  out.dailyGenerateForbidden = shape(await gcall('wrong-key'));
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

test('I3 零生产写：两份驱动都不许碰到真 Turso / 真模型', () => {
  // 判据是"驱动里的 fetch 被打死 + URL 是 file:"，两条都在驱动文本里；此锁防的是将来有人把它改成打生产。
  // 09-24 第四轮审查抓出：上一版只读 `DRIVER`，新加的 shape 驱动整条落在守卫之外 ⇒ 两份都要扫。
  for (const [tag, file] of [['I1~I3 驱动', DRIVER], ['I4 驱动', SHAPE_DRIVER]]) {
    const src = fs.readFileSync(file, 'utf8');
    assert.match(src, /TURSO_DATABASE_URL = 'file:'/, `${tag}：驱动必须绑 file: 临时库`);
    assert.match(src, /globalThis\.fetch = async \(\) => \{ throw/, `${tag}：真 fetch 必须打死`);
    assert.doesNotMatch(src, /vercel\.app|turso\.io/, `${tag}：驱动里出现云端点 = 测试在打生产`);
  }
});

// ── I4：读层早报**五条返回分支**的执行级同形证明（09-24 夜，补 T6 形态判据抓不到的那一半）──
// 为什么：T6 走"括号配平 + 只认顶层键"，但形态判据原理上仍抓不到两类（第四轮审查实测）：
//   ① 值取错来源（`theme: stats.themeX` —— 键在、值永远没有）；② 条件展开 `...(c ? {} : { theme… })` 里那一支。
//   所以这里在 `file:` 临时库上把五条分支各真跑一遍，除了"三个键都在"，还要求三个字段
//   **与同一份响应里的 `stats` 逐字段自洽**（`consistent`）。
// ⚠️ `consistent` 的效力边界（09-24 自己 F2P 出来的，别读成"写死也蒙不过去"）：
//   新鲜/过期两支的 stats 有真值（`theme:'测试导语' / sv:2 / degraded:true`）⇒ 这一条在那两臂**有牙**；
//   自动生成/手动重算/生成器回执三支走的是关键词档，stats 里本来就没有 theme ⇒
//   把响应写成死值 `theme: null` **仍然自洽**（实测：改掉第 5 处 → I4 仍绿）。这三臂只能证明"键在、档位是 1"，
//   不能证明"值会跟着 stats 走"。要真出证据得让内联生成器产出非默认 stats，而那要模型调用 —— 本用例打死 fetch，不做。
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
const ARMS = ['autoGenerated', 'fresh', 'stale', 'regenerate', 'dailyGenerate'];

test('I4 五条分支（自动生成/新鲜/过期/手动重算/生成器回执）响应体都带且只带自洽的 theme+schemaVersion+degraded', () => {
  const r = runShape();
  assert.equal(r.diagArticles, 12, `种子数据没到位（articles=${r.diagArticles}）`);
  for (const k of ARMS) {
    const b = r[k] || {};
    assert.equal(b.status, 200, `${k} 分支 HTTP=${b.status}（分支根本没跑到，判据会空转）`);
    assert.ok(b.hasReport, `${k} 分支没有 report 体`);
    for (const key of NEED) assert.ok(b.keys.includes(key), `${k} 分支的 report 缺键 ${key} —— 走这条分支的读者看不到导语/档位`);
    // 自洽：三个顶层字段必须等于同一份响应里 stats 的真值（缺键按 null/1/false 算）
    assert.equal(b.consistent, true, `${k} 分支的 theme/schemaVersion/degraded 与自身 stats 不自洽 ⇒ 值不是从 stats 来的（形态判据抓不到这一类）`);
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
  assert.equal(r.dailyGenerate.schemaVersion, 1, '生成器回执（POST /api/daily-generate）同样是关键词档');
  // 反例：错 key 必须 403 且没有 report —— 否则上面那句"200 且有 report"可能只是撞对了路由
  assert.equal(r.dailyGenerateForbidden.status, 403, '错 key 竟然没被拒 ⇒ E 臂的 200 不证明走到了生成逻辑');
  assert.equal(r.dailyGenerateForbidden.hasReport, false, '403 响应里不该有 report');
});
