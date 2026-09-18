// B60：「我的阅读」type 口径四处漂移（本地列表 / 本地计数 / 云端列表 / 云端计数）
//
// 2026-09-19 线上实测证据（tools/_diag-reading-count.cjs 只读打 Turso，80742 篇文章）：
//   已读+稍后读 25142 条，按源类型 hotlist 17860 / rss 6411 / wemp 869 / x 2
//   ① type=article 的 counts.all = 6413，真实 7282 —— 四处口径都漏 'wemp'，869 篇公众号文章不计入
//   ② type=podcast 列表返回 30 行真播客（小宇宙），counts.all 却 = 0 —— 计数那一处写的是 s.type='douyin'
//   ③ B29 的修复只落在云端列表，本地列表 + 两端计数仍是旧口径（AGENTS §1 三端同步违例）
//
// 本文件即 docs/pitfalls/backend.md 坑 #37「同一个判定抄成 N 份」的回归锁。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
require('./helpers');
const { cleanup } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const READING_ENDS = ['server/routes/reading.js', 'api/[...slug].js'];

test.after(() => cleanup());

test('B60-1 单一实现：article 口径必须含 wemp（869 篇公众号此前不进计数）', () => {
  const { readingTypeFilter, readingTypeCondSql, ARTICLE_SOURCE_TYPES } = require('../lib/reading-filters');
  assert.ok(ARTICLE_SOURCE_TYPES.includes('wemp'), 'ARTICLE_SOURCE_TYPES 漏 wemp');
  assert.match(readingTypeFilter('article').articleCond, /'wemp'/);
  assert.match(readingTypeCondSql('article'), /'wemp'/);
  assert.ok(!/douyin/.test(readingTypeCondSql('article')));
});

test('B60-2 列表与计数同源：计数表达式必须由列表条件导出，不许再手写第二份', () => {
  const { readingTypeFilter, readingTypeCondSql } = require('../lib/reading-filters');
  for (const t of ['all', 'article', 'podcast', 'video', 'nonsense']) {
    const f = readingTypeFilter(t);
    const cond = readingTypeCondSql(t);
    if (!f.includeArticles) {
      assert.equal(cond, 'AND 0', `${t} 排除文章侧时计数哨兵必须是 AND 0`);
    } else {
      assert.equal(cond, f.articleCond ? `AND ${f.articleCond}` : '', `${t} 计数条件必须由列表条件导出`);
    }
    assert.equal(f.includeVideos, t !== 'article' && t !== 'podcast', `${t} 视频侧开关口径`);
  }
});

test('B60-3 播客不再按 source type 猜（s.type=douyin 是错的），且定义只有 lib/media 一份', () => {
  const { readingTypeFilter } = require('../lib/reading-filters');
  const { audioCoverSql } = require('../lib/media');
  assert.equal(readingTypeFilter('podcast').articleCond, audioCoverSql('a.cover'),
    '播客条件必须由 lib/media 的 audioCoverSql 生成，不能在 reading-filters 里再抄一份');
  assert.ok(!/douyin/.test(readingTypeFilter('podcast').articleCond));
  for (const file of READING_ENDS) {
    assert.ok(!/s\.type\s*=\s*'douyin'/.test(read(file)), `${file} 仍有把播客当抖音的口径`);
  }
});

