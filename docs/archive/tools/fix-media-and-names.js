// 一次性修复:乱码源名 + wemp/hotlist 源头像 + 存量文章 data-src 懒加载图片
// 用法: node tools/fix-media-and-names.js
const path = require('path');
process.env.APP_DATA_DIR = process.env.APP_DATA_DIR || path.join(__dirname, '..', 'data');
const { db } = require('../server/db');

const WEMP = process.env.WEMP_BASE_URL || 'http://127.0.0.1:8001';
const proxied = (u) => (u && /^https?:\/\//.test(u) ? `/api/img?u=${encodeURIComponent(u)}` : null);

// 热榜平台 id → 官网域(取 favicon 做头像)
const PLATFORM_HOST = {
  weibo: 'weibo.com', zhihu: 'zhihu.com', baidu: 'baidu.com', toutiao: 'toutiao.com',
  douyin: 'douyin.com', 'bilibili-hot-search': 'bilibili.com', tieba: 'tieba.baidu.com',
  thepaper: 'thepaper.cn', ifeng: 'ifeng.com', ithome: 'ithome.com', sspai: 'sspai.com',
  juejin: 'juejin.cn', hackernews: 'news.ycombinator.com', 'github-trending-today': 'github.com',
  producthunt: 'producthunt.com', solidot: 'solidot.org', coolapk: 'coolapk.com',
  'wallstreetcn-hot': 'wallstreetcn.com', 'cls-hot': 'cls.cn', 'xueqiu-hotstock': 'xueqiu.com',
  jin10: 'jin10.com', gelonghui: 'gelonghui.com', zaobao: 'zaobao.com', cankaoxiaoxi: 'cankaoxiaoxi.com',
  sputniknewscn: 'sputniknews.cn', kaopu: 'kaopu.news', douban: 'douban.com', 'chongbuluo-hot': 'chongbuluo.com',
};

const NAME_FIX = {
  70: 'Hacker News 首页',
  71: '机核',
  72: '量子位博客',
  73: 'FT中文网',
};

async function main() {
  // 1. 乱码名修复
  const fixName = db.prepare('UPDATE sources SET name=? WHERE id=?');
  for (const [id, name] of Object.entries(NAME_FIX)) {
    fixName.run(name, Number(id));
    console.log(`源 #${id} 改名 → ${name}`);
  }

  // 2. hotlist 源头像:平台 favicon 走图片代理
  const setAvatar = db.prepare("UPDATE sources SET avatar=? WHERE id=? AND (avatar IS NULL OR avatar='')");
  let n = 0;
  for (const s of db.prepare("SELECT id, url FROM sources WHERE type='hotlist'").all()) {
    const nid = s.url.replace('hotlist://', '');
    const host = PLATFORM_HOST[nid];
    if (!host) continue;
    setAvatar.run(proxied(`https://${host}/favicon.ico`), s.id);
    n++;
  }
  console.log(`hotlist 头像: ${n}`);

  // 3. wemp 源头像:从 we-mp-rss 拉 mp_cover
  const tok = await fetch(`${WEMP}/api/v1/wx/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'admin', password: 'admin@123' }).toString(),
  }).then((r) => r.json()).then((j) => j.data.access_token);
  const feeds = await fetch(`${WEMP}/api/v1/wx/mps?limit=100&offset=0`, { headers: { Authorization: `Bearer ${tok}` } })
    .then((r) => r.json()).then((j) => j.data.list || []);
  const coverByName = new Map(feeds.map((f) => [f.mp_name, f.mp_cover]));
  let m = 0;
  for (const s of db.prepare("SELECT id, name FROM sources WHERE type='wemp'").all()) {
    const cover = coverByName.get(s.name);
    if (cover) { setAvatar.run(proxied(cover), s.id); m++; }
  }
  console.log(`wemp 头像: ${m}`);

  // 4. 存量文章懒加载图片修复(data-src → src + no-referrer)
  const rows = db.prepare("SELECT id, content_html FROM articles WHERE content_html LIKE '%data-src=%'").all();
  const upd = db.prepare('UPDATE articles SET content_html=? WHERE id=?');
  let fixed = 0;
  for (const r of rows) {
    let c = r.content_html.replace(/<img\b([^>]*?)\sdata-src=(["'])([^"']+)\2([^>]*)>/gi, (mm, pre, q, src, post) => {
      const rest = (pre + ' ' + post).replace(/\ssrc=(["']).*?\1/gi, '');
      return `<img${rest} src=${q}${src}${q}>`;
    });
    c = c.replace(/<img\b(?![^>]*\breferrerpolicy\b)([^>]*?src=["']https?:\/\/mmbiz\.qpic\.cn[^>]*?)>/gi, '<img$1 referrerpolicy="no-referrer">');
    if (c !== r.content_html) { upd.run(c, r.id); fixed++; }
  }
  console.log(`存量文章图片修复: ${fixed} 篇`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
