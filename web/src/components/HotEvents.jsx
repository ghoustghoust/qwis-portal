import { useEffect, useState } from 'react';
import { api, qs } from '../api';
import { toast } from '../toast';
import { formatDateTime } from '../util';
import { FlameIcon } from './icons.jsx';

// 跨域事件热点榜（九期 M4）：GET /api/hot/events?domain= 列表 + GET /api/hot/events/:rank 详情
// 领域筛选按钮组；事件行 = 排名 + 标题 + 状态标 + 信源数 + 热度 + 领域
// 点击行 → 详情视图：大标题 + 统计行 + 报道时间线（点击标题新窗口打开 url）

// 状态标配色：新=绿 / 爆=红 / 发酵中=黄 / 收尾=灰
const STATUS_STYLE = {
  新: 'var(--green)',
  爆: 'var(--red)',
  发酵中: '#b8860b',
  收尾: 'var(--muted)',
};

function StatusBadge({ status }) {
  const c = STATUS_STYLE[status] || STATUS_STYLE['收尾'];
  return (
    <span className="badge-green flex-none" style={{ color: c, borderColor: c }}>
      {status}
    </span>
  );
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 事件详情视图：统计行 + 报道时间线
function EventDetail({ ev, onBack }) {
  const items = [...(ev.items || [])].sort(
    (a, b) => (b.published_at || '').localeCompare(a.published_at || '')
  );
  return (
    <div>
      <button className="btn-ghost !px-2.5" onClick={onBack}>
        ← 返回榜单
      </button>
      <div className="card mt-4 p-5">
        <div className="flex items-center gap-2 text-[11px] t-muted">
          <span className="tabular-nums">#{pad2(ev.rank)}</span>
          <span>{ev.domain}</span>
          <StatusBadge status={ev.status} />
          <span className="flex-1" />
          <span className="t-accent font-bold tabular-nums text-[13px] inline-flex items-center gap-1">
            <FlameIcon size={14} /> {ev.heat}
          </span>
        </div>
        <h2 className="mt-2 text-lg font-bold leading-snug t-text">{ev.title}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs t-muted tabular-nums">
          <span>
            {ev.sourceCount} 源 · {ev.reportCount} 篇
          </span>
          <span>· 首发 {formatDateTime(ev.firstAt)}</span>
          <span>· 最新 {formatDateTime(ev.latestAt)}</span>
        </div>
      </div>

      {/* 报道时间线（时间倒序） */}
      <div className="mt-5">
        <div className="text-[12px] font-semibold t-accent mb-2">报道时间线 · {items.length} 篇</div>
        <div className="relative pl-4">
          <span
            className="absolute left-[3px] top-2 bottom-2 w-px"
            style={{ background: 'var(--border)' }}
          />
          {items.map((it) => (
            <div key={it.id} className="relative pb-4 last:pb-1">
              <span
                className="absolute -left-4 top-[7px] w-[7px] h-[7px] rounded-full"
                style={{ background: 'var(--accent)', boxShadow: '0 0 0 2px var(--bg)' }}
              />
              <div className="flex items-center gap-2 text-[11px] t-muted tabular-nums">
                <span>{formatDateTime(it.published_at)}</span>
                <span className="uppercase tracking-wide truncate">{it.source_name || '未知信源'}</span>
                {it.score != null && <span className="t-accent">· {it.score}</span>}
              </div>
              <a
                className="mt-0.5 block text-[14px] font-medium leading-snug t-text hover:underline"
                href={it.url}
                target="_blank"
                rel="noopener noreferrer"
                title="新窗口打开原文"
              >
                {it.title} ↗
              </a>
              {it.summary && (
                <p className="mt-1 text-[12.5px] leading-relaxed t-muted line-clamp-2">{it.summary}</p>
              )}
            </div>
          ))}
          {items.length === 0 && (
            <div className="py-8 text-center text-xs t-muted">暂无报道明细</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function HotEvents() {
  const [domain, setDomain] = useState('all');
  const [domains, setDomains] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [detail, setDetail] = useState(null); // 展开的事件详情

  // 切领域重新请求
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    api
      .get('/api/hot/events' + qs({ domain }))
      .then((d) => {
        if (cancelled) return;
        setEvents(Array.isArray(d?.events) ? d.events : []);
        if (Array.isArray(d?.domains)) setDomains(d.domains);
        setFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setEvents([]);
        setFailed(true);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [domain]);

  const openDetail = async (ev) => {
    try {
      const d = await api.get(`/api/hot/events/${ev.rank}` + qs({ domain }));
      if (!d?.event) throw new Error('事件不存在');
      setDetail(d.event);
    } catch (e) {
      toast(e.message || '事件详情加载失败');
    }
  };

  // 详情视图
  if (detail) return <EventDetail ev={detail} onBack={() => setDetail(null)} />;

  return (
    <div>
      {/* 领域筛选行（2026-09-05 视觉精修：统一 .pill/.pill.on） */}
      <div className="flex flex-wrap gap-1.5">
        {['all', ...domains].map((dm) => (
          <button
            key={dm}
            onClick={() => setDomain(dm)}
            className={`pill cursor-pointer ${domain === dm ? 'on' : ''}`}
          >
            {dm === 'all' ? '全部' : dm}
          </button>
        ))}
      </div>

      {/* 事件列表（2026-09-05 视觉精修：统一 card card-lift 语言，热度数字用 stat-num 缩小版） */}
      <div className="mt-4 space-y-2.5">
        {events.map((ev) => (
          <button
            key={ev.rank}
            className="card card-lift w-full text-left px-4 py-3 flex items-center gap-3"
            onClick={() => openDetail(ev)}
          >
            <span className="flex-none w-7 text-right text-[15px] font-bold tabular-nums t-accent">
              {pad2(ev.rank)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <StatusBadge status={ev.status} />
                <span className="text-[14px] font-medium leading-snug t-text truncate">
                  {ev.title}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] t-muted tabular-nums">
                <span>
                  {ev.sourceCount} 源 · {ev.reportCount} 篇
                </span>
                <span>· {ev.domain}</span>
                <span>· {formatDateTime(ev.latestAt)}</span>
              </div>
            </div>
            <span
              className="stat-num flex-none !text-[15px] t-accent inline-flex items-center gap-1"
              title="热度值"
            >
              <FlameIcon size={14} /> {ev.heat}
            </span>
          </button>
        ))}
      </div>

      {loading && <div className="py-6 text-center text-xs t-muted">加载中…</div>}
      {!loading && events.length === 0 && (
        <div className="card px-4 py-16 text-center text-[13px] t-muted">
          {failed ? '热点榜服务尚未就绪，请稍后再试' : '近 3 天暂无跨源事件'}
        </div>
      )}
    </div>
  );
}
