import { useState } from 'react';
import { formatDateTime } from '../util.js';
import { FlameIcon, ChevronDownIcon } from '../icons.jsx';

// 热点榜 Tab：事件排名列表，点击展开报道时间线（手风琴，移动端友好）

// 状态标配色：新=绿 / 爆=红 / 发酵中=黄 / 收尾=灰
const STATUS_COLOR = {
  新: 'var(--green)',
  爆: 'var(--red)',
  发酵中: 'var(--amber)',
  收尾: 'var(--muted)',
};

function StatusBadge({ status }) {
  const c = STATUS_COLOR[status] || STATUS_COLOR['收尾'];
  return (
    <span className="badge" style={{ color: c }}>
      {status}
    </span>
  );
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function EventCard({ ev, rank, open, onToggle }) {
  const items = [...(ev.items || [])].sort(
    (a, b) => (b.published_at || '').localeCompare(a.published_at || '')
  );
  return (
    <div className="card overflow-hidden">
      <button className="w-full text-left px-4 py-3 flex items-center gap-3" onClick={onToggle}>
        <span className="flex-none w-7 text-right text-[15px] font-bold tabular-nums t-accent">
          {pad2(rank)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <StatusBadge status={ev.status} />
            <span className="text-[14px] font-medium leading-snug t-text">{ev.title}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] t-muted tabular-nums">
            <span>
              {ev.sourceCount} 源 · {ev.reportCount} 篇
            </span>
            <span>· {ev.domain}</span>
            <span>· {formatDateTime(ev.latestAt)}</span>
          </div>
        </div>
        <span className="flex-none text-[13px] font-bold tabular-nums t-accent inline-flex items-center gap-1">
          <FlameIcon size={14} /> {ev.heat}
        </span>
        <ChevronDownIcon
          size={14}
          className="flex-none t-muted transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t t-border">
          <div className="mt-2 text-[11px] t-muted tabular-nums">
            首发 {formatDateTime(ev.firstAt)} · 最新 {formatDateTime(ev.latestAt)}
          </div>
          <div className="mt-2 text-[12px] font-semibold t-accent">报道时间线 · {items.length} 篇</div>
          <div className="relative mt-2 pl-4">
            <span
              className="absolute left-[3px] top-2 bottom-2 w-px"
              style={{ background: 'var(--border)' }}
            />
            {items.map((it, i) => (
              <div key={it.id ?? i} className="relative pb-3.5 last:pb-1">
                <span
                  className="absolute -left-4 top-[7px] w-[7px] h-[7px] rounded-full"
                  style={{ background: 'var(--accent)', boxShadow: '0 0 0 2px var(--surface)' }}
                />
                <div className="flex items-center gap-2 text-[11px] t-muted tabular-nums">
                  <span>{formatDateTime(it.published_at)}</span>
                  <span className="truncate">{it.source_name || '未知信源'}</span>
                </div>
                <a
                  className="mt-0.5 block text-[13.5px] font-medium leading-snug t-text"
                  href={it.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {it.title}
                </a>
              </div>
            ))}
            {items.length === 0 && (
              <div className="py-6 text-center text-xs t-muted">暂无报道明细</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function EventsTab({ events }) {
  const [openIdx, setOpenIdx] = useState(null); // 手风琴：同时只展开一个
  const list = Array.isArray(events) ? events : [];
  return (
    <div className="px-4 pt-4 space-y-2.5">
      {list.map((ev, i) => (
        <EventCard
          key={i}
          ev={ev}
          rank={i + 1}
          open={openIdx === i}
          onToggle={() => setOpenIdx(openIdx === i ? null : i)}
        />
      ))}
      {list.length === 0 && (
        <div className="card px-4 py-16 text-center text-[13px] t-muted">近 3 天暂无跨源事件</div>
      )}
    </div>
  );
}
