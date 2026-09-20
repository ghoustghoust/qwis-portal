// 保留与删除语义的回归锁（B102 / spec43 D1，用户 09-20 定"本地不删内容"）。
// 为什么单独成文件：删除类断言必须能钉在**行为**上，而不是钉在"某文件里有某个字符串"上 ——
// R2 是往临时文件库里真插真删，R4 是把坏形态喂给 W17 那一份派生判据（坑 #45/#58）。
// 依赖纪律：lib/retention 是本批新建模块，一律惰性取（坑 #64）；本文件只碰 helpers 给的临时库。
require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { db } = require('../server/db');

const ret = () => require('../lib/retention');
const daysAgoIso = (d) => new Date(Date.now() - d * 86400e3).toISOString();

test('R1 三端作用域：本地不删内容、视频任何一端都不可删、skip 必须带理由', () => {
  const r = ret();
  for (const s of Object.keys(r.POLICY)) {
    const videos = r.scope(s).filter((x) => x.table === 'videos' && x.action === 'delete');
    assert.deepEqual(videos, [], `${s} 作用域把视频/播客列入了可删 —— 违反 2026-09-13 决策「视频/播客永不清理」`);
    for (const rule of r.scope(s)) {
      assert.ok(rule.table && rule.key, `${s}/${JSON.stringify(rule)} 缺字段`);
      if (rule.action === 'skip') {
        assert.ok((rule.reason || '').length >= 6,
          `${s} 跳过 ${rule.table} 却没写理由 —— 会被下一轮读成"漏接了"而不是"决定不删"`);
      }
      if (rule.action === 'delete') assert.ok(rule.col, `${s}/${rule.key} 删除却没给时间列`);
    }
  }
  const local = Object.fromEntries(r.plan('local').map((p) => [p.table, p.action]));
  assert.equal(local.articles, 'skip', '本地又开始删文章了 —— 灾备副本会自我清空（B102 原病）');
  assert.equal(local.videos, 'skip');
  assert.equal(local.pending_items, 'delete');
});

test('R2 真删真查：runner 那条保留 SQL 只删"老 + 未读 + 未收藏 + 未精选 + 非热榜"', () => {
  const r = ret();
  const normal = db.prepare("INSERT INTO sources(type,name,url,enabled,status,created_at) VALUES('rss','普通源','https://n.example.com/f',1,'ok',?)").run(daysAgoIso(1)).lastInsertRowid;
  const hot = db.prepare("INSERT INTO sources(type,name,url,enabled,status,created_at) VALUES('hotlist','热榜源','https://h.example.com/f',1,'ok',?)").run(daysAgoIso(1)).lastInsertRowid;
  const ins = db.prepare('INSERT INTO articles(source_id,title,url,published_at,created_at) VALUES(?,?,?,?,?)');
  const put = (src, title, days, patch) => {
    const id = ins.run(src, title, `https://x.example.com/${title}`, daysAgoIso(days), daysAgoIso(days)).lastInsertRowid;
    if (patch) db.prepare(`UPDATE articles SET ${patch} WHERE id=?`).run(id);
    return id;
  };
  const doomed = put(normal, '老未读', 40, null);
  const readOne = put(normal, '老已读', 40, "read_at='" + daysAgoIso(1) + "'");
  const saved = put(normal, '老稍后读', 40, 'later=1');
  const picked = put(normal, '老精选', 40, 'featured=1');
  const fresh = put(normal, '新未读', 1, null);
  const hotOld = put(hot, '热榜老未读', 40, null);

  const cutoff = r.cutoffIso(7);
  const rr = db.prepare(r.deleteSql('runner', 'retention')).run(cutoff);
  assert.equal(rr.changes, 1, '普通文章保留清理删的条数不对 —— 豁免面被改动了');
  const alive = (id) => !!db.prepare('SELECT id FROM articles WHERE id=?').get(id);
  assert.equal(alive(doomed), false, '该删的没删');
  for (const [id, why] of [[readOne, '已读'], [saved, '稍后读'], [picked, '精选'], [fresh, '新内容'], [hotOld, '热榜走另一条分支']]) {
    assert.ok(alive(id), `${why} 的文章被删了 —— 豁免失效`);
  }
  const rh = db.prepare(r.deleteSql('runner', 'hotlist')).run(r.cutoffIso(7));
  assert.equal(rh.changes, 1, '热榜分支没删掉那条 40 天前的热榜条目');
  assert.ok(!alive(hotOld), '热榜旧数据清理后仍在');

  // 反向自证（坑 #45）：真条件再来一次应当**一条都不删**；把"稍后读"豁免摘掉则两条都该没了 ——
  // 对照组没有区分度时这条锁就是空的
  const againReal = db.prepare(r.deleteSql('runner', 'retention')).run(r.cutoffIso(7));
  assert.equal(againReal.changes, 0, '再来一次还删得动 = 第一次的删除面比豁免面宽');
  const noExempt = r.ARTICLE_DELETE_COND.replace('later = 0', '1=1');
  assert.notEqual(noExempt, r.ARTICLE_DELETE_COND, '突变没生效，下面的对照没有区分度');
  const putSaved = (title) => {
    db.prepare('INSERT INTO articles(source_id,title,url,published_at,created_at) VALUES(?,?,?,?,?)')
      .run(normal, title, `https://x.example.com/${title}`, daysAgoIso(40), daysAgoIso(40));
    db.prepare('UPDATE articles SET later=1 WHERE url=?').run(`https://x.example.com/${title}`);
  };
  putSaved('老稍后读2');
  const before = db.prepare('SELECT COUNT(*) c FROM articles WHERE later=1').get().c;
  assert.equal(before, 2, '样本前提不成立（应有 2 条稍后读：老稍后读 + 老稍后读2）');
  const mutated = db.prepare(`DELETE FROM articles WHERE published_at < ? AND ${noExempt} AND source_id NOT IN (SELECT id FROM sources WHERE type='hotlist')`)
    .run(r.cutoffIso(7));
  assert.equal(mutated.changes, 2,
    '摘掉"稍后读"豁免后仍然没删 —— 说明 later 判定根本没参与这条 SQL，R2 的断言是空的');
});

