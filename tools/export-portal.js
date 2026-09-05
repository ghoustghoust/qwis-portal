// Vercel 只读门户数据导出：SQLite → portal/public/data/*.json
// 用法: node tools/export-portal.js
const path = require('path');
const fs = require('fs');
process.env.APP_DATA_DIR = process.env.APP_DATA_DIR || path.join(__dirname, '..', 'data');
const { db } = require('../server/db');

const OUT_DIR = path.join(__dirname, '..', 'portal', 'public', 'data');
fs.mkdirSync(OUT_DIR, { recursive: true });

function writeJson(name, obj) {
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, JSON.stringify(obj));
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`  ${name}: ${kb} KB`);
}

function main() {
  // 1. 最新日报
  const daily = require('../server/services/ai/daily');
  const report = daily.getLatest();

  // 2. 近 3 天文章(按领域分组,截 500 条)
  const cutoff = new Date(Date.now() - 72 * 3600e3).toISOString();
  const rows = db.prepare(`
    SELECT a.id, a.title, a.url, a.summary, a.cover, a.published_at, a.score, a.content_html,
           s.name AS source_name, s.type AS source_type, g.name AS domain
    FROM articles a
    JOIN sources s ON s.id = a.source_id AND s.enabled = 1
    LEFT JOIN groups g ON g.id = s.group_id
    WHERE a.published_at >= ?
    ORDER BY a.published_at DESC LIMIT 500
  `).all(cutoff);

  // 3. 事件热点榜
  const events = require('../server/services/events');
  const evts = events.getEvents('all').slice(0, 50);

  // 4. 分组 + 未读数;源列表(云端侧栏用)
  const groups = db.prepare(`
    SELECT g.id, g.name, g.sort,
      (SELECT count(*) FROM articles a JOIN sources s2 ON s2.id=a.source_id
       WHERE s2.group_id=g.id AND a.read_at IS NULL) AS unread
    FROM groups g WHERE g.kind='article' ORDER BY g.sort
  `).all();
  const sources = db.prepare(`
    SELECT s.id, s.name, s.type, s.avatar, s.group_id, s.status,
      (SELECT count(*) FROM articles a WHERE a.source_id=s.id AND a.read_at IS NULL) AS unread
    FROM sources s WHERE s.enabled=1 ORDER BY s.id
  `).all();

  // 5. 视频条目(近 3 天)
  const vcut = new Date(Date.now() - 72 * 3600e3).toISOString();
  const videos = db.prepare(`
    SELECT v.id, v.title, v.url, v.cover, v.vid, v.platform, v.author, v.intro, v.published_at, v.duration, s.name AS source_name, s.type AS source_type
    FROM videos v JOIN sources s ON s.id=v.source_id AND s.enabled=1
    WHERE v.published_at >= ? ORDER BY v.published_at DESC LIMIT 200
  `).all(vcut);

  // 6. AIHOT 时间轴(近 7 天)
  const acut = new Date(Date.now() - 7 * 24 * 3600e3).toISOString();
  const aihot = db.prepare(`
    SELECT a.id, a.title, a.url, a.summary, a.cover, a.published_at, a.score, a.category, a.source_id, s.name AS source_name
    FROM articles a JOIN sources s ON s.id=a.source_id
    WHERE s.name LIKE 'AIHOT%' AND a.published_at >= ? ORDER BY a.published_at DESC LIMIT 300
  `).all(acut);

  writeJson('daily-latest.json', report || null);
  writeJson('articles.json', rows);
  writeJson('events.json', evts);
  writeJson('groups.json', groups);
  writeJson('sources.json', sources);
  writeJson('videos.json', videos);
  writeJson('aihot.json', aihot);
  const meta = {
    exportedAt: new Date().toISOString(),
    sources: db.prepare('SELECT count(*) c FROM sources WHERE enabled=1').get().c,
    articles: db.prepare('SELECT count(*) c FROM articles').get().c,
    domains: db.prepare("SELECT name FROM groups WHERE kind='article' ORDER BY sort").all().map((g) => g.name),
    cloud: true,
  };

  writeJson('meta.json', meta);
  console.log(`导出完成: 日报 ${report ? '#' + report.id : '无'}, 文章 ${rows.length} 条, 事件 ${evts.length} 个`);
}

main();
