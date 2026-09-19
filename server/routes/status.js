// 状态卡汇总 API（T15，F23/F28/F36）：GET /api/status
const express = require('express');
const { db, getSetting } = require('../db');

const router = express.Router();

function count(sql, ...args) {
  return db.prepare(sql).get(...args).c;
}

function addHours(iso, hours) {
  if (!iso) return null;
  return new Date(new Date(iso).getTime() + hours * 3600e3).toISOString();
}

// 噪声源判据（热榜/聚合器）：状态页所有计数与来源榜共用
const NOISE = "(s.type='hotlist' OR COALESCE(json_extract(COALESCE(s.extra,'{}'),'$.aggregator'),0)=1)";

// B26：入报统计（条目数 + Top5 来源榜）拆成独立端点按需取，故先抽成可复用的算法。
// 窗口取近 7 天，与云端 api/[...slug].js 的同名统计、以及界面文案「近7天入早报」一致
// （本地此前只算最新 1 期 daily_reports，标签写着近 7 天、数字却是单期——同一句话两端不同值）。
function computeDailySources() {
  const out = { dailyItemCount: 0, dailyTopSources: [] };
  try {
    const since = new Date(Date.now() - 7 * 86400e3).toISOString();
    const rows = db.prepare('SELECT sections FROM daily_reports WHERE generated_at >= ? ORDER BY id DESC LIMIT 7').all(since);
    const noiseNames = new Set(db.prepare(`SELECT name FROM sources s WHERE ${NOISE}`).all().map((r) => r.name));
    const tally = new Map();
    for (const rep of rows) {
      let sections = [];
      try { sections = JSON.parse(rep.sections || '[]'); } catch { /* 忽略坏行 */ }
      for (const sec of sections) {
        for (const it of sec.items || []) {
          out.dailyItemCount += 1;
          const name = it.source_name || it.source || '';
          if (!name || /^\d+ 源$/.test(name) || noiseNames.has(name)) continue; // 破茧栏合成条目与聚合源不计
          tally.set(name, (tally.get(name) || 0) + 1);
        }
      }
    }
    out.dailyTopSources = [...tally.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, cnt]) => ({ name, count: cnt }));
    const names = out.dailyTopSources.map((t) => t.name);
    if (names.length) {
      const av = new Map(db.prepare(`SELECT name, avatar FROM sources WHERE name IN (${names.map(() => '?').join(',')})`)
        .all(...names).map((r) => [r.name, r.avatar]));
      for (const t of out.dailyTopSources) t.avatar = av.get(t.name) || null;
    }
  } catch { /* 日报缺失/损坏时降级为计数 0 */ }
  return out;
}

// GET /api/status/daily-sources —— 重统计按需加载（B26 拆首屏）
router.get('/daily-sources', (req, res) => {
  res.json({ ok: true, since: new Date(Date.now() - 7 * 86400e3).toISOString(), overview: computeDailySources() });
});

