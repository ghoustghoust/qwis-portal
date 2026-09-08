import React from 'react';

// 统计卡（2026-09-05 视觉精修）：浅底 + 大数字 + 标签
// tone: 'surface'(默认白卡) | 'soft'(accent-soft 浅底) | 'surface2'(surface-2 浅底)
const TONE_CLASS = {
  surface: 't-surface border t-border',
  soft: 't-accent-soft',
  surface2: 't-surface2',
};

export default function StatCard({ label, value, tone = 'surface', className = '', compact = false, children }) {
  return (
    <div className={`rounded-xl ${compact ? 'p-3' : 'p-3.5'} ${TONE_CLASS[tone] || TONE_CLASS.surface} ${className}`}>
      <div className="text-[11px] t-muted">{label}</div>
      <div className={`stat-num mt-1 ${compact ? '!text-[1.35rem]' : ''}`}>{value}</div>
      {children}
    </div>
  );
}
