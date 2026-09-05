// 公众号适配器（F21~F27）：OPML 同步 + 单源文章抓取（复用 rss 适配器）
const { fetchText } = require('../../../util/http');
const { db, setSetting } = require('../../../db');
const { nowIso } = require('../../../util/time');
const rssAdapter = require('../rss');

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'))
    || tag.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i'));
  return m ? m[1] : null;
}

// 解析 OPML：取带 xmlUrl 的 outline（名称 + RSS 链接）
function parseOpml(xml) {
  const outlines = [];
  const re = /<outline\b[^>]*\/?>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const tag = m[0];
    const xmlUrl = attr(tag, 'xmlUrl');
    if (!xmlUrl) continue; // 分组 outline 无 xmlUrl，跳过
    const name = attr(tag, 'title') || attr(tag, 'text') || attr(tag, 'name') || '';
    outlines.push({ name: decodeEntities(name).trim(), url: decodeEntities(xmlUrl).trim() });
  }
  return outlines;
}

// 拉 OPML → diff 本地 sources(type='wechat') → 新增/恢复/更新计数写 settings
async function syncOpml(opmlUrl) {
  if (!opmlUrl) throw new Error('未配置 OPML 地址');
  const xml = await fetchText(opmlUrl);
  const outlines = parseOpml(xml);
  if (!outlines.length) throw new Error('OPML 中没有解析到任何 RSS 订阅');

  let added = 0, restored = 0, updated = 0;
  const findStmt = db.prepare("SELECT * FROM sources WHERE type='wechat' AND url=?");
  const insertStmt = db.prepare(
    "INSERT INTO sources(type, name, url, enabled, status, created_at) VALUES('wechat', ?, ?, 1, 'ok', ?)"
  );
  const enableStmt = db.prepare("UPDATE sources SET enabled=1, status='ok' WHERE id=?");
  const renameStmt = db.prepare('UPDATE sources SET name=? WHERE id=?');

  for (const o of outlines) {
    const exist = findStmt.get(o.url);
    if (!exist) {
      insertStmt.run(o.name || o.url, o.url, nowIso());
      added++;
    } else if (!exist.enabled) {
      enableStmt.run(exist.id); // 之前停用/删除过的源重新出现 → 恢复
      restored++;
    } else if (o.name && exist.name !== o.name) {
      renameStmt.run(o.name, exist.id);
      updated++;
    }
  }

  const lastResult = { added, restored, updated };
  setSetting('wechat.lastSyncAt', nowIso());
  setSetting('wechat.lastResult', lastResult);
  setSetting('wechat.total', outlines.length);
  return lastResult;
}

module.exports = {
  type: 'wechat',
  defaultIntervalMin: 480, // 文章刷新走 RSS 间隔
  // 公众号源经 OPML 导入，不支持直接粘贴链接识别
  match() {
    return false;
  },
  syncOpml,
  parseOpml,
  // fetch：复用 rss 适配器抓单源（source.url 为该公众号的 RSS 链接）
  async fetch(source, ctx) {
    return rssAdapter.fetch(source, ctx);
  },
};
