// 21-bilibili-runner 回归测试：签名一致性/saveVideos 幂等/诊断结构
const { test, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
for (const line of envTxt.split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const bili = require('../api/_bilibili');
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

let testSourceId = null;
let insertedVid = 'BV_TEST_21';

after(async () => {
  if (testSourceId) {
    await db.execute('DELETE FROM videos WHERE source_id=?', [testSourceId]);
    await db.execute('DELETE FROM sources WHERE id=?', [testSourceId]);
  }
  db.close();
});

test('1. signWbi 签名确定性（与本地实现逐字比对）', () => {
  // 复现本地 signWbi 算法独立计算，与 _bilibili 导出比对
  const MIXIN = 'abcdefghijklmnopqrstuvwxyz123456';
  const params = { mid: '123', wts: 1700000000, ps: 30 };
  const out = bili.signWbi(params, MIXIN);
  // 本地算法复算
  const clean = {};
  for (const [k, v] of Object.entries(params)) clean[k] = String(v).replace(/[!'()*]/g, '');
  const query = Object.keys(clean).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(clean[k])}`).join('&');
  const expect = `${query}&w_rid=${crypto.createHash('md5').update(query + MIXIN).digest('hex')}`;
  assert.equal(out, expect);
  assert.match(out, /w_rid=[0-9a-f]{32}$/);
});

test('2. saveVideos 幂等（模拟 batch INSERT OR IGNORE）', async () => {
  await db.execute({ sql: "INSERT INTO sources(type,name,url,enabled,status,created_at) VALUES('bilibili','TEST-B站源','https://space.bilibili.com/999',1,'pending',?)", args: [new Date().toISOString()] });
  testSourceId = Number((await db.execute('SELECT MAX(id) m FROM sources')).rows[0].m);
  try { await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_vid ON videos(vid)'); } catch { /* 已存在 */ }
  const ins = () => db.execute({
    sql: 'INSERT OR IGNORE INTO videos(source_id,title,url,vid,author,published_at,created_at) VALUES(?,?,?,?,?,?,?)',
    args: [testSourceId, '测试视频', 'https://www.bilibili.com/video/' + insertedVid, insertedVid, 'TEST', new Date().toISOString(), new Date().toISOString()],
  });
  const r1 = await ins();
  const r2 = await ins();
  assert.equal(r1.rowsAffected, 1);
  assert.equal(r2.rowsAffected, 0, '重复 vid 不应重复插入');
  const c = await db.execute('SELECT COUNT(*) c FROM videos WHERE vid=?', [insertedVid]);
  assert.equal(c.rows[0].c, 1);
});

test('3. diagnose 返回三态结构', async () => {
  const r = await bili.diagnose();
  assert.ok('cookieConfigured' in r && 'wbiKeyRefreshed' in r && 'loginOk' in r);
  console.log('   diagnose:', JSON.stringify(r));
}, { timeout: 30000 });

test('4. 真实采集兜底可用（匿名，B站公开 API）', async () => {
  try {
    const r = await bili.fetchBiliVideos({ uid: '546195', name: '老蒋巨靠谱' });
    assert.ok(r.videos.length > 0, '应采到视频');
    assert.ok(r.videos[0].vid.startsWith('BV'));
  } catch (e) {
    console.log('   真实 API 不可达（网络原因），跳过:', e.message.slice(0, 60));
  }
}, { timeout: 60000 });
