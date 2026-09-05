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

  res.json({
    ok: true,
    pausedSources,
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
