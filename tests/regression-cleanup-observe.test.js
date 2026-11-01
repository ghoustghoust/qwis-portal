// B101 观测轮的回归锁：待删量读数必须与删除用的是同一份谓词，且删除闸是**强制路径**。
//
// 为什么这一批非配锁不可（不是流程洁癖）：09-20T22:27Z 有一轮 cleanup 真跑掉了 ——
// 心跳里写着热榜删 26,532 + 保留删 24,291 = 50,823 条，而当时的"待删量"是我半小时前手工算的 50,636。
// 两者对得上，但**没有任何代码保证它们一直对得上**：读数是抄的 SQL 就一定会漂（坑 #58/#62 的方向）。
// 更要紧的是那一轮删除**没有过删除闸**（闸当时只是"可用工具"，B103 的剩余项）。
// 所以这里钉三件事：①读数 == 真删掉的条数；②没有可用转储就一条都不许删且必须出声；
// ③历史按天去重（14 条历史 = 14 天趋势，去重失效就退化成当天的抖动）。
//
// 2026-11-01 烧速两刀改锁说明（用户拍板"砍掉每批白烧统计"）：保留读数的唯一入口从
// "collect/translate 等每个批次收尾各刷一遍（≈192 次 COUNT/天，reads 烧速真凶）"改为
// "每日 cleanup 一次（正常档 2 条 COUNT，删后复刷 2 条；≥light 档读数+DELETE 一起让路）"。
// CO4 的场景随之从 daily 批换成 cleanup 批，并新增两段：批次收尾不得再刷读数（防白烧统计
// 回潮）、CO6 钉 light 档"不删只记账"与恢复后自动补跑的联动。去重与封顶的断言原样保留。
//
// 形态说明：全部在**本地 libsql 文件库**上跑（`TURSO_DATABASE_URL='file:'`，零生产写，坑 #52/#64），
// 且用 `execFileSync` 直接跑 `tools/collect-turso.js`，**不落根目录 scratch 驱动**
// （B105 那一族"根目录临时驱动 + 退出阶段 0xC0000005"的成因就是驱动文件本身）。
'use strict';
require('./helpers'); // 先于任何 server/*：临时 APP_DATA_DIR，绝不碰 data/app.db
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFileSync } = require('child_process');
const { createClient } = require('@libsql/client');

const ROOT = path.join(__dirname, '..');
const OLD = '2026-01-01T00:00:00.000Z';   // 稳稳落在 7 天窗口之外
const NEW = new Date(Date.now() + 0).toISOString();

// 惰性取（坑 #64/#67）：基线树里还没有 lib/retention#pendingPlan 时要让**用例**各自红
const RT = () => require('../lib/retention');
const CD = () => require('../lib/content-dump');

function tmp(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), tag)); }
function fileUrl(dir) { return 'file:' + path.join(dir, 't.db').replace(/\\/g, '/'); }

