// 多平台报警服务(九期):渠道(钉钉/企微/飞书/Server酱/Bark/TG/自定义webhook) + 事件开关 + 冷却防骚扰 + 触发日志
// 配置存 settings.alerts: {channels:[{id,type,name,enabled,config:{...}}], events:{...}, cooldownMin, recentLog:[...]}
const { getSetting, setSetting } = require('../db');
const { fetchJson } = require('../util/http');
const log = require('../util/log');
const audit = require('../services/audit');

const DEFAULT_EVENTS = {
  source_error: true,          // 源抓取失败(连续失败≥2 次才报)
  source_paused: true,         // 源熔断自动暂停
  source_slow: true,           // 3.2 抓取耗时超阈值（ms）
  daily_failed: true,          // 日报生成失败
  collect_stalled: true,       // 采集停滞(1 小时内 0 成功刷新)
  // wemp_down / wemp_cookie_expired 已随 we-mp-rss 退役移除(2026-09-04)
};

function getConfig() {
  const a = getSetting('alerts', {});
  return {
    channels: Array.isArray(a.channels) ? a.channels : [],
    events: { ...DEFAULT_EVENTS, ...(a.events || {}) },
    cooldownMin: Number(a.cooldownMin) || 120,
    recentLog: Array.isArray(a.recentLog) ? a.recentLog : [],
    // 3.2 报警精细化：抓取耗时阈值（毫秒）+ 按源静默列表
    slowThresholdMs: Number(a.slowThresholdMs) || 30000,
    silence: Array.isArray(a.silence) ? a.silence : [], // [{sourceId?, type?, event}]
  };
}

function saveConfig(cfg) {
  setSetting('alerts', cfg);
}

// ---- 渠道凭据脱敏（2026-09-05 P0 修复：GET /api/alerts/config 曾明文回传全部渠道密钥）----
// 敏感字段：webhook URL（内含 access_token/key）、加签 secret、SendKey、Bark deviceKey、TG bot token
// 非敏感字段（server/chatId）保留原值
const SENSITIVE_KEYS = ['url', 'secret', 'sendkey', 'deviceKey', 'token'];
const SECRET_MASK = '********';

// GET 出参：敏感字段非空则替换为掩码
function maskChannels(channels) {
  return (Array.isArray(channels) ? channels : []).map((c) => {
    const cfg = { ...(c.config || {}) };
    for (const k of SENSITIVE_KEYS) {
      if (cfg[k]) cfg[k] = SECRET_MASK;
    }
    return { ...c, config: cfg };
  });
}

function getPublicConfig() {
  const cfg = getConfig();
  return { ...cfg, channels: maskChannels(cfg.channels) };
}

// PUT 入参合并：与既有渠道同 id 时，敏感字段为掩码/空值 → 保留旧值（防前端整体回写 channels 时把密钥刷成掩码）
function mergeChannelSecrets(oldChannels, newChannels) {
  const oldById = new Map((Array.isArray(oldChannels) ? oldChannels : []).map((c) => [c.id, c]));
  return (Array.isArray(newChannels) ? newChannels : []).map((c) => {
    const old = oldById.get(c.id);
    if (!old) return c; // 新渠道：原样使用（前端新增时填的是真实密钥）
    const cfg = { ...(c.config || {}) };
    for (const k of SENSITIVE_KEYS) {
      if (cfg[k] === undefined || cfg[k] === '' || cfg[k] === SECRET_MASK) {
        if (old.config && old.config[k] !== undefined) cfg[k] = old.config[k];
        else delete cfg[k];
      }
    }
    return { ...c, config: cfg };
  });
}

// ---- 各渠道发送器 ----
const crypto = require('crypto');

