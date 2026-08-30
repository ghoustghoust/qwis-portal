// 报警服务云端版(十一期 M4):移植主系统 server/services/alerts.js
// 六渠道发送器是纯 HTTP,原样可用;配置/冷却存 Turso settings(异步化)
const crypto = require('crypto');
const { getSetting, setSetting } = require('./_turso');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const DEFAULT_EVENTS = {
  source_error: true,
  source_paused: true,
  wemp_down: true,
  daily_failed: true,
  wemp_cookie_expired: true,
};

const EVENT_TITLE = {
  source_error: '⚠️ 源抓取失败',
  source_paused: '🛑 源已熔断暂停',
  wemp_down: '🔌 公众号引擎离线',
  daily_failed: '📅 日报生成失败',
  wemp_cookie_expired: '🔑 微信读书 Cookie 失效',
};

async function getConfig() {
  const a = await getSetting('alerts', {});
  return {
    channels: Array.isArray(a.channels) ? a.channels : [],
    events: { ...DEFAULT_EVENTS, ...(a.events || {}) },
    cooldownMin: Number(a.cooldownMin) || 120,
    recentLog: Array.isArray(a.recentLog) ? a.recentLog : [],
  };
}

async function saveConfig(cfg) {
  await setSetting('alerts', cfg);
}

async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, {
      ...opts,
      headers: { 'User-Agent': UA, ...(opts.headers || {}) },
      signal: ctrl.signal,
    });
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

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

async function postWebhook(url, payload) {
  const r = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (r && (r.errcode !== undefined && r.errcode !== 0)) throw new Error(r.errmsg || `errcode=${r.errcode}`);
  if (r && (r.code !== undefined && r.StatusCode === undefined && r.code !== 0 && r.code !== 200)) throw new Error(r.msg || r.message || `code=${r.code}`);
  return r;
}

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
      const timestamp = Math.floor(Date.now() / 1000);
      body.timestamp = String(timestamp);
      body.sign = crypto.createHmac('sha256', `${timestamp}\n${c.config.secret}`).digest('base64');
    }
    return postWebhook(c.config.url, body);
  },
  async serverchan(c, title, text) {
    const r = await fetchJson(`https://sctapi.ftqq.com/${c.config.sendkey}.send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ title, desp: text }).toString(),
    });
    if (r.code !== 0 && r.code !== 200) throw new Error(r.message || 'Server酱返回异常');
    return r;
  },
  async bark(c, title, text) {
    const server = (c.config.server || 'https://api.day.app').replace(/\/$/, '');
    const r = await fetchJson(`${server}/${c.config.deviceKey}/${encodeURIComponent(title)}/${encodeURIComponent(text)}?group=${encodeURIComponent('全网情报')}`);
    if (r.code !== 200) throw new Error(r.message || 'Bark 返回异常');
    return r;
  },
  async telegram(c, title, text) {
    const r = await fetchJson(`https://api.telegram.org/bot${c.config.token}/sendMessage`, {
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

// ---- 冷却(同源同事件 cooldownMin 内不重复;存 Turso settings) ----
async function inCooldown(key, minutes) {
  const c = await getSetting('alerts.cooldowns', {});
  const t = c[key];
  return t && Date.now() - Date.parse(t) < minutes * 60e3;
}
async function markCooldown(key) {
  const c = await getSetting('alerts.cooldowns', {});
  c[key] = new Date().toISOString();
  const keys = Object.keys(c);
  if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete c[k];
  await setSetting('alerts.cooldowns', c);
}

async function appendLog(entry) {
  const cfg = await getConfig();
  cfg.recentLog = [entry, ...cfg.recentLog].slice(0, 50);
  await saveConfig(cfg);
}

// dispatch(event, {sourceId?, title, text}) —— 按开关+冷却分发到所有启用渠道
async function dispatch(event, { sourceId, title, text }) {
  const cfg = await getConfig();
  if (cfg.events[event] === false) return { sent: 0, skipped: 'disabled' };
  const channels = cfg.channels.filter((c) => c.enabled !== false);
  if (!channels.length) return { sent: 0, skipped: 'no-channels' };
  const coolKey = `${event}:${sourceId || 'global'}`;
  if (await inCooldown(coolKey, cfg.cooldownMin)) return { sent: 0, skipped: 'cooldown' };
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
  await appendLog({ at: new Date().toISOString(), event, title, results });
  return { sent: results.filter((r) => r.ok).length, results };
}

function sourceError(source, failCount, errMsg) {
  if (failCount >= 3) {
    return dispatch('source_paused', {
      sourceId: source.id,
      title: EVENT_TITLE.source_paused,
      text: `源「${source.name}」连续失败 ${failCount} 次,已自动暂停。请到管理后台检查或重新启用。\n最近错误: ${String(errMsg || '').slice(0, 120)}`,
    });
  }
  if (failCount >= 2) {
    return dispatch('source_error', {
      sourceId: source.id,
      title: EVENT_TITLE.source_error,
      text: `源「${source.name}」连续失败 ${failCount} 次。\n错误: ${String(errMsg || '').slice(0, 120)}`,
    });
  }
  return Promise.resolve({ sent: 0, skipped: 'below-threshold' });
}

module.exports = { getConfig, saveConfig, dispatch, sourceError, SENDERS, DEFAULT_EVENTS, EVENT_TITLE };
