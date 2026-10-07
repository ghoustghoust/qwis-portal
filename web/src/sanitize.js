import DOMPurify from 'dompurify';

// 2026-09-05 P0 安全修复：RSS/公众号正文是第三方不可信 HTML。
// 服务端 cleanContent 只做结构性清理（不剥 onerror/onclick 内联事件与 javascript: 链接），
// 所有 dangerouslySetInnerHTML 渲染前必须再过一道 DOMPurify。
// referrerpolicy 是 cleanContent 注入的防盗链属性，需显式放行；target/loading 同理。

// 2026-10-06 性能：净化产物的 img 统一补懒加载——长文几十张原图此前随注入即刻全量下载，
// 打开文章整页卡顿。属性必须在注入 DOM 前就挂在标签上（事后 setAttribute 拦不住已发起的请求），
// 所以挂 DOMPurify 属性钩子而不是渲染后再处理。decoding=async 顺便把解码挪出主线程关键路径。
let _hooked = false;
function ensureImgLazyHook() {
  if (_hooked) return;
  _hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'IMG') {
      if (!node.getAttribute('loading')) node.setAttribute('loading', 'lazy');
      if (!node.getAttribute('decoding')) node.setAttribute('decoding', 'async');
    }
  });
}

export function safeHtml(html) {
  ensureImgLazyHook();
  return DOMPurify.sanitize(String(html || ''), {
    ADD_ATTR: ['referrerpolicy', 'target', 'loading', 'decoding'],
  });
}
