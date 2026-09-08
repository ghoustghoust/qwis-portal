import DOMPurify from 'dompurify';

// 2026-09-05 P0 安全修复：RSS/公众号正文是第三方不可信 HTML。
// 服务端 cleanContent 只做结构性清理（不剥 onerror/onclick 内联事件与 javascript: 链接），
// 所有 dangerouslySetInnerHTML 渲染前必须再过一道 DOMPurify。
// referrerpolicy 是 cleanContent 注入的防盗链属性，需显式放行；target/loading 同理。
export function safeHtml(html) {
  return DOMPurify.sanitize(String(html || ''), {
    ADD_ATTR: ['referrerpolicy', 'target', 'loading'],
  });
}
