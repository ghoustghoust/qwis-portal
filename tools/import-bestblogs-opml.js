#!/usr/bin/env node
/**
 * tools/import-bestblogs-opml.js —— bestblogs OPML 源迁移（2026-09-04，we-mp-rss 退役）
 *
 * 把 opml/ 下三个 bestblogs OPML 导入为正式订阅源：
 *   wechat2rss(375 公众号) → type='rss'    分组「公众号」(全文在 content:encoded，rss 适配器已支持)
 *   youtube(124 频道)      → type='youtube' 分组「YouTube」(rss 适配器别名，入 videos 表；需代理可达)
 *   podcast(60 小宇宙)     → type='rss'    分组「播客」
 * 并把旧 wemp 源(we-mp-rss)全部停用(enabled=0，保留历史文章不删)。
 *
 * 用法：node tools/import-bestblogs-opml.js          # dry-run，只打印不写库
 *       node tools/import-bestblogs-opml.js --apply  # 实际写库
 *
 * 安全：URL 去重（已存在跳过）；同名 rss/youtube 源跳过；next_fetch_at 在 6h 内随机错峰，防首刷风暴。
 */
const path = require('path');
const fs = require('fs');
const { db } = require('../server/db');
const { nowIso } = require('../server/util/time');

const APPLY = process.argv.includes('--apply');
const OPML_DIR = path.join(__dirname, '..', 'opml');

const FILES = [
  { file: 'bestblogs_wechat2rss_opml_all.opml', type: 'rss', group: '公众号', kind: 'article', origin: 'wechat2rss' },
  { file: 'bestblogs_youtube_opml_all.opml', type: 'youtube', group: 'YouTube', kind: 'video', origin: 'bestblogs-youtube' },
  // 播客不做同名去重：与公众号「同品牌不同媒介」（URL 不同），同名去重会误杀（2026-09-04 审查发现丢 7 个）
  { file: 'bestblogs_podcast_opml_all.opml', type: 'rss', group: '播客', kind: 'article', origin: 'bestblogs-podcast', dedupName: false },
];

function parseOpml(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /<outline\b[^>]*>/g;
  let m;
  while ((m = re.exec(xml))) {
    const tag = m[0];
    const url = (tag.match(/xmlUrl="([^"]*)"/) || [])[1];
    const title = (tag.match(/(?:text|title)="([^"]*)"/) || [])[1];
    if (url && title) out.push({ title: title.trim(), url: url.trim() });
  }
  return out;
}

function getOrCreateGroup(name, kind) {
  const row = db.prepare('SELECT id FROM groups WHERE name=? AND kind=?').get(name, kind);
  if (row) return row.id;
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort),0) s FROM groups').get().s;
  return db.prepare('INSERT INTO groups(kind, name, sort) VALUES(?,?,?)').run(kind, name, maxSort + 1).lastInsertRowid;
}

const report = { groups: {}, imported: [], skippedDupUrl: 0, skippedDupName: 0, wempDisabled: 0 };

const existingUrl = db.prepare('SELECT id FROM sources WHERE url=?');
const existingNameType = db.prepare('SELECT id FROM sources WHERE name=? AND type=?');
const insert = db.prepare(
  `INSERT INTO sources(type, name, url, group_id, enabled, status, extra, created_at, next_fetch_at)
   VALUES (?, ?, ?, ?, 1, 'ok', ?, ?, ?)`
);

for (const f of FILES) {
  const file = path.join(OPML_DIR, f.file);
  if (!fs.existsSync(file)) { console.log(`⚠️  缺文件 ${f.file}，跳过`); continue; }
  const items = parseOpml(file);
  const gid = APPLY ? getOrCreateGroup(f.group, f.kind) : `(新分组「${f.group}」)`;
  let added = 0;
  for (const it of items) {
    if (existingUrl.get(it.url)) { report.skippedDupUrl++; continue; }
    if (f.dedupName !== false && existingNameType.get(it.title, f.type)) { report.skippedDupName++; continue; }
    if (APPLY) {
      // 首刷错峰：0~360min 随机，防 559 个源在同一 tick 里串行打满
      const next = new Date(Date.now() + Math.floor(Math.random() * 360) * 60e3).toISOString();
      insert.run(f.type, it.title, it.url, gid, JSON.stringify({ origin: f.origin, migratedAt: nowIso() }), nowIso(), next);
    }
    added++;
  }
  report.groups[f.file] = { total: items.length, added };
  report.imported.push(`${f.group}: ${added}/${items.length}`);
}

// 停用旧 wemp 源（保留历史文章；we-mp-rss 退役）
const wempCount = db.prepare("SELECT COUNT(*) c FROM sources WHERE type='wemp' AND enabled=1").get().c;
if (APPLY && wempCount) {
  db.prepare("UPDATE sources SET enabled=0 WHERE type='wemp'").run();
}
report.wempDisabled = wempCount;

console.log(APPLY ? '\n=== 迁移已执行 ===' : '\n=== DRY-RUN（加 --apply 实际执行）===');
for (const line of report.imported) console.log(`  ✅ ${line}`);
console.log(`  ⏭️  URL 重复跳过 ${report.skippedDupUrl}，同名同类型跳过 ${report.skippedDupName}`);
console.log(`  🔌 停用 wemp 源 ${report.wempDisabled} 个（文章保留）`);
if (!APPLY) console.log('\n确认无误后执行：node tools/import-bestblogs-opml.js --apply');
