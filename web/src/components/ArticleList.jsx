import { useCallback, useEffect, useRef, useState } from 'react';
import { api, qs } from '../api';
import { relativeTime, formatDate, imgUrl } from '../util';
import DateFilter from './DateFilter.jsx';
import { MergeIcon, ChevronDownIcon } from './icons.jsx';

const DEDUP_KEY = 'qwis.dedup'; // 「合并同事件」开关记忆（缺省 '1' 开启）

function readDedup() {
  try {
    return localStorage.getItem(DEDUP_KEY) !== '0';
  } catch {
    return true;
  }
}

// 文章列表栏（F4）：来源/标题/两行摘要/方形缩略图/相对时间/未读蓝点/选中高亮，游标分页（N5）
// T12/F4（六期）：头部挂 DateFilter（from/to），请求带日期范围，头部第二行显示 span 跨度
// 九期：「合并同事件」开关（dedup=1，簇序号游标）；relatedCount>0 显示「N 源」徽章，点击展开其他信源
export default function ArticleList({ filter, q, onSearch, onDateChange, selectedId, onSelect, onMeta, onItems, reloadKey }) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [sort, setSort] = useState('new'); // new=最新在前 / old=最早在前
  const [span, setSpan] = useState(null); // 后端返回的 {min,max} 发布时间跨度（T8）
  const [dedup, setDedup] = useState(readDedup); // 合并同事件
  const [expandedId, setExpandedId] = useState(null); // 展开了 related 的条目
  const boxRef = useRef(null);
  const loadingRef = useRef(false);

  const toggleDedup = () => {
    setDedup((v) => {
      const next = !v;
      try {
        localStorage.setItem(DEDUP_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const fetchPage = useCallback(
    async (cur, replace) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const data = await api.get(
          `/api/articles${qs({
            tab: filter.tab,
            source_id: filter.sourceId,
            group_id: filter.groupId,
            q: filter.tab === 'history' ? q : undefined,
            sort,
            from: filter.from || undefined,
            to: filter.to || undefined,
            dedup: dedup ? 1 : undefined, // dedup 模式 nextCursor 为簇序号（字符串数字）
            cursor: cur || undefined,
          })}`
        );
        const list = data?.items || data?.articles || (Array.isArray(data) ? data : []);
        const next = data?.next_cursor ?? data?.nextCursor ?? null;
        setItems((prev) => (replace ? list : [...prev, ...list]));
        setCursor(next);
        setDone(!next);
        if (data?.span) setSpan(data.span);
        onMeta?.(data);
      } catch (e) {
        if (replace) {
          setItems([]);
        }
        setDone(true);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [filter, q, sort, dedup, onMeta]
  );

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setDone(false);
    setSpan(null);
    setExpandedId(null);
    fetchPage(null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.tab, filter.sourceId, filter.groupId, filter.from, filter.to, q, sort, dedup, reloadKey]);

  // P1-2：60s 轮询静默刷新第一页（修复“必须手动刷新网页才能看到新文”）
  // 仅在页面可见、未选中文章、列表接近顶部时替换刷新，避免打断阅读/深分页状态
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden) return;
      if (selectedId) return;
      const el = boxRef.current;
      if (el && el.scrollTop > 200) return;
      fetchPage(null, true);
    }, 60000);
    return () => clearInterval(t);
  }, [fetchPage, selectedId]);

  // 滚动到底部加载下一页
  const onScroll = () => {
    const el = boxRef.current;
    if (!el || done || loadingRef.current) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
      fetchPage(cursor, false);
    }
  };

  const markLocalRead = (id) => {
    setItems((prev) => prev.map((a) => (a.id === id ? { ...a, read_at: a.read_at || new Date().toISOString() } : a)));
  };

  // 暴露给父组件：打开文章后本地置已读
  useEffect(() => {
    if (selectedId) markLocalRead(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // P3: onItems 移出 setState updater（原在 updater 内调用父回调是 React 反模式，StrictMode 下 updater 双执行 → 父副作用双触发）
  // 改为 items 提交后统一回调，语义等价、只触发一次
  useEffect(() => {
    onItems?.(items);
  }, [items, onItems]);

  const titleOf = () => {
    if (filter.sourceId) return '订阅源文章';
    if (filter.groupId) return '分组文章';
    return { all: '全部文章', later: '稍后阅读', history: '历史存档' }[filter.tab] || '文章';
  };

  return (
    <section className="w-[380px] flex-none border-r t-border flex flex-col h-full t-surface">
      <div className="px-4 pt-3 pb-2 border-b t-border">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold t-text flex-1 truncate">{titleOf()}</h2>
          <button
            className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border t-border transition-colors ${
              dedup ? 't-accent-soft t-accent font-medium' : 't-muted hover:t-text'
            }`}
            title={dedup ? '合并同事件：已开启（点击关闭）' : '合并同事件：同一事件的多信源报道合并为一条'}
            onClick={toggleDedup}
          >
            <MergeIcon width={12} height={12} /> 合并
          </button>
          <button
            className="text-[11px] t-muted hover:t-text px-1.5 py-0.5 rounded border t-border"
            title="切换排序"
            onClick={() => setSort((s) => (s === 'new' ? 'old' : 'new'))}
          >
            {sort === 'new' ? '最新 ↓' : '最早 ↑'}
          </button>
          <DateFilter value={{ from: filter.from, to: filter.to }} onChange={onDateChange} />
          <span className="text-xs t-muted tabular-nums">{items.length || ''}</span>
        </div>
        {/* T12：当前筛选下的内容时间跨度（后端 span 字段就绪后显示） */}
        {span && (span.min || span.max) && (
          <div className="mt-1 text-[11px] t-muted tabular-nums">
            {formatDate(span.min)} ~ {formatDate(span.max)} · 已加载 {items.length}
          </div>
        )}
        {/* F6：历史存档搜索框 */}
        {filter.tab === 'history' && (
          <input
            className="input mt-2"
            placeholder="搜索历史标题和内容"
            value={q}
            onChange={(e) => onSearch(e.target.value)}
          />
        )}
      </div>
      <div ref={boxRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        {items.map((a) => {
          const unread = !a.read_at && filter.tab !== 'history';
          const active = a.id === selectedId;
          return (
            <div
              key={a.id}
              onClick={() => onSelect(a.id)}
              className={`flex gap-3 px-4 py-3 cursor-pointer border-b t-border transition-colors ${
                active ? 't-accent-soft' : 'hover:bg-[var(--surface-2)]'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] t-muted">
                  {unread && (
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-none"
                      style={{ background: 'var(--blue-dot)' }}
                      title="未读"
                    />
                  )}
                  <span className="truncate">{a.source_name || a.author || ''}</span>
                  <span className="flex-none">· {relativeTime(a.published_at)}</span>
                </div>
                <div
                  className={`mt-0.5 text-[13.5px] leading-snug line-clamp-2 ${
                    unread ? 'font-semibold t-text' : 't-text'
                  }`}
                >
                  {a.title}
                  {dedup && a.relatedCount > 0 && (
                    <button
                      className="badge-green ml-1.5 align-middle"
                      style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
                      title={`同事件共 ${a.relatedCount + 1} 个信源，点击${expandedId === a.id ? '收起' : '展开'}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedId((cur) => (cur === a.id ? null : a.id));
                      }}
                    >
                      {a.relatedCount + 1} 源
                      <ChevronDownIcon
                        width={9}
                        height={9}
                        className="ml-0.5 transition-transform duration-200"
                        style={{ transform: expandedId === a.id ? 'rotate(180deg)' : 'none' }}
                      />
                    </button>
                  )}
                </div>
                {dedup && a.relatedCount > 0 && expandedId === a.id && (
                  <div
                    className="mt-1.5 border-l-2 pl-2 space-y-1"
                    style={{ borderColor: 'var(--accent)' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {(a.related || []).map((r) => (
                      <a
                        key={r.id}
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-[11px] t-muted hover:t-accent leading-snug truncate"
                        title={r.url}
                      >
                        ↗ {r.source_name || '未知信源'}
                      </a>
                    ))}
                  </div>
                )}
                {a.summary && (
                  <div className="mt-1 text-xs t-muted leading-relaxed line-clamp-2">{a.summary}</div>
                )}
              </div>
              {a.cover && (
                <img referrerPolicy="no-referrer"
                  src={imgUrl(a.cover)}
                  alt=""
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  className="w-16 h-16 rounded-lg object-cover flex-none self-center"
                />
              )}
            </div>
          );
        })}
        {loading && <div className="py-4 text-center text-xs t-muted">加载中…</div>}
        {!loading && items.length === 0 && (
          <div className="py-10 text-center text-xs t-muted">
            {filter.tab === 'history' ? '暂无历史存档' : filter.tab === 'later' ? '暂无稍后阅读' : '暂无文章'}
          </div>
        )}
        {!done && !loading && items.length > 0 && (
          <button className="w-full py-3 text-xs t-muted hover:t-accent" onClick={() => fetchPage(cursor, false)}>
            加载更多
          </button>
        )}
      </div>
    </section>
  );
}
