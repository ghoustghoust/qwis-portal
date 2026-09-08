// 日报 API（T27，F13~F19）
// 挂载 /api/daily：GET /（最新一份，无则 report:null）、POST /regenerate
// 子路由器 settingsRouter 由 routes/settings.js 委托挂载到 /api/settings/daily：
//   GET/PUT 窗口 / 生成时间 / 来源勾选 / focus / columns 栏目管理
// AI 能力已恢复（Agnes AI 平台）：日报支持 AI 智能摘要+重要度排序
// 写入与 routes/settings.js 共用同一批 settings 键（'daily'、'daily.columns'）
const express = require('express');
const { db, getSetting, setSetting } = require('../db');
const daily = require('../services/ai/daily');
const log = require('../util/log');
const audit = require('../services/audit');

const router = express.Router();
const settingsRouter = express.Router();

// GET /api/daily —— 最新一份日报；stale=今日生成时间已过但今日尚无日报（F3 打开即补）
router.get('/', (req, res) => {
  res.json({ ok: true, report: daily.getLatest(), stale: daily.needsGeneration() });
});

// POST /api/daily/regenerate {windowHours?} —— 立即生成并返回
// 生成前先补抓到期的源（next_fetch_at 已过期的 enabled 源），保证日报数据是新鲜的
router.post('/regenerate', async (req, res) => {
  try {
    // P2-1 修复：复用 scheduler.fetchDueBeforeDaily（已含 ticking 守卫），消除与 tick() 并发双抓竞态
    // （原本在此重复一套无守卫的补抓循环，与调度器实现漂移）
    // 修复：预抓取阶段失败不应触发日报生成失败报警，需隔离错误
    try {
      await require('../services/scheduler').fetchDueBeforeDaily();
    } catch (preErr) {
      // 仅记录日志，不影响后续日报生成
      log.warn(`[日报预抓取] 部分源失败：${preErr.message}`);
    }
    const report = await daily.generate(req.body && req.body.windowHours);
    audit.record('daily.generate', { detail: { windowHours: req.body && req.body.windowHours }, ip: req.ip });
    res.json({ ok: true, report });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

function sourceList(types, selectedIds) {
  const rows = db
    .prepare(`SELECT id, type, name, focus FROM sources WHERE type IN (${types.map(() => '?').join(',')}) ORDER BY id`)
    .all(...types);
  return rows.map((s) => ({
    id: s.id,
    type: s.type,
    name: s.name,
    focus: !!s.focus,
    selected: selectedIds ? selectedIds.includes(s.id) : true, // 未配置=全选
  }));
}

// GET /api/settings/daily
settingsRouter.get('/', (req, res) => {
  const cfg = daily.dailyConfig();
  res.json({
    ok: true,
    windowHours: cfg.windowHours,
    time: cfg.time,
    articleSourceIds: cfg.articleSourceIds, // null=全选
    videoSourceIds: cfg.videoSourceIds,
    articleSources: sourceList(daily.ARTICLE_SOURCE_TYPES, cfg.articleSourceIds),
    videoSources: sourceList(daily.VIDEO_SOURCE_TYPES, cfg.videoSourceIds),
    columns: daily.getColumns(),
    defaultColumns: daily.DEFAULT_COLUMNS,
  });
});

// 校验/规整栏目数组：名称必填；无 id 自动生成；special 仅认 focus/fallback
// 3.3 增强：keywords 支持 AND 组合 —— 每项可以是字符串（OR）或字符串数组（AND）
function sanitizeColumns(cols) {
  if (!Array.isArray(cols) || !cols.length) throw new Error('columns 必须是非空数组');
  return cols.map((c, i) => {
    const out = {
      id: c.id || `c${Date.now()}_${i}`,
      name: String(c.name || '').trim(),
    };
    if (!out.name) throw new Error('栏目名称不能为空');
    if (c.special === 'focus' || c.special === 'fallback') {
      out.special = c.special;
    } else {
      if (c.desc !== undefined) out.desc = String(c.desc);
      out.keywords = Array.isArray(c.keywords)
        ? c.keywords.map((k) => {
            // AND 组合：数组内每项都是字符串
            if (Array.isArray(k)) return k.map((s) => String(s).trim()).filter(Boolean);
            return String(k).trim();
          }).filter((k) => (Array.isArray(k) ? k.length > 0 : k))
        : [];
    }
    return out;
  });
}

// PUT /api/settings/daily
settingsRouter.put('/', (req, res) => {
  const body = req.body || {};
  const cur = getSetting('daily', {});
  const next = { ...cur };

  if (body.windowHours !== undefined) {
    const n = Number(body.windowHours);
    if (!Number.isFinite(n) || n <= 0) return res.json({ ok: false, error: 'windowHours 必须是正数' });
    next.windowHours = n;
  }
  if (body.time !== undefined) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(body.time));
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
      return res.json({ ok: false, error: 'time 格式必须是 HH:MM' });
    }
    next.time = `${m[1].padStart(2, '0')}:${m[2]}`;
  }
  if (body.articleSourceIds !== undefined) {
    if (!Array.isArray(body.articleSourceIds)) return res.json({ ok: false, error: 'articleSourceIds 必须是数组' });
    next.articleSourceIds = body.articleSourceIds.map(Number);
  }
  if (body.videoSourceIds !== undefined) {
    if (!Array.isArray(body.videoSourceIds)) return res.json({ ok: false, error: 'videoSourceIds 必须是数组' });
    next.videoSourceIds = body.videoSourceIds.map(Number);
  }
  setSetting('daily', next);

  // focus 开关 → sources.focus（两种写法：focus={id:bool} 局部更新；focusSourceIds=[..] 全量替换）
  if (body.focusSourceIds !== undefined) {
    if (!Array.isArray(body.focusSourceIds)) return res.json({ ok: false, error: 'focusSourceIds 必须是数组' });
    const ids = new Set(body.focusSourceIds.map(Number));
    db.prepare('UPDATE sources SET focus = CASE WHEN id IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END')
      .run(JSON.stringify([...ids]));
  } else if (body.focus && typeof body.focus === 'object') {
    const stmt = db.prepare('UPDATE sources SET focus=? WHERE id=?');
    for (const [id, v] of Object.entries(body.focus)) stmt.run(v ? 1 : 0, Number(id));
  }

  // 栏目管理：restoreDefaultColumns 恢复默认四栏目；否则 columns 全量替换
  try {
    if (body.restoreDefaultColumns) {
      setSetting('daily.columns', daily.DEFAULT_COLUMNS);
    } else if (body.columns !== undefined) {
      setSetting('daily.columns', sanitizeColumns(body.columns));
    }
  } catch (err) {
    return res.json({ ok: false, error: err.message });
  }

  // AI 配置已迁移至 /api/settings 的 ai 区（统一入口）

  // 生成时间/窗口等变更后重排调度（重建日报 cron）
  try { require('../services/scheduler').reschedule(); } catch { /* 调度未启动时忽略 */ }
  audit.record('daily.settings', { detail: { keys: Object.keys(body).filter(k => ['windowHours','time','articleSourceIds','videoSourceIds','columns','focusSourceIds'].includes(k)) }, ip: req.ip });
  res.json({ ok: true });
});

// 供 settings.js 复用的 daily 字段校验（C24：两个写入口校验强度必须一致，防绕过校验写入非法 time/windowHours）
function validateDailyPatch(patch) {
  const out = {};
  if (patch.windowHours !== undefined) {
    const n = Number(patch.windowHours);
    if (!Number.isFinite(n) || n <= 0) throw new Error('windowHours 必须是正数');
    out.windowHours = n;
  }
  if (patch.time !== undefined) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(patch.time));
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error('time 格式必须是 HH:MM');
    out.time = `${m[1].padStart(2, '0')}:${m[2]}`;
  }
  return out;
}

module.exports = router;
module.exports.settingsRouter = settingsRouter;
module.exports.validateDailyPatch = validateDailyPatch;
