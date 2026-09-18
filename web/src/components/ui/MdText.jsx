import React from 'react';
import { mdInlineParse } from './md-inline.js';

// spec 32 内容排版渲染（2026-09-15）：AI 输出的 markdown 内联标记不再被纯文本化
// 支持：**加粗** / *强调* / ==重点标记== / `行内代码` / ~~删除线~~
// 安全模型（验收②③的等价实现）：输出纯 React 元素树，不经 dangerouslySetInnerHTML——
// 不产生任何 HTML 字符串注入面；白名单等价于「只可能生成 strong/em/mark/code/del 五种元素」，
// 其余输入一律按纯文本原样渲染（<script> 等 XSS 载体原样显示为文本）。
// 解析逻辑在 md-inline.js（纯 JS，node:test 锁定）；本组件只做元素映射。
const TAG = { bold: 'strong', em: 'em', mark: 'mark', code: 'code', del: 'del' };

export default function MdText({ text, className }) {
  const segs = mdInlineParse(text);
  return (
    <span className={className}>
      {segs.map((seg, i) => {
        if (seg.t === 'text') return <React.Fragment key={i}>{seg.v}</React.Fragment>;
        const Tag = TAG[seg.t];
        return <Tag key={i} className={seg.t === 'mark' ? 'md-mark' : seg.t === 'code' ? 'md-code' : undefined}>{seg.v}</Tag>;
      })}
    </span>
  );
}
