import { useEffect, useState } from 'react';
import { api, qs } from '../api';
import { toast } from '../toast';
import { formatDateTime, formatHeat, relativeTime } from '../util';
import { FlameIcon } from './icons.jsx';

// 跨域事件热点榜（九期 M4）：GET /api/hot/events?domain= 列表 + GET /api/hot/events/:rank 详情
// 2026-09-14 对齐样图精修：事件卡 = 大排名号 + 状态标/标题 + 报道摘要（2 行）+ 信源胶囊（分组·名称）
// + 右侧大热度值与真·趋势折线（24 桶报道密度，暂无可比趋势时空态）；详情含信源清单 + 报道时间线

// 状态标配色：新=绿 / 爆=红 / 发酵中=黄 / 收尾=灰 / 精选=主题色
const STATUS_STYLE = {
  新: 'var(--green)',
  爆: 'var(--red)',
  发酵中: '#b8860b',
  收尾: 'var(--muted)',
  精选: 'var(--accent)',
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

// 趋势折线（样图：∿—○ 形态）：24 桶计数 → SVG polyline + 末端圆点 + 淡色面积
function Sparkline({ data, w = 76, h = 26 }) {
  if (!Array.isArray(data) || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const stepX = w / (data.length - 1);
  const pts = data.map((v, i) => [
    Number((i * stepX).toFixed(1)),
    Number((h - 3 - (v / max) * (h - 7)).toFixed(1)),
  ]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="block">
      <path d={area} fill="var(--accent)" opacity="0.10" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.2" fill="var(--accent)" stroke="var(--bg)" strokeWidth="1" />
    </svg>
  );
}

// 信源胶囊行：「分组·名称」最多 3 个 + 「+N 源」（完整名单在详情）
function SourceChips({ list, sourceCount }) {
  const sources = Array.isArray(list) ? list : [];
  if (!sources.length) return null;
  const show = sources.slice(0, 3);
  const rest = (sourceCount || sources.length) - show.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {show.map((s, i) => (
        <span
          key={`${s.group}-${s.name}-${i}`}
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] leading-4 t-muted"
          style={{ background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}
          title={`${s.group} · ${s.name}`}
        >
          <span className="t-accent">{s.group}</span>
          <span className="mx-0.5 opacity-60">·</span>
          <span className="max-w-[120px] truncate">{s.name}</span>
        </span>
      ))}
      {rest > 0 && <span className="text-[10.5px] t-muted tabular-nums">+{rest} 源</span>}
    </span>
  );
}

// 事件详情视图：统计行 + 信源清单 + 报道时间线
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
          <span className="serif text-[15px] font-bold tabular-nums t-accent">#{pad2(ev.rank)}</span>
          <span>{ev.domain}</span>
          <StatusBadge status={ev.status} />
          <span className="flex-1" />
          <span className="t-accent font-bold tabular-nums text-[13px] inline-flex items-center gap-1">
            <FlameIcon size={14} /> {ev.heatFormatted || formatHeat(ev.heat)}
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
        {/* 信源清单：分组·名称 全量 */}
        {Array.isArray(ev.sourceList) && ev.sourceList.length > 0 && (
          <div className="mt-3 pt-3 border-t border-dashed t-border">
            <SourceChipsFull list={ev.sourceList} />
          </div>
        )}
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
                <span className="uppercase tracking-wide truncate">
                  {it.source_group ? `${it.source_group} · ` : ''}{it.source_name || '未知信源'}
                </span>
                {it.score > 0 && <span className="t-accent">· {formatHeat(it.score)}</span>}
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

// 详情页信源全量清单（不换行截断，全量展示）
function SourceChipsFull({ list }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((s, i) => (
        <span
          key={`${s.group}-${s.name}-${i}`}
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] leading-4 t-muted"
          style={{ background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}
        >
          <span className="t-accent">{s.group}</span>
          <span className="mx-0.5 opacity-60">·</span>
          <span>{s.name}</span>
        </span>
      ))}
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

      {/* 事件列表（2026-09-14 对齐样图：左排名号 / 中标题+摘要+信源 / 右大热度+趋势折线） */}
      <div className="mt-4 space-y-3">
        {events.map((ev) => (
          <button
            key={ev.rank}
            className="card card-lift w-full text-left p-4 flex items-start gap-4"
            onClick={() => openDetail(ev)}
          >
            <span className="serif flex-none w-8 pt-0.5 text-center text-[17px] font-bold tabular-nums t-accent">
              {pad2(ev.rank)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <StatusBadge status={ev.status} />
                <span className="text-[14.5px] font-bold leading-snug t-text">{ev.title}</span>
              </div>
              {/* 报道摘要（样图：标题下摘要 2 行截断，行首「报道摘要」小标） */}
              {ev.items?.[0]?.summary && (
                <p className="mt-1.5 text-[12px] leading-relaxed t-muted line-clamp-2">
                  <span className="t-accent font-medium">报道摘要　</span>
                  {ev.items[0].summary}
                </p>
              )}
              {/* 信源胶囊（分组·名称）+ 元信息行 */}
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] t-muted tabular-nums">
                <SourceChips list={ev.sourceList} sourceCount={ev.sourceCount} />
                <span className="flex-none">· {ev.reportCount} 篇报道</span>
                <span className="flex-none">· {relativeTime(ev.latestAt)}更新</span>
                <span className="flex-none">· {ev.domain}</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5 flex-none pt-0.5">
              <span className="inline-flex items-baseline gap-1" title={ev.heatFormatted || `热度 ${ev.heat}`}>
                <span className="stat-num !text-[20px] t-accent">{formatHeat(ev.heat)}</span>
                <span className="text-[10px] t-muted">热度</span>
              </span>
              {Array.isArray(ev.trend) && ev.trend.length >= 2 ? (
                <Sparkline data={ev.trend} />
              ) : (
                <span className="text-[10px] t-muted whitespace-nowrap">暂无可比趋势</span>
              )}
            </div>
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
