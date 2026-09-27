// 全量普查（不是抽样）：现役公众号源与退役 wemp 源的正文图片域名分布，逐行扫到底
// 跑法：node docs/eval/probe-imgproxy-census-20260926.cjs   （只读 data/app.db，零写入）
const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, '..', '..', 'data', 'app.db'), { readonly: true, fileMustExist: true });

const PRED = {
  'hosted-wechat2rss': "url LIKE '%wechat2rss%'",
  'retired-wemp': "type = 'wemp'",
  other: "url NOT LIKE '%wechat2rss%' AND type <> 'wemp'",
};
const idsOf = (kind) => db.prepare(`SELECT id FROM sources WHERE ${PRED[kind]}`).all().map((r) => r.id);

// 逐组扫全部文章的 img 域名；只保留计数，不留正文
function census(kind) {
  const ids = idsOf(kind);
  if (!ids.length) return { docs: 0, withImg: 0, hosts: new Map() };
  const hosts = new Map();
  let docs = 0;
  let withImg = 0;
  let imgs = 0;
  const stmt = db.prepare(`SELECT id, content_html FROM articles WHERE source_id IN (${ids.map(() => '?').join(',')})`);
  for (const r of stmt.iterate(...ids)) {
    docs++;
    const html = r.content_html || '';
    const found = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)];
    if (!found.length) continue;
    withImg++;
    for (const m of found) {
      imgs++;
      let h;
      try {
        h = new URL(m[1].replace(/&amp;/g, '&')).host;
      } catch {
        h = '(相对路径或无法解析)';
      }
      hosts.set(h, (hosts.get(h) || 0) + 1);
    }
  }
  return { docs, withImg, imgs, sources: ids.length, hosts };
}

for (const kind of ['hosted-wechat2rss', 'retired-wemp', 'other']) {
  const c = census(kind);
  console.log(`\n== ${kind}：源 ${c.sources ?? 0} 个 / 文章 ${c.docs} 篇 / 含图 ${c.withImg} 篇 / 图 ${c.imgs ?? 0} 张 ==`);
  const top = [...(c.hosts || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [h, n] of top) console.log(`   ${h}: ${n}`);
  console.log(`   域名总数：${(c.hosts || new Map()).size}`);
}
