// 九期 M1:热榜矩阵种子脚本 —— 建领域分组 + 批量插入 hotlist 源（幂等，可重复跑）
// 用法: node tools/seed-hotlist.js        (写库)
//       node tools/seed-hotlist.js --fetch (写库后经 HTTP 触发首轮抓取,需服务在跑)
const path = require('path');
process.env.APP_DATA_DIR = process.env.APP_DATA_DIR || path.join(__dirname, '..', 'data');
const { db } = require('../server/db');
const { nowIso } = require('../server/util/time');

// 领域 → [newsnow 源 id, 显示名]
const DOMAINS = {
  综合热搜: [
    ['weibo', '微博热搜'], ['zhihu', '知乎热榜'], ['baidu', '百度热搜'], ['toutiao', '头条热榜'],
    ['douyin', '抖音热点'], ['bilibili-hot-search', 'B站热搜'], ['tieba', '贴吧热议'], ['kuaishou', '快手热点'],
    ['thepaper', '澎湃热榜'], ['ifeng', '凤凰热榜'],
  ],
  科技热榜: [
    ['36kr-renqi', '36氪人气榜'], ['ithome', 'IT之家'], ['sspai', '少数派热门'], ['juejin', '掘金热榜'],
    ['hackernews', 'Hacker News'], ['github-trending-today', 'GitHub 今日趋势'], ['producthunt', 'Product Hunt'],
    ['solidot', 'Solidot'], ['coolapk', '酷安热榜'],
  ],
  财经热榜: [
    ['wallstreetcn-hot', '华尔街见闻热榜'], ['cls-hot', '财联社热门'], ['xueqiu-hotstock', '雪球热股'],
    ['jin10', '金十数据'], ['gelonghui', '格隆汇'],
  ],
  国际视野: [
    ['zaobao', '联合早报'], ['cankaoxiaoxi', '参考消息'], ['sputniknewscn', '俄卫星通讯社'], ['kaopu', '靠谱新闻'],
  ],
  文化生活: [
    ['douban', '豆瓣热门'], ['chongbuluo-hot', '虫部落热榜'],
  ],
};

function ensureGroup(name) {
  const row = db.prepare("SELECT id FROM groups WHERE kind='article' AND name=?").get(name);
  if (row) return row.id;
  const maxSort = db.prepare("SELECT COALESCE(MAX(sort),0) m FROM groups WHERE kind='article'").get().m;
  const r = db.prepare("INSERT INTO groups(kind, name, sort) VALUES('article', ?, ?)").run(name, maxSort + 1);
  return r.lastInsertRowid;
}

function main() {
  const find = db.prepare("SELECT id FROM sources WHERE type='hotlist' AND url=?");
  const insert = db.prepare(
    "INSERT INTO sources(type, name, url, group_id, extra, enabled, status, created_at) VALUES('hotlist', ?, ?, ?, ?, 1, 'ok', ?)"
  );
  let added = 0, skipped = 0;
  const ids = [];
  for (const [domain, list] of Object.entries(DOMAINS)) {
    const gid = ensureGroup(domain);
    for (const [nid, name] of list) {
      const url = `hotlist://${nid}`;
      if (find.get(url)) { skipped++; continue; }
      const extra = JSON.stringify({ intervalMin: 30, platform: name, domain });
      const r = insert.run(`${name}`, url, gid, extra, nowIso());
      ids.push(r.lastInsertRowid);
      added++;
    }
  }
  // 60s 每日精选新闻(独立上游)
  if (!find.get('hotlist60s://60s')) {
    const gid = ensureGroup('综合热搜');
    const r = insert.run('每天60秒读懂世界', 'hotlist60s://60s', gid,
      JSON.stringify({ intervalMin: 360, platform: '60s', domain: '综合热搜' }), nowIso());
    ids.push(r.lastInsertRowid);
    added++;
  } else skipped++;
  console.log(`热榜源入库: 新增 ${added}, 已存在跳过 ${skipped}`);
  if (process.argv.includes('--fetch') && ids.length) {
    console.log('触发首轮抓取…');
    (async () => {
      for (const id of ids) {
        try {
          const r = await fetch(`http://127.0.0.1:3000/api/sources/${id}/refresh`, { method: 'POST' }).then((x) => x.json());
          console.log(`  #${id}: ${r.ok ? `+${r.articles} 条` : '失败 ' + r.error}`);
        } catch (e) { console.log(`  #${id}: 请求失败 ${e.message}`); }
      }
      process.exit(0);
    })();
  }
}

main();
