// HTML 纯文本工具 + AI 摘要能力模块
// htmlToText 被日报引擎（services/ai/daily.js）引用：取正文纯文本做关键词匹配与去重
// AI 摘要/翻译能力已恢复，由 services/ai/llm.js 提供底层 LLM 调用
function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { htmlToText };
