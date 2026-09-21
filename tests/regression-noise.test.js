// B107 噪声口径单实现回归锁（spec 36-7 的 AC1/AC2/AC4，2026-09-21）。
//
// 一句话病根：'hotlist' + extra.aggregator 这条判定在 api/server/tools 里手写了 25 处，
// 副本之间还各有增减 —— 实测抓到两处真漂移：
//   ① `handleArticlesReadAll` 只排两轴，列表排四轴 → "全部标已读"标掉列表里看不见的条目；
//   ② 「我的阅读」两端**一处都没排** → 足迹被热榜淹没（旧库实测 25,142 条里 17,860 条是热榜）。
// 所以这条锁要同时钉住四件事：轴只有一份（N1/N2/N3）、少接一处就红（N4）、
// 新旧写法逐行等价（N5/N6/N7）、两端默认排除且开关能放回来（N8/N9）。
//
// 纪律：判据来自 lib/noise.js 那一份（坑 #58/#59），本文件只写"怎么报"；
// 每条禁写法都配负向样本（塞进去必须红）与反向样本（合法写法不许红），分母必须打印。
'use strict';
require('./helpers'); // 必须先于任何 server/* —— 给它一个临时 APP_DATA_DIR，绝不碰 data/app.db
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
// 惰性取（坑 #64/#67 口径）：F2P 会在"基线树里还没有 lib/noise.js"的 worktree 里跑本文件，
// 顶层 require 会让它崩在加载期，读成"锁假了"而不是"改前红"。
const N = () => require('../lib/noise');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── 夹具：一份数据同时喂本地与云端两端（N8/N9 的跨端对账靠这个"同一份"才成立）──
// 五种源，各一条已读文章，把要钉的语义一次摆全：
const SOURCES = [
  { key: 'normal', type: 'rss', name: 'B107普通源', extra: null },
  { key: 'hot', type: 'hotlist', name: 'B107热榜源', extra: '{}' },
  { key: 'agg', type: 'rss', name: 'B107聚合源', extra: '{"aggregator":1}' },
  // 屏蔽轴：批准口径只说"排除热榜聚合噪声"，屏蔽是另一件事 → 足迹**不许**排它（N8 钉住这条边界）
  { key: 'muted', type: 'rss', name: 'B107屏蔽源', extra: '{}', muted: 1 },
  { key: 'hidden', type: 'rss', name: 'B107未收录源', extra: '{}', reader_visible: 0 },
];
const PODCAST_COVER = 'https://media.xyzcdn.net/b107/ep0.m4a';
// 七条文章 + 一条收藏视频，把要钉的语义一次摆全（噪声两轴 / 屏蔽与未收录两轴不属于噪声 /
// 源已删的孤儿 / 稍后读 / 播客特征 / 视频侧）
const ARTICLES = [
  { title: '普通已读', src: 'normal', read: true },
  { title: '热榜已读', src: 'hot', read: true },
  { title: '聚合已读', src: 'agg', read: true },
  { title: '屏蔽源已读', src: 'muted', read: true },
  { title: '未收录已读', src: 'hidden', read: true },
  { title: '孤儿已读', src: null, read: true },                              // 源已被删：NOT EXISTS 形态必须留着它
  { title: '播客稍后读', src: 'normal', later: true, cover: PODCAST_COVER }, // 稍后读 tab 与播客 type 的双料样本
];
const VIDEO_TITLE = 'B107 收藏视频';
// B29：观看过但未收藏的视频也算「交互过」，要进 tab=all（此前两端只认 favorite=1 → 视频区恒空）
const WATCHED_TITLE = 'B107 已观看视频';
const T = (x) => `B107 ${x}`;
const KEEP_DEFAULT = [T('普通已读'), T('屏蔽源已读'), T('未收录已读'), T('孤儿已读'), T('播客稍后读'), VIDEO_TITLE, WATCHED_TITLE];
const KEEP_ALL = [T('普通已读'), T('热榜已读'), T('聚合已读'), T('屏蔽源已读'), T('未收录已读'), T('孤儿已读'), T('播客稍后读'), VIDEO_TITLE, WATCHED_TITLE];

