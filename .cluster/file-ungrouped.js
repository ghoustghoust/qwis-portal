// 2026-09-05:归档 3 个未分组启用源（用户要求：有分类的源应进入对应文件夹）
const fs = require('fs');
const path = require('path');
const { db } = require('../server/db');

// 先备份
const bakDir = path.join(__dirname, '..', 'data', 'backups');
fs.mkdirSync(bakDir, { recursive: true });
const bak = path.join(bakDir, `app-before-group-filing-${Date.now()}.db`);
db.backup(bak).then(() => {
  console.log('已备份 →', bak);

  const groupOf = (name, kind) => db.prepare('SELECT id FROM groups WHERE name=? AND kind=?').get(name, kind);

  // 影视飓风(bilibili 视频)无合适视频组，新建「影音创作」
  let media = groupOf('影音创作', 'video');
  if (!media) {
    const maxSort = db.prepare("SELECT COALESCE(MAX(sort),0) s FROM groups WHERE kind='video'").get().s;
    const r = db.prepare("INSERT INTO groups(kind,name,sort) VALUES('video','影音创作',?)").run(maxSort + 1);
    media = { id: r.lastInsertRowid };
    console.log('已建组 影音创作 id=' + media.id);
  }

  const moves = [
    [1, groupOf('编程技术', 'article').id, '阮一峰的网络日志 → 编程技术(文章)'],
    [12, groupOf('编程技术', 'video').id, 'NeuralNine → 编程技术(视频)'],
    [2, media.id, '影视飓风 → 影音创作(视频)'],
  ];
  const stmt = db.prepare('UPDATE sources SET group_id=? WHERE id=?');
  for (const [sid, gid, label] of moves) {
    stmt.run(gid, sid);
    console.log('✓', label);
  }
  const left = db.prepare('SELECT COUNT(*) c FROM sources WHERE group_id IS NULL AND enabled=1').get().c;
  console.log('剩余未分组启用源:', left);
  process.exit(0);
}).catch((e) => { console.error('备份失败，中止:', e.message); process.exit(1); });