// 钉钉/飞书加签:timestamp + '\n' + secret 的 HMAC-SHA256 → base64 → urlencode
function signedUrl(url, secret) {
  if (!secret) return url;
  const timestamp = Date.now();
  const sign = encodeURIComponent(
    crypto.createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64')
  );
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}timestamp=${timestamp}&sign=${sign}`;
}

const SENDERS = {
  // 钉钉:POST webhook {msgtype:'text'};安全设置支持加签(config.secret)
  async dingtalk(c, title, text) {
    return postWebhook(signedUrl(c.config.url, c.config.secret), { msgtype: 'text', text: { content: `${title}\n${text}` } });
  },
  async wecom(c, title, text) {
    return postWebhook(c.config.url, { msgtype: 'text', text: { content: `${title}\n${text}` } });
  },
  // 飞书群自定义机器人;开启签名校验时需提供 config.secret
  async feishu(c, title, text) {
    const body = { msg_type: 'text', content: { text: `${title}\n${text}` } };
    if (c.config.secret) {
      const timestamp = Math.floor(Date.now() / 1000);
      body.timestamp = String(timestamp);
      body.sign = crypto.createHmac('sha256', `${timestamp}\n${c.config.secret}`).digest('base64');
    }
    return postWebhook(c.config.url, body);
  },
  // Server酱 Turbo:https://sctapi.ftqq.com/<sendkey>.send
  async serverchan(c, title, text) {
    const key = c.config.sendkey;
    const url = `https://sctapi.ftqq.com/${key}.send`;
    const r = await sendJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ title, desp: text }).toString(),
    });
    if (r.code !== 0 && r.code !== 200) throw new Error(r.message || 'Server酱返回异常');
    return r;
  },
  // Bark:https://<server>/<device_key>/<title>/<body>
  async bark(c, title, text) {
    const server = (c.config.server || 'https://api.day.app').replace(/\/$/, '');
    const url = `${server}/${c.config.deviceKey}/${encodeURIComponent(title)}/${encodeURIComponent(text)}?group=${encodeURIComponent('全网情报')}`;
    const r = await sendJson(url);
    if (r.code !== 200) throw new Error(r.message || 'Bark 返回异常');
    return r;
  },
  // Telegram:https://api.telegram.org/bot<token>/sendMessage
  async telegram(c, title, text) {
    const url = `https://api.telegram.org/bot${c.config.token}/sendMessage`;
    const r = await sendJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: c.config.chatId, text: `${title}\n${text}` }),
    });
    if (!r.ok) throw new Error(r.description || 'Telegram 返回异常');
    return r;
  },
  async webhook(c, title, text, event) {
    return postWebhook(c.config.url, { title, text, event, time: new Date().toISOString() });
  },
};

// ---- 网络层直连兆底:本地代理(HTTPS_PROXY)宕机时报警不能跟着哑 ----
let directAgent = null;
function getDirectAgent() {
  if (directAgent === null) {
    try { directAgent = new (require('undici').Agent)(); } catch { directAgent = false; }
  }
  return directAgent || null;
}
function isNetworkError(e) {
  const m = String((e && e.message) || '');
  return /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR/i.test(m) || !!(e && e.cause);
}
// fetchJson 封装:先走全局代理配置,网络级失败时绕过代理直连重试一次
async function sendJson(url, opts) {
  try {
    return await fetchJson(url, opts);
  } catch (e) {
    const agent = getDirectAgent();
    if (agent && isNetworkError(e)) {
      log.warn(`[报警] 代理通道失败(${e.message}),直连重试: ${String(url).slice(0, 60)}`);
      return await fetchJson(url, { ...opts, dispatcher: agent });
    }
    throw e;
  }
}

async function postWebhook(url, payload) {
  const r = await sendJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  // 钉钉/企微 errcode 非 0 视为失败;飞书 code 非 0 失败
  if (r && (r.errcode !== undefined && r.errcode !== 0)) throw new Error(r.errmsg || `errcode=${r.errcode}`);
  if (r && (r.code !== undefined && r.StatusCode === undefined && r.code !== 0 && r.code !== 200)) throw new Error(r.msg || r.message || `code=${r.code}`);
  return r;
}

