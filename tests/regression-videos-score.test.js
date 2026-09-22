// B18（P2-6）：videos.score 落库链路——'v'+id 前缀的视频深析条目必须回写 videos.score
'use strict';
require('./helpers');
const test = require('node:test');
const assert = require('node:assert');

test('SC18-1 评分回写：文章进 articles.score、视频进 videos.score、无分跳过（B18）', async () => {
  const { persistScores } = require('../lib/score-persist');
  const calls = [];
  const qRun = async (sql, args) => calls.push({ sql, args });
  const n = await persistScores([
    { id: 101, totalScore: 88.4, reason: '好文' },
    { id: 'v55', totalScore: 76.2, reason: '好视频' },
    { id: 102, totalScore: NaN },       // 无分跳过
    { id: 'v56' },                       // 无 totalScore 跳过
  ], qRun);
  assert.equal(n, 2, `应回写 2 条，实得 ${n}`);
  assert.deepEqual(calls[0], { sql: 'UPDATE articles SET score=?, reason=? WHERE id=?', args: [88, '好文', 101] });
  assert.deepEqual(calls[1], { sql: 'UPDATE videos SET score=? WHERE id=?', args: [76, 55] },
    'v 前缀条目没进 videos 表（B18 的原始病根）');
});

test('SC18-2 videos.score 列在两份建表源都在（W24 覆盖面的延伸）', () => {
  const { parseDbFile } = require('../lib/schema-columns');
  const path = require('path');
  const libCols = parseDbFile(path.join(__dirname, '..'), 'lib/db.js').tables.get('videos');
  const srvCols = parseDbFile(path.join(__dirname, '..'), 'server/db.js').tables.get('videos');
  for (const [name, cols] of [['lib/db.js', libCols], ['server/db.js', srvCols]]) {
    assert.ok(cols.has('score'), `${name} 的 videos 缺 score 列`);
    assert.ok(cols.has('watched_at'), `${name} 的 videos 缺 watched_at 列`);
  }
});

test('SC18-3 媒体栏显示面：云端媒体查询带 score 字段（B18 可见面）', () => {
  const fs = require('fs');
  const api = fs.readFileSync(require('path').join(__dirname, '..', 'api', '[...slug].js'), 'utf8');
  assert.ok(/v\.score/.test(api), '云端媒体查询没选 score');
});
