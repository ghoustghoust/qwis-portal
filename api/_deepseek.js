// DeepSeek 客户端云端版(十一期 M5):移植主系统 server/services/ai/deepseek.js
// fetch 直连 OpenAI 兼容协议;Key 读 Turso settings 'daily.apiKey'(兼容主系统的 'ai'.apiKey)
const { getSetting } = require('./_turso');

const DEFAULT_API_BASE = 'https://api.deepseek.com/chat/completions';
const DEFAULT_MODEL = 'deepseek-v4-flash';

async function aiConfig() {
  const daily = await getSetting('daily', {});
  const ai = await getSetting('ai', {});
  return {
    apiBase: daily.apiBase || ai.apiBase || DEFAULT_API_BASE,
    model: daily.model || ai.model || DEFAULT_MODEL,
    apiKey: daily.apiKey || ai.apiKey || '',
    aiEnabled: daily.aiEnabled !== undefined ? !!daily.aiEnabled : !!ai.aiEnabled,
  };
}

async function chat(messages, opts = {}) {
  const cfg = await aiConfig();
  const apiBase = opts.apiBase || cfg.apiBase;
  const model = opts.model || cfg.model;
  const apiKey = opts.apiKey !== undefined ? opts.apiKey : cfg.apiKey;
  if (!apiKey) throw new Error('未配置 DeepSeek Key');

  const body = {
    model,
    messages,
    ...(opts.responseFormat ? { response_format: { type: opts.responseFormat } } : {}),
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || 30000);
  let res;
  try {
    res = await fetch(apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) {
    const err = new Error(`DeepSeek API HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  return typeof content === 'string' ? content : '';
}

module.exports = { chat, aiConfig, DEFAULT_API_BASE, DEFAULT_MODEL };