// ---- 冷却(同源同事件 cooldownMin 内不重复) ----
let cooldowns = null; // { "event:sourceId": isoTime }
function loadCooldowns() {
  if (cooldowns === null) cooldowns = getSetting('alerts.cooldowns', {});
  return cooldowns;
}
function inCooldown(key, minutes) {
  const t = loadCooldowns()[key];
  return t && Date.now() - Date.parse(t) < minutes * 60e3;
}
function markCooldown(key) {
  const c = loadCooldowns();
  c[key] = new Date().toISOString();
  // 控制体积:只留最近 200 条
  const keys = Object.keys(c);
  if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete c[k];
  setSetting('alerts.cooldowns', c);
}

function appendLog(entry) {
  const cfg = getConfig();
  cfg.recentLog = [entry, ...cfg.recentLog].slice(0, 50);
  saveConfig(cfg);
}

/**
 * 手动清除所有冷却记录（用于后台管理页的'清空冷却'功能）
 * 注意：真正生效的冷却存 settings['alerts.cooldowns']（见 loadCooldowns），且有内存缓存——两者都要清
 */
function clearCooldowns() {
  cooldowns = {};
  setSetting('alerts.cooldowns', cooldowns);
  log.info('[报警] 已清空所有冷却记录');
}

/**
 * 自动清理超过 7 天的冷却记录，防止数据库膨胀
 */
function autoCleanupOldCooldowns(maxDays = 7) {
  const c = loadCooldowns();
  const cutoff = Date.now() - maxDays * 24 * 60e3 * 60;
  let cleaned = 0;
  for (const key of Object.keys(c)) {
    if (Date.parse(c[key]) < cutoff) {
      delete c[key];
      cleaned++;
    }
  }
  if (cleaned > 0) {
    setSetting('alerts.cooldowns', c);
    log.info(`[报警] 自动清理了 ${cleaned} 条过期冷却记录`);
  }
}

/**
 * 自动清理超过 maxDays 天的报警日志，防止数据库膨胀
 */
function autoCleanupOldLogs(maxDays = 7) {
  const cfg = getConfig();
  const before = (cfg.recentLog || []).length;
  const cutoff = Date.now() - maxDays * 24 * 60e3 * 60;
  const kept = (cfg.recentLog || []).filter((r) => Date.parse(r.at) >= cutoff);
  if (kept.length !== before) {
    cfg.recentLog = kept;
    saveConfig(cfg);
    log.info(`[报警] 自动清理了 ${before - kept.length} 条过期报警日志,保留 ${kept.length} 条`);
  }
}

/**
 * dispatch(event, {sourceId?, sourceType?, title, text}) —— 按开关+冷却+静默规则分发到所有启用渠道
 * 返回 {sent: n, skipped: 'cooldown'|'disabled'|'silenced'|'no-channels', results: [...]}
 */
