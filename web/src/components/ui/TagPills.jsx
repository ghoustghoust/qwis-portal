import React from 'react';
import { parseTags } from '../../util.js';

// 标签胶囊行（2026-09-05 视觉精修）：最多 max 个，超出折叠为 +N
export default function TagPills({ tags, max = 4, className = '' }) {
  const list = parseTags(tags);
  if (list.length === 0) return null;
  const shown = list.slice(0, max);
  const rest = list.length - shown.length;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {shown.map((t) => (
        <span key={t} className="pill">{t}</span>
      ))}
      {rest > 0 && <span className="pill">+{rest}</span>}
    </div>
  );
}
