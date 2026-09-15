// 2026-09-15 用户拍板操作：A 类死 feed 删除 + YouTube 误写 articles 迁移 videos + 播客桥接源降频 3 天
const fs = require('fs');
for (const l of fs.readFileSync('.env','utf8').split(/\r?\n/)) { const m = /^([A-Z_]+)=(.+)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const DEAD_FEEDS = [1467, 799, 817, 1070, 1272, 820, 1141, 1063, 1057, 1118]; // A 类纯 RSS 死 feed

(async () => {
  // ── ① A 类死 feed 级联删除（其文章全是零内容空壳，无信息损失） ──
  let delArt = 0;
  for (const sid of DEAD_FEEDS) {
    const a = await db.execute({ sql: 'DELETE FROM articles WHERE source_id=?', args: [sid] });
    const s = await db.execute({ sql: 'DELETE FROM sources WHERE id=?', args: [sid] });
    delArt += a.rowsAffected;
    console.log(`删除源 #${sid}: 文章 ${a.rowsAffected} 行 / 源 ${s.rowsAffected} 行`);
  }
  console.log(`① 死 feed 删除完成：10 源，${delArt} 空壳文章行`);

  // ── ② YouTube 误写 articles → 迁移到 videos 表（2026-09-14 写入路径已修，此为存量） ──
  const rows = await db.execute(`SELECT a.id, a.title, a.url, a.cover, a.summary, a.published_at, a.created_at, s.name sname
    FROM articles a JOIN sources s ON s.id=a.source_id WHERE s.type='youtube'`);
  let moved = 0, dupSkipped = 0, noVid = 0;
  for (const r of rows.rows) {
    const m = String(r.url || '').match(/[?&]v=([\w-]+)/) || String(r.url || '').match(/youtu\.be\/([\w-]+)/);
    const vid = m ? m[1] : null;
    if (!vid) { noVid++; continue; }
    const ins = await db.execute({
      sql: `INSERT OR IGNORE INTO videos(source_id, platform, title, url, vid, cover, author, intro, published_at, created_at)
            SELECT s.id, 'youtube', ?, ?, ?, COALESCE(?, 'https://i.ytimg.com/vi/' || ? || '/hqdefault.jpg'), ?, ?, ?, ? FROM sources s WHERE s.id =
              (SELECT source_id FROM articles WHERE id=?)`,
      args: [r.title, r.url, vid, r.cover, vid, r.sname, r.summary || null, r.published_at, r.created_at, r.id],
    });
    if (ins.rowsAffected > 0) moved++; else dupSkipped++;
  }
  const delYt = await db.execute(`DELETE FROM articles WHERE source_id IN (SELECT id FROM sources WHERE type='youtube')`);
  console.log(`② YouTube 存量：${rows.rows.length} 行 → 迁入 videos ${moved}（重复已在 videos 跳过 ${dupSkipped}，无 vid 无法迁移 ${noVid}）；articles 表清掉 ${delYt.rowsAffected} 行`);

  // ── ③ 播客桥接源降频 3 天（4320min；用户口径：小宇宙日更低频，3 天一次可覆盖） ──
  const pods = await db.execute(`SELECT id, extra FROM sources WHERE type='rss' AND (url LIKE '%xiaoyuzhoufm%' OR url LIKE '%xiaoyuzhou%' OR json_extract(COALESCE(extra,'{}'),'$.origin')='bestblogs-podcast')`);
  let adj = 0;
  for (const p of pods.rows) {
    let ex = {}; try { ex = JSON.parse(p.extra || '{}'); } catch { /* 重置 */ }
    if (ex.intervalMin === 4320) continue;
    ex.intervalMin = 4320;
    await db.execute({ sql: 'UPDATE sources SET extra=? WHERE id=?', args: [JSON.stringify(ex), p.id] });
    adj++;
  }
  console.log(`③ 播客桥接源降频 3 天：${adj}/${pods.rows.length} 个调整`);

  // 汇总校验
  const yt = await db.execute("SELECT COUNT(*) c FROM articles a JOIN sources s ON s.id=a.source_id WHERE s.type='youtube'");
  console.log('校验：articles 表残留 youtube 行 =', yt.rows[0].c);
  const vc = await db.execute("SELECT COUNT(*) c FROM videos WHERE platform='youtube'");
  console.log('校验：videos 表 youtube 总数 =', vc.rows[0].c);
  db.close(); process.exitCode = 0;
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
