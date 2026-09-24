// 级3 的**执行锁**（2026-09-24）—— 与 regression-prescreen.test.js 的 P1~P8 的区别：
// P 系列是纯函数锁与形态锁，这一份是「真把生产模式 daily-ai 跑一遍」。
//
// 为什么单独要有这一条（用户 2026-09-24 追问「你是不是绕过开发环境直接改云端」后查实）：
//   全仓此前**没有任何测试 spawn 过 tools/collect-turso.js**（碰 runner 的锁全是 readFileSync + 正则）。
//   于是 `runDailyAi` 改完后的第一次真实执行本来会是今晚 21:30 的生产批次 —— 那是拿线上当测试。
//   这条锁把第一次执行挪进隔离环境。
//
// 隔离边界（三条各有依据，都不碰生产）：
//   ① 数据库：TURSO_DATABASE_URL=file:<临时库>。脚本的 .env 加载是「只填空缺」
//      （`collect-turso.js:26` 的 `if (m && !process.env[m[1]])`），已设的非空值不会被真凭据回填；
//      `file:` 免 token（:77 的判据）。⚠️ 哑值必须**非空**：设成空串会被判成"没设"→ 被 .env 灌回真 key。
//   ② AI 出口：`settings.ai.apiBase` 指向本机桩服务；`_ai.js` 用全局 fetch，本仓无
//      `setGlobalDispatcher`（已核）→ 不经代理。
//   ③ 报警出口：`api/_alerts.js` 的通道配置读的是**库里的 settings**（:11 同一个连接），
//      临时库不塞 webhook = 无处可发；且本用例失败率 0、不截断，判据本身也不触发。
//
// 为什么桩必须是**另一个进程**（第一轮实现踩的坑，别再合并回本进程）：
//   跑产品脚本用的是 `runDriver`（spawnSync，为了复用 B105 退出段崩的口径）—— 同步等待会占死
//   本进程事件循环，跑在同一个进程里的 HTTP 服务因此永远无法应答，子调AI 调用挂到超时、
//   实测表现是「0 次调用 + ETIMEDOUT」，看着像产品代码坏了。桩独立成进程后才对。
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { runDriver } = require('./driver-runner');
const { createClient } = require('@libsql/client');
// lib/ 一律惰性取（#64-1）：顶层 require 会让 F2P 在基线提交上加载失败
const dbSchema = () => require('../lib/db');

const ROOT = path.join(__dirname, '..');
const TMP = (name) => path.join(os.tmpdir(), `psx-${process.pid}-${name}`);
const DB = TMP('db');
const STUB = TMP('stub.cjs').replace(/\\/g, '/');
const DRIVER = path.join(ROOT, `.prescreen-exec-driver-${process.pid}.cjs`);
const LOG = TMP('prompts.jsonl');

const LIMIT = 12; // DAILY_AI_LIMIT：两次跑同样 12 个坑，只差 cap —— 覆盖差才是"免费"换来的
const BIG = 3;
const BIG_N = 30;
const SMALL = 40;

let stubChild;

function startStub() {
  return new Promise((resolve, reject) => {
    fs.writeFileSync(STUB, `
const http = require('http');
const fs = require('fs');
const LOG = process.argv[2];
fs.writeFileSync(LOG, '');
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url === '/__reset') { fs.writeFileSync(LOG, ''); res.end('ok'); return; }
    fs.appendFileSync(LOG, raw + '\\n');
    let content = '{"score":42,"ignore":false,"reason":"桩"}';
    if (raw.includes('待评内容')) {
      content = '{"score":42,"ignore":false,"reason":"桩：值得深析"}';
    } else if (raw.includes('待评文章')) {
      content = '{"scores":{"选题":8,"内容":8,"深度":8,"实用":7,"创新":6,"表达":8},'
        + '"totalScore":88,"reason":"桩给的推荐理由","summary":"桩摘要",'
        + '"quote":"原文金句","points":["要点一"],"tags":["AI"]}';
    } else if (raw.includes('入选列表')) {
      content = '从本地测试，到执行锁，再到隔离边界，判断这条锁有效。';
    } else {
      content = '{"themes":[]}';
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
  });
});
server.listen(0, '127.0.0.1', () => { console.log('PORT ' + server.address().port); });
setTimeout(() => process.exit(0), 300000); // 兜底自杀，防测试异常退出后留孤儿
`);
    stubChild = spawn(process.execPath, [STUB, LOG], { cwd: ROOT });
    stubChild.stdout.on('data', (buf) => {
      const m = /PORT (\d+)/.exec(String(buf));
      if (m) resolve(Number(m[1]));
    });
    stubChild.stderr.on('data', (b) => reject(new Error(`桩进程起不来：${b}`)));
    setTimeout(() => reject(new Error('桩进程 10s 没报端口')), 10000);
  });
}