router.get('/', (req, res) => {
  const intervals = { opml: 12, rss: 8, bilibili: 60, douyin: 360, queue: 10, ...getSetting('intervals', {}) };
  const lastSyncAt = getSetting('wechat.lastSyncAt', null);

  const rssLast = db.prepare(
    // B93：NULLIF 排掉字面串 'null'（文本序比任何 ISO 都大，会把 MAX 毒成 null）；
    // 类型集合与云端对齐（补 wemp/youtube——云端是 ('wechat','rss','wemp','x','youtube')）
    "SELECT MAX(NULLIF(last_fetched_at,'null')) t FROM sources WHERE type IN ('wechat','rss','wemp','x','youtube')"
  ).get().t;
  const rssNext = db.prepare(
    "SELECT MIN(next_fetch_at) t FROM sources WHERE enabled=1 AND type IN ('wechat','rss','x')"
  ).get().t;
  const biliLast = db.prepare(
    "SELECT MAX(last_fetched_at) t FROM sources WHERE type='bilibili'"
  ).get().t;

  const biliCookie = db.prepare("SELECT cookie FROM credentials WHERE platform='bilibili'").get();

  // T48：连续失败 3 次被自动暂停的源（enabled=0 且 fail_count>=3），前端状态卡/列表可感知
  const pausedRows = db.prepare(
    'SELECT id, type, name, fail_count, last_fetched_at FROM sources WHERE enabled=0 AND COALESCE(fail_count,0)>=3 ORDER BY id'
  ).all();
  const pausedSources = {
    count: pausedRows.length,
    items: pausedRows,
  };

  // 2026-09-05 视觉精修:阅读器右侧统计轨(OverviewRail)数据——本周概览 + 近7天入早报 Top5
  // 统计口径与阅读器一致：排除热榜/聚合源噪音(否则「近7天更新」被热榜刷成上万条,毫无意义)
  // NOISE 已提到模块作用域（来源榜也要用；见文件上方）
  const now = Date.now();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const weekAgo = new Date(now - 7 * 86400e3).toISOString();
  // 27-reader-today：未读只统计近 3 天（历史自动归档，口径与 GET /api/sources 未读一致）
  const threeDaysAgo = new Date(now - 3 * 86400e3).toISOString();
  const overview = {
    enabledSources: count(`SELECT COUNT(*) c FROM sources s WHERE s.enabled=1 AND NOT ${NOISE}`),
    unreadArticles: count(`SELECT COUNT(*) c FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.read_at IS NULL AND COALESCE(a.published_at, a.created_at) >= ? AND NOT ${NOISE}`, threeDaysAgo),
    todayNew: count(`SELECT COUNT(*) c FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.created_at >= ? AND NOT ${NOISE}`, dayStart.toISOString()),
    weekNew: count(`SELECT COUNT(*) c FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.created_at >= ? AND NOT ${NOISE}`, weekAgo),
    // B26：入报统计（dailyItemCount / dailyTopSources）不在首屏——与云端同一份契约：
    // 一律走 GET /api/status/daily-sources。两端形状不同会让"哪一端算错了"无从判断（对抗审查查出）。
  };

  res.json({
    ok: true,
    pausedSources,
    overview,
    wechat: {
      opmlStatus: getSetting('wechat.opmlStatus', '空闲'),
      opmlLastSync: lastSyncAt,
      opmlNextSync: addHours(lastSyncAt, Number(intervals.opml)),
      opmlLastResult: getSetting('wechat.lastResult', null), // {added, restored, updated}
      opmlTotal: getSetting('wechat.total', 0),
      lastError: getSetting('wechat.lastError', null),
      localCount: count("SELECT COUNT(*) c FROM sources WHERE type='wechat'"),
      subscribedCount: count("SELECT COUNT(*) c FROM sources WHERE type='wechat' AND enabled=1"),
      rssLastFetch: rssLast,
      rssNextFetch: rssNext,
      articleCount: count('SELECT COUNT(*) c FROM articles'),
      errorCount: count("SELECT COUNT(*) c FROM sources WHERE status='error'"),
    },
    bilibili: {
      mode: '本机模式',
      sourceCount: count("SELECT COUNT(*) c FROM sources WHERE type='bilibili'"),
      videoCount: count("SELECT COUNT(*) c FROM videos WHERE platform='bilibili'"),
      lastFetch: biliLast,
      intervalMin: Number(intervals.bilibili),
      cookieConfigured: !!(biliCookie && biliCookie.cookie),
    },
    douyin: {
      mode: '本机模式',
      sourceCount: count("SELECT COUNT(*) c FROM sources WHERE type='douyin'"),
      videoCount: count("SELECT COUNT(*) c FROM videos WHERE platform='douyin'"),
      intervalMin: Number(intervals.douyin),
    },
  });
});

module.exports = router;