async function dispatch(event, { sourceId, sourceType, title, text }) {
  const cfg = getConfig();
  if (cfg.events[event] === false) return { sent: 0, skipped: 'disabled' };

  // 3.2 按源/类型静默：匹配 sourceId 或 type 的特定事件不发送
  if (sourceId && Array.isArray(cfg.silence) && cfg.silence.length) {
    const silenced = cfg.silence.some((rule) => {
      if (rule.event && rule.event !== event) return false;
      if (rule.sourceId && Number(rule.sourceId) === Number(sourceId)) return true;
      if (rule.type && rule.type === sourceType) return true;
      return false;
    });
    if (silenced) {
      log.info(`[报警] ${event} 命中静默规则,跳过: sourceId=${sourceId}`);
      return { sent: 0, skipped: 'silenced' };
    }
  }

  const channels = cfg.channels.filter((c) => c.enabled !== false);
  if (!channels.length) return { sent: 0, skipped: 'no-channels' };
  const coolKey = `${event}:${sourceId || 'global'}`;
  if (inCooldown(coolKey, cfg.cooldownMin)) {
    log.info(`[报警] ${event} 冷却中,跳过: ${title}`);
    return { sent: 0, skipped: 'cooldown' };
  }
  markCooldown(coolKey);

  const results = [];
  for (const c of channels) {
    const sender = SENDERS[c.type];
    if (!sender) { results.push({ channel: c.name, ok: false, error: '未知渠道类型' }); continue; }
    try {
      await sender(c, title, text, event);
      results.push({ channel: c.name, ok: true });
    } catch (e) {
      results.push({ channel: c.name, ok: false, error: e.message });
      log.warn(`[报警] 渠道「${c.name}」发送失败:`, e.message);
    }
  }
  const entry = { at: new Date().toISOString(), event, title, results };
  appendLog(entry);
  const sent = results.filter((r) => r.ok).length;
  // 3.2 报警发送结果写入审计日志
  audit.record('alerts.dispatch', { detail: { event, title: (title || '').slice(0, 80), sent, total: channels.length, failed: results.length - sent } });
  log.info(`[报警] ${event}: 「${title}」→ ${sent}/${channels.length} 渠道成功`);
  return { sent, results };
}

// ---- 事件便捷入口 ----
const EVENT_TITLE = {
  source_error: '⚠️ 源抓取失败',
  source_paused: '🛑 源已熔断暂停',
  source_slow: '🐢 源抓取耗时过长',
  daily_failed: '📅 日报生成失败',
  collect_stalled: '⏸ 采集停滞',
};

function sourceError(source, failCount, errMsg) {
  if (failCount >= 3) {
    return dispatch('source_paused', {
      sourceId: source.id,
      title: EVENT_TITLE.source_paused,
      text: `源「${source.name}」连续失败 ${failCount} 次，已自动暂停。请到管理后台检查或重新启用。\n最近错误：${log.mask(String(errMsg || '').slice(0, 120))}`, // ✅ 脱敏
    });
  }
  if (failCount >= 2) {
    return dispatch('source_error', {
      sourceId: source.id,
      title: EVENT_TITLE.source_error,
      text: `源「${source.name}」连续失败 ${failCount} 次。\n错误：${log.mask(String(errMsg || '').slice(0, 120))}`, // ✅ 脱敏
    });
  }
  return Promise.resolve({ sent: 0, skipped: 'below-threshold' });
}

function dailyFailed(errMsg) {
  return dispatch('daily_failed', {
    title: EVENT_TITLE.daily_failed,
    text: `今日日报生成失败: ${String(errMsg || '').slice(0, 200)}`,
  });
}

function collectStalled(detail) {
  return dispatch('collect_stalled', {
    title: EVENT_TITLE.collect_stalled,
    text: `过去 1 小时内没有任何源成功刷新,可能调度器异常或网络中断。请检查服务状态。\n${String(detail || '').slice(0, 200)}`,
  });
}

// 3.2 抓取耗时超阈值报警
function sourceSlow(source, elapsedMs) {
  const cfg = getConfig();
  if (elapsedMs < cfg.slowThresholdMs) return Promise.resolve({ sent: 0, skipped: 'below-threshold' });
  return dispatch('source_slow', {
    sourceId: source.id,
    sourceType: source.type,
    title: EVENT_TITLE.source_slow,
    text: `源「${source.name}」抓取耗时 ${(elapsedMs / 1000).toFixed(1)}s，超过阈值 ${(cfg.slowThresholdMs / 1000).toFixed(0)}s。`,
  });
}

module.exports = { getConfig, getPublicConfig, saveConfig, mergeChannelSecrets, SECRET_MASK, SENSITIVE_KEYS, dispatch, sourceError, sourceSlow, dailyFailed, collectStalled, EVENT_TITLE, DEFAULT_EVENTS, SENDERS, clearCooldowns, autoCleanupOldCooldowns, autoCleanupOldLogs };