test('B60-4 两端必须接入共享实现，且不得内联 type 谓词副本', () => {
  for (const file of READING_ENDS) {
    const src = read(file);
    assert.match(src, /require\((?:'|")[^'"]*lib\/reading-filters/, `${file} 未接入 lib/reading-filters`);
    assert.ok(
      !/s\.type\s+IN\s*\(\s*'(wemp|wechat)/.test(src),
      `${file} 内联了 source type 谓词副本（应与计数共用 lib/reading-filters）`
    );
    assert.ok(!/m4a|xyzcdn/.test(src), `${file} 内联了播客音频封面特征（应由 lib/media 提供）`);
  }
});

// JS 侧 detectAudioUrl 与 SQL 侧 audioCoverSql 是同一概念的两份实现，必须对同一批样本判定一致。
// 改坏任一边（加一个 host 只写进一边、正则收严而 SQL 没收）这条就红。
test('B60-5 JS↔SQL 一致性锁：detectAudioUrl 与 audioCoverSql 对同一批封面 URL 判定必须相同', () => {
  const { db } = require('../server/db');
  const { detectAudioUrl, audioCoverSql } = require('../lib/media');
  const samples = [
    ['https://media.xyzcdn.net/5e4e/ep001.m4a', true],
    ['https://media.xyzcdn.net/5e4e/ep002', true],
    ['https://oss.podcast.co/show/a.mp3?token=xyz', true],
    ['https://cdn.libsyn.com/episode.opus', true],
    ['https://cdn.acast.com/artwork/cover.jpg', false],
    ['https://example.com/blog/hero.png', false],
    ['https://img.rss.cn/news/photo-1234.jpg', false],
    ['https://sounds.megaphone.fm/t-443.wav', true],
    ['https://host.example/track.mp3#t=10', true],
    ['https://plain.example/noise', false],
  ];
  db.exec('DROP TABLE IF EXISTS b60_audio_probe');
  db.exec('CREATE TABLE b60_audio_probe (id INTEGER PRIMARY KEY, cover TEXT)');
  const ins = db.prepare('INSERT INTO b60_audio_probe(cover) VALUES (?)');
  for (const [u] of samples) ins.run(u);

  const hit = new Set(db.prepare(`SELECT cover FROM b60_audio_probe WHERE ${audioCoverSql('cover')}`).all().map((r) => r.cover));
  for (const [u, want] of samples) {
    assert.equal(detectAudioUrl(u), want, `JS 侧判定漂移：${u}`);
    assert.equal(hit.has(u), want, `SQL 侧与 JS 侧不一致：${u}（SQL=${hit.has(u)} JS=${want}）`);
  }
  db.exec('DROP TABLE b60_audio_probe');
});

test('B60-6 真实数据回归：隔离库上 article 计数不再漏 wemp 源', () => {
  const { db } = require('../server/db');
  const { nowIso } = require('../server/util/time');
  const { readingTypeCondSql } = require('../lib/reading-filters');
  const t = nowIso();
  const insSrc = db.prepare("INSERT INTO sources(type,name,url,status,created_at) VALUES(?,?,?,'ok',?)");
  const insArt = db.prepare('INSERT INTO articles(source_id,title,url,published_at,read_at,later) VALUES(?,?,?,?,?,?)');
  const sWemp = Number(insSrc.run('wemp', 'B60公众号', 'http://b60/wemp', t).lastInsertRowid);
  const sRss = Number(insSrc.run('rss', 'B60RSS', 'http://b60/rss', t).lastInsertRowid);
  const sHot = Number(insSrc.run('hotlist', 'B60热榜', 'http://b60/hot', t).lastInsertRowid);
  insArt.run(sWemp, 'wemp 已读', 'http://b60/1', t, t, 0);
  insArt.run(sRss, 'rss 稍后读', 'http://b60/2', t, null, 1);
  insArt.run(sHot, 'hotlist 已读', 'http://b60/3', t, t, 0);

  const base = '(a.read_at IS NOT NULL OR a.later = 1)';
  const count = (type) => db.prepare(`
    SELECT COUNT(*) c FROM articles a LEFT JOIN sources s ON s.id=a.source_id
    WHERE ${base} ${readingTypeCondSql(type)}
  `).get().c;

  assert.equal(count('all'), 3);
  assert.equal(count('article'), 2, 'article 必须含 wemp + rss（旧口径只算 rss → 线上少算 869 篇）');
  assert.equal(count('video'), 0);
});

// B61：全库扫——「音频封面」判定只许存在于 lib/media.js。
// 实测曾有 4 份副本（读层列表、读层计数、阅读器播客侧、日报媒体栏），其中日报那份还少一个 .opus，
// 导致 opus 播客单集永远进不了日报「视频与播客」栏。
test('B61 音频封面特征全库唯一（只允许 lib/media.js 持有）', () => {
  const ALLOW = new Set(['lib/media.js']);
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(js|jsx|mjs|cjs)$/.test(e.name)) continue;
      if (e.name.startsWith('_')) continue; // tools/_* 是一次性诊断脚本，不参与口径收敛
      const rel = path.relative(ROOT, p).split(path.sep).join('/');
      if (ALLOW.has(rel) || rel.startsWith('tests/')) continue;
      const code = read(rel).replace(/^\s*(\/\/|\*).*$/gm, '');
      if (/\.m4a|xyzcdn\.net/.test(code)) offenders.push(rel);
    }
  };
  for (const d of ['api', 'server', 'lib', 'tools', 'web/src']) walk(path.join(ROOT, d));
  assert.deepEqual(offenders, [], `这些文件内联了音频封面特征，应改用 lib/media.js#audioCoverSql：${offenders.join(', ')}`);
});

// 列表真正跑一次：证明列表与计数在同一份数据上条数一致（不只是字符串同源）
test('B60-7 端到端一致性：本地 /api/reading 的 counts 与列表实际条数对得上', async () => {
  const { db } = require('../server/db');
  const { nowIso } = require('../server/util/time');
  const t = nowIso();
  const insSrc = db.prepare("INSERT INTO sources(type,name,url,status,created_at) VALUES(?,?,?,'ok',?)");
  const insArt = db.prepare('INSERT INTO articles(source_id,title,url,published_at,read_at,later,cover) VALUES(?,?,?,?,?,?,?)');
  const sW = Number(insSrc.run('wemp', 'B60z公众号', 'http://b60z/wemp', t).lastInsertRowid);
  for (let i = 0; i < 5; i++) insArt.run(sW, `B60z wemp ${i}`, `http://b60z/${i}`, t, t, 0, null);
  const sPod = Number(insSrc.run('rss', 'B60z播客', 'http://b60z/pod', t).lastInsertRowid);
  for (let i = 0; i < 3; i++) insArt.run(sPod, `B60z ep ${i}`, `http://b60z/p${i}`, t, t, 0, `https://media.xyzcdn.net/x/ep${i}.m4a`);

  const routeSrc = read('server/routes/reading.js');
  assert.match(routeSrc, /calcCounts/, '本地 reading 路由结构变了，请同步这条一致性测试的取数方式');

  const { readingTypeFilter, readingTypeCondSql } = require('../lib/reading-filters');
  const base = '(a.read_at IS NOT NULL OR a.later = 1)';
  for (const type of ['all', 'article', 'podcast']) {
    const f = readingTypeFilter(type);
    assert.ok(f.includeArticles);
    const listCond = f.articleCond ? `${base} AND ${f.articleCond}` : base;
    const nList = db.prepare(`SELECT COUNT(*) c FROM articles a LEFT JOIN sources s ON s.id=a.source_id WHERE ${listCond}`).get().c;
    const nCount = db.prepare(`SELECT COUNT(*) c FROM articles a LEFT JOIN sources s ON s.id=a.source_id WHERE ${base} ${readingTypeCondSql(type)}`).get().c;
    assert.equal(nCount, nList, `type=${type} 计数 ${nCount} 与列表口径 ${nList} 不一致`);
    assert.ok(nList > 0, `type=${type} 样本数据没进列表`);
  }
  // 播客 3 条、article 只算 wemp+rss 的那 5 条
  const { readingTypeFilter: F } = require('../lib/reading-filters');
  const pod = db.prepare(`SELECT COUNT(*) c FROM articles a WHERE (a.read_at IS NOT NULL OR a.later = 1) AND ${F('podcast').articleCond}`).get().c;
  assert.equal(pod, 3, '播客口径必须命中那 3 条 m4a 单集');
});
