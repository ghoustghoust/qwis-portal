// 日报 AI 增强模块
// 职责：为日报候选条目生成 AI 摘要 + 重要度评分（1-10）
// 依赖：services/ai/llm.js（Agnes AI 平台）
const llm = require('./llm');
const log = require('../../util/log');

// 日报条目 AI 分析提示词
const DAILY_ANALYSIS_PROMPT = `你是一位 AI 行业情报分析师。请分析以下情报条目，输出 JSON 格式结果（不要输出其他内容）：

要求：
1. summary：用 1-2 句简洁中文概括该条目的核心信息（不超过 80 字）
2. importance：重要度评分 1-10（10=行业重大事件，7-9=值得关注，4-6=一般动态，1-3=低价值）
3. tags：1-3 个标签（如"大模型"、"融资"、"产品发布"、"开源"、"政策监管"等）

输出格式（严格 JSON）：
{"summary":"...","importance":N,"tags":["...","..."]}

请分析以下条目：`;

/**
 * 为单个条目生成 AI 分析
 * @param {object} item - {title, text, kind, source_name}
 * @returns {Promise<{summary:string, importance:number, tags:string[]}|null>}
 */
async function analyzeItem(item) {
  const input = `[${item.kind === 'video' ? '视频' : '文章'}] ${item.title}\n来源：${item.source_name}\n内容：${(item.text || '').slice(0, 1500)}`;
  try {
    const reply = await llm.chat([
      { role: 'system', content: DAILY_ANALYSIS_PROMPT },
      { role: 'user', content: input },
    ], { temperature: 0.2, maxTokens: 300, timeoutMs: 30_000 });

    // 解析 JSON（兼容 markdown 代码块包裹）
    const jsonStr = reply.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return {
      summary: String(parsed.summary || '').slice(0, 200),
      importance: Math.min(10, Math.max(1, Number(parsed.importance) || 5)),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 3) : [],
    };
  } catch (err) {
    log.warn(`[日报AI] 分析失败 "${(item.title || '').slice(0, 30)}": ${err.message}`);
    return null;
  }
}

/**
 * 批量分析日报候选条目（串行，避免 API 限流）
 * @param {Array} items - 候选条目列表
 * @param {object} [opts] - { concurrency?: number, onProgress?: fn }
 * @returns {Promise<Map<string, object>>} ref_id → AI 分析结果
 */
async function analyzeBatch(items, opts = {}) {
  const results = new Map();
  const total = items.length;
  let done = 0;
  let failed = 0;

  for (const item of items) {
    const key = `${item.kind}:${item.ref_id}`;
    const result = await analyzeItem(item);
    if (result) {
      results.set(key, result);
    } else {
      failed++;
    }
    done++;
    if (opts.onProgress) opts.onProgress({ done, failed, total });
    // 串行间隔，避免触发限流
    if (done < total) await new Promise(r => setTimeout(r, 500));
  }

  log.info(`[日报AI] 批量分析完成：成功 ${done - failed}/${total}，失败 ${failed}`);
  return results;
}

/**
 * 检查 AI 日报功能是否启用
 */
function isEnabled() {
  try {
    const { getSetting } = require('../../db');
    const aiCfg = getSetting('ai', {}) || {};
    return !!aiCfg.enabled;
  } catch { return false; }
}

module.exports = { analyzeItem, analyzeBatch, isEnabled };