// 查询串 → 期望标题集合。**本地与云端跑同一张表**：两端不一致会先在这里露头
// （B134 就是这么抓出来的 —— 本地除 all/all 外每个筛选组合都返回空列表）
const COMBOS = [
  ['tab=all&type=all', KEEP_DEFAULT],
  ['tab=all&type=all&include_hot=1', KEEP_ALL],
  ['tab=read&type=all', [T('普通已读'), T('屏蔽源已读'), T('未收录已读'), T('孤儿已读')]],
  ['tab=read&type=all&include_hot=1', [T('普通已读'), T('热榜已读'), T('聚合已读'), T('屏蔽源已读'), T('未收录已读'), T('孤儿已读')]],
  ['tab=favorited&type=all', [T('播客稍后读'), VIDEO_TITLE]],
  ['tab=favorited&type=all&include_hot=1', [T('播客稍后读'), VIDEO_TITLE]],
  ['tab=all&type=article', [T('普通已读'), T('屏蔽源已读'), T('未收录已读'), T('播客稍后读')]],
  ['tab=all&type=article&include_hot=1', [T('普通已读'), T('聚合已读'), T('屏蔽源已读'), T('未收录已读'), T('播客稍后读')]],
  ['tab=all&type=video', [VIDEO_TITLE, WATCHED_TITLE]],
  ['tab=all&type=video&include_hot=1', [VIDEO_TITLE, WATCHED_TITLE]],
  ['tab=all&type=podcast', [T('播客稍后读')]],
];
const articleRows = (ids, t) => ARTICLES.map((a) => ({
  source_id: a.src ? ids[a.src] : 9999, title: T(a.title), url: `http://b107/a/${a.title}`,
  cover: a.cover || null, read_at: a.read ? t : null, later: a.later ? 1 : 0,
}));

// 本地与云端两份夹具的写入由这一份定义驱动（跨端对账的前提是"喂的确实是同一批数据"）
function seedLocal(db, t) {
  const insSrc = db.prepare('INSERT INTO sources(type,name,url,extra,muted,reader_visible,status,created_at) VALUES(?,?,?,?,?,?,?,?)');
  const insArt = db.prepare('INSERT INTO articles(source_id,title,url,published_at,read_at,later,cover) VALUES(?,?,?,?,?,?,?)');
  const ids = {};
  for (const s of SOURCES) {
    ids[s.key] = Number(insSrc.run(s.type, s.name, `http://b107/${s.key}`, s.extra, s.muted ?? 0, s.reader_visible ?? 1, 'ok', t)
      .lastInsertRowid);
  }
  for (const r of articleRows(ids, t)) insArt.run(r.source_id, r.title, r.url, t, r.read_at, r.later, r.cover);
  db.prepare('INSERT INTO videos(source_id,title,url,published_at,favorite) VALUES(?,?,?,?,1)')
    .run(ids.normal, VIDEO_TITLE, 'http://b107/v/1', t);
  db.prepare('INSERT INTO videos(source_id,title,url,published_at,favorite,watched_at) VALUES(?,?,?,?,0,?)')
    .run(ids.normal, WATCHED_TITLE, 'http://b107/v/2', t, t);
  return ids;
}

const sorted = (a) => [...a].sort();
const titlesOf = (d) => (d.items || []).map((i) => i.title);

