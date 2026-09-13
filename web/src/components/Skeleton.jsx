import React from 'react';

// T3-3 R4 骨架屏（2026-09-14）：替代"加载中…"文字，感知性能优化
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 animate-pulse" aria-hidden>
      <span className="w-6 h-6 rounded-full flex-none t-surface2" />
      <span className="flex-1 space-y-1.5">
        <span className="block h-3 rounded t-surface2" style={{ width: '70%' }} />
        <span className="block h-2.5 rounded t-surface2" style={{ width: '45%' }} />
      </span>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="card p-3 animate-pulse" aria-hidden>
      <div className="flex gap-3">
        <span className="flex-1 space-y-2">
          <span className="block h-3 rounded t-surface2" style={{ width: '85%' }} />
          <span className="block h-3 rounded t-surface2" style={{ width: '60%' }} />
          <span className="block h-2.5 rounded t-surface2" style={{ width: '40%' }} />
        </span>
        <span className="w-[76px] h-[57px] rounded t-surface2 flex-none" />
      </div>
    </div>
  );
}

// 行列表骨架（n 行）
export function SkeletonList({ n = 6 }) {
  return (
    <div role="status" aria-label="加载中">
      {Array.from({ length: n }, (_, i) => <SkeletonRow key={i} />)}
    </div>
  );
}

// 卡片骨架（n 张，grid-cols 由外层控制时用）
export function SkeletonCards({ n = 6 }) {
  return (
    <div role="status" aria-label="加载中" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: n }, (_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}
