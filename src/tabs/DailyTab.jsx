import { Cover } from '../Cover.jsx';
import { formatDateTime, relativeTime } from '../util.js';

// 今日日报 Tab：栏目分区卡片；「茧房外」栏用紫色强调

function isCocoon(column) {
  return (column || '').includes('茧房外');
}

function DailyItem({ it, cocoon }) {
  return (
    <a
      href={it.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 px-4 py-3 border-t t-border active:bg-[var(--surface-2)]"
    >
      <div className="flex-1 min-w-0">
        <h3 className={`text-[14.5px] font-medium leading-snug ${cocoon ? 't-text' : 't-text'}`}>
          {it.title}
        </h3>
        {it.summary && (
          <p className="mt-1 text-[12.5px] leading-relaxed t-muted line-clamp-2">{it.summary}</p>
        )}
        <div className="mt-1.5 flex items-center gap-2 text-[11px] t-muted">
          <span className="truncate">{it.source_name}</span>
          <span className="flex-none tabular-nums">· {relativeTime(it.published_at)}</span>
          {Array.isArray(it.related) && it.related.length > 0 && (
            <span className={`flex-none badge ${cocoon ? '' : 't-accent'}`}>
              +{it.related.length} 相关
            </span>
          )}
        </div>
      </div>
      <Cover
        src={it.cover}
        className="flex-none w-[72px] h-[54px] rounded-lg object-cover"
      />
    </a>
  );
}

export default function DailyTab({ daily }) {
  const sections = (daily?.sections || []).filter((s) => (s.items || []).length > 0);
  return (
    <div className="px-4 pt-4 space-y-4">
      {daily?.generated_at && (
        <div className="text-[11px] t-muted px-1">
          生成于 {formatDateTime(daily.generated_at)}
          {daily.stats?.articles != null && ` · 收录 ${daily.stats.articles} 条`}
        </div>
      )}
      {sections.map((sec) => {
        const cocoon = isCocoon(sec.column);
        return (
          <section
            key={sec.column}
            className="card overflow-hidden"
            style={cocoon ? { borderColor: 'var(--purple)' } : undefined}
          >
            <header
              className="px-4 py-2.5"
              style={cocoon ? { background: 'color-mix(in srgb, var(--purple) 10%, transparent)' } : undefined}
            >
              <div
                className="text-[13px] font-bold"
                style={cocoon ? { color: 'var(--purple)' } : undefined}
              >
                {cocoon && '◈ '}
                {sec.column}
                <span className="ml-1.5 text-[11px] font-normal t-muted">{sec.items.length} 条</span>
              </div>
              {sec.desc && <div className="mt-0.5 text-[11px] t-muted leading-snug">{sec.desc}</div>}
            </header>
            <div>
              {sec.items.map((it, i) => (
                <DailyItem key={it.ref_id ?? i} it={it} cocoon={cocoon} />
              ))}
            </div>
          </section>
        );
      })}
      {sections.length === 0 && (
        <div className="card px-4 py-16 text-center text-[13px] t-muted">今日日报暂无内容</div>
      )}
    </div>
  );
}
