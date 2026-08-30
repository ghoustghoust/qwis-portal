import { useCallback, useEffect, useRef, useState } from 'react';
import { Cover } from '../Cover.jsx';
import { relativeTime, formatDateTime } from '../util.js';
import {
  ChevronDownIcon, ArrowLeftIcon, ExternalIcon, MergeIcon, SearchIcon, RssIcon,
} from '../icons.jsx';
import { getArticles, getArticle } from '../api.js';

// 阅读器 Tab：桌面端（≥1024px）三栏 = 领域侧栏（可折叠）/ 文章列表 / 阅读视图
// 移动端：领域 chips + 列表，点击进阅读视图（返回按钮）
// dedup 合并同事件默认开（localStorage: portal.dedup）；侧栏折叠状态存 portal.groupsCollapsed

const DEDUP_KEY = 'portal.dedup';
const SIDEBAR_KEY = 'portal.groupsCollapsed';

function readBool(key, def) {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return def;
    if (key === SIDEBAR_KEY) return !!JSON.parse(v).__sidebar;
    return v !== '0';
  } catch {
    return def;
  }
}
function writeSidebar(collapsed) {
  try {
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ __sidebar: collapsed }));
  } catch {
    /* ignore */
  }
}

function useIsDesktop() {
  const [d, setD] = useState(() => matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = matchMedia('(min-width: 1024px)');
    const fn = (e) => setD(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return d;
}

// 「N 源」徽章 + 展开同事件其他信源
function RelatedBadge({ a }) {
  const [open, setOpen] = useState(false);
  if (!a.relatedCount) return null;
  return (
    <span className="inline-block align-middle" onClick={(e) => e.stopPropagation()}>
      <button
        className="badge ml-1.5"
        style={{ color: 'var(--accent)' }}
        title={`同事件共 ${a.relatedCount + 1} 个信源，点击${open ? '收起' : '展开'}`}
        onClick={() => setOpen((v) => !v)}
      >
        {a.relatedCount + 1} 源
        <ChevronDownIcon
          size={9}
          className="ml-0.5 transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>
      {open && (
        <span className="block mt-1.5 border-l-2 pl-2 space-y-1" style={{ borderColor: 'var(--accent)' }}>
          {(a.related || []).map((r) => (
            <a
              key={r.id}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-[11px] font-normal t-muted hover:t-accent leading-snug truncate"
              title={r.url}
            >
              ↗ {r.source_name || '未知信源'}
            </a>
          ))}
        </span>
      )}
    </span>
  );
}

function ArticleRow({ a, active, onOpen }) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`w-full text-left flex gap-3 px-4 py-3 border-b t-border transition-colors cursor-pointer ${
        active ? 't-accent-soft' : 'hover:bg-[var(--surface-2)]'
      }`}
      onClick={() => onOpen(a)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(a)}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-[11px] t-muted">
          <span className="truncate">{a.source_name}</span>
          <span className="flex-none tabular-nums">· {relativeTime(a.published_at)}</span>
          {a.score != null && <span className="flex-none t-accent tabular-nums">· {a.score}</span>}
        </div>
        <h3 className="mt-0.5 text-[14px] font-medium leading-snug t-text line-clamp-2">
          {a.title}
          <RelatedBadge a={a} />
        </h3>
        {a.summary && (
          <p className="mt-1 text-[12px] t-muted leading-relaxed line-clamp-2">{a.summary}</p>
        )}
      </div>
      <Cover src={a.cover} className="flex-none w-[64px] h-[48px] rounded-lg object-cover self-center" />
    </div>
  );
}

