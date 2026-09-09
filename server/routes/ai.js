// AI 能力 API（Agnes AI 平台）
// 挂载 /api/ai：
//   GET  /api/ai/ping        —— 连通性测试
//   GET  /api/ai/config       —— 当前配置（Key 脱敏）
//   PUT  /api/ai/config       —— 更新运行时配置（model/apiBase）
//   POST /api/ai/translate    —— 精翻英文文章
//   POST /api/ai/summary      —— 智能摘要提取
//   POST /api/ai/chat         —— 通用对话（调试用）
const express = require('express');
const llm = require('../services/ai/llm');
const { getSetting, setSetting } = require('../db');
const log = require('../util/log');

const router = express.Router();

// ── 连通性测试 ──────────────────────────────────────────────
router.get('/ping', async (req, res) => {
  const result = await llm.ping();
  res.json({ ok: result.ok, ...result });
});
// POST /api/ai/ping（Vercel 兼容）
router.post('/ping', async (req, res) => {
  const result = await llm.ping();
  res.json({ ok: result.ok, ...result });
});

// ── 配置读取（Key 脱敏）────────────────────────────────────
router.get('/config', (req, res) => {
  const cfg = llm.getConfig();
  const runtimeCfg = getSetting('ai', {}) || {};
  const features = getSetting('ai.features', { translate: true, summary: true, classify: false, analyze: false });
  res.json({
    ok: true,
    apiKeyConfigured: !!cfg.apiKey,
    apiBase: cfg.apiBase,
    model: cfg.model,
    envSource: process.env.AGNES_API_KEY ? 'env' : 'settings',
    runtime: runtimeCfg,
    features,
  });
});

// ── 配置更新 ────────────────────────────────────────────────
router.put('/config', (req, res) => {
  const body = req.body || {};
  const cur = getSetting('ai', {}) || {};
  const next = { ...cur };
  if (body.model !== undefined) next.model = String(body.model).trim();
  if (body.apiBase !== undefined) next.apiBase = String(body.apiBase).trim();
  // apiKey 留空不覆盖（敏感字段惯例）
  if (body.apiKey && body.apiKey.trim()) next.apiKey = body.apiKey.trim();
  setSetting('ai', next);
  // 功能开关单独存储
  if (body.features && typeof body.features === 'object') {
    setSetting('ai.features', body.features);
  }
  log.info('[AI] 配置已更新');
  res.json({ ok: true });
});

// ── 精翻英文文章 ────────────────────────────────────────────
const DEFAULT_TRANSLATE_PROMPT = `你是一位资深中英翻译专家，擅长科技/AI 领域。请将以下英文内容翻译为高质量中文，要求：
1. 准确传达原意，不遗漏关键信息
2. 符合中文科技文章表达习惯，避免翻译腔
3. 专有名词首次出现时保留英文原文（如 "大语言模型（LLM）"）
4. 保持原文段落结构
5. 只输出翻译结果，不要添加解释或注释

请翻译以下内容：`;

router.post('/translate', async (req, res) => {
  try {
    const { text, prompt } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.json({ ok: false, error: '请提供待翻译的文本内容' });
    }
    const systemPrompt = prompt || getSetting('ai.prompt.translate', '') || DEFAULT_TRANSLATE_PROMPT;
    const result = await llm.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: String(text).trim() },
    ], { temperature: 0.3, timeoutMs: 120_000 });
    res.json({ ok: true, translation: result });
  } catch (err) {
    log.error('[AI] 翻译失败:', err.message);
    res.json({ ok: false, error: err.message });
  }
});

// ── 智能摘要提取 ────────────────────────────────────────────
const DEFAULT_SUMMARY_PROMPT = `你是一位专业的内容分析师。请从以下文章中提取核心要点，生成结构化摘要，格式如下：

**核心要点**（1-2 句话概括全文主旨）

**关键信息**：
- 要点 1
- 要点 2
- 要点 3
（提取 3-5 个最重要的信息点）

**影响/意义**：简要说明该内容的重要性或潜在影响

要求：
1. 摘要总长度控制在 200 字以内
2. 使用简洁的中文表达
3. 保留关键数据和专有名词`;