// 造一份最小库：1 个热榜源 + 1 个普通源，7 条命中删除谓词（热榜 3 / 普通 4）+ 3 条豁免
async function seed(url) {
  const db = createClient({ url });
  await db.execute('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)');
  await db.execute(`CREATE TABLE IF NOT EXISTS sources(id INTEGER PRIMARY KEY, name TEXT, type TEXT,
    extra TEXT, enabled INTEGER DEFAULT 1, status TEXT, fail_count INTEGER DEFAULT 0,
    last_fetched_at TEXT, next_fetch_at TEXT, muted INTEGER DEFAULT 0, reader_visible INTEGER DEFAULT 1, focus INTEGER DEFAULT 0)`);
  await db.execute('DELETE FROM sources');
  await db.execute("INSERT INTO sources(id,name,type) VALUES(1,'热榜源','hotlist'),(2,'普通源','rss')");
  return db;
}
async function seedArticles(db, n) {
  await db.execute('CREATE TABLE IF NOT EXISTS articles(id INTEGER PRIMARY KEY, source_id INTEGER, title TEXT, url TEXT, content_html TEXT, summary TEXT, published_at TEXT, created_at TEXT, read_at TEXT, later INTEGER DEFAULT 0, featured INTEGER DEFAULT 0, score INTEGER DEFAULT 0, tags TEXT, extra TEXT)');
  await db.execute('DELETE FROM articles');
  for (let i = 1; i <= n; i++) {
    await db.execute({
      sql: 'INSERT INTO articles(id,source_id,title,url,published_at,created_at,read_at,later,featured) VALUES(?,?,?,?,?,?,?,?,?)',
      args: [i, i % 2 === 1 ? 1 : 2, `t${i}`, `u${i}`, OLD, OLD, null, 0, 0],
    });
  }
  // 三条豁免：已读 / 稍后读 / 精选
  for (const [id, col] of [[21, 'read_at'], [22, 'later'], [23, 'featured']]) {
    const args = [id, 2, `t${id}`, `u${id}`, OLD, OLD];
    await db.execute({
      sql: col === 'read_at'
        ? 'INSERT INTO articles(id,source_id,title,url,published_at,created_at,read_at,later,featured) VALUES(?,?,?,?,?,?,?,?,?)'
        : 'INSERT INTO articles(id,source_id,title,url,published_at,created_at,read_at,later,featured) VALUES(?,?,?,?,?,?,?,?,?)',
      args: col === 'read_at' ? [...args.slice(0, 6), NEW, 0, 0]
        : col === 'later' ? [...args.slice(0, 6), null, 1, 0]
          : [...args.slice(0, 6), null, 0, 1],
    });
  }
  // 一条窗口内的新文章（id 24）
  await db.execute({
    sql: 'INSERT INTO articles(id,source_id,title,url,published_at,created_at,read_at,later,featured) VALUES(?,?,?,?,?,?,?,?,?)',
    args: [24, 2, 't24', 'u24', NEW, NEW, null, 0, 0],
  });
}
function runRunner(mode, env) {
  const e = { ...process.env, ...env };
  delete e.NODE_TEST_CONTEXT;               // 嵌套 node 不删这个会被**静默跳过**（坑 #53 同族）
  e.TURSO_AUTH_TOKEN = '';
  try {
    return { out: execFileSync(process.execPath, [path.join(ROOT, 'tools', 'collect-turso.js'), mode],
      { cwd: ROOT, encoding: 'utf8', env: e, timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 };
  } catch (err) {
    return { out: `${err.stdout || ''}\n${err.stderr || ''}`, code: err.status === undefined ? -1 : err.status };
  }
}
const readSetting = async (db, key) => {
  const rows = Array.from((await db.execute({ sql: 'SELECT value FROM settings WHERE key=?', args: [key] })).rows);
  if (!rows[0]) return null;
  try { return JSON.parse(rows[0].value); } catch { return null; }
};
const countArticles = async (db) => Number(Array.from((await db.execute('SELECT COUNT(*) c FROM articles')).rows)[0].c);

// 一份**能通过校验**的最小转储：两张表各 1 片，清单自洽（sha/行数/id 区间/字节数都由 writeChunk 的返回拼）
function makeDump(dir, tables) {
  const cd = CD();
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    schemaVersion: cd.SCHEMA_VERSION, scope: 'cloud', sourceKind: 'libsql',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tables: {},
  };
  for (const [table, rows] of Object.entries(tables)) {
    const columns = Object.keys(rows[0]);
    const rec = cd.writeChunk(dir, table, 1, rows);
    manifest.tables[table] = {
      rows: rec.rows, maxId: rec.idMax, bytes: rec.bytes, columns, chunks: [rec],
    };
  }
  cd.writeManifest(dir, manifest);
  return dir;
}
const dumpOf = (n) => ({
  articles: Array.from({ length: n }, (_, i) => ({ id: i + 1, title: 't' + (i + 1), published_at: OLD, content_html: 'x' })),
  videos: [{ id: 1, title: 'v1', published_at: OLD }],
});

test('CO1 读数说的是真话：pendingPlan 算出的条数 == 真删掉的条数（逐键对账）', async () => {
  const dir = tmp('b101-co1-');
  try {
    const url = fileUrl(dir);
    const db = await seed(url);
    await seedArticles(db, 20);
    const plan = RT().pendingPlan('runner', 7);
    assert.deepEqual(plan.map((p) => p.key), ['hotlist', 'retention'], 'runner 作用域的删除键集变了（读数面也跟着变，先看 spec43 D1）');
    const before = {};
    for (const p of plan) before[p.key] = Number(Array.from((await db.execute({ sql: p.sql, args: [p.cutoff] })).rows)[0].c);
    assert.deepEqual(before, { hotlist: 10, retention: 10 }, `夹具不符合预期：${JSON.stringify(before)}`);
    for (const p of plan) {
      const r = await db.execute({ sql: RT().deleteSql('runner', p.key), args: [p.cutoff] });
      assert.equal(r.rowsAffected, before[p.key], `${p.key}：计数说 ${before[p.key]} 条，真删了 ${r.rowsAffected} 条 —— 谓词已经漂了`);
    }
    assert.equal(await countArticles(db), 4, '删完应只剩 3 条豁免 + 1 条窗口内');
    await db.close();
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows 句柄 */ } }
});

