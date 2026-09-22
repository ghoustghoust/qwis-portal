// B86（P3-3）：本地端日报补「视频与播客」栏——播客走 audioCoverSql 唯一口径，与云端同栏同形状
'use strict';
require('./helpers'); // 先于 server/*：临时 APP_DATA_DIR
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

test('BM1 本地日报媒体栏：窗口内视频与播客都进「视频与播客」栏（B86）', async () => {
  const { db } = require('../server/db');
  const t = new Date().toISOString();
  db.prepare("INSERT INTO sources(type,name,url,enabled,status,created_at) VALUES('rss','BM源','http://bm/f',1,'ok',?)").run(t);
  const sid = db.prepare('SELECT id FROM sources LIMIT 1').get().id;
  db.prepare('INSERT INTO videos(source_id,platform,title,url,published_at,created_at) VALUES(?,?,?,?,?,?)')
    .run(sid, 'youtube', 'BM视频', 'http://bm/v1', t, t);
  db.prepare('INSERT INTO articles(source_id,title,url,published_at,created_at,cover) VALUES(?,?,?,?,?,?)')
    .run(sid, 'BM播客单集', 'http://bm/p1', t, t, 'https://media.xyzcdn.net/bm/ep1.opus');
  const daily = require('../server/services/ai/daily');
  const rep = await daily.generate(48);
  const media = (rep.sections || []).find((s) => s.column === '视频与播客');
  assert.ok(media, '本地日报没有「视频与播客」栏：' + (rep.sections || []).map((s) => s.column).join(','));
  const kinds = media.items.map((i) => `${i.kind}:${i.title}`);
  assert.ok(kinds.some((k) => k === 'video:BM视频'), '视频没进媒体栏：' + kinds.join(','));
  assert.ok(kinds.some((k) => k === 'podcast:BM播客单集'), '播客没进媒体栏（audioCoverSql 没接上）：' + kinds.join(','));
  const pod = media.items.find((i) => i.kind === 'podcast');
  assert.equal(pod.audio_url, 'https://media.xyzcdn.net/bm/ep1.opus', '播客条目没带 audio_url');
});

test('BM2 无媒体候选时不出空栏（B86 边界）', async () => {
  const daily = require('../server/services/ai/daily');
  const { db } = require('../server/db');
  db.prepare('DELETE FROM videos').run();
  db.prepare('DELETE FROM articles').run();
  const rep = await daily.generate(48);
  assert.ok(!(rep.sections || []).some((s) => s.column === '视频与播客' && !s.items.length), '出了空的媒体栏');
});

test('BM3 播客判定不自带第四份：daily.js 引 lib/media.js#audioCoverSql（B61/B86 形态）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'services', 'ai', 'daily.js'), 'utf8');
  assert.ok(src.includes("require('../../../lib/media')") && src.includes('audioCoverSql'), 'daily.js 没接唯一口径');
});
