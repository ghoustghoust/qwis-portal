// 定位乱码文章:用用户提供的确切碎片段匹配
const path = require('path');
process.env.APP_DATA_DIR = process.env.APP_DATA_DIR || path.join(__dirname, '..', 'data');
const { db } = require('../server/db');

// 用户贴的乱码原文片段(UTF-8 被 GBK 误读的典型)
const FRAGS = ['Ҫˢ', 'Ƶ', '籼', ''];
// 以及乱码解码后可能的正常文案(从用户片段还原:像是 B站/视频加载失败的占位文案)
const GUESS = ['刷新视频', '检查网络', '阅读模式', '关闭当前页面', '打开 App'];

const seen = new Set();
for (const f of [...FRAGS, ...GUESS]) {
  const rows = db.prepare(
    'SELECT a.id, a.title, s.name AS sname, s.type FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.content_html LIKE ? OR a.title LIKE ? LIMIT 5'
  ).all(`%${f}%`, `%${f}%`);
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    console.log(`[${f}] #${r.id} [${r.sname}|${r.type}]`, (r.title || '').slice(0, 60));
  }
}
console.log('命中文章数:', seen.size);