test('R3 三端读同一份条件：本地/runner/云端手动端点都不许自带第二份谓词', () => {
  const r = ret();
  const cloud = r.deleteSql('runner', 'retention');
  assert.match(cloud, /read_at IS NULL/, '「已读不删」的判定不见了');
  assert.match(cloud, /later = 0/, '「稍后读不删」不见了');
  assert.match(cloud, /COALESCE\(featured, 0\) = 0/, '「精选不删」不见了');
  assert.match(cloud, /source_id NOT IN \(SELECT id FROM sources WHERE type='hotlist'\)/,
    '普通文章分支把热榜排除掉了没？没有就会与热榜分支重复删同一批');
  assert.equal(r.deleteSql('cloudManual', 'hotlist'), r.deleteSql('runner', 'hotlist'),
    '云端手动端点与 runner 的热榜清理条件分叉了（AGENTS §1 三份实现必漂）');
  // 保守约定必须还在：`'null'` 污染（B15/BL10）在订正前**不许**变成可删条件
  assert.equal(r.UNREAD_COND, 'read_at IS NULL',
    'UNREAD_COND 被改写 —— 云端 2.5 万行 read_at=\'null\' 会突然变成可删，而内容级备份还没有（B103）');
  assert.throws(() => r.cutoffIso(0), /保留天数/);
  assert.equal(r.deleteSql('local', 'videos'), null, 'local 作用域能生成 videos 的删除 SQL = B102 复发');
});

test('R4 W17 派生判据自证：坏形态必红、级联与注释里的反例不许红', () => {
  const r = ret();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-w17-'));
  try {
    fs.writeFileSync(path.join(dir, 'bad-copy.js'),
      "const db = 1;\ndb.prepare('DELETE FROM articles WHERE published_at < ? AND read_at IS NULL').run(c);\n");
    fs.writeFileSync(path.join(dir, 'bad-copy2.js'),
      "const q = \"DELETE FROM videos WHERE watched_at < ?\";\nmodule.exports = q;\n");
    fs.writeFileSync(path.join(dir, 'ok-consumer.js'),
      "const { deleteSql } = require('../lib/retention');\nmodule.exports = deleteSql('runner', 'retention');\n");
    fs.writeFileSync(path.join(dir, 'ok-cascade.js'),
      "db.prepare('DELETE FROM articles WHERE source_id=?').run(id);\n");
    fs.writeFileSync(path.join(dir, 'ok-comment.js'),
      "// 反例长这样：DELETE FROM articles WHERE published_at < ? —— 注释里的不算（坑 #63）\nmodule.exports = 1;\n");
    const res = r.findRetentionViolations(dir);
    const flagged = res.violations.map((v) => v.file).sort();
    assert.deepEqual(flagged, ['bad-copy.js', 'bad-copy2.js'],
      `应抓到两份裸谓词，实得 ${JSON.stringify(flagged)}（全量：${JSON.stringify(res.violations)}）`);
    assert.ok(res.scanned >= 5, `样本目录只扫到 ${res.scanned} 个文件 = 扫描面是空的，判据恒绿`);
    // 反向：豁免与消费点不许被算成违规
    assert.ok(!res.violations.some((v) => /^ok-/.test(v.file)), '消费点/级联/注释反例被判成第二份谓词');
    // 真仓当前必须是干净的（这条会随并行会话的改动变红，那是信息不是噪声）
    const real = r.findRetentionViolations(path.join(__dirname, '..'));
    assert.equal(real.violations.length, 0,
      `仓库里出现了不经 lib/retention 的第二份保留谓词：\n${JSON.stringify(real.violations)}`);
    assert.ok(real.consumed.length >= 3, `消费点只剩 ${real.consumed.length} 个（本地/runner/云端应都引用）：${real.consumed}`);
    // 把视频列入可删必须被 reports 出来（现场改 POLICY 再改回来，不碰文件）
    r.POLICY.local.push({ key: 'videos', table: 'videos', action: 'delete', col: 'published_at', reason: '突变样本' });
    try {
      assert.deepEqual(r.findRetentionViolations(path.join(__dirname, '..')).videosDeletable, ['local'],
        'videos 被列入可删却没报出来 = W17 的这条硬约束不干活');
    } finally {
      r.POLICY.local.pop();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
