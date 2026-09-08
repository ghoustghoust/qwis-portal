// 设置 API（T15）：分区读写；PUT 敏感字段留空不覆盖；GET 脱敏只返回是否已配置（N2）
// AI 摘要已下线：不再提供 ai 配置区与 /api/settings/ai 委托
const express = require('express');
const { db, getSetting, setSetting } = require('../db');
const { nowIso } = require('../util/time');

const router = express.Router();

const DEFAULT_INTERVALS = { opml: 12, rss: 8, bilibili: 60, douyin: 360, queue: 10 };

function cookieConfigured(platform) {
  const row = db.prepare('SELECT cookie FROM credentials WHERE platform=?').get(platform);
  return !!(row && row.cookie);
}

function maskSection(obj, sensitiveKeys) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (sensitiveKeys.includes(k)) {
      out[`${k}Configured`] = !!v; // 只返回是否已配置
    } else {
      out[k] = v;
    }
  }
  return out;
}

// GET /api/settings —— 分区返回，敏感字段脱敏
router.get('/', (req, res) => {
  const queue = getSetting('queue', {});
  res.json({
    ok: true,
    intervals: { ...DEFAULT_INTERVALS, ...getSetting('intervals', {}) },
    opml: { url: getSetting('opml.url', ''), enabled: getSetting('opml.enabled', true) },
    queue: maskSection({ intervalMin: 10, enabled: false, ...queue }, ['token']),
    daily: getSetting('daily', { windowHours: 48, time: '08:00' }),
    data: getSetting('data', { retentionDays: 7 }),  // 数据保留天数配置
    hot: { enabled: getSetting('hot', {}).enabled !== false },
    views: getSetting('reader.views', []), // 十一期：阅读器保存视图（公开读）
    bilibili: { cookieConfigured: cookieConfigured('bilibili') },
    douyin: { cookieConfigured: cookieConfigured('douyin') },
    wechat: {
      lastSyncAt: getSetting('wechat.lastSyncAt', null),
      lastResult: getSetting('wechat.lastResult', null),
    },
  });
});

// 合并写入一个对象型 setting；敏感键留空（undefined/''）不覆盖
function mergeSetting(key, patch, sensitiveKeys = []) {
  const cur = getSetting(key, {});
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch || {})) {
    if (sensitiveKeys.includes(k) && (v === undefined || v === '')) continue; // 留空不覆盖
    if (v !== undefined) next[k] = v;
  }
  setSetting(key, next);
}

// PUT /api/settings {intervals?, opml?, queue?, ai?, daily?, bilibili?{cookie}}
router.put('/', (req, res) => {
  const body = req.body || {};
  // 先全部校验、再统一写入——防「400 报错但前面的区已写库」的部分写入（2026-09-04 对抗性审查发现）
  let dailyPatch = null;
  if (body.daily) {
    try {
      // 与 /api/settings/daily 同一校验（time/windowHours），非法值 400 不写入；其余键原样合并
      dailyPatch = { ...body.daily, ...require('./daily').validateDailyPatch(body.daily) };
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }
  if (body.intervals) mergeSetting('intervals', body.intervals);
  if (body.opml) {
    if (body.opml.url !== undefined) setSetting('opml.url', String(body.opml.url));
    if (body.opml.enabled !== undefined) setSetting('opml.enabled', !!body.opml.enabled);
  }
  if (body.queue) mergeSetting('queue', body.queue, ['token']);
  if (dailyPatch) mergeSetting('daily', dailyPatch);
  if (body.hot) mergeSetting('hot', body.hot); // F8：热榜启用开关
  if (body.data) {
    // 3.4 校验保留天数范围（1-90 天）
    if (body.data.retentionDays !== undefined) {
      const n = Number(body.data.retentionDays);
      if (!Number.isInteger(n) || n < 1 || n > 90) {
        return res.status(400).json({ ok: false, error: 'retentionDays 必须是 1-90 的整数' });
      }
    }
    mergeSetting('data', body.data, []);  // 数据管理配置（含 retentionDays）
  }
  // 十一期：视图存储（整体替换，校验：数组、≤20、每项 name 非空≤20字、filter 为对象）
  if (body.views !== undefined) {
    const views = body.views;
    if (!Array.isArray(views) || views.length > 20) {
      return res.status(400).json({ ok: false, error: 'views 必须为数组且不超过 20 个' });
    }
    for (const v of views) {
      if (!v || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 20) {
        return res.status(400).json({ ok: false, error: '视图名称须为非空且不超过 20 字' });
      }
      if (!v.filter || typeof v.filter !== 'object') {
        return res.status(400).json({ ok: false, error: '视图 filter 须为对象' });
      }
    }
    setSetting('reader.views', views);
  }
  if (body.bilibili && body.bilibili.cookie) {
    // Cookie 存 credentials 表（不落 settings）
    db.prepare(
      'INSERT INTO credentials(platform, cookie, updated_at) VALUES(?,?,?) ON CONFLICT(platform) DO UPDATE SET cookie=excluded.cookie, updated_at=excluded.updated_at'
    ).run('bilibili', String(body.bilibili.cookie), nowIso());
  }
  // 间隔变更后重排调度
  try { require('../services/scheduler').reschedule(); } catch { /* 调度未启动时忽略 */ }
  res.json({ ok: true });
});

// 二期：GET/PUT /api/settings/daily 委托给 routes/daily.js 的子路由器
// （AI 摘要下线后不再委托 /api/settings/ai）
try { router.use('/daily', require('./daily').settingsRouter); } catch { /* routes/daily.js 未就绪时忽略 */ }

module.exports = router;
