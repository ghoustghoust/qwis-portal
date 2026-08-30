import { useEffect, useState } from 'react';
import { formatDateTime } from '../util.js';
import { FlameIcon, ChevronDownIcon } from '../icons.jsx';
import { getEvents } from '../api.js';

// 热点榜 Tab：桌面端（≥1024px）左侧榜单 + 右侧详情面板（报道时间线）；
// 移动端手风琴展开。状态标：新=绿 / 爆=红 / 发酵中=黄 / 收尾=灰

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

// 报道时间线（桌面详情面板与移动端展开共用）
function Timeline({ ev }) {
  const items = [...(ev.items || [])].sort(
    (a, b) => (b.published_at || '').localeCompare(a.published_at || '')
  );
  return (
    <div>
      <div className="text-[11px] t-muted tabular-nums">
        首发 {formatDateTime(ev.firstAt)} · 最新 {formatDateTime(ev.latestAt)}
      </div>
      <div className="mt-2 text-[12px] font-semibold t-accent">报道时间线 · {items.length} 篇</div>
      <div className="relative mt-2 pl-4">
        <span className="absolute left-[3px] top-2 bottom-2 w-px" style={{ background: 'var(--border)' }} />
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
        {items.length === 0 && <div className="py-6 text-center text-xs t-muted">暂无报道明细</div>}
      </div>
    </div>
  );
}

// 榜单行（桌面/移动共用）
function EventRow({ ev, selected, open, onClick, desktop }) {
  return (
    <button
      className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
        selected ? 't-accent-soft' : 'hover:bg-[var(--surface-2)]'
      }`}
      onClick={onClick}
    >
      <span className="flex-none w-7 text-right text-[15px] font-bold tabular-nums t-accent">
        {pad2(ev.rank)}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <StatusBadge status={ev.status} />
          <span className="text-[14px] font-medium leading-snug t-text line-clamp-2">{ev.title}</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] t-muted tabular-nums">
          <span>
            {ev.sourceCount} 源 · {ev.reportCount} 篇
          </span>
          <span>· {ev.domain}</span>
        </div>
      </div>
      <span className="flex-none text-[13px] font-bold tabular-nums t-accent inline-flex items-center gap-1">
        <FlameIcon size={14} /> {ev.heat}
      </span>
      {!desktop && (
        <ChevronDownIcon
          size={14}
          className="flex-none t-muted transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        />
      )}
    </button>
  );
}

export default function EventsTab() {
  const [domain, setDomain] = useState('all');
  const [domains, setDomains] = useState([]);
  const [events, setEvents] = useState(null); // null=加载中
  const [failed, setFailed] = useState(false);
  const [selIdx, setSelIdx] = useState(0); // 桌面端选中（详情面板）
  const [openIdx, setOpenIdx] = useState(null); // 移动端手风琴

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    getEvents(domain)
      .then((d) => {
        if (cancelled) return;
        setEvents(d.events || []);
        if (Array.isArray(d.domains) && d.domains.length) setDomains(d.domains);
        setSelIdx(0);
        setOpenIdx(null);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [domain]);

  if (failed) {
    return <div className="card mx-4 mt-4 px-4 py-16 text-center text-[13px] t-muted">热点榜数据加载失败</div>;
  }
  if (!events) return <div className="py-20 text-center text-[13px] t-muted">加载中…</div>;

  const selected = events[selIdx] || null;

  return (
    <div className="px-4 pt-4 max-w-[1400px] mx-auto w-full">
      {/* 领域筛选 */}
      <div className="flex flex-wrap gap-2">
        {['all', ...domains].map((dm) => (
          <button
            key={dm}
            onClick={() => setDomain(dm)}
            className={`px-3 py-1 rounded-full text-xs border transition-colors ${
              domain === dm ? 't-accent-bg border-transparent font-medium' : 't-border t-muted hover:t-text'
            }`}
            style={domain === dm ? { color: 'var(--accent-text)' } : undefined}
          >
            {dm === 'all' ? '全部' : dm}
          </button>
        ))}
      </div>

      {events.length === 0 ? (
        <div className="card mt-4 px-4 py-16 text-center text-[13px] t-muted">近 3 天暂无跨源事件</div>
      ) : (
        <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-4 lg:items-start">
          {/* 左：榜单 */}
          <div className="card divide-y divide-[var(--border)] overflow-hidden">
            {events.map((ev, i) => (
              <div key={ev.rank}>
                {/* 桌面行：点击选中；移动行：手风琴展开 */}
                <div className="hidden lg:block">
                  <EventRow ev={ev} desktop selected={selIdx === i} onClick={() => setSelIdx(i)} />
                </div>
                <div className="lg:hidden">
                  <EventRow
                    ev={ev}
                    open={openIdx === i}
                    onClick={() => setOpenIdx(openIdx === i ? null : i)}
                  />
                  {openIdx === i && (
                    <div className="px-4 pb-4 pt-2 border-t t-border">
                      <Timeline ev={ev} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 右：详情面板（仅桌面端，吸附顶部） */}
          <div className="hidden lg:block lg:sticky lg:top-16">
            {selected && (
              <div className="card p-5 max-h-[calc(100vh-6rem)] overflow-y-auto">
                <div className="flex items-center gap-2 text-[11px] t-muted">
                  <span className="tabular-nums">#{pad2(selected.rank)}</span>
                  <span>{selected.domain}</span>
                  <StatusBadge status={selected.status} />
                  <span className="flex-1" />
                  <span className="t-accent font-bold tabular-nums text-[13px] inline-flex items-center gap-1">
                    <FlameIcon size={14} /> {selected.heat}
                  </span>
                </div>
                <h2 className="mt-2 text-lg font-bold leading-snug t-text">{selected.title}</h2>
                <div className="mt-2 text-xs t-muted tabular-nums">
                  {selected.sourceCount} 源 · {selected.reportCount} 篇
                </div>
                <div className="mt-4 pt-3 border-t t-border">
                  <Timeline ev={selected} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