async function exec(sql, args = []) {
  const db = createClient({ url: `file:${DB}` });
  try { return Array.from((await db.execute({ sql, args })).rows); } finally { await db.close(); }
}

async function seed() {
  for (const suffix of ['', '-wal', '-shm']) { try { fs.rmSync(DB + suffix, { force: true }); } catch { /* 不存在 */ } }
  const db = createClient({ url: `file:${DB}` });
  const { SCHEMA, ALTERS } = dbSchema();
  await db.executeMultiple('PRAGMA journal_mode=OFF;');
  await db.executeMultiple(SCHEMA); // 多语句脚本：必须 executeMultiple，execute 只跑第一条
  for (const alter of ALTERS) { try { await db.execute(alter); } catch { /* 列已存在 */ } }
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  let n = 0;
  const addSource = async (name) => {
    await db.execute({ sql: "INSERT INTO sources(type,name,url,enabled,status,extra,created_at) VALUES('rss',?,?,1,'ok','{}',?)",
      args: [name, `https://stub.example.com/${name}.rss`, iso(900)] });
    const r = await db.execute('SELECT last_insert_rowid() id');
    return Number(r.rows[0].id);
  };
  const addArticle = async (sid, title, minAgo) => {
    await db.execute({ sql: `INSERT INTO articles(source_id,title,url,summary,content_html,published_at,created_at)
                             VALUES(?,?,?,?,?,?,?)`,
      args: [sid, title, `https://stub.example.com/a/${n}`, `${title} 的摘要`,
        `<p>BODY-MARKER-${n} 只有按 id 单取才会拿到的正文</p>`, iso(minAgo), iso(minAgo)] });
    n++;
  };
  for (let b = 0; b < BIG; b++) {
    const sid = await addSource(`大源${b}`);
    for (let i = 0; i < BIG_N; i++) await addArticle(sid, `Big${b} Article${i} on AI agents in production`, i * BIG + b);
  }
  for (let s = 0; s < SMALL; s++) {
    const sid = await addSource(`小源${s}`);
    await addArticle(sid, `Small${s} article about LLM eval harness`, BIG * BIG_N + s * 2);
  }
  await db.close();
  return n;
}

function runDailyAi() {
  return runDriver(DRIVER, [], {
    timeout: 150000,
    payloadRe: /EXITING OK/,
    env: {
      ...process.env,
      TURSO_DATABASE_URL: `file:${DB}`,
      TURSO_AUTH_TOKEN: 'stub-unused-token',
      AGNES_API_KEY: 'stub-unused',
      DEEPSEEK_API_KEY: 'stub-unused',
      NO_PROXY: '127.0.0.1,localhost',
      DAILY_AI_LIMIT: String(LIMIT),
    },
  });
}

const readPrompts = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean) : []);
const latestReport = async () => {
  const rows = await exec('SELECT id, stats, sections FROM daily_reports ORDER BY id DESC LIMIT 1');
  if (!rows.length) return null;
  return { id: Number(rows[0].id), stats: JSON.parse(rows[0].stats || '{}'), sections: JSON.parse(rows[0].sections || '[]') };
};