// 阅读视图（桌面右栏 / 移动整栏）
function ReadingView({ item, full, onBack, isDesktop }) {
  const html = full?.content_html || item.content_html || '';
  return (
    <div className="px-5 py-4 max-w-[760px] mx-auto w-full">
      <div className="flex items-center gap-2">
        {!isDesktop && (
          <button
            className="inline-flex items-center gap-1 text-[13px] t-accent font-medium py-1 -ml-1"
            onClick={onBack}
          >
            <ArrowLeftIcon size={16} /> 返回
          </button>
        )}
        <span className="flex-1" />
        <a
          className="inline-flex items-center gap-1 text-[12px] t-muted hover:t-accent"
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          原文 <ExternalIcon size={13} />
        </a>
      </div>
      <h1 className="mt-2 text-[19px] font-bold leading-snug t-text">{item.title}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] t-muted">
        <span>{item.source_name}</span>
        <span className="tabular-nums">· {formatDateTime(item.published_at)}</span>
        {item.domain && <span>· {item.domain}</span>}
        {item.score != null && <span className="t-accent tabular-nums">· 评分 {item.score}</span>}
      </div>
      <div className="mt-4 pt-4 border-t t-border">
        {html ? (
          <div className="article-content" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div>
            {!full && <div className="py-6 text-center text-xs t-muted">正文加载中…</div>}
            {full && item.summary && (
              <p className="text-[14px] leading-relaxed t-text">{item.summary}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReaderTab({ meta }) {
  const isDesktop = useIsDesktop();
  const [domain, setDomain] = useState(''); // '' = 全部
  const [q, setQ] = useState('');
  const [qD, setQD] = useState('');
  const [dedup, setDedup] = useState(() => readBool(DEDUP_KEY, true));
  const [sidebarOff, setSidebarOff] = useState(() => readBool(SIDEBAR_KEY, false));
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState(null); // 列表条目
  const [full, setFull] = useState(null); // 全文（getArticle）
  const loadingRef = useRef(false);

  const domains = meta?.domains || [];

  // 搜索防抖
  useEffect(() => {
    const t = setTimeout(() => setQD(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const fetchPage = useCallback(
    async (cur, replace) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const d = await getArticles({ cursor: cur, domain, q: qD, dedup });
        setItems((prev) => (replace ? d.items : [...prev, ...d.items]));
        setCursor(d.nextCursor);
        setDone(!d.nextCursor);
        if (d.total != null) setTotal(d.total);
        setFailed(false);
      } catch {
        if (replace) setItems([]);
        setDone(true);
        setFailed(true);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [domain, qD, dedup]
  );

  // 筛选/搜索/开关变化 → 清空重载
  useEffect(() => {
    setItems([]);
    setCursor(null);
    setDone(false);
    setSelected(null);
    setFull(null);
    fetchPage(null, true);
  }, [fetchPage]);

  const toggleDedup = () =>
    setDedup((v) => {
      const next = !v;
      try {
        localStorage.setItem(DEDUP_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });

  const toggleSidebar = () =>
    setSidebarOff((v) => {
      writeSidebar(!v);
      return !v;
    });

  const open = (a) => {
    setSelected(a);
    setFull(null);
    getArticle(a.id)
      .then(setFull)
      .catch(() => setFull(a)); // 详情接口失败就用列表自带内容
  };

  // 领域选择条目（侧栏/移动 chips 共用）
  const DomainPick = ({ value, label, chip }) => (
    <button
      onClick={() => setDomain(value)}
      className={
        chip
          ? `flex-none px-3 py-1 rounded-full text-xs border transition-colors ${
              domain === value ? 't-accent-bg border-transparent font-medium' : 't-border t-muted'
            }`
          : `w-full text-left px-2.5 py-1.5 rounded-lg text-[13px] transition-colors truncate ${
              domain === value ? 't-accent-soft t-accent font-medium' : 't-muted hover:bg-[var(--surface-2)]'
            }`
      }
      style={chip && domain === value ? { color: 'var(--accent-text)' } : undefined}
    >
      {label}
    </button>
  );

  const searchAndToggle = (
    <div className="flex items-center gap-2 px-3 py-2 border-b t-border">
      <div className="relative flex-1">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 t-muted">
          <SearchIcon size={13} />
        </span>
        <input
          className="w-full bg-transparent border t-border rounded-lg pl-7 pr-2 py-1.5 text-[12.5px] t-text outline-none focus:border-[var(--accent)]"
          placeholder="搜索标题 / 摘要…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <button
        className={`flex-none inline-flex items-center gap-1 text-[11px] px-2 py-1.5 rounded-lg border t-border transition-colors ${
          dedup ? 't-accent-soft t-accent font-medium' : 't-muted hover:t-text'
        }`}
        title={dedup ? '合并同事件：已开启（点击关闭）' : '合并同事件：同一事件多信源合并为一条'}
        onClick={toggleDedup}
      >
        <MergeIcon size={12} /> 合并
      </button>
    </div>
  );

  const listBody = (
    <>
      {items.map((a) => (
        <ArticleRow key={a.id} a={a} active={selected?.id === a.id} onOpen={open} />
      ))}
      {loading && <div className="py-4 text-center text-xs t-muted">加载中…</div>}
      {!loading && items.length === 0 && (
        <div className="py-16 text-center text-[13px] t-muted">
          {failed ? '文章数据加载失败' : '近 3 天暂无文章'}
        </div>
      )}
      {!done && !loading && items.length > 0 && (
        <button
          className="w-full py-3 text-xs t-muted hover:t-accent"
          onClick={() => fetchPage(cursor, false)}
        >
          加载更多{total != null ? `（已加载 ${items.length}/${total}）` : ''}
        </button>
      )}
    </>
  );

  /* ===== 桌面端三栏 ===== */
  if (isDesktop) {
    return (
      <div className="flex flex-1 min-h-0" style={{ height: 'calc(100vh - 3rem)' }}>
        {/* 左：领域侧栏（可折叠） */}
        <aside
          className={`flex-none border-r t-border t-surface flex flex-col transition-all ${
            sidebarOff ? 'w-10' : 'w-48'
          }`}
        >
          <button
            className="flex-none flex items-center gap-1.5 px-3 py-2.5 text-[11px] t-muted hover:t-text"
            title={sidebarOff ? '展开领域栏' : '收起领域栏'}
            onClick={toggleSidebar}
          >
            <ChevronDownIcon
              size={13}
              className="transition-transform duration-200"
              style={{ transform: sidebarOff ? 'rotate(-90deg)' : 'rotate(90deg)' }}
            />
            {!sidebarOff && <span className="tracking-wide">领域</span>}
          </button>
          {!sidebarOff && (
            <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
              <DomainPick value="" label="全部" />
              {domains.map((dm) => (
                <DomainPick key={dm} value={dm} label={dm} />
              ))}
            </div>
          )}
        </aside>

        {/* 中：文章列表 */}
        <section className="flex-none w-[400px] border-r t-border flex flex-col min-h-0">
          {searchAndToggle}
          <div className="flex-1 overflow-y-auto">{listBody}</div>
        </section>

        {/* 右：阅读视图 */}
        <section className="flex-1 min-w-0 overflow-y-auto">
          {selected ? (
            <ReadingView item={selected} full={full} onBack={() => setSelected(null)} isDesktop />
          ) : (
            <div className="h-full flex flex-col items-center justify-center t-muted">
              <RssIcon size={36} />
              <div className="mt-3 text-[13px]">从中间列表选一篇文章开始阅读</div>
            </div>
          )}
        </section>
      </div>
    );
  }

  /* ===== 移动端单栏 ===== */
  if (selected) {
    return <ReadingView item={selected} full={full} onBack={() => setSelected(null)} isDesktop={false} />;
  }
  return (
    <div>
      <div className="px-4 pt-3 flex gap-2 overflow-x-auto pb-1">
        <DomainPick chip value="" label="全部" />
        {domains.map((dm) => (
          <DomainPick chip key={dm} value={dm} label={dm} />
        ))}
      </div>
      {searchAndToggle}
      <div className="pb-24">{listBody}</div>
    </div>
  );
}
