import { useEffect, useRef, useState } from 'react';
import { CalendarIcon } from './icons.jsx';

// 日期范围筛选（T11/F4）：日历图标按钮 + 浮层（快捷段 + 自定义起止 + 应用/清除）
// props: value={from,to}（YYYY-MM-DD 或 null）、onChange({from,to})
const QUICK = [
  { key: 'today', label: '今天', days: 0 },
  { key: 'd3', label: '近3天', days: 2 },
  { key: 'd7', label: '近7天', days: 6 },
  { key: 'd30', label: '近30天', days: 29 },
  { key: 'all', label: '全部', days: null },
];

function toYmd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function DateFilter({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from: value?.from || '', to: value?.to || '' });
  const boxRef = useRef(null);

  const active = !!(value?.from || value?.to);

  // 打开浮层时同步草稿；点击外部关闭
  useEffect(() => {
    if (!open) return;
    setDraft({ from: value?.from || '', to: value?.to || '' });
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, value]);

  const applyQuick = (days) => {
    if (days === null) {
      onChange({ from: null, to: null });
      setOpen(false);
      return;
    }
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    onChange({ from: toYmd(from), to: toYmd(to) });
    setOpen(false);
  };

  const applyDraft = () => {
    let { from, to } = draft;
    if (from && to && from > to) [from, to] = [to, from];
    onChange({ from: from || null, to: to || null });
    setOpen(false);
  };

  const clear = () => {
    onChange({ from: null, to: null });
    setOpen(false);
  };

  const fmt = (ymd) => {
    const [, m, d] = (ymd || '').split('-');
    return `${Number(m)}/${Number(d)}`;
  };
  const rangeText = active ? `${fmt(value.from)}~${fmt(value.to)}` : '';

  return (
    <div ref={boxRef} className="relative flex-none">
      <button
        className={`text-[11px] px-1.5 py-0.5 rounded border t-border inline-flex items-center gap-1 ${
          active ? 't-accent-soft t-accent font-medium' : 't-muted hover:t-text'
        }`}
        title="按日期范围筛选"
        onClick={() => setOpen((v) => !v)}
      >
        <CalendarIcon size={12} />
        {rangeText}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 card p-3 w-[248px] shadow-lg">
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((qk) => (
              <button
                key={qk.key}
                className="btn-ghost !px-2.5 !py-1 !text-[11px]"
                onClick={() => applyQuick(qk.days)}
              >
                {qk.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="date"
              className="input !px-1.5 !py-1 !text-[11px] min-w-0"
              value={draft.from}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            />
            <span className="t-muted text-xs flex-none">~</span>
            <input
              type="date"
              className="input !px-1.5 !py-1 !text-[11px] min-w-0"
              value={draft.to}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            />
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button className="btn-ghost !px-2.5 !py-1 !text-[11px]" onClick={clear}>
              清除
            </button>
            <button
              className="btn-primary !px-2.5 !py-1 !text-[11px]"
              disabled={!draft.from && !draft.to}
              onClick={applyDraft}
            >
              应用
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
