import MdText from './MdText.jsx';
import { looksLikeHtml } from './md-inline.js';
import { safeHtml } from '../../sanitize';

// 正文/摘要来源有两种，却长期共用一条渲染链路：
//   ① 采集到的原文 = HTML（必须过 safeHtml 白名单）
//   ② AI 摘要 / 无正文时的回退 = 带内联标记的纯文本（**加粗** ==重点== `代码`）
// 历史上三处回退一律塞进 safeHtml，纯文本被转义后原样显示 → 标记变成裸星号，
// 用户看到的正是批注 B8「综述/详情无排版，加粗与重点标注丢失」。
// 这里按"像不像 HTML"分流，两条分支都保留调用方给的 className 与 ref（正文滚动/锚点要它）。
const HTML_RE = looksLikeHtml;

export default function RichText({ text, className = '', innerRef }) {
  const v = String(text == null ? '' : text);
  if (HTML_RE(v)) {
    return <div ref={innerRef} className={className} dangerouslySetInnerHTML={{ __html: safeHtml(v) }} />;
  }
  return (
    <div ref={innerRef} className={`whitespace-pre-line ${className}`}>
      <MdText text={v} />
    </div>
  );
}
