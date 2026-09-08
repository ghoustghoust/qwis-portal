// 报警管理 API(九期)
// GET  /api/alerts/config        —— 渠道与事件配置
// PUT  /api/alerts/config        —— 保存 {channels, events, cooldownMin}
// POST /api/alerts/test {channelId?} —— 发送测试消息 (指定渠道或全部)
// GET  /api/alerts/log           —— 最近 50 条触发记录
// POST /api/alerts/clear-cooldowns —— 清空所有冷却记录（手动清理）
// DELETE /api/alerts/log          —— 清空报警日志
const express = require('express');
const alerts = require('../services/alerts');
const audit = require('../services/audit');

const router = express.Router();

router.get('/config', (req, res) => {
  // P0 安全修复（2026-09-05）：渠道密钥（webhook url/secret/sendkey/deviceKey/token）脱敏回传
  res.json({ ok: true, ...alerts.getPublicConfig(), eventMeta: alerts.EVENT_TITLE });
});

router.put('/config', (req, res) => {
  try {
    const { channels, events, cooldownMin, slowThresholdMs, silence } = req.body || {};
    const cfg = alerts.getConfig();
    if (channels !== undefined) {
      if (!Array.isArray(channels)) throw new Error('channels 必须是数组');
      for (const c of channels) {
        if (!c.type || !alerts.SENDERS[c.type]) throw new Error(`未知渠道类型: ${c.type}`);
        if (!c.name) throw new Error('渠道缺少名称');
        if (!c.id) c.id = `${c.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      }
      cfg.channels = alerts.mergeChannelSecrets(cfg.channels, channels); // 掩码/空值的敏感字段保留旧值
    }
    if (events !== undefined) cfg.events = { ...cfg.events, ...events };
    if (cooldownMin !== undefined) {
      const n = Number(cooldownMin);
      if (!Number.isFinite(n) || n < 5) throw new Error('冷却时长最小 5 分钟');
      cfg.cooldownMin = n;
    }
    // 3.2 精细化配置
    if (slowThresholdMs !== undefined) {
      const n = Number(slowThresholdMs);
      if (!Number.isFinite(n) || n < 1000) throw new Error('slowThresholdMs 最小 1000 毫秒');
      cfg.slowThresholdMs = n;
    }
    if (silence !== undefined) {
      if (!Array.isArray(silence)) throw new Error('silence 必须是数组');
      cfg.silence = silence.map((r) => ({
        sourceId: r.sourceId ? Number(r.sourceId) : undefined,
        type: r.type || undefined,
        event: r.event || undefined,
      })).filter((r) => r.sourceId || r.type);
    }
    alerts.saveConfig(cfg);
    audit.record('alerts.config', { detail: { changed: { channels: channels !== undefined, events: events !== undefined, cooldownMin: cooldownMin !== undefined, slowThresholdMs: slowThresholdMs !== undefined, silence: silence !== undefined } }, ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/test', async (req, res) => {
  const cfg = alerts.getConfig();
  let channels = cfg.channels.filter((c) => c.enabled !== false);
  const { channelId } = req.body || {};
  if (channelId) channels = channels.filter((c) => c.id === channelId);
  if (!channels.length) return res.status(400).json({ ok: false, error: '没有可测试的启用渠道' });
  // 测试走临时配置直发,不受事件开关/冷却影响
  const results = [];
  for (const c of channels) {
    const sender = alerts.SENDERS[c.type];
    try {
      await sender(c, '✅ 全网情报报警测试', `渠道「${c.name}」配置正确,报警链路已连通。\n时间: ${new Date().toLocaleString('zh-CN')}`);
      results.push({ channel: c.name, ok: true });
    } catch (e) {
      results.push({ channel: c.name, ok: false, error: e.message });
    }
  }
  res.json({ ok: true, results });
});

router.get('/log', (req, res) => {
  res.json({ ok: true, log: alerts.getConfig().recentLog });
});

// P1: 清空所有冷却记录
router.post('/clear-cooldowns', (req, res) => {
  try {
    alerts.clearCooldowns();
    audit.record('alerts.clear-cooldowns', { ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// P1: 清空报警日志
router.delete('/log', (req, res) => {
  const a = require('../db').getSetting('alerts', {});
  a.recentLog = [];
  require('../db').setSetting('alerts', a);
  audit.record('alerts.clear-log', { ip: req.ip });
  res.json({ ok: true });
});

// P2: 删除单条报警日志（下标 + at 指纹双校验，防删除瞬间有新记录插入导致删错目标）
router.delete('/log/:index', (req, res) => {
  const { getSetting, setSetting } = require('../db');
  const a = getSetting('alerts', {});
  const log = Array.isArray(a.recentLog) ? a.recentLog : [];
  let i = Number(req.params.index);
  if (!Number.isInteger(i) || i < 0 || i >= log.length) {
    return res.status(400).json({ ok: false, error: '无效的日志序号' });
  }
  const at = req.query.at;
  if (at && log[i].at !== at) {
    // 下标已位移（有新报警插入）：按 at 指纹重新定位
    i = log.findIndex((r) => r.at === at);
    if (i === -1) return res.status(404).json({ ok: false, error: '该条记录已不存在' });
  }
  log.splice(i, 1);
  a.recentLog = log;
  setSetting('alerts', a);
  res.json({ ok: true });
});

module.exports = router;
