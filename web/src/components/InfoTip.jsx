import { useState, useRef, useEffect } from 'react';

// 圆圈问号（后台总规格准入规则：每个功能块配三段式说明——是什么/怎么设置/改了会看到什么）
// 用悬浮小卡而非浏览器 title：内容较长需要排版；点击开合，点击外部关闭
export default function InfoTip({ what, how, effect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  if (!what && !how && !effect) return null;
  return (
    <span className="relative inline-flex items-center" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="功能说明"
        className="w-4 h-4 rounded-full t-border t-muted text-[10px] leading-none flex items-center justify-center flex-none"
        style={{ cursor: 'help', border: '1px solid var(--border)' }}
      >
        ?
      </button>
      {open && (
        <div
          className="absolute left-1/2 z-30 w-72 card p-3 text-xs leading-relaxed text-left shadow-lg"
          style={{ transform: 'translateX(-50%)', top: '1.5rem' }}
        >
          {what && <div className="mb-1.5"><span className="t-accent font-semibold">这是什么：</span><span className="t-text">{what}</span></div>}
          {how && <div className="mb-1.5"><span className="t-accent font-semibold">怎么设置：</span><span className="t-text">{how}</span></div>}
          {effect && <div><span className="t-accent font-semibold">改了会怎样：</span><span className="t-text">{effect}</span></div>}
        </div>
      )}
    </span>
  );
}
