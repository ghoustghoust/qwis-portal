// 运维健康状态聚合接口（P1）：熔断源统计 + Cookie 失效特征 + B 站诊断
// 供管理后台实时状态指示器与运维工具箱调用，只读接口不改变任何状态
// （we-mp-rss 已退役：wemp 引擎在线检测随之移除，2026-09-04）
const express = require('express');
const { db, getSetting } = require('../db');
const { mask } = require('../util/log');

const router = express.Router();

// GET /api/health/status — 综合健康快照（前端状态面板 30s 轮询）
router.get('/status', async (req, res) => {
  try {
    // 源状态统计
    const total = db.prepare('SELECT COUNT(*) c FROM sources').get().c;
    const enabled = db.prepare('SELECT COUNT(*) c FROM sources WHERE enabled=1').get().c;
    const errorSources = db.prepare("SELECT COUNT(*) c FROM sources WHERE status='error' AND enabled=1").get().c;
    const frozen = db.prepare('SELECT COUNT(*) c FROM sources WHERE fail_count >= 3 AND enabled=0').get().c;

    // 3. 熔断源清单（带脱敏后的最近错误，前端展示用）
    const frozenList = db.prepare(
      'SELECT id, name, type, fail_count, extra FROM sources WHERE fail_count >= 3 AND enabled=0 ORDER BY fail_count DESC LIMIT 20'
    ).all().map((r) => {
      let extra = {};
      try { extra = JSON.parse(r.extra || '{}'); } catch { /* 忽略 */ }
      return {
        id: r.id, name: r.name, type: r.type, failCount: r.fail_count,
        lastError: extra.lastError ? mask(extra.lastError).slice(0, 200) : null,
        lastErrorAt: extra.lastErrorAt || null,
      };
    });

    // 4. Cookie 失效特征扫描（-2012/过期/失效/401）
    const cookieIssues = db.prepare(
      "SELECT id, name, type, extra FROM sources WHERE status='error' AND extra LIKE '%lastError%'"
    ).all().filter((r) => {
      let extra = {};
      try { extra = JSON.parse(r.extra || '{}'); } catch { return false; }
      return /-2012|cookie.*(过期|失效)|登录态失效|401|-101|SESSDATA/i.test(extra.lastError || '');
    }).map((r) => ({ id: r.id, name: r.name, type: r.type }));

    res.json({
      ok: true,
      sources: { total, enabled, error: errorSources, frozen },
      frozenList,
      cookieIssues,
      alerts: getAlertSummary(),
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 报警配置摘要（事件开关 + 渠道数 + 最近触发记录），用于诊断"报警为何未触发"
function getAlertSummary() {
  try {
    const a = getSetting('alerts', {});
    const events = a.events || {};
    const channels = Array.isArray(a.channels) ? a.channels : [];
    const recentLog = Array.isArray(a.recentLog) ? a.recentLog.slice(-5) : [];
    return {
      eventsEnabled: {
        source_error: events.source_error !== false,
        source_paused: events.source_paused !== false,
        collect_stalled: events.collect_stalled !== false,
      },
      enabledChannelCount: channels.filter((c) => c.enabled).length,
      cooldownMin: Number(a.cooldownMin) || 120,
      recentLog,
    };
  } catch { return null; }
}

// POST /api/health/bilibili-diagnose — B 站专项诊断：强制刷新 WBI 密钥 + 验证 Cookie 登录态
router.post('/bilibili-diagnose', async (req, res) => {
  try {
    const bili = require('../services/collectors/bilibili');
    const result = await bili._diagnose();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/health/unfreeze-all — 批量解冻：重置所有熔断源的 fail_count 并重新启用
// 运维兜底手段（人工确认后由前端按钮或脚本调用），返回恢复的源清单
router.post('/unfreeze-all', (req, res) => {
  try {
    const frozen = db.prepare(
      'SELECT id, name, type, fail_count FROM sources WHERE fail_count >= 3 AND enabled=0'
    ).all();
    if (!frozen.length) return res.json({ ok: true, restored: 0, message: '无熔断源需要恢复' });

    // 统一解冻语义(store.unfreezeSource):清计数+启用+清错误字段,保留 extra 其他配置
    const { unfreezeSource } = require('../services/collectors/store');
    for (const r of frozen) unfreezeSource(r.id);
    res.json({ ok: true, restored: frozen.length, sources: frozen });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/health/unfreeze/:id — 单源解冻（前端表格行内操作）
router.post('/unfreeze/:id', (req, res) => {
  try {
    const s = db.prepare('SELECT * FROM sources WHERE id=?').get(req.params.id);
    if (!s) return res.status(404).json({ ok: false, error: 'not found' });
    require('../services/collectors/store').unfreezeSource(s.id);
    res.json({ ok: true, id: s.id, name: s.name });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
