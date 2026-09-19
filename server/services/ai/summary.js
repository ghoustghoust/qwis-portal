const { decodeXmlEntities } = require('../../../lib/text-clean'); // B94：实体解码唯一实现
// HTML 纯文本工具 + AI 摘要能力模块
// htmlToText 被日报引擎（services/ai/daily.js）引用：取正文纯文本做关键词匹配与去重
// AI 摘要/翻译能力已恢复，由 services/ai/llm.js 提供底层 LLM 调用
function htmlToText(html) {
  if (!html) return '';
  // B94：标签剥完后，实体解码统一走 lib/text-clean（这里原来自己抄了一遍映射表，
  // 抄的那份漏了 &apos;/&ldquo;/数字实体等——多份必漂）
  return decodeXmlEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

module.exports = { htmlToText };
