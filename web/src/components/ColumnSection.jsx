import { relativeTime, imgUrl } from '../util';

// 日报栏目区（F15/F16）：栏名+右侧说明；卡片=封面大图+标题+摘要
// 摘要与重要度由 AI 生成，已随 AI 摘要下线（历史日报数据仍可展示）
export default function ColumnSection({ section, onOpen }) {
  const items = section?.items || [];
  return (
    <section>
      <div className="flex items-baseline justify-between gap-6">
        <h2 className="serif text-xl font-bold t-text flex-none">{section?.column}</h2>
        {section?.desc && (
          <div className="text-[11px] t-muted text-right leading-relaxed">{section.desc}</div>
        )}
      </div>
      <div className="mt-2 border-t-2" style={{ borderColor: 'var(--text)' }} />

      {items.length === 0 ? (
        <div className="mt-4 card px-4 py-8 text-center text-xs t-muted">
          这一栏暂时没有命中内容
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((item, i) => (
            <DailyCard key={`${item.kind}-${item.ref_id}-${i}`} item={item} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}

function DailyCard({ item, onOpen }) {
  return (
    <article
      className="card overflow-hidden cursor-pointer transition-transform hover:-translate-y-0.5"
      onClick={() => onOpen?.(item)}
    >
      {item.cover ? (
        <img
          referrerPolicy="no-referrer"
          src={imgUrl(item.cover)}
          alt=""
          loading="lazy"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          className="w-full aspect-[16/9] object-cover"
        />
      ) : null}
      <div className="p-4">
        <h3 className="mt-1 text-[15px] font-bold leading-snug t-text line-clamp-2">
          {item.title}
        </h3>
        {/* T13/F5：跨源去重标注（title 悬停显示来源名） */}
        {Array.isArray(item.related) && item.related.length > 0 && (
          <div
            className="mt-1 text-[11px] t-accent"
            title={`同主题信源：${item.related.map((r) => r.source_name || '').filter(Boolean).join('、')}`}
          >
            另有 {item.related.length} 家信源报道
          </div>
        )}
        {item.summary ? (
          <p className="mt-2 text-[13px] leading-relaxed t-muted line-clamp-5 whitespace-pre-line">
            {item.summary}
          </p>
        ) : null}
        <div className="mt-3 flex items-center justify-between text-[11px] t-muted">
          <span className="truncate">
            {item.source_name || ''}
            {item.source_name ? ' · ' : ''}
            {item.kind === 'video' ? '视频' : '公众号'} · {relativeTime(item.published_at)}
          </span>
        </div>
      </div>
    </article>
  );
}