let port;

before(async () => {
  port = await startStub();
  const seeded = await seed();
  assert.equal(seeded, BIG * BIG_N + SMALL, '种子没铺满，后面的覆盖断言就没有意义');
  await exec("INSERT OR REPLACE INTO settings(key,value) VALUES('ai',?)",
    [JSON.stringify({ apiKey: 'stub-key', apiBase: `http://127.0.0.1:${port}/v1`, model: 'stub-model', dailyMinScore: 30 })]);
  await exec("INSERT OR REPLACE INTO settings(key,value) VALUES('ai.minIntervalMs',?)", ['1000']);
  await exec("INSERT OR REPLACE INTO settings(key,value) VALUES('daily',?)", ['{}']);
  fs.writeFileSync(DRIVER, `
process.argv[2] = 'daily-ai'; process.argv[3] = '--rolling24';
require(${JSON.stringify(path.join(ROOT, 'tools', 'collect-turso.js'))});
console.log('EXITING OK');
`);
});

after(() => {
  try { stubChild && stubChild.kill(); } catch { /* 已退 */ }
  for (const f of [STUB, LOG, DB, `${DB}-wal`, `${DB}-shm`]) { try { fs.rmSync(f, { force: true }); } catch { /* 无 */ } }
  try { fs.rmSync(DRIVER, { force: true }); } catch { /* 无 */ }
});

test('E1 生产模式 daily-ai 真跑通：出报、不降级、stats.prescreen 落库', async () => {
  await exec("INSERT OR REPLACE INTO settings(key,value) VALUES('prescreen.perSourceCap',?)", ['2']);
  const out = runDailyAi();
  assert.match(out, /EXITING OK/, '脚本没跑到正常收尾');
  const rep = await latestReport();
  assert.ok(rep, 'daily_reports 里没有新行 —— 整条链路根本没写成');
  assert.notEqual(rep.stats.degraded, true, `被降级成关键词版（=深析全败的表现）：${JSON.stringify(rep.stats.filterStats)}`);
  assert.ok(rep.stats.prescreen, 'stats.prescreen 没落库 —— "配额有没有生效"又变成不可判别（P0-2 同族）');
  assert.equal(rep.stats.prescreen.cap, 2);
  assert.equal(rep.stats.prescreen.pool, BIG * BIG_N + SMALL, '宽池读数应等于窗口内全部候选');
  assert.equal(rep.stats.prescreen.poolSources, BIG + SMALL);
  assert.ok(rep.stats.totalItems > 0, '出报 0 条');
});

test('E2 因果被真执行证明：同样 12 个坑，cap=2 把源覆盖换回来', async () => {
  await exec("INSERT OR REPLACE INTO settings(key,value) VALUES('prescreen.perSourceCap',?)", ['100']); // ≈不做配额
  assert.match(runDailyAi(), /EXITING OK/);
  const noCap = await latestReport();
  await exec("INSERT OR REPLACE INTO settings(key,value) VALUES('prescreen.perSourceCap',?)", ['2']);
  assert.match(runDailyAi(), /EXITING OK/);
  const withCap = await latestReport();

  assert.equal(noCap.stats.prescreen.kept, LIMIT, '不做配额时 12 个坑被大源吃满');
  assert.equal(withCap.stats.prescreen.kept, LIMIT, '配额后调用量必须一样 —— 这一刀是"免费"的');
  assert.ok(noCap.stats.prescreen.keptSources <= BIG + 1,
    `不限量本该只覆盖约 ${BIG} 源，实测 ${noCap.stats.prescreen.keptSources} —— 种子形状变了，本锁要重读`);
  assert.ok(withCap.stats.prescreen.keptSources >= noCap.stats.prescreen.keptSources * 2,
    `配额后源覆盖没换回来：${noCap.stats.prescreen.keptSources} → ${withCap.stats.prescreen.keptSources}`);
});

