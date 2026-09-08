// LLM 通用客户端（Agnes AI 平台，OpenAI 兼容接口）
// 职责：封装 chat completions 调用，供翻译/摘要/日报等 Skill 复用
// 配置优先级：环境变量 AGNES_API_KEY > settings['ai'] 运行时配置
const log = require('../../util/log');

const DEFAULT_BASE = 'https://apihub.agnes-ai.com/v1';
const DEFAULT_MODEL = 'agnes-2.5-flash';
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * 获取当前 LLM 配置（环境变量 + 运行时 settings 合并）
 */
function getConfig() {
  let runtimeCfg = {};
  try {
    const { getSetting } = require('../../db');
    runtimeCfg = getSetting('ai', {}) || {};
  } catch { /* db 未初始化时忽略 */ }

  return {
    apiKey: process.env.AGNES_API_KEY || runtimeCfg.apiKey || '',
    apiBase: process.env.AGNES_API_BASE || runtimeCfg.apiBase || DEFAULT_BASE,
    model: process.env.AGNES_MODEL || runtimeCfg.model || DEFAULT_MODEL,
  };
}

/**
 * 调用 LLM chat completions（OpenAI 兼容格式）
 * @param {Array<{role:string, content:string}>} messages - 消息列表
 * @param {object} [opts] - 可选参数
 * @param {string} [opts.model] - 覆盖模型名
 * @param {number} [opts.temperature] - 温度（0-2）
 * @param {number} [opts.maxTokens] - 最大输出 token
 * @param {number} [opts.timeoutMs] - 超时毫秒
 * @returns {Promise<string>} 助手回复文本
 */
async function chat(messages, opts = {}) {
  const cfg = getConfig();
  if (!cfg.apiKey) {
    throw new Error('未配置 Agnes AI API Key，请在 .env 中设置 AGNES_API_KEY 或在设置页配置');
  }

  const url = `${cfg.apiBase.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: opts.model || cfg.model,
    messages,
  };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Agnes AI API HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Agnes AI API 返回空内容: ' + JSON.stringify(data).slice(0, 200));
    }
    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 检测 API 是否可用（连通性测试）
 * @returns {Promise<{ok:boolean, model?:string, error?:string}>}
 */
async function ping() {
  try {
    const cfg = getConfig();
    if (!cfg.apiKey) return { ok: false, error: '未配置 API Key' };
    const reply = await chat([
      { role: 'user', content: '请回复"连通成功"四个字。' },
    ], { maxTokens: 20, timeoutMs: 15_000 });
    return { ok: true, model: cfg.model, reply };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { chat, ping, getConfig, DEFAULT_BASE, DEFAULT_MODEL };
