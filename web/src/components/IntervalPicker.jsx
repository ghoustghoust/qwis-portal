import { useEffect, useRef, useState } from 'react';

// 抓取频率预设选择器（10-05 用户点单④）：行内 ⏱ 与组卡 ⋯ 共用——
// 弹窗输数字换成预设按钮（30 分钟 / 1 小时 / 6 小时 / 跟随默认），常用操作不用输数字。
export default function IntervalPicker({ open, title, currentMin, onClose, onPick }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  const PRESETS = [
    { min: null, label: '跟随默认', note: '按全局频率（当前 30 分钟）' },
    { min: 30, label: '每 30 分钟', note: '活跃源' },
    { min: 60, label: '每 1 小时', note: '常规' },
    { min: 360, label: '每 6 小时', note: '低频源 / 省配额' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.35)' }} onClick={onClose}>
      <div className="card p-4 w-full max-w-xs shadow-xl" ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-semibold t-text mb-1">{title || '抓取频率'}</div>
        <div className="text-[11px] t-muted mb-3">选预设，或点「自定义」输分钟数。当前：{currentMin ? `每 ${currentMin} 分钟` : '跟随默认'}</div>
        <div className="space-y-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className={`w-full text-left px-3 py-2.5 rounded-lg border t-border text-[13px] flex items-center gap-2 hover:t-surface2 ${String(currentMin ?? '') === String(p.min ?? '') ? 't-accent-soft border-[var(--accent)]' : ''}`}
              onClick={() => onPick(p.min)}
            >
              <span className="flex-1 t-text">{p.label}</span>
              <span className="text-[11px] t-muted">{p.note}</span>
            </button>
          ))}
          <button
            className="w-full text-left px-3 py-2.5 rounded-lg border t-border text-[13px] hover:t-surface2 t-text"
            onClick={() => {
              const v = window.prompt('自定义频率（分钟）：', currentMin || '');
              if (v === null) return;
              const n = Number(v.trim());
              if (!Number.isFinite(n) || n <= 0) return;
              onPick(n);
            }}
          >自定义分钟数…</button>
        </div>
      </div>
    </div>
  );
}
