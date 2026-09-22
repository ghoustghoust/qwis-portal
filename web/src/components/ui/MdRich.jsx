import React from 'react';
import { mdBlocks } from './md-inline.js';
import MdText from './MdText.jsx';

// B8 块级排版（2026-09-22）：### 标题 / - 无序表 / 1. 有序表 / 空行分段。
// 安全模型与 MdText 相同：输出纯 React 元素树，不碰 dangerouslySetInnerHTML；
// 块内文本仍走 MdText 的同一份内联解析（**加粗**等），白名单元素只有 h3/h4/ul/ol/li/p + 内联五种。
export default function MdRich({ text, className }) {
  return (
    <div className={className}>
      {mdBlocks(text).map((b, i) => {
        if (b.t === 'h') {
          const Tag = b.level <= 2 ? 'h3' : 'h4';
          return <Tag key={i} className="md-h"><MdText text={b.v} /></Tag>;
        }
        if (b.t === 'ul') return <ul key={i} className="md-ul">{b.items.map((it, j) => <li key={j}><MdText text={it} /></li>)}</ul>;
        if (b.t === 'ol') return <ol key={i} className="md-ol">{b.items.map((it, j) => <li key={j}><MdText text={it} /></li>)}</ol>;
        return <p key={i} className="md-p"><MdText text={b.v} /></p>;
      })}
    </div>
  );
}
