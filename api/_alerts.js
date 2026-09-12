// 云端报警引擎（15-cloud-alerts，2026-09-12）
// Turso 版，移植自 server/services/alerts.js（双实现，改语义两边同步）
// 差异：冷却/日志直读写 Turso settings（serverless 无内存态）；无代理直连兜底（runner/Vercel 海外直连）；
// 新增事件 ai_failed / frozen_digest；错误分类器（F4 可诊断文案）
const crypto = require('crypto');
const { createClient } = require('@libsql/client');

let _db = null;
function getDb() {
  if (!_db) {
    _db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return _db;
}
async function qAll(sql, args = []) { return Array.from((await getDb().execute({ sql, args })).rows); }
async function qOne(sql, args = []) { return (await qAll(sql, args))[0]; }
function nowIso() { return new Date().toISOString(); }

async function getSetting(key, def = null) {
  const row = await qOne('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return def;
  try { return JSON.parse(row.value); } catch { return row.value ?? def; }
}
async function setSetting(key, val) {
  await getDb().execute({
    sql: 'INSERT OR REPLACE INTO settings(key, value) VALUES(?, ?)',
    args: [key, typeof val === 'string' ? val : JSON.stringify(val)],
  });
}
async function auditRecord(action, opts = {}) {
  try {
    await getDb().execute({
      sql: 'INSERT INTO audit_log(at, user, action, target, detail, ip) VALUES(?,?,?,?,?,?)',
      args: [nowIso(), opts.user || 'admin', action, opts.target || null,
        opts.detail ? JSON.stringify(opts.detail).slice(0, 2000) : null, null],
    });
  } catch { /* 审计失败不阻断 */ }
}

const DEFAULT_EVENTS = {
  source_error: true, source_paused: true, daily_failed: true,
  collect_stalled: true, ai_failed: true, frozen_digest: true,
};

async function getConfig() {
  const a = (await getSetting('alerts', {})) || {};
  return {
    channels: Array.isArray(a.channels) ? a.channels : [],
    events: { ...DEFAULT_EVENTS, ...(a.events || {}) },
    cooldownMin: Number(a.cooldownMin) || 120,
    recentLog: Array.isArray(a.recentLog) ? a.recentLog : [],
    silence: Array.isArray(a.silence) ? a.silence : [],
  };
}
const saveConfig = (cfg) => setSetting('alerts', cfg);

// ─── 渠道密钥脱敏（与本地同规则） ───
const SENSITIVE_KEYS = ['url', 'secret', 'sendkey', 'deviceKey', 'token'];
const SECRET_MASK = '********';
function maskChannels(channels) {
  return (Array.isArray(channels) ? channels : []).map((c) => {
    const cfg = { ...(c.config || {}) };
    for (const k of SENSITIVE_KEYS) if (cfg[k]) cfg[k] = SECRET_MASK;
    return { ...c, config: cfg };
  });
}
// PUT 合并：同 id 渠道敏感字段为掩码/空 → 保留旧值
function mergeChannelSecrets(oldChannels, newChannels) {
  const oldById = new Map((Array.isArray(oldChannels) ? oldChannels : []).map((c) => [c.id, c]));
  return (Array.isArray(newChannels) ? newChannels : []).map((c) => {
    const old = oldById.get(c.id);
    if (!old) return c;
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

// ─── 网络层 ───
async function sendJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text, httpStatus: res.status }; }
}
async function postWebhook(url, payload) {
  const r = await sendJson(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (r && r.errcode !== undefined && r.errcode !== 0) throw new Error(r.errmsg || `errcode=${r.errcode}`);
  if (r && r.code !== undefined && r.StatusCode === undefined && r.code !== 0 && r.code !== 200) throw new Error(r.msg || r.message || `code=${r.code}`);
  return r;
}
function signedUrl(url, secret) {
  if (!secret) return url;
  const timestamp = Date.now();
  const sign = encodeURIComponent(
    crypto.createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64')
  );
  return `${url}${url.includes('?') ? '&' : '?'}timestamp=${timestamp}&sign=${sign}`;
}

// ─── 七渠道发送器（与本地逐一对应） ───
const SENDERS = {
  async dingtalk(c, title, text) {
    return postWebhook(signedUrl(c.config.url, c.config.secret), { msgtype: 'text', text: { content: `${title}\n${text}` } });
  },
  async wecom(c, title, text) {
    return postWebhook(c.config.url, { msgtype: 'text', text: { content: `${title}\n${text}` } });
  },
  async feishu(c, title, text) {
    const body = { msg_type: 'text', content: { text: `${title}\n${text}` } };
    if (c.config.secret) {
      const ts = Math.floor(Date.now() / 1000);
      body.timestamp = String(ts);
      body.sign = crypto.createHmac('sha256', `${ts}\n${c.config.secret}`).digest('base64');
    }
    return postWebhook(c.config.url, body);
  },
  async serverchan(c, title, text) {
    const r = await sendJson(`https://sctapi.ftqq.com/${c.config.sendkey}.send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ title, desp: text }).toString(),
    });
    if (r.code !== 0 && r.code !== 200) throw new Error(r.message || 'Server酱返回异常');
    return r;
  },
  async bark(c, title, text) {
    const server = (c.config.server || 'https://api.day.app').replace(/\/$/, '');
    const r = await sendJson(`${server}/${c.config.deviceKey}/${encodeURIComponent(title)}/${encodeURIComponent(text)}?group=${encodeURIComponent('全网情报')}`);
    if (r.code !== 200) throw new Error(r.message || 'Bark 返回异常');
    return r;
  },
  async telegram(c, title, text) {
    const r = await sendJson(`https://api.telegram.org/bot${c.config.token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: c.config.chatId, text: `${title}\n${text}` }),
    });
    if (!r.ok) throw new Error(r.description || 'Telegram 返回异常');
    return r;
  },
  async webhook(c, title, text, event) {
    return postWebhook(c.config.url, { title, text, event, time: nowIso() });
  },
};

// ─── 冷却（Turso 持久化，serverless 无内存态） ───
async function loadCooldowns() { return (await getSetting('alerts.cooldowns', {})) || {}; }
function inCooldownFrom(c, key, minutes) {
  const t = c[key];
  return t && Date.now() - Date.parse(t) < minutes * 60e3;
}
async function markCooldown(key) {
  const c = await loadCooldowns();
  c[key] = nowIso();
  const keys = Object.keys(c);
  if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete c[k];
  await setSetting('alerts.cooldowns', c);
}

async function appendLog(entry) {
  const cfg = await getConfig();
  cfg.recentLog = [entry, ...cfg.recentLog].slice(0, 50);
  await saveConfig(cfg);
}

// ─── F4 错误分类器（可诊断文案；本地 alerts.js 有同规则副本，改规则两边同步） ───
function classifyError(errMsg, sourceType) {
  const m = String(errMsg || '');
  if (sourceType === 'youtube' && /HTTP (404|500)/.test(m)) {
    return { category: '反爬封锁', advice: 'YouTube 对机房 IP 间歇性封锁（假 404/500），下轮换 IP 自动重试；连续 10 次才熔断，一般无需处理' };
  }
  if (/HTTP 403/.test(m)) return { category: '访问被拒', advice: '源站拒绝访问（鉴权/反爬）。持续 24h 未恢复建议后台检查或换源' };
  if (/HTTP 404/.test(m)) return { category: '地址失效', advice: 'feed 地址可能已变更，建议管理台核对或换源' };
  if (/HTTP 5\d\d/.test(m)) return { category: '源站故障', advice: '对方服务器错误，下轮自动重试' };
  if (/timeout|aborted|ETIMEDOUT/i.test(m)) return { category: '超时', advice: '源站响应慢或网络抖动，下轮自动重试' };
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return { category: 'DNS 解析失败', advice: '域名不可达，检查地址拼写或源站状态' };
  return { category: '未知错误', advice: '到管理台源库查看该源 lastError 详情' };
}

// ─── 分发主流程 ───
async function dispatch(event, { sourceId, sourceType, title, text } = {}) {
  const cfg = await getConfig();
  if (cfg.events[event] === false) return { sent: 0, skipped: 'disabled' };
  if (sourceId && cfg.silence.length) {
    const silenced = cfg.silence.some((rule) => {
      if (rule.event && rule.event !== event) return false;
      if (rule.sourceId && Number(rule.sourceId) === Number(sourceId)) return true;
      if (rule.type && rule.type === sourceType) return true;
      return false;
    });
    if (silenced) return { sent: 0, skipped: 'silenced' };
  }
  const channels = cfg.channels.filter((c) => c.enabled !== false);
  if (!channels.length) return { sent: 0, skipped: 'no-channels' };
  const coolKey = `${event}:${sourceId || 'global'}`;
  const cooldowns = await loadCooldowns();
  if (inCooldownFrom(cooldowns, coolKey, cfg.cooldownMin)) return { sent: 0, skipped: 'cooldown' };
  await markCooldown(coolKey);

  const results = [];
  for (const c of channels) {
    const sender = SENDERS[c.type];
    if (!sender) { results.push({ channel: c.name, ok: false, error: '未知渠道类型' }); continue; }
    try {
      await sender(c, title, text, event);
      results.push({ channel: c.name, ok: true });
    } catch (e) {
      results.push({ channel: c.name, ok: false, error: e.message });
    }
  }
  await appendLog({ at: nowIso(), event, title, results });
  const sent = results.filter((r) => r.ok).length;
  await auditRecord('alerts.dispatch', { detail: { event, title: (title || '').slice(0, 80), sent, total: channels.length } });
  console.log(`[alerts] ${event}: 「${title}」→ ${sent}/${channels.length} 渠道成功`);
  return { sent, results };
}

// ─── 事件入口（F4 可诊断文案） ───
async function sourceAlert(source, failCount, errMsg) {
  const { category, advice } = classifyError(errMsg, source.type);
  if (failCount >= 3) {
    return dispatch('source_paused', {
      sourceId: source.id, sourceType: source.type,
      title: '🛑 源已熔断暂停',
      text: `源「${source.name}」（${source.type}）连续失败 ${failCount} 次，已自动暂停。\n原因分类：${category}\n最近错误：${String(errMsg || '').slice(0, 120)}\n处置建议：${advice}\n恢复入口：管理后台 → 源库 → 重新启用`,
    });
  }
  if (failCount >= 2) {
    return dispatch('source_error', {
      sourceId: source.id, sourceType: source.type,
      title: '⚠️ 源抓取失败',
      text: `源「${source.name}」（${source.type}）连续失败 ${failCount} 次。\n原因分类：${category}\n错误：${String(errMsg || '').slice(0, 120)}\n建议：${advice}`,
    });
  }
  return { sent: 0, skipped: 'below-threshold' };
}

function dailyFailed(errMsg) {
  return dispatch('daily_failed', {
    title: '📅 日报生成失败',
    text: `日报生成失败：${String(errMsg || '').slice(0, 200)}\n处置建议：到 GitHub Actions 查看 daily-report 任务日志；若为 Turso 连接问题通常是暂时性的`,
  });
}

function collectStalled(detail) {
  return dispatch('collect_stalled', {
    title: '⏸ 云端采集停滞',
    text: `过去 1 小时内没有任何源成功采集。\n${String(detail || '').slice(0, 200)}\n处置建议：依次检查 ① GitHub Actions 最近运行状态 ② cron-job.org 触发器 ③ Turso 连接`,
  });
}

function aiFailed(detail) {
  return dispatch('ai_failed', {
    title: '🤖 AI 链路失败',
    text: `${String(detail || '').slice(0, 300)}\n处置建议：检查 Agnes 额度/限流（免费池 20 RPM）；若持续 401 检查 settings.ai 是否被污染（应为 {}）`,
  });
}

// F5 熔断不沉默：每日汇总当前熔断待处理源
async function frozenDigest() {
  const rows = await qAll(
    "SELECT id, name, type, fail_count, extra FROM sources WHERE fail_count >= 3 AND enabled=0 ORDER BY fail_count DESC"
  );
  if (!rows.length) return { sent: 0, skipped: 'no-frozen' };
  const lines = rows.slice(0, 20).map((s) => {
    let err = '';
    try { err = JSON.parse(s.extra || '{}').lastError || ''; } catch { /* ignore */ }
    const { category } = classifyError(err, s.type);
    return `· [${s.type}] ${s.name}（${category}，连失 ${s.fail_count} 次）`;
  });
  return dispatch('frozen_digest', {
    title: `🧊 熔断待处理清单（${rows.length} 个源）`,
    text: `以下源处于熔断停用状态，请抽空到管理后台源库处理：\n${lines.join('\n')}${rows.length > 20 ? `\n…共 ${rows.length} 个` : ''}`,
  });
}

// 测试发送
async function testAll() {
  const cfg = await getConfig();
  const channels = cfg.channels.filter((c) => c.enabled !== false);
  if (!channels.length) return { sent: 0, skipped: 'no-channels', results: [] };
  const results = [];
  for (const c of channels) {
    const sender = SENDERS[c.type];
    try {
      if (!sender) throw new Error('未知渠道类型');
      await sender(c, '✅ 全网情报云端报警测试', '如果你看到这条消息，说明云端报警链路已通。');
      results.push({ channel: c.name, ok: true });
    } catch (e) {
      results.push({ channel: c.name, ok: false, error: e.message });
    }
  }
  return { sent: results.filter((r) => r.ok).length, results };
}

module.exports = {
  getConfig, saveConfig, maskChannels, mergeChannelSecrets, SECRET_MASK,
  dispatch, sourceAlert, dailyFailed, collectStalled, aiFailed, frozenDigest,
  classifyError, testAll, DEFAULT_EVENTS,
};