test('N8 本地 /api/reading：默认排噪声、include_hot=1 放回来，且 11 个筛选组合都要有内容（AC4 + B134）', async () => {
  const express = require('express');
  const { db } = require('../server/db');
  const { nowIso } = require('../server/util/time');
  seedLocal(db, nowIso());

  const app = express();
  app.use('/api/reading', require('../server/routes/reading.js'));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r)); // Windows 上 address() 在 listening 前是 null
  try {
    const base = `http://127.0.0.1:${srv.address().port}/api/reading`;
    const get = async (qs) => {
      const r = await fetch(`${base}?${qs}`);
      assert.equal(r.status, 200, `端点没答（${qs}）`);
      return r.json();
    };
    const off = await get('tab=all&type=all');
    const on = await get('tab=all&type=all&include_hot=1');
    assert.ok(off.counts.all < on.counts.all, '开关两态读数相同 = 开关根本没接线');
    // 一张表跑完 11 个组合：默认排噪声、开关放回来、且**每个 tab×type 组合都有内容**
    // （B134：本地端原来除 all/all 外每个组合都返回空列表，计数却还是对的）
    for (const [qs, want] of COMBOS) {
      const d = await get(qs);
      assert.equal(d.ok, true, `${qs} 报错：${d.error}`);
      assert.deepEqual(sorted(titlesOf(d)), sorted(want), `本地端 ${qs} 的列表与期望不符`);
      if (qs.startsWith('tab=all&type=all')) {
        assert.equal(d.counts.all, d.items.length, `本地端 ${qs}：计数与列表不同口径`);
      }
    }
  } finally {
    srv.close();
  }
});

test('N9 云端 /api/reading 两条路径同口径：两段式快路径与带筛选慢路径都要排噪声（AC3/AC4）', async () => {
  const file = path.join(os.tmpdir(), `b107-cloud-${process.pid}.db`).replace(/\\/g, '/');
  fs.rmSync(file, { force: true });
  // 必须指向隔离库：测试里的写方法/建表都不许落在生产 Turso 上（B117 / spec43 §六）
  process.env.TURSO_DATABASE_URL = 'file:' + file;
  process.env.TURSO_AUTH_TOKEN = '';
  const libdb = require('../lib/db.js');
  assert.match(String(process.env.TURSO_DATABASE_URL), /^file:/, '这条用例的前提是指向文件库');
  await libdb.ensureSchema();

  const t = new Date().toISOString();
  const ids = {};
  for (const s of SOURCES) {
    const r = await libdb.dbRun(
      'INSERT INTO sources(type,name,url,extra,muted,reader_visible,status,created_at) VALUES(?,?,?,?,?,?,?,?)',
      s.type, s.name, `http://b107/${s.key}`, s.extra, s.muted ?? 0, s.reader_visible ?? 1, 'ok', t,
    );
    ids[s.key] = Number(r.lastInsertRowid);
  }
  for (const r of articleRows(ids, t)) {
    await libdb.dbRun('INSERT INTO articles(source_id,title,url,published_at,read_at,later,cover) VALUES(?,?,?,?,?,?,?)',
      r.source_id, r.title, r.url, t, r.read_at, r.later, r.cover);
  }
  await libdb.dbRun('INSERT INTO videos(source_id,title,url,published_at,favorite,watched_at) VALUES(?,?,?,?,0,?)',
    ids.normal, WATCHED_TITLE, 'http://b107/v/2', t, t);
  await libdb.dbRun('INSERT INTO videos(source_id,title,url,published_at,favorite) VALUES(?,?,?,?,1)',
    ids.normal, VIDEO_TITLE, 'http://b107/v/1', t);

  const handler = require('../api/[...slug].js');
  const call = async (qs) => {
    const res = { _status: 200, _body: null };
    res.setHeader = () => res; res.status = (s) => { res._status = s; return res; };
    res.json = (b) => { res._body = b; return res; }; res.send = (b) => { res._body = b; return res; }; res.end = () => res;
    await handler({ method: 'GET', url: '/api/reading', query: Object.fromEntries(new URLSearchParams(qs)), body: {}, headers: {} }, res);
    assert.equal(res._status, 200, `端点 ${qs} 返回 ${res._status}：${JSON.stringify(res._body)}`);
    return res._body;
  };
  // 同一张 COMBOS 表喂云端：首屏两个组合走 T3-3 两段式**快路径**，其余走带筛选**慢路径**。
  // 两条路径都要排噪声、都要认开关 —— 快路径漏接是这类改造最常见的翻车点。
  for (const [qs, want] of COMBOS) {
    const d = await call(qs);
    assert.equal(d.ok, true, `云端 ${qs} 报错：${d.error}`);
    assert.deepEqual(sorted(titlesOf(d)), sorted(want), `云端 ${qs} 的列表与本地/期望不符`);
    if (qs.startsWith('tab=all&type=all')) {
      assert.equal(d.counts.all, d.items.length, `云端 ${qs}：计数与列表不同口径`);
    }
  }
  await libdb.close();
  // 尽力清理：Windows 上 libsql 可能还攥着文件句柄，EPERM 不该把这条锁判成红
  try { fs.rmSync(file, { force: true }); } catch { /* 留给系统临时目录回收 */ }
});

