// LLM 通用客户端（Agnes AI 平台，OpenAI 兼容接口）
// 职责：封装 chat completions 调用，供翻译/摘要/日报等 Skill 复用
// 配置优先级：环境变量 AGNES_API_KEYS/AGNES_API_KEY > settings['ai'] 运行时配置
// 多账号（T6-3，10-13 用户拍板）：AGNES_API_KEYS 逗号分隔成池，额度耗尽进程内轮切；
// 与云端池同一环境变量命名，但本地不读云端耗尽表（本地 settings 是另一套库——三端不共享进程）。
const log = require('../../util/log');

const DEFAULT_BASE = 'https://apihub.agnes-ai.com/v1';
const DEFAULT_MODEL = 'agnes-2.5-flash';
const DEFAULT_TIMEOUT_MS = 60_000;

const QUOTA_RE = /insufficient[_\s-]?quota|quota exceeded|exceeded\s+(the\s+)?(current\s+)?quota|余额不足|额度已?用完|欠费|billing|balance/i;
const EXHAUST_TTL = 12 * 3600e3;
const _exhausted = new Map(); // 指纹 → 解除时刻（进程内；重启即复活重试，符合"探测活口"语义）
const _fp = (k) => String(k || '').slice(-6);

function _poolKeys(runtimeCfg) {
  const envPool = String(process.env.AGNES_API_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (envPool.length) return envPool;
  const single = process.env.AGNES_API_KEY || runtimeCfg.apiKey || '';
  return single ? [single] : [];
}

/**
 * 获取当前 LLM 配置（环境变量 + 运行时 settings 合并）
 */
function getConfig() {
  let runtimeCfg = {};
  try {
    const { getSetting } = require('../../db');
    runtimeCfg = getSetting('ai', {}) || {};
  } catch { /* db 未初始化时忽略 */ }

  const now = Date.now();
  const keys = _poolKeys(runtimeCfg).filter((k) => {
    const until = _exhausted.get(_fp(k));
    if (until && until > now) return false;
    if (until) _exhausted.delete(_fp(k));
    return true;
  });
  return {
    apiKeys: keys,
    apiKey: keys[0] || '',
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
  if (!cfg.apiKeys.length) {
    throw new Error('未配置 Agnes AI API Key，请在 .env 中设置 AGNES_API_KEY/AGNES_API_KEYS 或在设置页配置');
  }

  const url = `${cfg.apiBase.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: opts.model || cfg.model,
    messages,
  };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;

  let lastErr = null;
  for (const key of cfg.apiKeys) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs || DEFAULT_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        const err = new Error(`Agnes AI API HTTP ${resp.status}: ${text.slice(0, 200)}`);
        err.status = resp.status;
        // 额度耗尽 → 登记该账号并轮切下一账号（退避重试对它无意义）
        if ([402, 403, 429].includes(resp.status) && QUOTA_RE.test(text)) {
          _exhausted.set(_fp(key), Date.now() + EXHAUST_TTL);
          log.warn(`[llm] 账号(尾号 …${_fp(key)})额度耗尽，轮切下一账号（12h 后重试）`);
        }
        throw err;
      }

      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Agnes AI API 返回空内容: ' + JSON.stringify(data).slice(0, 200));
      }
      return content.trim();
    } catch (e) {
      lastErr = e;
      // 只有额度耗尽才换账号；网络/超时错误照旧抛给调用方（别把单账号的网络抖动误判成额度问题）
      if (!(e && e.status && _exhausted.get(_fp(key)))) throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('全部 AI 账号额度耗尽');
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
