const { db } = require('../server/db');
console.log('=== hotlist 源及其分组 ===');
for (const r of db.prepare("SELECT s.id,s.name,s.group_id,g.name gname,(SELECT COUNT(*) FROM articles a WHERE a.source_id=s.id AND a.read_at IS NULL) unread FROM sources s LEFT JOIN groups g ON g.id=s.group_id WHERE s.type='hotlist' AND s.enabled=1 ORDER BY unread DESC").all())
  console.log(r.id, r.name, '→', r.gname || '未分组', '未读', r.unread);
console.log('=== 未分组的启用源 ===');
for (const r of db.prepare('SELECT id,type,name,url FROM sources WHERE group_id IS NULL AND enabled=1').all()) console.log(r.id, r.type, r.name);
console.log('=== 各组未读 TOP10 ===');
for (const r of db.prepare('SELECT g.name, COUNT(*) unread FROM articles a JOIN sources s ON s.id=a.source_id JOIN groups g ON g.id=s.group_id WHERE a.read_at IS NULL GROUP BY g.name ORDER BY unread DESC LIMIT 10').all())
  console.log(r.name, r.unread);
console.log('=== 聚合源(extra.aggregator) ===');
for (const r of db.prepare("SELECT id,name,group_id FROM sources WHERE json_extract(COALESCE(extra,'{}'),'$.aggregator')=1").all()) console.log(r.id, r.name, 'group', r.group_id);