test('E3 正文按 id 单取真的生效（Pass2 每条都拿到正文，Pass1 一条都没烧正文）', async () => {
  // 自己独占一次测量跑：先清桩日志。原实现吃的是 E1+E2 的残留（`/__reset` 定义了却没人调），
  // 且用 `some()` —— 12 条里 11 条取空也照样绿（09-24 对抗审查抓出）。改成 every + 独立窗口。
  await fetch(`http://127.0.0.1:${port}/__reset`);
  await exec("INSERT OR REPLACE INTO settings(key,value) VALUES('prescreen.perSourceCap',?)", ['2']);
  assert.match(runDailyAi(), /EXITING OK/);
  const all = readPrompts();
  const filterCalls = all.filter((p) => p.includes('待评内容'));
  const analyzeCalls = all.filter((p) => p.includes('待评文章'));
  assert.ok(filterCalls.length >= LIMIT, `初筛调用数 ${filterCalls.length} < ${LIMIT} —— 配额后的候选没真进模型`);
  assert.ok(analyzeCalls.length > 0, '一次深析都没发生 —— 过了初筛的条目没进 Pass2');
  const missing = analyzeCalls.filter((p) => !p.includes('BODY-MARKER-'));
  assert.deepEqual(missing, [], `${missing.length}/${analyzeCalls.length} 条深析请求里没有正文 —— `
    + 'runDailyAi 的"按 id 单取 content_html"取空时不报错，深析会拿空正文照常打分（P0-2 那一族不可判别）');
  assert.ok(!filterCalls.some((p) => p.includes('BODY-MARKER-')),
    '初筛请求里出现了全文 —— Pass1 只该吃标题+摘要，烧正文等于白付 token');
  // 缺正文必须有数：stats.analyzeNoBody 是本用例的对照组，静默取空要能在库里看见
  const rep = await latestReport();
  assert.equal(typeof rep.stats.analyzeNoBody, 'number', 'stats.analyzeNoBody 没落库 —— 取空又变成看不见的形状');
  assert.equal(rep.stats.analyzeNoBody, 0, `有 ${rep.stats.analyzeNoBody} 条深析是拿空正文打的分`);

  // E3-补（用户 09-24「补这两个字段」）：attempted/rejected 与三段耗时必须在**真跑出来的行**里，
  // 而不是只在源码里 —— F5 那类形态锁只能证明"写了"，证明不了"跑起来会落库"（P0-2 当年就是形态对、运行时不落数）。
  const fs2 = rep.stats.filterStats;
  assert.equal(typeof fs2.attempted, 'number', 'filterStats.attempted 没落库');
  assert.equal(typeof fs2.rejected, 'number', 'filterStats.rejected 没落库');
  // 算术自洽：attempted 必须真等于 passed+rejected（过去只有 passed/failed，失败放行两边都算 → 尝试数算不出来）
  assert.equal(fs2.attempted, fs2.passed + fs2.rejected,
    `attempted=${fs2.attempted} ≠ passed(${fs2.passed})+rejected(${fs2.rejected}) —— 口径又漂了`);
  assert.ok(fs2.attempted <= fs2.candidates, `尝试数 ${fs2.attempted} 大于候选 ${fs2.candidates}，不可能是真值`);
  const ts = rep.stats.timeSplit;
  assert.ok(ts && typeof ts.filterMin === 'number' && typeof ts.analyzeMin === 'number' && typeof ts.mediaMin === 'number',
    'stats.timeSplit 三段没落库 —— 预算够不够又只能靠猜');
  assert.ok(ts.filterMin >= 0 && ts.analyzeMin >= 0 && ts.mediaMin >= 0, `出现负耗时：${JSON.stringify(ts)}`);
  assert.ok(ts.filterMin + ts.analyzeMin + ts.mediaMin <= Number(rep.stats.elapsedMin) + 0.5,
    `三段之和 ${ts.filterMin + ts.analyzeMin + ts.mediaMin}min 超过总耗时 ${rep.stats.elapsedMin}min —— 计时器套错位置（拆账比合账还假）`);
});
