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
//   ② AI 出口：`settings.ai.apiBase` 指向本机桩服务。**但"产品只用 global fetch"这句此前是错的**
//      （09-24 22:46Z 实测推翻）：`tools/collect-turso.js:59-68` 在 `HTTPS_PROXY` 存在时改用
//      **undici 自己的 fetch + ProxyAgent**，所以包 `globalThis.fetch` 那道闸看不见 AI 流量。
//      现在把子进程的 `HTTPS_PROXY` 指到**桩自己**：任何非本机目标都会以绝对 URL 落到桩手上并记进
//      出网台账（`egressLines()`），"零真实出口"从此有可读证据；驱动里那道 global-fetch 闸降级为纵深。
//   ③ 报警出口：`api/_alerts.js` 的通道配置读的是**库里的 settings**（:11 同一个连接），
//      临时库不塞 webhook = 无处可发；且本用例失败率 0、不截断，判据本身也不触发。
//
// 为什么桩必须是**另一个进程**（第一轮实现踩的坑，别再合并回本进程）：
//   跑产品脚本用的是 `runDriver`（spawnSync，为了复用 B105 退出段崩的口径）—— 同步等待会占死
//   本进程事件循环，跑在同一个进程里的 HTTP 服务因此永远无法应答，子调AI 调用挂到超时、
//   实测表现是「0 次调用 + ETIMEDOUT」，看着像产品代码坏了。桩独立成进程后才对。
'use strict';
const { test, todo, before, after } = require('node:test');
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
const MODE = TMP('mode'); // 注入开关（0/缺省 = 不注入），桩每个请求现读
const EGR = TMP('egress.log'); // 出网台账（桩兼作代理时写）：非本机的目标 = 一行记录

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
const MODE = process.argv[3]; // 每个请求现读：测试想注入失败时写个数字（0/缺省 = 不注入）
const EGR = process.argv[4]; // 出网台账：桩同时当代理用，凡"以绝对 URL 打进来、目标又不是本机桩"的一律记一行
let THEME_CALLS = 0; // 主题命名这一发的计数（交替回两种形状用）
let FILTER_CALLS = 0;
const modeNum = () => { try { return Number(fs.readFileSync(MODE, 'utf8').trim()) || 0; } catch { return 0; } }
fs.writeFileSync(LOG, '');
fs.writeFileSync(EGR, '');
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    // 桩同时当代理用（子进程的 HTTPS_PROXY 指到本桩）：绝对形式的请求 = 客户端想去别的地方。
    // 为什么需要这一步（09-24 22:46Z 实测）：产品侧 AI 调用走的是 **undici 自己的 fetch + ProxyAgent**
    // （tools/collect-turso.js:59-68 明写"外部 undici 的 ProxyAgent 与 Node 内置 fetch 的 dispatcher 不兼容"），
    // 所以只在驱动里包 globalThis.fetch 那道闸**看不见这些请求** —— 用它当"零真实出口"的证据是假的。
    // 让桩自己当代理，任何非本机的目标都会以绝对 URL 落到这里 ⇒ 台账文件就是可判定的证据。
    if (/^https?:\\/\\//.test(req.url)) {
      const mine = /^https?:\\/\\/(127\\.0\\.0\\.1|localhost)(:\\d+)?(\\/|$)/.test(req.url);
      if (!mine) { fs.appendFileSync(EGR, req.url + '\\n'); res.writeHead(403); res.end('blocked-by-test-stub'); return; }
      req.url = req.url.replace(/^https?:\\/\\/[^/]+/, '/') || '/'; // 本机自代理：削回路径形式，照常应答
    }
    if (req.url === '/__reset') { fs.writeFileSync(LOG, ''); res.end('ok'); return; }
    fs.appendFileSync(LOG, raw + '\\n');
    let content = '{"score":42,"ignore":false,"reason":"桩"}';
    if (raw.includes('待评内容')) {
        // 初筛：默认全部正常回分。MODE 文件写 N>0 时，每第 N 次回一段**掏不出 JSON** 的答复
      // ⇒ filterArticle 走 _ai.js:274 的「解析失败放行」⇒ failed 真非零，failWhy 的算式才有东西可加
      //   （本轮教训：不在 0 上验算式）。为什么只注入 parse 这一类 —— 注入 ok:false 那一族会触发
      //   _ai.js 的供应商 failover，而 deepseek 的 base 是写死在代码里的，那一发会**真出网**
      //   （会被桩兼作代理的出网台账当场记下一行：见 E5/E6 的 egressLines 断言）。
      // ⚠️ 这一段注释里不许出现反引号：它在生成桩源码的模板串内部（详见 E4 上方那条同族记录）。
      FILTER_CALLS++;
      const every = modeNum();
      content = (every > 0 && FILTER_CALLS % every === 0)
        ? '这段回答里没有花括号，模型答歪了'
        : '{"score":42,"ignore":false,"reason":"桩：值得深析"}';
    } else if (raw.includes('待评文章')) {
      content = '{"scores":{"选题":8,"内容":8,"深度":8,"实用":7,"创新":6,"表达":8},'
        + '"totalScore":88,"reason":"桩给的推荐理由","summary":"桩摘要",'
        + '"quote":"原文金句","points":["要点一"],"tags":["AI"]}';
    } else if (raw.includes('入选列表')) {
      content = '从本地测试，到执行锁，再到隔离边界，判断这条锁有效。';
    } else if (raw.includes('属于同一主题')) {
      // 主题命名这一发【轮流给两种形状】（第六轮审查点出：原来固定回 {"themes":[]}，四条命名出口里
      // 只有 incomplete 会被踩到，"丢弃到底进没进 drops、会不会让 named 少一"这条账从没被真跑验过）。
      // 交替 ⇒ 至少一次成功命名 + 至少一次 no_json 丢弃 ⇒ E4 的 named + Σ == rated 第一次在
      // "有一项真的非零"的情形下闭合（而不是两边都 0 的恒等）。
      // ⚠️ 这段注释里不许出现反引号：它在**生成桩源码的模板串**内部，一个反引号就会截断模板串
      //   （实测表现是"本文件 SyntaxError、整个 E 套件 0 pass"，看起来像隔离坏了而不是引号坏了）。
      THEME_CALLS++;
      content = THEME_CALLS % 2 === 1
        ? '{"name":"桩主题' + THEME_CALLS + '","viewpoint":"事件","summary":"桩给的跨源综述，覆盖两条报道。"}'
        : '这段回复里没有花括号';
    } else {
      content = '{"themes":[]}';
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
  });
});
server.listen(0, '127.0.0.1', () => { console.log('PORT ' + server.address().port); });
// CONNECT 也要记：undici 的 ProxyAgent 对 **https** 目标是先发 CONNECT（E6 第一版就是栽在这里 ——
// 只认绝对形式，结果台账一行没记，红得对）。目标是别处 ⇒ 记台账 + 拆掉 socket；
// 目标是本机桩自己 ⇒ 同样拆掉（本用例不需要 TLS 隧道，绝对形式那条路已覆盖 http 目标）。
server.on('connect', (req, socket) => {
  const host = String(req.url || '');
  if (!/^(127\\.0\\.0\\.1|localhost)(:\\d+)?$/.test(host)) fs.appendFileSync(EGR, 'CONNECT ' + host + '\\n');
  try { socket.destroy(); } catch { /* 已拆 */ }
});
setTimeout(() => process.exit(0), 300000); // 兜底自杀，防测试异常退出后留孤儿
`);
    stubChild = spawn(process.execPath, [STUB, LOG, MODE, EGR], { cwd: ROOT });
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
      // 把"代理"指向桩自己 ⇒ 产品侧无论走 global fetch 还是 undici fetch，想去任何非本机目标都会以
      // 绝对 URL 落到桩手上（见 startStub 里的出网台账分支）。必须**非空**：.env 加载是"只填空缺"。
      HTTPS_PROXY: `http://127.0.0.1:${port}`,
      HTTP_PROXY: `http://127.0.0.1:${port}`,
      DAILY_AI_LIMIT: String(LIMIT),
    },
  });
}