test('CO3 反向（#72）：转储可用时必须真能放行，且实删数 == 读数（闸不许恒挡，也不许多删）', async () => {
  const dir = tmp('b101-co3-');
  try {
    const url = fileUrl(dir);
    const db = await seed(url);
    await seedArticles(db, 20);
    const dumpDir = path.join(dir, 'dump');
    makeDump(dumpDir, dumpOf(24));
    const r = runRunner('cleanup', { TURSO_DATABASE_URL: url, CONTENT_DUMP_DIR: dumpDir });
    assert.match(r.out, /保留读数: 7 天窗口下待删 20 条/, `改前读数没打出来（或算错）：${r.out.slice(0, 400)}`);
    assert.match(r.out, /清理完成: 删除 10 条热榜旧数据/, `热榜分支没按读数删：${r.out.slice(0, 400)}`);
    const row = await readSetting(db, 'retention.pending');
    assert.equal(row.gate.allowed, true, `有可用转储却被挡：${row.gate.reason}`);
    assert.equal(row.total, 0, `闸放行、删完之后重算的待删量应为 0，实得 ${row.total}`);
    assert.equal(await countArticles(db), 4);
    const hb = await readSetting(db, 'cloud.collect');
    assert.equal(hb.history[hb.history.length - 1].stats.blocked, null, '放行的一轮不该带 blocked');
    await db.close();
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows 句柄 */ } }
});

test('CO4 读数唯一入口=每日 cleanup（11-01 拍板：批次收尾白烧统计已砍）；历史按天去重且封顶 14 条', async () => {
  const dir = tmp('b101-co4-');
  try {
    const url = fileUrl(dir);
    const db = await seed(url);
    await seedArticles(db, 0);
    const dumpDir = path.join(dir, 'dump');
    makeDump(dumpDir, dumpOf(1));
    // ① 批次收尾不得再刷读数（防白烧统计回潮）：daily 批跑完，retention.pending 必须不存在
    runRunner('daily', { TURSO_DATABASE_URL: url, CONTENT_DUMP_DIR: dumpDir });
    assert.equal(await readSetting(db, 'retention.pending'), null,
      'daily 批不该再写保留读数（11-01 拍板砍掉批次收尾统计，若此红 = 白烧统计回潮）');
    // ② 唯一入口挂 cleanup，历史按天去重：同一天连跑三遍也只攒 1 条
    const counts = [];
    for (let i = 0; i < 3; i++) {
      runRunner('cleanup', { TURSO_DATABASE_URL: url, CONTENT_DUMP_DIR: dumpDir });
      const row = await readSetting(db, 'retention.pending');
      counts.push(row ? row.history.length : -1);
    }
    assert.ok(counts.every((c) => c === 1), `cleanup 同一天跑了三遍，历史却攒了 ${JSON.stringify(counts)} 条 —— 按天去重失效`);
    // 手工把历史灌满，验封顶：写入 20 条旧记录后刷新，应留 14 条
    await db.execute({
      sql: 'INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)',
      args: ['retention.pending', JSON.stringify({
        at: NEW, scope: 'runner', retentionDays: 7, total: 1, counts: { hotlist: 1 },
        gate: { allowed: false, reason: 'x' },
        history: Array.from({ length: 20 }, (_, k) => ({ at: `2026-0${(k % 8) + 1}-0${k % 8}T00:00:00.000Z`, total: k, counts: {}, gateAllowed: false })),
      })],
    });
    runRunner('cleanup', { TURSO_DATABASE_URL: url, CONTENT_DUMP_DIR: dumpDir });
    const row = await readSetting(db, 'retention.pending');
    // cleanup 一轮内跑 pre+判闸两遍写库（scan 复用只省 COUNT 不省写），同天第二遍走 replace
    // 不再 push —— 所以这里钉的是语义边界（today 恰好一条 + 总数不超 14），不钉脆弱的逐遍计数
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(row.history.filter((h) => String(h.at).slice(0, 10) === today).length, 1,
      `同天多遍写库后 today 条应有且仅有 1 条，实得 ${row.history.filter((h) => String(h.at).slice(0, 10) === today).length} —— 按天去重失效`);
    assert.ok(row.history.length <= 14, `历史封顶失效：${row.history.length} 条`);
    await db.close();
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows 句柄 */ } }
});

