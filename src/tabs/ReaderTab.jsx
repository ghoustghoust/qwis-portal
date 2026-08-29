import { useEffect, useMemo, useState } from 'react';
import { Cover } from '../Cover.jsx';
import { relativeTime, formatDateTime } from '../util.js';
import { ChevronDownIcon, ArrowLeftIcon, ExternalIcon } from '../icons.jsx';

// 阅读器 Tab：按 domain 分组（可折叠，折叠状态存 localStorage: portal.groupsCollapsed）
// 点击文章 → 阅读视图（content_html 直渲，图片 no-referrer）

const COLLAPSED_KEY = 'portal.groupsCollapsed';

function readCollapsed() {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function ArticleRow({ it, onOpen }) {
  return (
    <button
      className="w-full text-left flex gap-3 px-3 py-2.5 rounded-lg active:bg-[var(--surface-2)]"
      onClick={() => onOpen(it)}
    >
      <div className="flex-1 min-w-0">
        <h3 className="text-[14px] font-medium leading-snug t-text line-clamp-2">{it.title}</h3>
        <div className="mt-1 flex items-center gap-2 text-[11px] t-muted">
          <span className="truncate">{it.source_name}</span>
          <span className="flex-none tabular-nums">· {relativeTime(it.published_at)}</span>
          {it.score != null && <span className="flex-none t-accent tabular-nums">· {it.score}</span>}
        </div>
      </div>
      <Cover src={it.cover} className="flex-none w-[64px] h-[48px] rounded-lg object-cover" />
    </button>
  );
}

// 阅读视图：全文直渲 + 返回
function ReadingView({ it, onBack }) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [it.id]);

  return (
    <div className="px-4 pt-3">
      <div className="flex items-center gap-2">
        <button
          className="inline-flex items-center gap-1 text-[13px] t-accent font-medium py-1.5 -ml-1"
          onClick={onBack}
        >
          <ArrowLeftIcon size={16} /> 返回
        </button>
        <span className="flex-1" />
        <a
          className="inline-flex items-center gap-1 text-[12px] t-muted"
          href={it.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          原文 <ExternalIcon size={13} />
        </a>
      </div>
      <h1 className="mt-2 text-[19px] font-bold leading-snug t-text">{it.title}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] t-muted">
        <span>{it.source_name}</span>
        <span className="tabular-nums">· {formatDateTime(it.published_at)}</span>
        {it.domain && <span>· {it.domain}</span>}
        {it.score != null && <span className="t-accent tabular-nums">· 评分 {it.score}</span>}
      </div>
      <div className="card mt-3 px-4 py-3">
        {it.content_html ? (
          <div className="article-content" dangerouslySetInnerHTML={{ __html: it.content_html }} />
        ) : (
          <div>
            {it.summary && <p className="text-[14px] leading-relaxed t-text">{it.summary}</p>}
            <a
              className="inline-block mt-3 text-[13px] t-accent underline"
              href={it.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              阅读原文 ↗
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReaderTab({ articles }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [reading, setReading] = useState(null); // 正在阅读的文章

  const toggle = (domain) =>
    setCollapsed((m) => {
      const next = { ...m, [domain]: !m[domain] };
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  // 按 domain 分组，组按文章数倒序，组内按时间倒序
  const groups = useMemo(() => {
    const map = new Map();
    for (const a of articles || []) {
      const d = a.domain || '其它';
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(a);
    }
    return [...map.entries()]
      .map(([domain, list]) => ({
        domain,
        list: [...list].sort((a, b) => (b.published_at || '').localeCompare(a.published_at || '')),
      }))
      .sort((a, b) => b.list.length - a.list.length);
  }, [articles]);

  if (reading) return <ReadingView it={reading} onBack={() => setReading(null)} />;

  return (
    <div className="px-4 pt-4 space-y-3">
      {groups.map((g) => {
        const isCollapsed = !!collapsed[g.domain];
        return (
          <section key={g.domain} className="card overflow-hidden">
            <button
              className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
              onClick={() => toggle(g.domain)}
              aria-expanded={!isCollapsed}
            >
              <ChevronDownIcon
                size={14}
                className="flex-none t-muted transition-transform duration-200"
                style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none' }}
              />
              <span className="flex-1 text-[13px] font-bold t-text">{g.domain}</span>
              <span className="text-[11px] t-muted tabular-nums">{g.list.length} 篇</span>
            </button>
            {!isCollapsed && (
              <div className="px-1.5 pb-2">
                {g.list.map((it) => (
                  <ArticleRow key={it.id} it={it} onOpen={setReading} />
                ))}
              </div>
            )}
          </section>
        );
      })}
      {groups.length === 0 && (
        <div className="card px-4 py-16 text-center text-[13px] t-muted">近 3 天暂无文章</div>
      )}
    </div>
  );
}
