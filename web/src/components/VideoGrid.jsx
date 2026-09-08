import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, qs } from '../api';
import { formatDuration, relativeTime, imgUrl } from '../util';
import DateFilter from './DateFilter.jsx';
import SourceAvatar from './ui/SourceAvatar.jsx'; // 2026-09-05 视觉精修：UP 主头像统一走共享组件

// 视频网格（F8）：多列卡片，封面+时长角标、两行标题、UP主头像+名称+N天前
// N5/T47：游标分页（每页 30）+ 手写窗口化渲染（虚拟滚动）——1000+ 条时 DOM 节点数恒定，滚动不卡顿
// 方案：按容器宽度估算列数与行高，只渲染可视窗口 ±overscan 的行，上下用撑高占位，不引第三方依赖

// 2026-09-05 视觉精修：网格间距统一 gap-3 p-3（常量与类名需同步）
const GAP = 12;        // gap-3
const PAD = 12;        // p-3
const MIN_COL_W = 220; // gridTemplateColumns: repeat(auto-fill, minmax(220px, 1fr))
const OVERSCAN = 3;    // 上下各多渲染 3 行

function useGridMetrics(boxRef) {
  const [metrics, setMetrics] = useState({ cols: 1, rowH: 320 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => {
      const contentW = Math.max(0, el.clientWidth - PAD * 2);
      const cols = Math.max(1, Math.floor((contentW + GAP) / (MIN_COL_W + GAP)));
      const colW = (contentW - (cols - 1) * GAP) / cols;
      // 行高 = 封面(16:9) + 卡内边距(p-2.5) + 标题区(两行 13px) + 元信息行 + 行间距
      const rowH = Math.ceil(colW * 9 / 16) + 20 + 36 + 6 + 18 + GAP;
      setMetrics((m) => (m.cols === cols && m.rowH === rowH ? m : { cols, rowH }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [boxRef]);
  return metrics;
}

export default function VideoGrid({ filter, onDateChange, onSelect, onMeta, reloadKey }) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const boxRef = useRef(null);
  const loadingRef = useRef(false);
  const { cols, rowH } = useGridMetrics(boxRef);
  const [win, setWin] = useState({ start: 0, end: 30 });

  const fetchPage = useCallback(
    async (cur, replace) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const data = await api.get(
          `/api/videos${qs({
            tab: filter.tab,
            source_id: filter.sourceId,
            group_id: filter.groupId,
            from: filter.from || undefined,
            to: filter.to || undefined,
            cursor: cur || undefined,
          })}`
        );
        const list = data?.items || data?.videos || (Array.isArray(data) ? data : []);
        const next = data?.next_cursor ?? data?.nextCursor ?? null;
        setItems((prev) => (replace ? list : [...prev, ...list]));
        setCursor(next);
        setDone(!next);
        onMeta?.(data);
      } catch (e) {
        if (replace) setItems([]);
        setDone(true);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [filter, onMeta]
  );

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setDone(false);
    if (boxRef.current) boxRef.current.scrollTop = 0;
    fetchPage(null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.tab, filter.sourceId, filter.groupId, filter.from, filter.to, reloadKey]);

  // 可视窗口计算：滚动/尺寸/数据变化时重算
  const updateWindow = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const startRow = Math.max(0, Math.floor(el.scrollTop / rowH) - OVERSCAN);
    const endRow = Math.ceil((el.scrollTop + el.clientHeight) / rowH) + OVERSCAN;
    const start = startRow * cols;
    const end = endRow * cols;
    setWin((w) => (w.start === start && w.end === end ? w : { start, end }));
  }, [rowH, cols]);

  useEffect(() => {
    updateWindow();
  }, [updateWindow, items.length]);

  const onScroll = () => {
    updateWindow();
    const el = boxRef.current;
    if (!el || done || loadingRef.current) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 160) {
      fetchPage(cursor, false);
    }
  };

  const titleOf = () =>
    ({ all: '全部视频', favorite: '收藏', history: '历史存档' }[filter.tab] || '视频');

  // 窗口化切片 + 上下占位行
  const totalRows = Math.ceil(items.length / cols);
  const startRow = Math.floor(win.start / cols);
  const endRow = Math.min(totalRows, Math.ceil(win.end / cols));
  const slice = items.slice(startRow * cols, endRow * cols);
  const topPad = startRow * rowH;
  const bottomPad = Math.max(0, (totalRows - endRow) * rowH);

  return (
    <section className="flex-1 flex flex-col h-full min-w-0 t-bg">
      <div className="px-5 h-12 flex items-center gap-2 flex-none border-b t-border t-surface">
        <h2 className="text-sm font-semibold t-text">{titleOf()}</h2>
        <span className="text-xs t-muted tabular-nums">{items.length || ''}</span>
        <div className="flex-1" />
        <DateFilter value={{ from: filter.from, to: filter.to }} onChange={onDateChange} />
      </div>
      <div ref={boxRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-3">
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
        >
          {topPad > 0 && <div style={{ gridColumn: '1 / -1', height: topPad }} aria-hidden="true" />}
          {slice.map((v) => (
            // 2026-09-05 视觉精修：视频卡统一 card card-lift，封面圆角由卡片 overflow-hidden 收敛（12px）
            <div key={v.id} className="cursor-pointer group card card-lift overflow-hidden" onClick={() => onSelect(v.id)}>
              <div className="relative t-surface2">
                {v.cover ? (
                  <img referrerPolicy="no-referrer"
                    src={imgUrl(v.cover)}
                    alt=""
                    loading="lazy"
                    className="w-full aspect-video object-cover group-hover:scale-[1.02] transition-transform"
                  />
                ) : (
                  <div className="w-full aspect-video flex items-center justify-center t-muted text-2xl">
                    ▶
                  </div>
                )}
                {formatDuration(v.duration) && (
                  <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[11px] leading-none text-white bg-black/70 tabular-nums">
                    {formatDuration(v.duration)}
                  </span>
                )}
              </div>
              <div className="p-2.5">
                <div className="text-[13px] leading-snug line-clamp-2 t-text group-hover:t-accent">
                  {v.title}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5 text-xs t-muted">
                  <SourceAvatar name={v.author || v.source_name} avatar={v.avatar || v.source_avatar} size={16} />
                  <span className="truncate">{v.author || v.source_name || ''}</span>
                  <span className="flex-none">· {relativeTime(v.published_at)}</span>
                  {filter.tab !== 'favorite' && v.favorite ? (
                    <span className="flex-none" style={{ color: 'var(--purple)' }} title="已收藏">
                      ★
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
          {bottomPad > 0 && <div style={{ gridColumn: '1 / -1', height: bottomPad }} aria-hidden="true" />}
        </div>
        {loading && <div className="py-6 text-center text-xs t-muted">加载中…</div>}
        {!loading && items.length === 0 && (
          <div className="py-16 text-center text-xs t-muted">
            {filter.tab === 'favorite' ? '暂无收藏视频' : filter.tab === 'history' ? '暂无历史存档' : '暂无视频，去管理后台（/admin/）添加 UP 主'}
          </div>
        )}
        {!done && !loading && items.length > 0 && (
          <div className="text-center">
            <button className="btn-ghost mt-5" onClick={() => fetchPage(cursor, false)}>
              加载更多
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
