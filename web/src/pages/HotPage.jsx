import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconRail } from '../main.jsx';
import { api, qs } from '../api';
import { toast } from '../toast';
import HotDetail from '../components/HotDetail.jsx';
import HotEvents from '../components/HotEvents.jsx';

// 热点榜页（七期 T9/F3）：精选/全部动态统一为日期分组时间轴（对齐 AIHOT 官网结构）
// 分组头「M月D日 星期X · N 条」可折叠（默认最新日展开）；左列 HH:mm + 竖线时间轴
// 卡片富字段：信源标签/评分徽章/推荐理由（精选卡）/#标签/精选徽章/♡收藏（=articles.later）
// 接口未就绪或字段缺失时优雅降级（N3：无评分不显示徽章）

const DEFAULT_CATEGORIES = ['模型', '产品', '行业', '论文', '教程', '观点'];
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

// author 字段形如「noreply@aihot.virxact.com (The Decoder：AI News（RSS）)」，取最外层括号内上游信源名
function sourceLabel(item) {
  const a = item.author || '';
  const m = a.match(/\((.+)\)/) || a.match(/（(.+)）/);
  if (m) return m[1].trim();
  if (a && !a.includes('@')) return a;
  return item.source_name || item.feedName || a || '';
}

// 标签字段兼容：JSON 数组字符串 / 数组 / 逗号分隔
export function parseTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.filter(Boolean);
  if (typeof tags === 'string') {
    try {
      const arr = JSON.parse(tags);
      if (Array.isArray(arr)) return arr.filter(Boolean);
    } catch {
      return tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

// 本地日期分组键 + 展示文案
function dateKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dateLabel(key) {
  if (key === 'unknown') return '未知日期';
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${m}月${d}日 星期${WEEKDAYS[dt.getDay()]}`;
}
function hhmm(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 评分徽章（N3：无评分不渲染）
function ScoreBadge({ score }) {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  return (
    <span className="flex-none inline-flex items-center gap-1 text-[11px] t-accent tabular-nums" title="AIHOT 编辑部评分">
      ● AI 评分 {score}/100
    </span>
  );
}

// 收藏♡：与阅读器「稍后阅读」同一字段（POST /api/articles/:id/later）
function HeartButton({ active, onToggle }) {
  return (
    <button
      className="icon-btn flex-none !w-7 !h-7 text-[15px]"
      title={active ? '取消稍后阅读' : '加入稍后阅读（阅读器可见）'}
      style={active ? { color: 'var(--purple)' } : undefined}
      onClick={onToggle}
    >
      {active ? '♥' : '♡'}
    </button>
  );
}

// 时间轴卡片（两个 Tab 共用）
function TimelineCard({ it, tab, onOpen, onToggleLater }) {
  const tags = parseTags(it.tags);
  const showReason = !!it.reason && (tab === 'featured' || !!it.featured);
  return (
    <article
      className="card p-4 cursor-pointer transition-transform hover:-translate-y-0.5"
      onClick={() => onOpen(it)}
    >
      <div className="flex items-center gap-2 text-[11px]">
        <span className="t-muted uppercase tracking-wide truncate">{sourceLabel(it)}</span>
        {!!it.featured && (
          <span
            className="badge-green flex-none"
            style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
          >
            ✦ 精选
          </span>
        )}
        <span className="flex-1" />
        <ScoreBadge score={it.score} />
        <HeartButton
          active={!!it.later}
          onToggle={(e) => {
            e.stopPropagation();
            onToggleLater(it);
          }}
        />
      </div>
      <h3 className="mt-1.5 text-[15px] font-bold leading-snug t-text">{it.title}</h3>
      {it.summary && (
        <p className="mt-1.5 text-[12.5px] leading-relaxed t-muted line-clamp-3">{it.summary}</p>
      )}
      {showReason && (
        <p className="mt-2.5 pt-2.5 border-t border-dashed t-border text-[12px] leading-relaxed t-muted">
          <span className="t-accent font-medium">推荐理由：</span>
          {it.reason}
        </p>
      )}
      {tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t} className="text-[11px] t-muted">
              #{t}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

// 日期分组：分组头（可折叠）+ 竖线时间轴列表
function DateGroup({ label, count, collapsed, onToggle, children }) {
  return (
    <section className="mb-6">
      <button className="flex items-center gap-2 select-none group" onClick={onToggle}>
        <span className="text-[15px] font-bold t-text">{label}</span>
        <span className="text-[11px] t-muted">· {count} 条</span>
        <span className="text-[10px] t-muted transition-transform" style={{ transform: collapsed ? 'rotate(-90deg)' : 'none' }}>
          ▼
        </span>
      </button>
      {!collapsed && <div className="mt-3">{children}</div>}
    </section>
  );
}

// 单个时间轴条目：左列 HH:mm + 圆点，竖线贯穿
function TimelineRow({ time, children }) {
  return (
    <div className="relative flex gap-4 pb-4 last:pb-5">
      <div className="w-11 flex-none text-right text-[11px] leading-5 t-muted tabular-nums pt-3.5">{time}</div>
      <span
        className="absolute left-[52px] top-[19px] w-[9px] h-[9px] rounded-full flex-none"
        style={{ background: 'var(--accent)', boxShadow: '0 0 0 2px var(--bg)' }}
      />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

export default function HotPage() {
  const [tab, setTab] = useState('featured'); // featured | all | events
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [category, setCategory] = useState(''); // '' = 全部
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [source, setSource] = useState(''); // 全部动态 Tab 来源筛选（按 author）
  const [sources, setSources] = useState([]); // /api/hot/sources 聚合计数
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false); // 接口未就绪
  const [detail, setDetail] = useState(null); // 打开详情的条目
  const [collapsedMap, setCollapsedMap] = useState({}); // 日期分组折叠状态
  const boxRef = useRef(null);
  const loadingRef = useRef(false);

  // 分类清单（失败回退六类默认值）
  useEffect(() => {
    api
      .get('/api/hot/categories')
      .then((d) => {
        if (Array.isArray(d?.categories) && d.categories.length) setCategories(d.categories);
      })
      .catch(() => {});
  }, []);

  // 全部动态 Tab：来源聚合计数（接口未就绪时静默降级为仅「全部」）
  useEffect(() => {
    if (tab !== 'all') return;
    api
      .get('/api/hot/sources')
      .then((d) => {
        const raw = Array.isArray(d) ? d : d?.sources || d?.items || [];
        const list = raw
          .map((s) =>
            typeof s === 'string'
              ? { name: s, count: null }
              : { name: s.author || s.name || s.source || '', count: s.count ?? s.total ?? null }
          )
          .filter((s) => s.name);
        setSources(list);
      })
      .catch(() => setSources([]));
  }, [tab]);

  // 全部动态搜索防抖
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const fetchPage = useCallback(
    async (cur, replace) => {
      if (tab === 'events') return; // 热点榜 Tab 由 HotEvents 组件自行取数
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const data = await api.get(
          `/api/hot${qs({
            tab,
            category: tab === 'featured' ? category || undefined : undefined,
            q: tab === 'all' ? qDebounced || undefined : undefined,
            source: tab === 'all' ? source || undefined : undefined,
            cursor: cur || undefined,
          })}`
        );
        const list = data?.items || [];
        const next = data?.nextCursor ?? data?.next_cursor ?? null;
        setItems((prev) => (replace ? list : [...prev, ...list]));
        setCursor(next);
        setDone(!next);
        setFailed(false);
      } catch (e) {
        if (replace) setItems([]);
        setDone(true);
        setFailed(true); // 后端未就绪 → 空态降级
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [tab, category, qDebounced, source]
  );

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setDone(false);
    setFailed(false);
    setCollapsedMap({});
    if (boxRef.current) boxRef.current.scrollTop = 0;
    fetchPage(null, true);
  }, [fetchPage]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el || done || loadingRef.current) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 160) {
      fetchPage(cursor, false);
    }
  };

  // ♡ 收藏切换：复用 articles.later，与阅读器稍后阅读双向一致
  const toggleLater = async (it) => {
    try {
      const d = await api.post(`/api/articles/${it.id}/later`);
      const later = d?.later ?? (it.later ? 0 : 1);
      setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, later } : x)));
      setDetail((prev) => (prev && prev.id === it.id ? { ...prev, later } : prev));
      toast(later ? '已加入稍后阅读' : '已取消稍后阅读');
    } catch (e) {
      toast(e.message || '操作失败');
    }
  };

  // 按本地日期分组（新→旧），组内按时间倒序
  const groups = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      const k = dateKey(it.published_at || it.created_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(it);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, list]) => ({
        key,
        list: [...list].sort(
          (a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at)
        ),
      }));
  }, [items]);

  const isCollapsed = (key, idx) => collapsedMap[key] ?? idx > 0; // 默认最新日展开
  const toggleGroup = (key, idx) =>
    setCollapsedMap((m) => ({ ...m, [key]: !(m[key] ?? idx > 0) }));

  const emptyText = failed
    ? '热点榜服务尚未就绪（后端接口施工中），请稍后再试'
    : tab === 'all' && (qDebounced || source)
      ? '没有匹配的动态'
      : tab === 'featured' && category
        ? '该分类近期待抓取内容为空'
        : '暂无热点内容，等待 AIHOT 抓取';

  return (
    <div className="flex h-screen t-bg t-text overflow-hidden">
      <IconRail />
      <div className="flex-1 flex flex-col min-w-0">
        {/* 页头：标题 + Tab */}
        <header className="flex-none border-b t-border t-surface px-6 pt-4">
          <h1 className="serif text-lg font-bold t-text">🔥 热点榜</h1>
          <div className="mt-3 flex items-center gap-1">
            {[
              { id: 'featured', label: '精选' },
              { id: 'all', label: '全部动态' },
              { id: 'events', label: '热点榜' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-[13px] rounded-t-lg border-b-2 -mb-px ${
                  tab === t.id
                    ? 't-accent font-medium border-[var(--accent)]'
                    : 't-muted border-transparent hover:t-text'
                }`}
              >
                {t.label}
              </button>
            ))}
            <div className="flex-1" />
            {tab === 'all' && (
              <>
                <select
                  className="input !w-44 mb-2"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  title="按来源筛选"
                >
                  <option value="">来源：全部</option>
                  {sources.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                      {s.count != null ? `（${s.count}）` : ''}
                    </option>
                  ))}
                </select>
                <input
                  className="input !w-56 mb-2"
                  placeholder="搜索标题、摘要…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </>
            )}
          </div>
        </header>

        {/* 精选：分类胶囊 */}
        {tab === 'featured' && (
          <div className="flex-none t-surface border-b t-border px-6 py-2.5 flex flex-wrap gap-2">
            {['', ...categories].map((c) => (
              <button
                key={c || 'all'}
                onClick={() => setCategory(c)}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                  category === c
                    ? 't-accent-bg border-transparent font-medium'
                    : 't-border t-muted hover:t-text'
                }`}
                style={category === c ? { color: 'var(--accent-text)' } : undefined}
              >
                {c || '全部'}
              </button>
            ))}
          </div>
        )}

        {/* 内容区：热点榜 Tab 用跨域事件榜；其余为日期分组时间轴 */}
        <main ref={boxRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-6 py-5">
          <div className="max-w-[860px] mx-auto">
            {tab === 'events' ? (
              <HotEvents />
            ) : (
              <>
                {groups.map((g, gi) => (
              <DateGroup
                key={g.key}
                label={dateLabel(g.key)}
                count={g.list.length}
                collapsed={isCollapsed(g.key, gi)}
                onToggle={() => toggleGroup(g.key, gi)}
              >
                <div className="relative">
                  {/* 竖线时间轴 */}
                  <span
                    className="absolute left-[56px] top-2 bottom-2 w-px"
                    style={{ background: 'var(--border)' }}
                  />
                  {g.list.map((it) => (
                    <TimelineRow key={it.id} time={hhmm(it.published_at || it.created_at)}>
                      <TimelineCard
                        it={it}
                        tab={tab}
                        onOpen={setDetail}
                        onToggleLater={toggleLater}
                      />
                    </TimelineRow>
                  ))}
                </div>
              </DateGroup>
            ))}

            {loading && <div className="py-6 text-center text-xs t-muted">加载中…</div>}
            {!loading && items.length === 0 && (
              <div className="card px-4 py-16 text-center text-[13px] t-muted">{emptyText}</div>
            )}
            {!done && !loading && items.length > 0 && (
              <div className="text-center">
                <button className="btn-ghost mt-1" onClick={() => fetchPage(cursor, false)}>
                  加载更多
                </button>
              </div>
            )}
              </>
            )}
            <div className="h-10" />
          </div>
        </main>
      </div>

      {detail && (
        <HotDetail
          item={detail}
          onClose={() => setDetail(null)}
          onToggleLater={toggleLater}
        />
      )}
    </div>
  );
}
