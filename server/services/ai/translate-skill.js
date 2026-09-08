// PDF Translate Skill（精翻模块）
// 职责：对英文资讯/论文/工程文章进行高质量中文化翻译
// Prompt 可通过 settings['translate.prompt'] 编辑，后台管理页提供编辑入口
const llm = require('./llm');
const { getSetting, setSetting } = require('../../db');
const { db } = require('../../db');
const log = require('../../util/log');

// ── 默认翻译提示词（精翻，非学术翻译）────────────────────────────
const DEFAULT_PROMPT = `你是一位资深科技翻译专家，擅长将英文新闻资讯、技术论文和工程类文章翻译为高质量中文。

翻译要求：
1. 【准确性】忠实原文，不遗漏关键信息，不添加原文没有的内容
2. 【流畅性】符合中文表达习惯，避免翻译腔（如"被...所"、"对于...来说"过多使用）
3. 【专业性】技术术语首次出现时采用「中文（英文原文）」格式，如"大语言模型（LLM）"
4. 【结构保持】保留原文的段落结构、列表、标题层级
5. 【数字与单位】保留原始数字，单位按中文习惯转换（如 "10 million" → "1000 万"）
6. 【专有名词】公司名/产品名/人名保留英文或通用译名，不强行音译
7. 【语境适配】新闻体用简洁明快的语言，论文体用严谨正式的措辞

请翻译以下内容，只输出翻译结果，不要添加任何解释或注释。`;

/**
 * 获取当前翻译 Prompt（运行时配置 > 默认值）
 */
function getPrompt() {
  return getSetting('translate.prompt', '') || DEFAULT_PROMPT;
}

/**
 * 更新翻译 Prompt
 */
function setPrompt(text) {
  setSetting('translate.prompt', String(text || ''));
}

/**
 * 恢复默认 Prompt
 */
function resetPrompt() {
  setSetting('translate.prompt', '');
}

/**
 * 检测文本是否为英文为主（CJK 字符占比 < 20% 且 Latin 字符占比 > 50%）
 */
function isEnglish(text) {
  if (!text) return false;
  const s = String(text).replace(/<[^>]+>/g, '').replace(/\s+/g, '');
  if (s.length < 20) return false;
  let cjk = 0, latin = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x4e00 && cp <= 0x9fff) cjk++;
    else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) latin++;
  }
  const total = cjk + latin || 1;
  return (latin / total) > 0.5 && (cjk / total) < 0.2;
}

/**
 * 翻译单篇文章（标题 + 正文纯文本）
 * @param {object} article - {title, content_html}
 * @returns {Promise<{title:string, content:string}|null>}
 */
async function translateArticle(article) {
  const title = String(article.title || '').trim();
  // 正文取纯文本（HTML 标签会干扰翻译质量）
  const plainText = String(article.content_html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&[a-zA-Z#0-9]+;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 6000); // 限制输入长度，避免超 token

  if (!plainText && !title) return null;

  const input = title
    ? `Title: ${title}\n\nArticle:\n${plainText}`
    : plainText;

  try {
    const reply = await llm.chat([
      { role: 'system', content: getPrompt() },
      { role: 'user', content: input },
    ], { temperature: 0.3, timeoutMs: 120_000 });

    // 解析结果：如果原文有标题，尝试分离翻译后的标题和正文
    let translatedTitle = '';
    let translatedContent = reply;
    if (title && reply.includes('\n')) {
      const firstLine = reply.split('\n')[0].trim();
      // 如果首行长度合理（像标题），视为翻译后的标题
      if (firstLine.length < 100 && firstLine.length > 2) {
        translatedTitle = firstLine;
        translatedContent = reply.slice(firstLine.length).replace(/^\n+/, '');
      }
    }
    return { title: translatedTitle, content: translatedContent };
  } catch (err) {
    log.warn(`[翻译Skill] 翻译失败 "${title.slice(0, 30)}": ${err.message}`);
    return null;
  }
}

/**
 * 批量翻译（串行，限流保护）
 * @param {Array} articles - [{id, title, content_html}]
 * @param {object} [opts] - { onProgress?: fn }
 * @returns {Promise<Map<number, object>>} articleId → 翻译结果
 */
async function translateBatch(articles, opts = {}) {
  const results = new Map();
  const total = articles.length;
  let done = 0;
  let failed = 0;

  for (const article of articles) {
    const result = await translateArticle(article);
    if (result) {
      results.set(article.id, result);
    } else {
      failed++;
    }
    done++;
    if (opts.onProgress) opts.onProgress({ done, failed, total });
    if (done < total) await new Promise(r => setTimeout(r, 800));
  }

  log.info(`[翻译Skill] 批量翻译完成：成功 ${done - failed}/${total}，失败 ${failed}`);
  return results;
}

/**
 * 将翻译结果写入数据库
 */
function saveTranslation(articleId, translated) {
  if (!translated) return false;
  db.prepare(
    'UPDATE articles SET translated_title = ?, translated_content = ? WHERE id = ?'
  ).run(translated.title || null, translated.content || null, articleId);
  return true;
}

/**
 * 检查翻译功能是否启用（自动翻译开关）
 */
function isEnabled() {
  const cfg = getSetting('translate', {}) || {};
  return cfg.enabled !== false; // 默认启用
}

/**
 * 获取翻译配置
 */
function getConfig() {
  const cfg = getSetting('translate', {}) || {};
  return {
    enabled: cfg.enabled !== false,
    prompt: getPrompt(),
    defaultPrompt: DEFAULT_PROMPT,
    autoTranslate: cfg.autoTranslate !== false,
    stats: {
      totalArticles: db.prepare('SELECT COUNT(*) c FROM articles').get().c,
      translatedArticles: db.prepare('SELECT COUNT(*) c FROM articles WHERE translated_title IS NOT NULL OR translated_content IS NOT NULL').get().c,
      pendingArticles: db.prepare(`
        SELECT COUNT(*) c FROM articles 
        WHERE translated_title IS NULL AND translated_content IS NULL
        AND content_html IS NOT NULL AND content_html != ''
      `).get().c,
    },
  };
}

/**
 * 更新翻译配置
 */
function updateConfig(patch) {
  const cur = getSetting('translate', {}) || {};
  const next = { ...cur };
  if (patch.enabled !== undefined) next.enabled = !!patch.enabled;
  if (patch.autoTranslate !== undefined) next.autoTranslate = !!patch.autoTranslate;
  setSetting('translate', next);
}

/**
 * 获取待翻译的英文文章（用于手动触发批量翻译）
 */
function getPendingEnglishArticles(limit = 20) {
  return db.prepare(`
    SELECT id, title, content_html FROM articles
    WHERE translated_title IS NULL AND translated_content IS NULL
    AND content_html IS NOT NULL AND content_html != ''
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

module.exports = {
  getPrompt, setPrompt, resetPrompt,
  isEnglish, translateArticle, translateBatch, saveTranslation,
  isEnabled, getConfig, updateConfig, getPendingEnglishArticles,
  DEFAULT_PROMPT,
};
