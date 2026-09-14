// 源头像回填（2026-09-14：676 个启用源无头像，前端全是单字母占位）
// 策略：RSS feed 自带的 channel image / itunes:image → 站点 /favicon.ico 兜底
// 只处理 rss 类型（X/YouTube 头像需抓页面，不在本脚本范围）
const fs = require('fs');
for (const line of fs.readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
process.env.HTTPS_PROXY = process.env.HTTPS_PROXY || 'http://127.0.0.1:12000';

const { createClient } = require('@libsql/client');
const { ProxyAgent, fetch: ufetch } = require('undici');
const RSSParser = require('rss-parser');
const dispatcher = new ProxyAgent(process.env.HTTPS_PROXY);
const rssParser = new RSSParser();

const isLocal = (u) => /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(String(u || ''));

async function fetchText(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await ufetch(url, {
      signal: ctrl.signal,
      dispatcher: /^https?:\/\/(127\.0\.0\.1|localhost)/.test(url) ? undefined : dispatcher,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const badAvatar = (u) => !u || !/^https?:\/\//.test(u) || /[<>]/.test(u) || /%3C|%3E/i.test(u);

async function resolveAvatar(source) {
  // 1) feed channel image / itunes:image
  try {
    const xml = await fetchText(source.url);
    const feed = await rssParser.parseString(xml);
    let img = (feed.image && feed.image.url) || (feed.itunes && feed.itunes.image) || null;
    if (img && !/^https?:\/\//.test(img)) {
      try { img = new URL(img, source.url).href; } catch { img = null; }
    }
    if (img && !badAvatar(img)) return img;
  } catch { /* feed 拉取失败走 favicon */ }
  // 2) 站点 favicon.ico 兜底（先 HEAD 验证存在）
  try {
    const origin = new URL(source.url).origin;
    const fav = `${origin}/favicon.ico`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await ufetch(fav, { method: 'HEAD', signal: ctrl.signal, dispatcher, redirect: 'follow' });
    clearTimeout(timer);
    if (res.ok) return fav;
  } catch { /* 无 favicon */ }
  return null;
}

(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const rows = (await db.execute(
    "SELECT id, name, url, type FROM sources WHERE enabled=1 AND (avatar IS NULL OR avatar='') AND type='rss' ORDER BY id"
  )).rows;
  console.log(`待回填 ${rows.length} 个 RSS 源`);

  let done = 0, ok = 0, failed = 0;
  const CONCURRENCY = 6;
  let idx = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (idx < rows.length) {
      const s = rows[idx++];
      try {
        const avatar = await resolveAvatar(s);
        if (avatar) {
          await db.execute({ sql: 'UPDATE sources SET avatar=? WHERE id=?', args: [avatar, s.id] });
          ok++;
        } else failed++;
      } catch { failed++; }
      done++;
      if (done % 50 === 0) console.log(`  进度 ${done}/${rows.length}（成功 ${ok}）`);
    }
  }));
  console.log(`完成: 成功 ${ok} / 失败 ${failed} / 共 ${rows.length}`);
})();
