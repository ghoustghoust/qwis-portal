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

router.get('/', (req, res) => {
  const intervals = { opml: 12, rss: 8, bilibili: 60, douyin: 360, queue: 10, ...getSetting('intervals', {}) };
  const lastSyncAt = getSetting('wechat.lastSyncAt', null);

  const rssLast = db.prepare(
    "SELECT MAX(last_fetched_at) t FROM sources WHERE type IN ('wechat','rss','x')"
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
  const NOISE = "(s.type='hotlist' OR COALESCE(json_extract(COALESCE(s.extra,'{}'),'$.aggregator'),0)=1)";
  const now = Date.now();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const weekAgo = new Date(now - 7 * 86400e3).toISOString();
  const overview = {
    enabledSources: count(`SELECT COUNT(*) c FROM sources s WHERE s.enabled=1 AND NOT ${NOISE}`),
    unreadArticles: count(`SELECT COUNT(*) c FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.read_at IS NULL AND NOT ${NOISE}`),
    todayNew: count(`SELECT COUNT(*) c FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.created_at >= ? AND NOT ${NOISE}`, dayStart.toISOString()),
    weekNew: count(`SELECT COUNT(*) c FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.created_at >= ? AND NOT ${NOISE}`, weekAgo),
    dailyItemCount: 0,
    dailyTopSources: [], // [{name, count}]
  };
  try {
    const latest = db.prepare('SELECT sections FROM daily_reports ORDER BY generated_at DESC LIMIT 1').get();
    if (latest) {
      // 热榜/聚合源的名字不进来源榜(「AIHOT 热榜 7 次」这类是聚合器不是真实来源)
      const noiseNames = new Set(
        db.prepare(`SELECT name FROM sources s WHERE ${NOISE}`).all().map((r) => r.name)
      );
      const sections = JSON.parse(latest.sections || '[]');
      const tally = new Map();
      for (const sec of sections) {
        for (const it of sec.items || []) {
          overview.dailyItemCount += 1;
          const name = it.source_name || '';
          if (!name || /^\d+ 源$/.test(name) || noiseNames.has(name)) continue; // 破茧栏合成条目与聚合源不计
          tally.set(name, (tally.get(name) || 0) + 1);
        }
      }
      overview.dailyTopSources = [...tally.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, cnt]) => ({ name, count: cnt }));
    }
  } catch { /* 日报缺失/损坏时 overview 降级为计数 0 */ }

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
