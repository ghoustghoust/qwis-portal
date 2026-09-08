// 2026-09-05:回填 articles.word_count（纯文本字数），替代 LENGTH(content_html) 虚高估算
const fs = require('fs');
const path = require('path');
const { db } = require('../server/db');
const { textLen } = require('../server/services/collectors/repo');

const bak = path.join(__dirname, '..', 'data', 'backups', `app-before-wordcount-${Date.now()}.db`);
db.backup(bak).then(() => {
  console.log('已备份 →', bak);
  const rows = db.prepare('SELECT id, content_html FROM articles WHERE word_count IS NULL').all();
  console.log('待回填', rows.length, '条');
  const upd = db.prepare('UPDATE articles SET word_count=? WHERE id=?');
  const t0 = Date.now();
  db.transaction(() => {
    for (const r of rows) upd.run(textLen(r.content_html), r.id);
  })();
  console.log(`完成，耗时 ${Date.now() - t0}ms`);
  // 抽验：刚才「5.2 万字」的虚高条目
  const sample = db.prepare("SELECT title, word_count, LENGTH(content_html) raw FROM articles WHERE word_count IS NOT NULL ORDER BY raw DESC LIMIT 3").all();
  for (const s of sample) console.log(`${s.title.slice(0, 20)} | word_count=${s.word_count} (原 raw=${s.raw})`);
  process.exit(0);
}).catch((e) => { console.error('备份失败，中止:', e.message); process.exit(1); });
