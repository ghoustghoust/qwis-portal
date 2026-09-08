// 2026-09-05:清洗 cover URL 里的 &amp; HTML 实体（采集层已修复，这里洗存量）
const fs = require('fs');
const path = require('path');
const { db } = require('../server/db');

const bak = path.join(__dirname, '..', 'data', 'backups', `app-before-cover-clean-${Date.now()}.db`);
db.backup(bak).then(() => {
  console.log('已备份 →', bak);
  const a = db.prepare("UPDATE articles SET cover = REPLACE(cover, '&amp;', '&') WHERE cover LIKE '%&amp;%'").run();
  const v = db.prepare("UPDATE videos SET cover = REPLACE(cover, '&amp;', '&') WHERE cover LIKE '%&amp;%'").run();
  console.log(`articles 清洗 ${a.changes} 条，videos 清洗 ${v.changes} 条`);
  const leftA = db.prepare("SELECT COUNT(*) c FROM articles WHERE cover LIKE '%&amp;%'").get().c;
  const leftV = db.prepare("SELECT COUNT(*) c FROM videos WHERE cover LIKE '%&amp;%'").get().c;
  console.log('剩余含 &amp;:', leftA, leftV);
  process.exit(0);
}).catch((e) => { console.error('备份失败，中止:', e.message); process.exit(1); });
