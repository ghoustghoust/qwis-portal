import { useMemo, useState } from 'react';
import { relativeTime, imgUrl } from '../util';
import Stars from './ui/Stars.jsx';
import TagPills from './ui/TagPills.jsx';

// 日报栏目区（2026-09-05b 混合式重写）：栏首封面卡(≤3) + 其余紧凑列表行
// 支持：折叠/展开、排序（默认/最新/最热）、关键词高亮、渐进渲染（性能）
// 摘要与重要度由 AI 生成，已随 AI 摘要下线（历史日报数据仍可展示）
// 2026-09-05 视觉精修：条目卡统一 card-lift，条目行补 Stars(score) + TagPills(tags, 3)

const CARD_COUNT = 3; // 栏首封面卡数量
const ROW_BATCH = 12; // 列表首批行数，超出走「展开剩余 N 条」

// 标题关键词高亮：React 节点拼接（不碰 dangerouslySetInnerHTML，无 XSS 面）
function highlightTitle(title, keywords, enabled) {
  const text = String(title || '');
  if (!enabled || !Array.isArray(keywords) || !keywords.length) return text;
  const kws = keywords.map((k) => String(k).trim()).filter(Boolean);
  if (!kws.length) return text;
  // 转义正则元字符，按长度降序避免短词截断长词
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${kws.sort((a, b) => b.length - a.length).map(esc).join('|')})`, 'gi');
  const parts = text.split(re);
  let marks = 0;
  return parts.map((p, i) => {
    if (i % 2 === 1 && marks < 5) { // 单条标题高亮上限 5 处
      marks++;
      return <mark key={i} className="hl">{p}</mark>;
    }
    return p;
  });
}

// 排序：default=服务端编辑顺序；time=最新；heat=同主题信源数 → 关键词命中数 → 时间
function sortItems(items, sort) {
  if (sort === 'default') return items;
  const arr = [...items];
  const byTime = (a, b) => String(b.published_at || '').localeCompare(String(a.published_at || ''));
  if (sort === 'time') return arr.sort(byTime);
  return arr.sort(
    (a, b) =>
      (b.related?.length || 0) - (a.related?.length || 0) ||
      (b.hits || 0) - (a.hits || 0) ||
      byTime(a, b)
  );
}

export default function ColumnSection({ section, keywords, collapsed, onToggle, sort = 'default', highlight = true, onOpen }) {
  const [expanded, setExpanded] = useState(false); // 渐进渲染：列表是否展开全部
  const rawItems = section?.items || [];
  const items = useMemo(() => sortItems(rawItems, sort), [rawItems, sort]);

  // 混合式分流：有封面者优先进卡片位（保持排序序），其余进紧凑列表
  const { cards, rows } = useMemo(() => {
    const cs = [];
    const rs = [];
    for (const it of items) {
      if (it.cover && cs.length < CARD_COUNT) cs.push(it);
      else rs.push(it);
    }
    return { cards: cs, rows: rs };
  }, [items]);

  const visibleRows = expanded ? rows : rows.slice(0, ROW_BATCH);
  const hiddenCount = rows.length - visibleRows.length;
  const isFocus = section?.col_id === 'focus' || section?.special === 'focus';

  return (
    <section id={`dailycol-${section?.col_id || section?.column}`} className="cv-auto scroll-mt-24">
      {/* 栏头：accent 竖条 + 栏名 + 条数徽章 + 折叠 chevron */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 text-left group"
        aria-expanded={!collapsed}
      >
        <span
          className="flex-none w-[3px] h-5 rounded-full"
          style={{ background: isFocus ? 'var(--green)' : 'var(--accent)' }}
        />
        <h2 className="serif text-lg sm:text-xl font-bold t-text flex-none">{section?.column}</h2>
        <span className="flex-none text-[11px] t-muted tabular-nums">{rawItems.length} 条</span>
        <span className="flex-1 border-t hairline" />
        {section?.desc && (
          <span className="hidden md:block text-[11px] t-muted text-right leading-relaxed max-w-[40%] truncate">
            {section.desc}
          </span>
        )}
        <span
          className="flex-none icon-btn !w-6 !h-6 text-xs transition-transform"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'none' }}
        >
          ▾
        </span>
      </button>

      {collapsed ? null : rawItems.length === 0 ? (
        <div className="mt-4 card px-4 py-8 text-center text-xs t-muted">这一栏暂时没有命中内容</div>
      ) : (
        <>
          {cards.length > 0 && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {cards.map((item, i) => (
                <DailyCard
                  key={`${item.kind}-${item.ref_id}-${i}`}
                  item={item}
                  keywords={keywords}
                  highlight={highlight}
                  onOpen={onOpen}
                />
              ))}
            </div>
          )}
          {rows.length > 0 && (
            <div className={cards.length ? 'mt-3' : 'mt-4'}>
              <div className="card card-lift divide-y" style={{ '--tw-divide-opacity': 1 }}>
                {visibleRows.map((item, i) => (
                  <CompactRow
                    key={`${item.kind}-${item.ref_id}-r${i}`}
                    item={item}
                    index={i}
                    keywords={keywords}
                    highlight={highlight}
                    onOpen={onOpen}
                  />
                ))}
              </div>
              {hiddenCount > 0 && (
                <button type="button" className="btn-ghost mt-3 w-full" onClick={() => setExpanded(true)}>
                  展开剩余 {hiddenCount} 条
                </button>
              )}
              {expanded && rows.length > ROW_BATCH && (
                <button type="button" className="btn-ghost mt-3 w-full" onClick={() => setExpanded(false)}>
                  收起
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function DailyCard({ item, keywords, highlight, onOpen }) {
  return (
    <article
      className="card card-lift overflow-hidden cursor-pointer"
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
      <div className="p-3 sm:p-4">
        <div className="flex items-start gap-2">
          <h3 className="flex-1 min-w-0 mt-1 text-[15px] font-bold leading-snug t-text line-clamp-2">
            {highlightTitle(item.title, keywords, highlight)}
          </h3>
          {/* 2026-09-05 视觉精修：右上星级评分（无 score 字段时 Stars 不渲染） */}
          <Stars score={item.score} size={12} className="flex-none mt-1.5" />
        </div>
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
        {/* 2026-09-05 视觉精修：标签胶囊行（最多 3 个，无 tags 字段时不渲染） */}
        <TagPills tags={item.tags} max={3} className="mt-2.5" />
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

// 紧凑列表行：序号 + 标题(高亮) + 信源徽章 + 来源·时间 + 小缩略图(移动端隐藏)
function CompactRow({ item, index, keywords, highlight, onOpen }) {
  return (
    <div
      className="flex items-center gap-3 px-3 sm:px-4 py-2.5 cursor-pointer transition-colors hover:bg-[var(--surface-2)]"
      onClick={() => onOpen?.(item)}
      style={{ borderColor: 'var(--border)' }}
    >
      <span className="flex-none w-5 text-right text-[11px] t-muted tabular-nums">{index + 1}</span>
      <span className="flex-1 min-w-0 truncate text-[13px] t-text">
        {highlightTitle(item.title, keywords, highlight)}
      </span>
      {/* 2026-09-05 视觉精修：星级评分 + 标签胶囊（窄屏隐藏，无字段时不渲染） */}
      <Stars score={item.score} size={11} showNum={false} className="flex-none hidden sm:inline-flex" />
      <TagPills tags={item.tags} max={3} className="flex-none hidden lg:flex flex-nowrap" />
      {Array.isArray(item.related) && item.related.length > 0 && (
        <span
          className="flex-none badge-green"
          title={`同主题信源：${item.related.map((r) => r.source_name || '').filter(Boolean).join('、')}`}
        >
          {item.related.length + 1} 源
        </span>
      )}
      <span className="flex-none text-[11px] t-muted whitespace-nowrap hidden sm:inline">
        {item.source_name || ''}
        {item.source_name ? ' · ' : ''}
        {relativeTime(item.published_at)}
      </span>
      {item.cover ? (
        <img
          referrerPolicy="no-referrer"
          src={imgUrl(item.cover)}
          alt=""
          loading="lazy"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          className="flex-none hidden sm:block w-14 h-9 object-cover rounded-md"
        />
      ) : null}
    </div>
  );
}