// 11-01 烧速两刀（用户拍板）：light 档及以上时，清理读数与 DELETE 一起让路——当天只记账不删，
// 恢复 none/watch 后第一次 cleanup 自动补跑（cleanup 每天都跑，无需状态机）。
// 本地假 quota guard 端点（CLOUD_SITE 可 env 覆盖 + fetchQuotaGuard 走裸 fetch）让 runner 子进程
// 真走 quotaSkip 分支，不开任何生产后门。
test('CO6 额度联动：light 档读数+DELETE 一起让路只记账；恢复 none 后首次 cleanup 自动补跑', async () => {
  const dir = tmp('b101-co6-');
  try {
    const url = fileUrl(dir);
    const db = await seed(url);
    await seedArticles(db, 20);
    const dumpDir = path.join(dir, 'dump');
    makeDump(dumpDir, dumpOf(24));
    const srv = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, guard: { level: 'light', pctReads: 93, pctWrites: 91.5, pctStorage: 14, daysLeft: 3, dailyBurnM: 10.1 } }));
    });
    await new Promise((res) => srv.listen(0, '127.0.0.1', res));
    const port = srv.address().port;
    try {
      // ① light 轮：读数不重算、DELETE 不跑（联动），心跳记账 blocked=quota:light（面板可辨「有意让路」）
      const before = await countArticles(db);
      const r = runRunner('cleanup', {
        TURSO_DATABASE_URL: url, CONTENT_DUMP_DIR: dumpDir,
        CLOUD_SITE: `http://127.0.0.1:${port}`, COLLECT_KEY: 'test-key',
      });
      assert.match(r.out, /清理读数与 DELETE 今日让路/, `light 轮没走让路分支：${r.out.slice(0, 400)}`);
      assert.equal(await countArticles(db), before, 'light 轮真删了东西 —— 读数与 DELETE 没有联动让路');
      const hb = await readSetting(db, 'cloud.collect');
      assert.equal(hb.history[hb.history.length - 1].stats.blocked, 'quota:light',
        'light 轮没在心跳记账（面板将分不清「闸挡下」与「有意让路」）');
      // ② 恢复 none（不注入假端点 → COLLECT_KEY 缺失 → quota 读不到按正常档）：首轮 cleanup 自动补跑
      const r2 = runRunner('cleanup', { TURSO_DATABASE_URL: url, CONTENT_DUMP_DIR: dumpDir });
      assert.match(r2.out, /清理完成: 删除 10 条热榜旧数据/, `恢复后没补跑删除：${r2.out.slice(0, 400)}`);
      assert.equal(await countArticles(db), 4, '恢复后首轮该把 20 条夹具删到 4（3 条豁免 + 1 条窗口内）');
      const row = await readSetting(db, 'retention.pending');
      assert.equal(row.total, 0, '补跑后读数应反映删后真值 0（CO3 同款语义）');
    } finally { srv.close(); }
    await db.close();
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows 句柄 */ } }
});

test('CO5 判据不写空：pendingPlan 的 WHERE 与 deleteSql 逐字同源；读数缺失时命令不许编一个', async () => {
  const { whereFor, deleteSql, countSql, pendingPlan, HOTLIST_DAYS } = RT();
  for (const p of pendingPlan('runner', 7)) {
    const w = whereFor('runner', p.key);
    assert.ok(deleteSql('runner', p.key).endsWith(w), `${p.key} 的删除 SQL 不含同一份 WHERE`);
    assert.ok(countSql('runner', p.key).endsWith(w), `${p.key} 的计数 SQL 不含同一份 WHERE`);
    assert.match(p.sql, /^SELECT COUNT\(\*\) c FROM articles WHERE /, `${p.key} 的计数不是数同一张表`);
  }
  assert.equal(pendingPlan('runner', 7).find((p) => p.key === 'hotlist').days, HOTLIST_DAYS,
    '热榜轴的天数与 HOTLIST_DAYS 不同 = 读数与删除用的是两个窗口');
  assert.deepEqual(pendingPlan('runner', 0).map((p) => p.key), ['hotlist'],
    '保留天数 0（=不删）时读数里还留着 retention 一项 → 会报出一个永远不会被删的待删量');
  // 命令不许"编"出一个落库读数：给它一份没有 retention.pending 的本地文件库，它必须明说"无"
  const dir = tmp('b101-co5-');
  try {
    const url = fileUrl(dir);
    const db = await seed(url);
    await seedArticles(db, 0);
    await db.close();
    const e = { ...process.env, TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: '' };
    delete e.NODE_TEST_CONTEXT;
    const out = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'check-retention.cjs')],
      { cwd: ROOT, env: e, encoding: 'utf8', timeout: 120000 });
    assert.match(out, /落库读数：无/, `库里没有这条读数，命令却给出了读数：${out.slice(0, 400)}`);
    assert.match(out, /一次都没跑过 = 触发口是暗的/, `没读心跳就不许说触发口状态：${out.slice(0, 400)}`);
    assert.match(out, /合计\s+\d+ 条 = 全库的/, `现算部分没打总数与分母：${out.slice(0, 400)}`);
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows 句柄 */ } }
});