router.post('/summary', async (req, res) => {
  try {
    const { text, kind, prompt } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.json({ ok: false, error: '请提供待摘要的文本内容' });
    }
    const systemPrompt = prompt || getSetting('ai.prompt.summary', '') || DEFAULT_SUMMARY_PROMPT;
    const input = kind === 'video'
      ? `【视频简介】\n${String(text).trim()}`
      : `【文章内容】\n${String(text).trim()}`;
    const result = await llm.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input },
    ], { temperature: 0.4, maxTokens: 800, timeoutMs: 90_000 });
    res.json({ ok: true, summary: result });
  } catch (err) {
    log.error('[AI] 摘要失败:', err.message);
    res.json({ ok: false, error: err.message });
  }
});

// ── 通用对话（调试用）──────────────────────────────────────
router.post('/chat', async (req, res) => {
  try {
    const { messages, model, temperature } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) {
      return res.json({ ok: false, error: 'messages 必须是非空数组' });
    }
    const result = await llm.chat(messages, { model, temperature, timeoutMs: 120_000 });
    res.json({ ok: true, reply: result });
  } catch (err) {
    log.error('[AI] 对话失败:', err.message);
    res.json({ ok: false, error: err.message });
  }
});

// ── 翻译 Skill 管理 ─────────────────────────────────────────
const translateSkill = require('../services/ai/translate-skill');

// GET /api/ai/translate/config —— 获取翻译配置（含 Prompt、统计）
router.get('/translate/config', (req, res) => {
  res.json({ ok: true, ...translateSkill.getConfig() });
});

// PUT /api/ai/translate/config —— 更新翻译配置
router.put('/translate/config', (req, res) => {
  const body = req.body || {};
  // 更新开关配置
  if (body.enabled !== undefined || body.autoTranslate !== undefined) {
    translateSkill.updateConfig({
      enabled: body.enabled,
      autoTranslate: body.autoTranslate,
    });
  }
  // 更新 Prompt
  if (body.prompt !== undefined) {
    translateSkill.setPrompt(body.prompt);
  }
  // 恢复默认 Prompt
  if (body.restoreDefault) {
    translateSkill.resetPrompt();
  }
  log.info('[AI] 翻译 Skill 配置已更新');
  res.json({ ok: true });
});

// POST /api/ai/translate/batch —— 手动触发批量翻译
router.post('/translate/batch', async (req, res) => {
  try {
    const limit = Math.min(Number(req.body?.limit) || 10, 50);
    const articles = translateSkill.getPendingEnglishArticles(limit);
    // 过滤英文
    const englishArticles = articles.filter(a => translateSkill.isEnglish(a.title + ' ' + a.content_html));
    if (englishArticles.length === 0) {
      return res.json({ ok: true, translated: 0, message: '没有待翻译的英文文章' });
    }
    const results = await translateSkill.translateBatch(englishArticles);
    let saved = 0;
    for (const [articleId, translated] of results) {
      if (translateSkill.saveTranslation(articleId, translated)) saved++;
    }
    res.json({ ok: true, translated: saved, total: englishArticles.length });
  } catch (err) {
    log.error('[AI] 批量翻译失败:', err.message);
    res.json({ ok: false, error: err.message });
  }
});

// POST /api/ai/translate/single —— 翻译单篇文章
router.post('/translate/single', async (req, res) => {
  try {
    const { articleId } = req.body || {};
    if (!articleId) return res.json({ ok: false, error: '请提供 articleId' });
    const { db: database } = require('../db');
    const article = database.prepare('SELECT id, title, content_html FROM articles WHERE id = ?').get(articleId);
    if (!article) return res.json({ ok: false, error: '文章不存在' });
    const result = await translateSkill.translateArticle(article);
    if (result) {
      translateSkill.saveTranslation(articleId, result);
      res.json({ ok: true, translation: result });
    } else {
      res.json({ ok: false, error: '翻译失败' });
    }
  } catch (err) {
    log.error('[AI] 单篇翻译失败:', err.message);
    res.json({ ok: false, error: err.message });
  }
});

module.exports = router;
