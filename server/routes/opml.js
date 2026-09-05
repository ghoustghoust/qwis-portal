// OPML / RSS 手动触发 API（T15）
// 同时挂载在 /api/opml 与 /api/rss（server/index.js），内部定义 /sync 与 /refresh 两个子路由
const express = require('express');
const { db, getSetting, setSetting } = require('../db');
const wechat = require('../services/collectors/wechat');
const scheduler = require('../services/scheduler');

const router = express.Router();

// POST /sync —— 手动触发 OPML 同步
router.post('/sync', async (req, res) => {
  const url = (req.body && req.body.url) || getSetting('opml.url', null);
  if (!url) return res.status(400).json({ ok: false, error: '未配置 OPML 地址' });
  try {
    const result = await wechat.syncOpml(url);
    res.json({ ok: true, ...result, lastSyncAt: getSetting('wechat.lastSyncAt') });
  } catch (err) {
    setSetting('wechat.lastError', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /refresh —— 手动触发 RSS 文章刷新（wechat/rss/x 全部 enabled 源）
router.post('/refresh', async (req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM sources WHERE enabled=1 AND type IN ('wechat','rss','x')").all();
    let articles = 0;
    let errors = 0;
    const failedNames = [];
    for (const s of rows) {
      try {
        const { fetchSource, markSourceError } = require('../services/collectors/store');
        const r = await fetchSource(s);
        articles += r.articles;
      } catch (err) {
        errors++;
        failedNames.push(`${s.name}: ${String(err.message || '').slice(0, 80)}`);
        // C25:与 sources.js refresh 同语义——走 markSourceError(记 fail_count/熔断);批量路径静默逐源报警,结尾汇总
        markSourceError(s, err.message, { silent: true });
      }
    }
    if (failedNames.length) {
      require('../services/alerts').dispatch('source_error', {
        title: `OPML 手动刷新失败 ${failedNames.length}/${rows.length} 源`,
        text: failedNames.slice(0, 10).join('\n'),
      }).catch(() => {});
    }
    res.json({ ok: true, sources: rows.length, articles, errors });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
