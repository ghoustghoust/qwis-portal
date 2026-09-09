import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconRail } from '../main.jsx';
import { api, qs } from '../api';
import { toast } from '../toast';
import { SearchIcon, BookIcon } from '../components/icons.jsx';
import TagPills from '../components/ui/TagPills.jsx';
import SourceAvatar from '../components/ui/SourceAvatar.jsx';
import { imgUrl } from '../util.js';
import { useI18n } from '../i18n.jsx';

// 我的阅读（沉淀聚合页）：已读文章 + 稍后读 + 收藏视频 的并集
// F1 日期分组聚合  F2 分段 Tab（全部/已收藏/已读）  F3 类型筛选
// F4 关键词搜索   F5 批量管理                        F6 Markdown 导出

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const PAGE_SIZE = 30;

// 类型徽章标签
function typeLabel(itemType, sourceType, t) {
  if (itemType === 'video') return t('reading.video');
  if (sourceType === 'douyin') return t('reading.podcast');
  return t('reading.article');
}

// 本地日期分组键
function dateKey(iso) {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateLabel(key, t) {
  if (key === 'unknown') return t('common.unknownDate');
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const todayKey = dateKey(today.toISOString());
  const yesterdayKey = dateKey(yesterday.toISOString());
  if (key === todayKey) return t('reading.today');
  if (key === yesterdayKey) return t('reading.yesterday');
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const weekdays = t('common.weekdays');
  const wd = Array.isArray(weekdays) ? weekdays[dt.getDay()] : WEEKDAYS[dt.getDay()];
  return t('common.dateFormat').replace('${m}', m).replace('${d}', d).replace('${wd}', wd);
}

// ---- 组件 ----

export default function MyReadingPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState('all');       // all | favorited | read
  const [type, setType] = useState('all');      // all | article | podcast | video
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ all: 0, favorited: 0, read: 0 });
  const [cursor, setCursor] = useState(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  // 选择模式
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set()); // Set of `${type}:${id}`
  const [batchBusy, setBatchBusy] = useState(false);
  const boxRef = useRef(null);
  const loadingRef = useRef(false);

  // 搜索防抖
  const [qInput, setQInput] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  // 加载数据
  const fetchPage = useCallback(async (cur, reset) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const params = { tab, type };
      if (q) params.q = q;
      if (cur) params.cursor = cur;
      const d = await api.get(`/api/reading${qs(params)}`);
      const newItems = d?.items || [];
      setCounts(d?.counts || { all: 0, favorited: 0, read: 0 });
      if (reset) {
        setItems(newItems);
      } else {
        setItems((prev) => [...prev, ...newItems]);
      }
      setCursor(d?.nextCursor || null);
      setDone(!d?.nextCursor);
    } catch (e) {
      if (reset) setItems([]);
      toast(e.message || t('reading.loadFailed'));
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [tab, type, q]);

  // tab/type/q 变化时重新加载
  useEffect(() => {
    setDone(false);
    setCursor(null);
    fetchPage(null, true);
  }, [fetchPage]);

  // 滚动加载
  const onScroll = () => {
    const el = boxRef.current;
    if (!el || done || loadingRef.current) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 160) {
      fetchPage(cursor, false);
    }
  };

  // 日期分组
  const groups = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      const k = dateKey(it.date);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(it);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, list]) => ({ key, list }));
  }, [items]);

  // 选择逻辑
  const itemKey = (it) => `${it.item_type}:${it.id}`;
  const toggleSelect = (it) => {
    const k = itemKey(it);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  const selectAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map(itemKey)));
    }
  };
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); };

  // 批量操作
  const doBatch = async (action) => {
    if (!selected.size || batchBusy) return;
    const actionLabels = { unlater: t('reading.unlater'), unfavorite: t('reading.unfavorite'), clear_read: t('reading.clearRead') };
    if (!confirm(`${t('reading.confirmBatch')} ${selected.size} ${t('reading.batchSuffix')}「${actionLabels[action]}」？`)) return;
    setBatchBusy(true);
    try {
      const payload = Array.from(selected).map((k) => {
        const [typ, id] = k.split(':');
        return { type: typ, id: Number(id) };
      });
      const d = await api.post('/api/reading/batch', { action, items: payload });
      toast(`${t('reading.processed')} ${d?.updated ?? 0} ${t('reading.items')}`);
      exitSelect();
      fetchPage(null, true);
    } catch (e) {
      toast(e.message || t('reading.opFailed'));
    } finally {
      setBatchBusy(false);
    }
  };

  // 导出 Markdown
  const doExport = async () => {
    const target = selected.size > 0
      ? Array.from(selected).map((k) => { const [typ, id] = k.split(':'); return { type: typ, id: Number(id) }; })
      : items.map((it) => ({ type: it.item_type, id: it.id }));
    if (!target.length) { toast(t('reading.noExport')); return; }
    try {
      const d = await api.post('/api/reading/export', { items: target });
      const blob = new Blob([d.markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${t('reading.title')}_${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`${t('reading.exported')} ${d.count} ${t('reading.items')}`);
    } catch (e) {
      toast(e.message || t('reading.exportFailed'));
    }
  };

  // 当前 tab 可执行的批量操作
  const batchActions = useMemo(() => {
    const actions = [];
    if (tab === 'all' || tab === 'favorited') {
      actions.push({ id: 'unlater', label: t('reading.unlater') });
      actions.push({ id: 'unfavorite', label: t('reading.unfavorite') });
    }
    if (tab === 'all' || tab === 'read') {
      actions.push({ id: 'clear_read', label: t('reading.clearRead') });
    }
    return actions;
  }, [tab]);

  const tabItems = [
    { id: 'all', label: t('reading.all'), count: counts.all },
    { id: 'favorited', label: t('reading.favorited'), count: counts.favorited },
    { id: 'read', label: t('reading.read'), count: counts.read },
  ];

  return (
    <div className="flex h-screen t-bg t-text overflow-hidden">
      <IconRail />
      <div className="flex-1 flex flex-col min-w-0">
        {/* 页头 */}
        <header className="flex-none border-b t-border t-surface px-6 pt-4">
          <div className="flex items-center gap-2.5">
            <BookIcon size={20} />
            <h1 className="serif text-lg font-bold t-text">{t('reading.title')}</h1>
            <div className="flex-1" />
            {selectMode ? (
              <div className="flex items-center gap-2">
                <button className="btn-ghost text-xs" onClick={selectAll}>
                  {selected.size === items.length ? t('reading.deselectAll') : t('reading.selectAll')}
                </button>
                <span className="text-xs t-muted">{selected.size} {t('reading.selected')}</span>
                <button className="btn-ghost text-xs" onClick={exitSelect}>{t('reading.cancel')}</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button className="btn-ghost text-xs" onClick={() => setSelectMode(true)} disabled={!items.length}>
                  {t('reading.batchManage')}
                </button>
                <button className="btn-ghost text-xs" onClick={doExport}>
                  {t('reading.export')}
                </button>
              </div>
            )}
          </div>

          {/* 2026-09-05 视觉精修：计数 Tab + 类型 Tab 收敛为 pill 组 */}
          <div className="mt-3 pb-3 flex items-center gap-2 flex-wrap">
            {tabItems.map((item) => (
              <button
                key={item.id}
                onClick={() => { setTab(item.id); if (selectMode) exitSelect(); }}
                className={`pill !px-3 !py-1 !text-xs ${tab === item.id ? 'on' : ''}`}
              >
                {item.label}
                <span className="opacity-60 tabular-nums">{item.count}</span>
              </button>
            ))}
            <span className="w-px h-4 t-surface2 flex-none mx-1" />
            {/* 类型筛选 */}
            {[
              { id: 'all', label: t('reading.all') },
              { id: 'article', label: t('reading.article') },
              { id: 'podcast', label: t('reading.podcast') },
              { id: 'video', label: t('reading.video') },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setType(item.id)}
                className={`pill !px-3 !py-1 !text-xs ${type === item.id ? 'on' : ''}`}
              >
                {item.label}
              </button>
            ))}
            <div className="flex-1" />
            {/* 搜索 */}
            <div className="relative">
              <input
                className="input !w-44 !py-1 !pl-7 text-xs"
                placeholder={t('reading.search')}
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
              />
              <SearchIcon size={14} className="absolute left-2 top-1/2 -translate-y-1/2 t-muted pointer-events-none" />
            </div>
          </div>
        </header>

        {/* 内容区 */}
        <main ref={boxRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-6 py-5">
          <div className="max-w-[860px] mx-auto">
            {groups.map((g) => (
              <div key={g.key} className="mb-6">
                {/* 2026-09-05 视觉精修：日期分组标题 = text-xs t-muted + hairline */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-medium t-text">{dateLabel(g.key, t)}</span>
                  <span className="text-xs t-muted tabular-nums">{g.list.length} {t('reading.items')}</span>
                  <div className="flex-1 border-t hairline" />
                </div>
                <div className="flex flex-col gap-2">
                  {g.list.map((it) => (
                    <ReadingRow
                      key={itemKey(it)}
                      it={it}
                      selectMode={selectMode}
                      checked={selected.has(itemKey(it))}
                      onToggle={() => toggleSelect(it)}
                      t={t}
                    />
                  ))}
                </div>
              </div>
            ))}

            {loading && <div className="py-6 text-center text-xs t-muted">{t('reading.loading')}</div>}
            {!loading && items.length === 0 && (
              <div className="card px-4 py-16 text-center text-[13px] t-muted">
                {tab === 'favorited' ? t('reading.noFavorite') : tab === 'read' ? t('reading.noRead') : t('reading.noData')}
              </div>
            )}
            {!done && !loading && items.length > 0 && (
              <div className="text-center">
                <button className="btn-ghost mt-1" onClick={() => fetchPage(cursor, false)}>
                  {t('reading.loadMore')}
                </button>
              </div>
            )}
            <div className="h-10" />
          </div>
        </main>

        {/* 批量操作底栏 */}
        {selectMode && selected.size > 0 && (
          <div className="flex-none border-t t-border t-surface px-6 py-3">
            <div className="max-w-[860px] mx-auto flex items-center gap-2">
              <span className="text-xs t-muted mr-2">{selected.size} {t('reading.selected')}</span>
              {batchActions.map((a) => (
                <button
                  key={a.id}
                  className="btn-ghost text-xs"
                  disabled={batchBusy}
                  onClick={() => doBatch(a.id)}
                >
                  {a.label}
                </button>
              ))}
              <div className="flex-1" />
              <button className="btn-ghost text-xs" disabled={batchBusy} onClick={doExport}>
                {t('reading.exportSelected')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- 单条内容行 ----
// 2026-09-05 视觉精修：统一 card card-lift p-3；复选框 + 80px 缩略图 + 标题 + meta + 摘要 2 行 + TagPills
function ReadingRow({ it, selectMode, checked, onToggle, t }) {
  const label = typeLabel(it.item_type, it.source_type, t);
  const date = it.date ? it.date.slice(0, 10) : '';
  const isVideo = it.item_type === 'video';

  return (
    <div className={`card card-lift flex items-start gap-3 p-3 ${selectMode ? 'cursor-pointer' : ''}`}>
      {/* 选择框 */}
      {selectMode && (
        <label className="flex-none mt-1 cursor-pointer" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
          <input type="checkbox" checked={checked} readOnly className="mr-0" />
        </label>
      )}
      {/* 缩略图（2026-09-05 修复：imgUrl 代理防盗链域名 + no-referrer + 失败/无封面回退源头像） */}
      <div className="flex-none w-20 h-20 rounded-[10px] overflow-hidden t-surface2 flex items-center justify-center">
        {it.cover ? (
          <img
            src={imgUrl(it.cover)}
            alt=""
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextSibling.style.display = '';
            }}
          />
        ) : null}
        <span style={it.cover ? { display: 'none' } : undefined} className="flex items-center justify-center w-full h-full">
          <SourceAvatar name={it.source_name} avatar={it.source_avatar} size={30} />
        </span>
      </div>
      {/* 内容 */}
      <div className="flex-1 min-w-0">
        <a
          href={it.url || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[14px] font-medium t-text leading-snug line-clamp-2 hover:t-accent"
          onClick={(e) => { if (selectMode) { e.preventDefault(); onToggle(); } }}
        >
          {it.title || t('reading.noTitle')}
        </a>
        <div className="meta mt-1">
          <span className="pill">{label}</span>
          {it.later === 1 && !isVideo && <span className="t-purple">{t('reading.laterBadge')}</span>}
          {it.favorite === 1 && isVideo && <span className="t-purple">{t('reading.favBadge')}</span>}
          {it.read_at && !isVideo && <span>{t('reading.readBadge')}</span>}
        </div>
        <div className="meta mt-1">
          <span className="truncate">{it.source_name || t('reading.unknownSource')}</span>
          {date && (
            <>
              <span className="sep">·</span>
              <span className="flex-none tabular-nums">{date}</span>
            </>
          )}
        </div>
        {it.summary && (
          <p className="text-xs t-muted mt-1 line-clamp-2 leading-relaxed">
            {it.summary.replace(/<[^>]+>/g, '').slice(0, 120)}
          </p>
        )}
        <TagPills tags={it.tags} max={4} className="mt-1.5" />
      </div>
    </div>
  );
}