const readPrompts = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean) : []);
// 出网台账（桩兼作代理写的）：每一行都是"产品真试图去的一个非本机 URL"
const egressLines = () => (fs.existsSync(EGR) ? fs.readFileSync(EGR, 'utf8').split('\n').filter(Boolean) : []);
const clearEgress = () => { try { fs.writeFileSync(EGR, ''); } catch { /* 桩还没起 */ } };
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
// 出网闸（09-24 第七轮之后补）：本用例宣称"零真实出口"，但隔离此前**只覆盖了 agnes 这一跳** ——
// _ai.js 的供应商链在 ok:false 时会 failover 到 deepseek，而 deepseek 的 base 写死在代码里
// （api/_ai.js:_providerChain），只要注入任何一次调用失败就会真出网。闸放在这里而不是指望 env：
// DEEPSEEK_API_KEY 必须留非空哑值（.env 加载是"只填空缺"，设成空串会被真凭据灌回来）。
const REAL_FETCH = globalThis.fetch;
let egressBlocked = 0;
globalThis.fetch = (...args) => {
  const u = String((args[0] && args[0].url) || args[0] || '');
  if (!/127\\.0\\.0\\.1|localhost/.test(u)) {
    egressBlocked++;
    return Promise.reject(new Error('ISOLATION-EGRESS-BLOCKED: ' + u.slice(0, 60)));
  }
  return REAL_FETCH(...args);
};
process.argv[2] = 'daily-ai'; process.argv[3] = '--rolling24';
require(${JSON.stringify(path.join(ROOT, 'tools', 'collect-turso.js'))});
console.log('EXITING OK EGRESS-BLOCKED ' + egressBlocked);
`);
});

after(() => {
  try { stubChild && stubChild.kill(); } catch { /* 已退 */ }
  for (const f of [STUB, LOG, MODE, EGR, DB, `${DB}-wal`, `${DB}-shm`]) { try { fs.rmSync(f, { force: true }); } catch { /* 无 */ } }
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

// E4（H32，用户 09-24「我们要让功能正式的可以使用……不是一半停摆一半未开发」）：
// 主题全景的归因读数必须**在真跑出来的那一行里**，且算式自洽 —— 源码级有 T10 管"每条 continue 都计数"，
// 但只有运行时能回答"是不是还有一条出口没被计数"（那正是 H32 的病根：`themes:[]` 说不清是聚不到还是命名丢了）。
// 用桩跑，零真模型调用；断言全部是结构 + 算式，不假设桩一定命名成功。
test('E4 主题全景归因真落库，且 named + 四条命名出口丢弃 == 发起命名的簇数', async () => {
  assert.match(runDailyAi(), /EXITING OK/);
  const rep = await latestReport();
  const tp = rep.stats.themePanorama;
  assert.ok(tp, 'stats.themePanorama 没落库 —— 那 H32 就还是"只看到 themes:[] 而分不清病因"');
  for (const k of ['found', 'multi', 'rated', 'named']) {
    assert.equal(typeof tp[k], 'number', `themePanorama.${k} 不是数（拿它做分母会静默失真）`);
  }
  // ⚠️ 下限（第六轮审查抓到的关键洞）：上面几行在**全 0** 时全部成立 —— 往实现里塞一句提前 `return zero`、
  //   或把 `items.length < 2` 改成 `< 500`，旧 E4 与 T10 都仍绿 ⇒ "功能从此再也不产出"这条恰好没人管，
  //   而这正是 H32 登记的原症状。种子数据是**确定**能聚出簇的（12 条里同一标题形状成对出现），
  //   所以这里要求非零不是碰运气：found/multi/rated 任意为 0 就该红。
  assert.ok(tp.found >= 1, `found=${tp.found} ⇒ 一期都没聚出簇：桩里 12 条种子标题是成对同形的，聚不出就是实现被改坏（H32 的原症状）`);
  assert.ok(tp.multi >= 1, `multi=${tp.multi} ⇒ 没有"≥2 条的簇"，命名环节根本没启动`);
  assert.ok(tp.rated >= 1, `rated=${tp.multi ? tp.rated : '?'} ⇒ 发起了 0 次命名，后面的算式全是 0==0 的空转`);
  assert.ok(tp.found >= tp.multi && tp.multi >= tp.rated, `found=${tp.found} multi=${tp.multi} rated=${tp.rated} 不单调`);
  assert.equal(tp.rated, Math.min(tp.multi, 4), `发起命名 ${tp.rated} 簇 ≠ min(够格的 ${tp.multi}, 上限 4) —— "取前 4"这道闸没进读数`);
  // ⚠️ 本条**钉不住"取前 4"这道闸本身**：桩里 multi 只有 2~3（< 4），把 `.slice(0, 4)` 改成 `.slice(0, 400)`
  //   E4 与 T10 都仍绿 —— 要钉住它得给种子加到 >4 组重簇。如实登记为未收口（不假装这条腿有牙）。
  const d = tp.drops || {};
  // 至少有一条**真实结局**：要么命名成功、要么有出口被计数（全 0 + 全空 = 上面已被挡住，这里再挡"两边都空"）
  assert.ok(tp.named >= 1 || Object.keys(d).length >= 1, `named=${tp.named} 且 drops 为空 ⇒ 这一期既没产出也没有任何归因，等于 H32 没修`);
  // 出口名单从契约取，不在锁里手抄（09-24 第六轮审查抓到：上一版抄了四条，漏了契约里合法的 `no_token`
  // 　⇒ 任何一期里只要有一条标题切不出词就假红。抄清单必漂，改成引用唯一事实源）
  const CONTRACT_EXITS = require('../docs/contracts/daily-report.json')
    .properties.report.properties.stats.properties.themePanorama.properties.drops.propertyNames.enum;
  const exitsIn = (k) => CONTRACT_EXITS.includes(k);
  assert.ok(Array.isArray(CONTRACT_EXITS) && CONTRACT_EXITS.length >= 6,
    `契约 drops 枚举读不到或退化到 ${CONTRACT_EXITS && CONTRACT_EXITS.length} 条 —— 分母空了这条判据就是恒绿`);
  // 谓词自证（两侧各一个样本）：只测"当前数据恰好合法"是不够的，得证明这条腿**认得合法、也拒绝非法**，
  // 否则它可能只是恒真（第六轮审查对上一条腿提的就是这个）。
  assert.ok(Object.keys({ no_token: 1, too_few_items: 2, ai_failed: 1 }).every(exitsIn),
    '派生名单连契约里明写的键都不认 ⇒ 名单取错了路径');
  assert.ok(!Object.keys({ bogus_exit: 1 }).every(exitsIn), '契约外出口没被判红 ⇒ 这条腿恒真、没有牙');
  for (const k of Object.keys(d)) {
    assert.ok(exitsIn(k),
      `drops 里出现契约外出口 ${k}（契约现有 ${CONTRACT_EXITS.join('/')}）—— 枚举要先进 docs/contracts/daily-report.json 再上线`);
  }
  // `too_few_items` 与 `no_token` 都是**聚类前**的丢弃（一条整批、一条条目级），丢的不是簇、不进 `rated`
  // 这本账 ⇒ 命名算式只允许加命名环节那四条（契约 drops 描述里写明两族之分）。
  const NAMING_EXITS = CONTRACT_EXITS.filter((k) => k !== 'no_token' && k !== 'too_few_items');
  assert.equal(NAMING_EXITS.length, 4, `命名环节出口应有 4 条，契约现在给了 ${NAMING_EXITS.length} 条 ⇒ 新增键要先进对应那一族`);
  const lost = NAMING_EXITS.reduce((n, k) => n + (d[k] || 0), 0);
  assert.equal(tp.named + lost, tp.rated,
    `命名成功 ${tp.named} + 丢弃 ${lost} ≠ 发起 ${tp.rated} ⇒ **还有一条静默出口没计数**（H32 的病根就是这个式子不成立）`);
  assert.equal((rep.stats.themes || []).length, tp.named, 'stats.themes 长度与 named 不一致 ⇒ 读数和产物两本账');
  // 导语那条（H30）也顺手在真跑的行里验一次形状：为空就必须带得出 why
  if (!rep.stats.theme) {
    assert.ok(rep.stats.themeSkip && ['ai_failed', 'all_lines_rejected', 'picked_vetoed', 'throw', 'unlabeled'].includes(rep.stats.themeSkip.why),
      'theme 为空却没有可区分的 why（H30 原本的症状）');
  }
});

// E5（H35，用户 09-24「补这两个字段……我们要让功能正式的可以使用」）：初筛失败必须**可归因**。
// `filterStats.failed` 只回答"多少"，答不了"哪一种"，而修法天差地别（reasoning_only 抬 maxTokens /
// timeout 抬 timeoutMs / rate_limited 加退避 / parse 是提示词的事）。09-24 线上量到一期 34.2% 失败，
// 就因为只有总数而拍不动 H33 —— 这条把"分类真落库"钉成执行级证据。
// 注入用 parse 这一族（模型答了但掏不出 JSON）：注入 ok:false 那一族会触发 _ai.js 的供应商 failover，
// deepseek 的 base 写死在代码里 ⇒ 那一发会真出网。出网闸（驱动里的 fetch 包装）负责把这件事变成断言。
test('E5 初筛失败真落库可归因：Σ(failWhy)==failed、注入的那一类真被认出来', async () => {
  fs.writeFileSync(MODE, '7'); // 每第 7 次初筛回一段掏不出 JSON 的答复
  // 为什么取 7 而不取 5（也不要取 2 或 1）：**本跑的分母不是生产的 500，而是 DAILY_AI_LIMIT=12**
  //   （实测读数见 E5-INJECT-READOUT：attempted=12 / failed=2）。报警线是 failed/attempted ≥ 20%
  //   （lib/filter-observe.js#FILTER_FAIL_ALERT_RATE），12 条里注入 2~3 条就是 17%~25%，**恰好压在报警线上**；
  //   判据阈值与被测常数是同一族数字时最容易互相伪装（本轮第 N 次踩同族），所以这里刻意取一个
  //   "分母多少都大概率落在个位数失败"的间隔，并且**不断言具体次数**（跨用例累计，断具体值就是 flaky 源）。
  clearEgress(); // 出网台账只判本跑（E1~E4 也在同一桩进程里跑过）
  let out = '';
  try { out = runDailyAi(); } finally { fs.writeFileSync(MODE, '0'); }
  assert.match(out, /EXITING OK/, '脚本没跑到正常收尾');
  // ⚠️ 这里**故意不断言**"出网台账为空"：09-24 23:06Z 实测该台账**看不见 https 目标**
  //   （undici ProxyAgent 对 https 先发 CONNECT，Node 的 connect 事件这条我没走通 —— E6 里详录），
  //   拿一个会漏检的装置报"0 次"，等于把"检测不到"冒充成"没有发生"。⇒ 只在日志里留读数，
  //   主张降级到 ISSUES H39（含三条待选处置），E6 以 todo 形式留在这里等拍板。
  if (egressLines().length) console.log('E5-EGRESS-LEDGER ' + egressLines().slice(0, 3).join(' ; '));
  const rep = await latestReport();
  const fs2 = rep.stats.filterStats || {};
  assert.ok(fs2.failWhy, 'stats.filterStats.failWhy 没落库 ⇒ H35 还是"只知道失败多少"');
  assert.ok(Number(fs2.failed) >= 1, `failed=${fs2.failed} ⇒ 注入根本没生效，下面的算式又是在 0 上验（本轮反复踩的那类假绿）`);
  const WHY_EXITS = require('../docs/contracts/daily-report.json')
    .properties.report.properties.stats.properties.filterStats.properties.failWhy.propertyNames.enum;
  assert.ok(WHY_EXITS.length >= 9, `契约 failWhy 枚举只剩 ${WHY_EXITS.length} 条 ⇒ 分母塌了`);
  const why = fs2.failWhy;
  for (const k of Object.keys(why)) assert.ok(WHY_EXITS.includes(k), `failWhy 出现契约外键 ${k} ⇒ 分类器加了新桶没进契约`);
  const sum = Object.values(why).reduce((a, b) => a + Number(b || 0), 0);
  // 把真读数打进日志：文档里"注入了多少次失败"这种数字必须能从一次运行里复算，不能靠估算
  console.log('E5-INJECT-READOUT ' + JSON.stringify({ attempted: fs2.attempted, failed: fs2.failed, sum, why }));
  assert.equal(sum, Number(fs2.failed), `Σ(failWhy)=${sum} ≠ failed=${fs2.failed} ⇒ 有一条失败没被归类（H35 的账又缺一格）`);
  // 注入的这一族必须被**认出来**，而不是全塞进 other（塞进 other 也算"有归因"，但等于没归因）
  assert.ok(Number(why.parse) >= 1, `注入的是"答了但掏不出 JSON"，failWhy.parse 却是 ${why.parse} ⇒ 分类器没接上或串变了`);
  assert.equal(why.other, undefined, `未知桶 other 被用了（${why.other}）⇒ 有一批失败连分类器都认不出，先把串补进 FILTER_FAIL_WHY 再谈修法`);
  // ⚠️ 这里**故意不写** `attempted == passed + rejected`：attempted 在源码里就是按 passed+rejected 算的，
  //   断言它等于自己（同源自证，第六轮审查在 E4 上刚判过一类同样的毛病）。要写就写独立可证伪的：
  assert.ok(Number(fs2.failed) < Number(fs2.attempted), `failed=${fs2.failed} 等于 attempted=${fs2.attempted} ⇒ 注入把整批都打挂了，"筛没筛"与"全挂"又会同形`);
  assert.ok(Number(fs2.passed) >= 1 && Number(fs2.analyzed) >= 1, `passed=${fs2.passed} analyzed=${fs2.analyzed} ⇒ 注入连带把主链路打断了，本用例只该证明归因，不该改变成败`);
});

// E6（E5 那条"一次都没真出网"的**反向证明**）：出网闸是这套隔离的安全装置本身，装置没人踩过就等于没有。
// 把 settings.ai.apiBase 指到非本机域名跑一次 ⇒ 每一发都必须被闸挡下并计数；跑完把 settings 还原，
// 免得后面的用例（同进程共享临时库）读到被污染的基址。
// H39：这条现在**跑必红**（台账对 CONNECT 漏检），按纪律以 todo 保留、不改它的判据去迁就装置。
// 等用户三选一：(a) 修台账让它真能看见 CONNECT（需要处理 TLS 隧道）；(b) 把'零真实出口'降级成
// '只覆盖 http 目标'并同步所有文档；(c) 换检测层（在 undici dispatcher 上装，而不是在网络边界上装）。
todo('E6 出网台账自己要被踩过一次：AI 基址指到非本机 https 域名时，台账必须记到那一发（待 H39 拍板）', async () => {
  const prev = await exec("SELECT value FROM settings WHERE key='ai'");
  assert.ok(prev.length === 1, '取不到 settings.ai ⇒ 前置状态就不对，别往下测');
  await exec("INSERT OR REPLACE INTO settings(key,value) VALUES('ai',?)",
    [JSON.stringify({ apiKey: 'stub-key', apiBase: 'https://egress-canary.invalid/v1', model: 'stub-model', dailyMinScore: 30 })]);
  clearEgress();
  let out = '';
  try { out = runDailyAi(); }
  finally { await exec("INSERT OR REPLACE INTO settings(key,value) VALUES('ai',?)", [String(prev[0].value)]); }
  assert.match(out, /EXITING OK/, '被挡之后脚本必须仍能收尾（闸是"拒绝这一次调用"，不是把进程杀掉）');
  const egr = egressLines();
  assert.ok(egr.length >= 1, `基址已经是非本机域名，出网台账却一行都没有（${egr.length}）⇒ 台账这条路是假的，E5 那句"没出网"不作数\n`
    + `--- settings.ai 写入后回读 ---\n${JSON.stringify((await exec("SELECT value FROM settings WHERE key='ai'")).map((r) => String(r.value)))}\n`
    + `--- 驱动 stdout 尾 900 字（含每期"失败因由"分布，能看出请求到底撞到哪儿失败的）---\n${out.slice(-900)}`);
  assert.ok(egr.some((l) => l.includes('egress-canary.invalid')),
    `台账里有 ${egr.length} 行但没有 canary 那一发（前 3 行：${egr.slice(0, 3).join(' ; ')}）⇒ 检出的不是我们注入的那次，判据对不上`);
  // 顺带把"failover 会不会打到写死的 deepseek"这件事变成**可见**而不是断言：
  // 台账里出现 api.deepseek.com 就说明 _ai.js 的失败换供应商会去外部基址 —— 现在它被桩接住并 403，
  // 不再偷偷出网（这正是 H37 的内容；要不要在产品侧允许 failover 出网，是另一件事，等用户拍）。
  const failedOver = egr.filter((l) => l.includes('api.deepseek.com')).length;
  console.log(`E6-READOUT 出网台账 ${egr.length} 行，其中 canary ${egr.filter((l) => l.includes('egress-canary.invalid')).length} 行、deepseek failover ${failedOver} 行`);
  // 还原证据：下一发必须重新打得通桩（否则 E6 把后面用例弄脏了却没人发现）
  const after = await exec("SELECT value FROM settings WHERE key='ai'");
  assert.equal(String(after[0].value), String(prev[0].value), 'settings.ai 没还原 ⇒ 后续用例会读到假基址');
});