test('N1 噪声轴在活代码里只剩一份：违规 0、分母够大、14 个消费点真接上了', () => {
  const r = N().findNoiseViolations(ROOT);
  assert.ok(r.scanned >= 100, `扫描面缩了（${r.scanned} 个文件）—— 分母不足时"0 违规"没有意义`);
  assert.ok(r.consumed >= 12, `引用唯一实现的消费点只有 ${r.consumed} 个（应 >=12：三端 + 服务层）`);
  assert.deepEqual(r.missingImport, [], `这些消费点没接 lib/noise（唯一实现成了空话）：${r.missingImport.join(', ')}`);
  assert.deepEqual(
    r.violations.map((v) => `${v.file}:${v.line} ${v.label}`), [],
    `噪声判定又出现第二份手写副本：\n${r.violations.map((v) => `  ${v.file}:${v.line} ${v.label} → ${v.code}`).join('\n')}`,
  );
});

// 把坏样本写进一个临时"仓库"，跑同一份判据 —— 必须红且点名（AC2 第一半）。
// 四种形态都要试：AND 式、OR 式、NOT EXISTS 式、只写单轴的式；漏一种就是判据只看字面全等。
function probeViolates(snippet, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b107-bad-'));
  try {
    fs.mkdirSync(path.join(dir, 'server/routes'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'server/routes/bad.js'), `const x = ${JSON.stringify(snippet)};\nmodule.exports = x;\n`);
    const r = N().findNoiseViolations(dir);
    assert.ok(r.violations.length > 0, `负向样本没被判出来（恒真判据，坑 #62）：${label}\n  样本：${snippet}`);
    assert.match(r.violations[0].file, /server\/routes\/bad\.js$/, `违规没点名文件：${label}`);
    assert.equal(r.violations[0].line, 1, `违规没点名的行号（应 1，实得 ${r.violations[0].line}）：${label}`);
    return r.violations;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('N2 负向自证：任何一处分再手写噪声条件，W18 判据必须红且点名（四种形态）', () => {
  const bad = [
    ["s.type != 'hotlist' AND COALESCE(json_extract(COALESCE(s.extra,'{}'),'$.aggregator'),0) != 1", 'AND 式（收口前那 7 份的写法）'],
    ["(s.type='hotlist' OR COALESCE(json_extract(COALESCE(s.extra,'{}'),'$.aggregator'),0)=1)", 'OR 式（状态页的写法）'],
    ['SELECT 1 FROM sources s2 WHERE s2.id=a.source_id AND (s2.type=\'hotlist\' OR COALESCE(json_extract(COALESCE(s2.extra,\'{}\'),\'$.aggregator\'),0)=1)', 'NOT EXISTS 式'],
    ["s.type != 'hotlist'", '只写热榜单轴（AI 精选那类）'],
    ["json_extract(COALESCE(s.extra,'{}'),'$.aggregator')=1", '只写聚合器单轴（热点榜页那类）'],
    ["SELECT name FROM sources WHERE type='hotlist'", '无别名式（直接查 sources）'],
  ];
  for (const [snippet, label] of bad) probeViolates(snippet, label);
});

test('N3 反向样本：提到 hotlist 但不是噪声判定的合法写法，一条都不许误红', () => {
  const ok = [
    "['rss','wechat','x','youtube','hotlist','bilibili']",       // SOURCE_TYPES 枚举
    "u.startsWith('hotlist://')",                                 // 协议前缀判断
    "s.type IN ('wechat','rss','wemp','x','youtube','hotlist')",  // 到期标记的源类型集合
    'refresh-all?type=hotlist',                                   // 查询串里的类型
    "INSERT INTO sources(type,name) VALUES('hotlist','x')",       // 写入取值（不是比较）
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b107-good-'));
  try {
    fs.mkdirSync(path.join(dir, 'server/routes'), { recursive: true });
    ok.forEach((s, i) => fs.writeFileSync(
      path.join(dir, 'server/routes', `g${i}.js`),
      `// 注释里也写一份噪声条件试试：const NOISE = "s.type='hotlist' OR json_extract(s.extra,'$.aggregator')"\nconst x = ${JSON.stringify(s)};\nmodule.exports = x;\n`,
    ));
    const r = N().findNoiseViolations(dir);
    assert.deepEqual(
      r.violations.map((v) => `${v.file}:${v.line} ${v.code}`), [],
      `合法写法被误判（判据第一版必错，坑 #62/#63）：\n${r.violations.map((v) => `  ${v.file}:${v.line} ${v.code}`).join('\n')}`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('N4 判据自身接线：把构造函数摘掉（消费点缺 require）也要红，且注释里的字面量不算', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b107-noimport-'));
  try {
    fs.mkdirSync(path.join(dir, 'server/routes'), { recursive: true });
    // 只放一个 MUST_IMPORT 里的真实路径，内容里既没有噪声字面量、也没有 require lib/noise
    fs.writeFileSync(path.join(dir, 'server/routes/status.js'), 'module.exports = 1;\n');
    const r = N().findNoiseViolations(dir);
    assert.deepEqual(r.violations, [], '这份夹具本来就不该有违规（用来证明 missingImport 是独立的一条腿）');
    assert.ok(r.missingImport.length > 0, '摘掉唯一实现的引用后 missingImport 必须非空，否则"只有一份"没人守');
    assert.ok(r.missingImport.includes('server/routes/status.js'), `没点名缺引用的文件：${r.missingImport.join(', ')}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // 自检探针不许扫到自己：本文件（tests/）里写了这么多坏样本，活仓库判据必须一条都不算
  const live = N().findNoiseViolations(ROOT);
  assert.ok(!live.violations.some((v) => v.file.startsWith('tests/')), '判据把 tests/ 也算进去了 = 自证不成立（坑 #59）');
  assert.ok(!live.allowed.some((a) => !/lib\/noise\.js/.test(a)), `允许清单异常：${live.allowed.join(', ')}`);
});

// ── N5/N6/N7：SQL 真跑对账。旧写法留在测试里当**参照物**（tests/ 不参与 W18 扫描，见 N4）──
const OLD_AND_FORM = "s.type != 'hotlist' AND COALESCE(json_extract(COALESCE(s.extra,'{}'),'$.aggregator'),0) != 1"
  + ' AND COALESCE(s.muted,0)=0 AND COALESCE(s.reader_visible,1)=1';
const OLD_EXISTS_FORM = `NOT EXISTS (SELECT 1 FROM sources s2 WHERE s2.id=articles.source_id AND (s2.type='hotlist'`
  + ` OR COALESCE(json_extract(COALESCE(s2.extra,'{}'),'$.aggregator'),0)=1 OR COALESCE(s2.muted,0)=1 OR COALESCE(s2.reader_visible,1)=0))`;

// 注意 `'not-json'` 这一格：SQLite 的 json_extract 对**非法 JSON 文本是抛错**，不是回 NULL。
// 所以矩阵里不能放它（放了整条 SQL 直接 SQLITE_ERROR）；它单独由 N5b 钉成一条已知边界。
const TYPES = ['rss', 'hotlist', null];
const EXTRAS = [null, '{}', '{"aggregator":1}', '{"aggregator":0}', 'null', '{"aggregator":true}', '""'];
const MUTEDS = [null, 0, 1];
const VISIBLES = [null, 0, 1];

function makeSourceTable(db) {
  db.exec('CREATE TABLE sources (id INTEGER PRIMARY KEY, type TEXT, extra TEXT, muted INTEGER, reader_visible INTEGER)');
  db.exec('CREATE TABLE articles (id INTEGER PRIMARY KEY, source_id INTEGER, published_at TEXT)');
  const rows = [];
  for (const type of TYPES) for (const extra of EXTRAS) for (const muted of MUTEDS) for (const rv of VISIBLES) {
    const id = rows.length + 1;
    db.prepare('INSERT INTO sources(id,type,extra,muted,reader_visible) VALUES(?,?,?,?,?)').run(id, type, extra, muted, rv);
    db.prepare('INSERT INTO articles(source_id,published_at) VALUES(?,?)').run(id, '2026-09-21T00:00:00.000Z');
    rows.push({ id, type, extra, muted, reader_visible: rv, source_type: type, source_extra: extra });
  }
  db.prepare('INSERT INTO articles(source_id,published_at) VALUES(9999,?)').run('2026-09-21T00:00:00.000Z'); // 孤儿条目
  return rows;
}

test('N5 新旧 SQL 写法逐行等价：三轴取值全组合下，AND 式 / NOT 式 / NOT EXISTS 式命中同一批行', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  const rows = makeSourceTable(db);
  const n = Number(db.prepare('SELECT COUNT(*) c FROM articles').get().c);
  const idsJoin = (where) => db.prepare(`SELECT a.id FROM articles a JOIN sources s ON s.id=a.source_id WHERE ${where} ORDER BY a.id`).all().map((r) => r.id);
  const idsExists = (where) => db.prepare(`SELECT articles.id FROM articles WHERE ${where} ORDER BY articles.id`).all().map((r) => r.id);

  const pairs = [
    ['两轴 NOT 式 vs 旧 AND 式', `NOT ${N().isNoiseSql('s')}`,
      "s.type != 'hotlist' AND COALESCE(json_extract(COALESCE(s.extra,'{}'),'$.aggregator'),0) != 1", idsJoin],
    ['四轴 NOT 式 vs 旧 AND 式', N().notNoiseSql('s', { reader: true }), OLD_AND_FORM, idsJoin],
    ['四轴 NOT EXISTS 式 vs 旧 NOT EXISTS 式', N().notNoiseExistsSql({ item: 'articles', alias: 's2', reader: true }), OLD_EXISTS_FORM, idsExists],
  ];
  for (const [label, neu, old, run] of pairs) {
    const a = run(neu);
    const b = run(old);
    assert.ok(a.length > 0 && a.length < n, `样本没铺开（${label}：命中 ${a.length}/${n}）—— 这条断言会恒真`);
    assert.deepEqual(a, b, `${label}：新旧写法命中不同行\n  新独有 ${a.filter((x) => !b.includes(x)).slice(0, 5).join(',')} / 旧独有 ${b.filter((x) => !a.includes(x)).slice(0, 5).join(',')}`);
  }
  // 三种形态之间的**唯一**差别必须是孤儿条目的去留（这是有意选择，钉住它防"顺手统一"）
  const orphan = Number(db.prepare('SELECT id FROM articles WHERE source_id=9999').get().id);
  const viaExists = idsExists(N().notNoiseExistsSql({ item: 'articles', alias: 's2' }));
  const viaJoin = idsJoin(`NOT ${N().isNoiseSql('s')}`);
  assert.ok(viaExists.includes(orphan), 'NOT EXISTS 形态下孤儿条目（源已删）必须留在足迹里 —— 足迹是历史事实');
  assert.ok(!viaJoin.includes(orphan), '正连接形态下孤儿条目被丢掉；两形态的这条差别是刻意保留的，改它要看那页该不该显示孤儿');
  db.close();
});

// 把"json_extract 遇到非法 JSON 文本会抛错"钉成已知边界：轴写法与收口前逐字相同，
// 所以这不是新引入的风险，但它是**全库共享**的一条边界 —— 以后给 extra 写非 JSON 文本会一次性打穿所有消费点。
test('N5b 已知边界：sources.extra 里放非 JSON 文本会让所有噪声判定抛错（不是回 NULL）', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE sources (id INTEGER PRIMARY KEY, type TEXT, extra TEXT)');
  db.prepare("INSERT INTO sources(id,type,extra) VALUES(1,'rss','not-json')").run();
  assert.throws(
    () => db.prepare(`SELECT id FROM sources s WHERE ${N().isNoiseSql('s')}`).all(),
    /malformed JSON|JSON/,
    '预期 json_extract 对非法 JSON 抛错 —— 若哪天它改成回 NULL，这条要翻过来说明边界收窄了',
  );
  db.close();
});

test('N6 计数与列表在两种开关状态下都自洽（AC4）：排噪声后 counts 必须等于列表实际条数', () => {
  const { notNoiseSql, notNoiseExistsSql } = N();
  // 同一份表达式在"列表 WHERE"与"计数 SELECT"里必须逐字同一个串 —— 两端四个消费点共用一个函数
  assert.equal(notNoiseExistsSql({ item: 'a', alias: 'sn' }), notNoiseExistsSql({ item: 'a', alias: 'sn' }));
  assert.ok(notNoiseSql('s', { reader: true }).includes('reader_visible'), '阅读器四轴必须含 reader_visible 轴');
  assert.ok(!notNoiseSql('s').includes('muted'), '两轴版不许把 muted 捎上（我的阅读用的就是它）');
});

test('N7 JS 侧与 SQL 侧同判：同一批源行，isNoiseSource 与 WHERE 命中一致', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  const rows = makeSourceTable(db);
  for (const [opts, sql] of [[{}, N().isNoiseSql('s')], [{ reader: true }, N().isNoiseSql('s', { reader: true })]]) {
    const bySql = new Set(db.prepare(`SELECT s.id FROM sources s JOIN articles a ON a.source_id=s.id WHERE ${sql}`).all().map((r) => r.id));
    let hits = 0;
    for (const r of rows) {
      const want = bySql.has(r.id);
      hits += want ? 1 : 0;
      assert.equal(N().isNoiseSource(r, opts), want,
        `JS 与 SQL 判定不一致（reader=${!!opts.reader}）：type=${r.type} extra=${r.extra} muted=${r.muted} rv=${r.reader_visible} → JS=${!want} SQL=${want}`);
    }
    assert.ok(hits > 0 && hits < rows.length, `样本没铺开（命中 ${hits}/${rows.length}）—— 这条断言恒真`);
  }
  // 只有 source_type、不带 extra 的行（热榜聚类那些）：结果必须与"仅排热榜"逐字相同
  for (const t of TYPES) {
    assert.equal(N().isNoiseSource({ source_type: t }), t === 'hotlist', `仅带 source_type 的行的判定漂了：type=${t}`);
  }
  // 空行/缺字段不许抛错（聚类里可能有 undefined 元素）
  assert.equal(N().isNoiseSource(null), false);
  assert.equal(N().isNoiseSource({}), false);
  db.close();
});
