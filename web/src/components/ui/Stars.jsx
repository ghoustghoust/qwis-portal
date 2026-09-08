import React from 'react';

// AI 评分星级（2026-09-05 视觉精修）：score 0-100 → 5 星（每 20 分一星，四舍五入到半星粒度简化为整数星）
// 无 score 不渲染；showNum 控制是否带分数文本
export default function Stars({ score, size = 12, showNum = true, className = '' }) {
  const v = Number(score);
  if (Number.isNaN(v) || v <= 0) return null;
  const full = Math.max(0, Math.min(5, Math.round(v / 20)));
  return (
    <span className={`stars ${className}`} title={`AI 评分 ${v}/100`}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg
          key={i}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          className={i < full ? '' : 'star-off'}
          fill={i < full ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" />
        </svg>
      ))}
      {showNum && <span className="stars-num">{v}</span>}
    </span>
  );
}
