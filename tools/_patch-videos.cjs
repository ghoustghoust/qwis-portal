// 替换 handleVideos 为 v2（游标分页 + tab 生效 + 播客并入）
const fs = require('fs');
const p = 'api/[...slug].js';
let s = fs.readFileSync(p, 'utf8');
const old = `async function handleVideos(req) {
  const q = req.query;
  const PAGE_SIZE = 30;
  const conds = [];
  const args = [];
  if (q.source_id) { conds.push('v.source_id=?'); args.push(Number(q.source_id)); }
  if (q.platform) { conds.push('v.platform=?'); args.push(q.platform); }
  const where = conds.length ? \`WHERE \${conds.join(' AND ')}\` : '';
  const rows = await qAll(
    \`SELECT v.*, s.name AS source_name FROM videos v JOIN sources s ON s.id=v.source_id \${where} ORDER BY COALESCE(v.published_at, v.created_at) DESC LIMIT ?\`,
    [...args, PAGE_SIZE]
  );
  return jsonOk({ items: rows });
}`;
const neu = `async function handleVideos(req) {
  const q = req.query;
  const PAGE_SIZE = 30;
  const withPodcasts = q.podcasts !== '0' && q.tab !== 'favorite' && q.tab !== 'history';
  const vConds = [];
  const vArgs = [];
  if (q.source_id) { vConds.push('v.source_id=?'); vArgs.push(Number(q.source_id)); }
  if (q.platform) { vConds.push('v.platform=?'); vArgs.push(q.platform); }
  if (q.group_id) { vConds.push('s.group_id=?'); vArgs.push(Number(q.group_id)); }
  if (q.tab === 'favorite') vConds.push('v.favorite=1');
  else if (q.tab === 'history') vConds.push('v.watched_at IS NOT NULL');
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(q.from || '')) { vConds.push('COALESCE(v.published_at, v.created_at) >= ?'); vArgs.push(\`\${q.from}T00:00:00.000Z\`); }
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(q.to || '')) { vConds.push('COALESCE(v.published_at, v.created_at) <= ?'); vArgs.push(\`\${q.to}T23:59:59.999Z\`); }

  // 播客侧条件（音频 enclosure 落 cover 的历史形态，lib/media.js 同口径）
  const pConds = ["s.enabled=1", "(a.cover LIKE '%.m4a%' OR a.cover LIKE '%.mp3%' OR a.cover LIKE '%.aac%' OR a.cover LIKE '%.ogg%' OR a.cover LIKE '%.opus%' OR a.cover LIKE '%media.xyzcdn.net%')"];
  const pArgs = [];
  if (q.group_id) { pConds.push('s.group_id=?'); pArgs.push(Number(q.group_id)); }
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(q.from || '')) { pConds.push('COALESCE(a.published_at, a.created_at) >= ?'); pArgs.push(\`\${q.from}T00:00:00.000Z\`); }
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(q.to || '')) { pConds.push('COALESCE(a.published_at, a.created_at) <= ?'); pArgs.push(\`\${q.to}T23:59:59.999Z\`); }

  // 游标：sort_key|kind|id 复合（kind 字典序 video>podcast，同刻视频在前）
  let cursorCond = '';
  const cursorArgs = [];
  if (q.cursor) {
    const [ck, ckind, cid] = String(q.cursor).split('|');
    if (ck && ckind && cid) {
      cursorCond = \` AND (sort_key < ? OR (sort_key = ? AND (kind < ? OR (kind = ? AND id < ?))))\`;
      cursorArgs.push(ck, ck, ckind, ckind, Number(cid));
    }
  }

  const videoSql = \`SELECT v.id AS id, 'video' AS kind, v.platform, v.title, v.url, v.cover, v.duration, v.author, v.intro,
      v.published_at, v.favorite, NULL AS audio_url, s.name AS source_name, s.avatar AS source_avatar,
      COALESCE(v.published_at, v.created_at) AS sort_key
    FROM videos v JOIN sources s ON s.id=v.source_id \${vConds.length ? 'WHERE ' + vConds.join(' AND ') : ''}\`;
  const podcastSql = \`SELECT a.id, 'podcast' AS kind, 'podcast' AS platform, a.title, a.url, NULL AS cover, NULL AS duration,
      COALESCE(NULLIF(a.author,''), s.name) AS author, substr(a.summary,1,300) AS intro,
      a.published_at, 0 AS favorite, a.cover AS audio_url, s.name AS source_name, s.avatar AS source_avatar,
      COALESCE(a.published_at, a.created_at) AS sort_key
    FROM articles a JOIN sources s ON s.id=a.source_id WHERE \${pConds.join(' AND ')}\`;

  const unionSql = withPodcasts
    ? \`SELECT * FROM (\${videoSql} UNION ALL \${podcastSql})\`
    : \`SELECT * FROM (\${videoSql})\`;
  const rows = await qAll(
    \`\${unionSql} WHERE 1=1\${cursorCond} ORDER BY sort_key DESC, kind DESC, id DESC LIMIT ?\`,
    [...vArgs, ...(withPodcasts ? pArgs : []), ...cursorArgs, PAGE_SIZE + 1]
  );

  let nextCursor = null;
  if (rows.length > PAGE_SIZE) {
    rows.pop();
    const last = rows[rows.length - 1];
    nextCursor = \`\${last.sort_key || ''}|\${last.kind}|\${last.id}\`;
  }
  // 播客条目 id 加 'a' 前缀防与 videos 主键混淆（前端按此前缀路由到音频详情）
  const items = rows.map((r) => (r.kind === 'podcast' ? { ...r, id: \`a\${r.id}\`, cover: r.source_avatar || null } : r));
  return jsonOk({ items, nextCursor });
}`;
if (!s.includes(old)) { console.error('MISS handleVideos'); process.exit(1); }
s = s.replace(old, neu);
fs.writeFileSync(p, s);
console.log('handleVideos v2 ok');
