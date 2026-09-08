// 新文章提示条（微信风格）
// 设计原则：被动接收 + 主动提醒
// - SSE 静默累积计数，不打断用户浏览/阅读
// - 仅在列表顶部区域显示轻量提示条（角标 + 文案）
// - 用户点击后平滑刷新列表并滚动到顶部
// - 无新文章时完全隐藏，零视觉干扰

import { useEffect, useRef, useState } from 'react';

export default function NewArticlesBanner({ newCount, lastEvent, onRefresh }) {
  const [visible, setVisible] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (newCount > 0 && lastEvent?.type === 'new_articles') {
      const source = lastEvent.sourceName || '';
      const title = lastEvent.latestTitle || '';
      // 单篇显示标题预览，多篇显示计数
      if (newCount === 1 && title) {
        const truncated = title.length > 28 ? title.slice(0, 28) + '…' : title;
        setDisplayName(`${source ? source + ' · ' : ''}${truncated}`);
      } else {
        setDisplayName(`${source || '订阅源'}更新了 ${newCount} 篇`);
      }
      // 从 0 → 有值时触发滑入动画
      if (prevCountRef.current === 0) {
        setVisible(true);
      }
      prevCountRef.current = newCount;
    } else if (newCount === 0) {
      prevCountRef.current = 0;
    }
  }, [newCount, lastEvent]);

  const handleClick = () => {
    setVisible(false);
    // 下一帧执行刷新，让关闭动画先播放
    requestAnimationFrame(() => {
      onRefresh?.();
    });
  };

  if (!visible || newCount === 0) return null;

  return (
    <button
      className="w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg cursor-pointer transition-all duration-300 ease-out"
      style={{
        background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
        border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
        color: 'var(--accent)',
        animation: 'slideDown 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      onClick={handleClick}
      title="点击刷新列表并滚动到顶部"
    >
      {/* 微信风格角标 */}
      <span
        className="flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold flex-none"
        style={{ background: 'var(--accent)', color: 'var(--bg)' }}
      >
        {newCount > 99 ? '99+' : newCount}
      </span>
      {/* 文案 */}
      <span className="flex-1 text-left truncate leading-tight">{displayName}</span>
      {/* 操作提示 */}
      <span className="flex-none text-[10px] opacity-50">刷新</span>
    </button>
  );
}
