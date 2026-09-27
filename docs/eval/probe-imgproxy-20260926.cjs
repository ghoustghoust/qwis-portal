// 一次性只读探针：现役公众号源与 wechat2rss img-proxy 到底有没有关联
// 跑法：node docs/eval/probe-imgproxy-20260926.cjs   （只读打开 data/app.db，零写入）
const path = require('path');
const Database = require('better-sqlite3');

const DB = path.join(__dirname, '..', '..', 'data', 'app.db');
const db = new Database(DB, { readonly: true, fileMustExist: true });

const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
console.log('sources 列:', cols('sources').join(','));
console.log('articles 列:', cols('articles').slice(0, 14).join(','));

const urlCol = cols('sources').find((c) => /xml_url|feed_url|url/i.test(c));
const typeCount = db.prepare('SELECT type, COUNT(*) n, SUM(enabled) enabled FROM sources GROUP BY type ORDER BY n DESC').all();
console.log('\n== 源按类型 ==');
for (const r of typeCount) console.log(`  ${r.type}: ${r.n} 个（enabled 合计 ${r.enabled ?? 0}）`);

const likeHost = `%wechat2rss%`;
const wechat = db
  .prepare(`SELECT id, name, type, enabled FROM sources WHERE ${urlCol} LIKE ? LIMIT 20`)
  .all(likeHost);
const wechatAll = db.prepare(`SELECT COUNT(*) n FROM sources WHERE ${urlCol} LIKE ?`).get(likeHost);
console.log(`\n== ${urlCol} 命中 wechat2rss 的源：${wechatAll.n} 个 ==`);
for (const r of wechat) console.log(`  #${r.id} ${r.type} enabled=${r.enabled} ${r.name}`);

// 这些源的文章正文里，图片域名到底长什么样
const ids = db.prepare(`SELECT id FROM sources WHERE ${urlCol} LIKE ?`).all(likeHost).map((r) => r.id);
if (!ids.length) {
  console.log('\n没有 wechat2rss 源，探针结束。');
  process.exit(0);
}
const artCount = db
  .prepare(`SELECT COUNT(*) n, SUM(CASE WHEN content_html IS NULL OR content_html='' THEN 1 ELSE 0 END) empty FROM articles WHERE source_id IN (${ids.map(() => '?').join(',')})`)
  .get(...ids);
console.log(`\n== 这些源的文章：${artCount.n} 篇，其中正文为空 ${artCount.empty ?? 0} 篇 ==`);

const rows = db
  .prepare(`SELECT id, title, substr(content_html,1,60000) html FROM articles WHERE source_id IN (${ids.map(() => '?').join(',')}) AND content_html IS NOT NULL AND length(content_html)>200 LIMIT 40`)
  .all(...ids);
const hosts = new Map();
for (const r of rows) {
  for (const m of r.html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    let host = '';
    try {
      host = new URL(m[1].replace(/&amp;/g, '&')).host;
    } catch {
      host = '(无法解析)';
    }
    hosts.set(host, (hosts.get(host) || 0) + 1);
  }
}
console.log(`\n== ${rows.length} 篇正文里的 img 域名分布 ==`);
for (const [h, n] of [...hosts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${h}: ${n}`);
const prox = [...hosts.keys()].filter((h) => /proxy/i.test(h));
console.log(`\n含 "proxy" 字样的域名：${prox.length ? prox.join(', ') : '无'}`);
