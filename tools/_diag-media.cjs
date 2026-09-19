// 诊断：云端视频/播客数据状态
const fs = require('fs');
for (const line of fs.readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
(async () => {
  const { createClient } = require('@libsql/client');
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;

  console.log('=== 视频新鲜度（按平台）===');
  for (const r of await q("SELECT platform, COUNT(*) n, MAX(published_at) latest, SUM(CASE WHEN cover IS NULL OR cover='' THEN 1 ELSE 0 END) no_cover FROM videos GROUP BY platform")) {
    console.log(` ${r.platform}: ${r.n} 个, 最新 ${r.latest}, 无封面 ${r.no_cover}`);
  }
  console.log('=== 视频源采集状态 ===');
  for (const r of await q("SELECT s.type, COUNT(*) n, SUM(s.enabled) enabled, MAX(NULLIF(s.last_fetched_at,'null')) last_fetch, SUM(CASE WHEN s.next_fetch_at IS NULL THEN 1 ELSE 0 END) no_next FROM sources s WHERE s.type IN ('youtube','bilibili','douyin') GROUP BY s.type")) {
    console.log(` ${r.type}: ${r.n} 源 (${r.enabled} 启用), 最近采集 ${r.last_fetch}, 无下次排期 ${r.no_next}`);
  }
  console.log('=== 播客（音频条目）规模 ===');
  const pod = await q("SELECT COUNT(*) n, MAX(published_at) latest FROM articles WHERE cover LIKE '%.m4a%' OR cover LIKE '%.mp3%' OR cover LIKE '%media.xyzcdn.net%'");
  console.log(` 音频条目: ${pod[0].n}, 最新 ${pod[0].latest}`);
  const podSrc = await q("SELECT COUNT(DISTINCT a.source_id) n FROM articles a WHERE a.cover LIKE '%.m4a%' OR a.cover LIKE '%.mp3%' OR a.cover LIKE '%media.xyzcdn.net%'");
  console.log(` 涉及源: ${podSrc[0].n}`);
  console.log('=== 日报/我的早报是否含视频 ===');
  const daily = await q("SELECT sections FROM daily_reports ORDER BY generated_at DESC LIMIT 1");
  if (daily[0]) {
    const secs = JSON.parse(daily[0].sections || '[]');
    const vids = secs.flatMap((s) => s.items || []).filter((i) => i.kind === 'video');
    console.log(` 最新日报: ${secs.length} 栏, 视频条目 ${vids.length}`);
  }
})();
