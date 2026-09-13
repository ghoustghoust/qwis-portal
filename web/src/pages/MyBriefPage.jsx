// 我的早报页（/mybrief/，19-my-brief）：订阅源专属 AI 策展
// UI 按用户样图：大日期 + 编辑导语 + 关键词标签行 + 头条推荐3/精选内容7/补充阅读N 分层
// 三态：no-subscription（引导标记）/ no-content（今日无更新）/ 正常
import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { IconRail } from '../main.jsx';
import { imgUrl, relativeTime } from '../util';
import Stars from '../components/ui/Stars.jsx';
import TagPills from '../components/ui/TagPills.jsx';
import QuickStudyModal from '../components/QuickStudyModal.jsx';
import { SunIcon } from '../components/icons.jsx';

const TYPES = [
  { key: 'all', label: '全部' },
  { key: 'article', label: '文章' },
  { key: 'video', label: '视频' },
  { key: 'podcast', label: '播客', disabled: true },
  { key: 'tweet', label: '推文', disabled: true },
];

export default function MyBriefPage() {
  const [data, setData] = useState(undefined);
  const [type, setType] = useState('all');
  const [studyItem, setStudyItem] = useState(null);

  useEffect(() => {
    api.get('/api/mybrief').then(setData).catch(() => setData(null));
  }, []);

  const report = data?.report;
  const empty = data?.empty || report?.empty;

  return (
    <div className="flex h-full">
      <IconRail />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-10">
          {/* 引导态：无订阅 */}
          {empty === 'no-subscription' && (
            <div className="card px-6 py-16 text-center">
              <SunIcon className="mx-auto t-accent" />
              <div className="serif mt-4 text-xl font-bold t-text">我的早报需要你的订阅</div>
              <p className="mt-3 text-[13px] t-muted leading-relaxed">
                去管理后台「源库」把你关心的源标记为特别关注（focus），
                <br />我的早报将每天只为你策展这些源的内容。
              </p>
              <a href="/admin/" className="btn-primary mt-6 inline-block" style={{ background: 'var(--green)' }}>
                去标记订阅
              </a>
            </div>
          )}

          {/* 空态：今日无更新 */}
          {empty === 'no-content' && (
            <div className="card px-6 py-16 text-center">
              <div className="serif text-xl font-bold t-text">今天订阅源没有新的精选内容</div>
              <p className="mt-3 text-[13px] t-muted">可以去看看每日早报（含全部源与破圈内容）</p>
            </div>
          )}

          {data === undefined && <div className="py-20 text-center text-sm t-muted">加载中…</div>}

          {/* 正常态 */}
          {report && !empty && (
            <>
              {/* 大日期 + 编辑导语 */}
              <header>
                <div className="text-[11px] tracking-widest t-accent font-medium">我的早报 · 来自你的关注</div>
                <h1 className="serif mt-2 text-3xl sm:text-5xl font-bold t-text">
                  {Number(report.date.slice(5, 7))}月{Number(report.date.slice(8, 10))}日
                </h1>
                {report.theme && (
                  <p className="serif mt-3 text-base sm:text-xl italic leading-relaxed t-muted">
                    今日聚焦：{report.theme}
                  </p>
                )}
                {Array.isArray(report.keywords) && report.keywords.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {report.keywords.map((k) => (
                      <span key={k} className="pill on !cursor-default text-[11px]">{k}</span>
                    ))}
                  </div>
                )}
              </header>

              {/* 类型筛选 */}
              <div className="mt-6 flex gap-1.5 border-t-2 pt-4" style={{ borderColor: 'var(--text)' }}>
                {TYPES.map((tp) => (
                  <button
                    key={tp.key}
                    disabled={tp.disabled}
                    className={`pill ${type === tp.key ? 'on' : ''} ${tp.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                    onClick={() => !tp.disabled && setType(tp.key)}
                    title={tp.disabled ? '该类型源即将上线' : ''}
                  >
                    {tp.label}
                  </button>
                ))}
              </div>

              <BriefSection title="头条推荐" items={report.sections?.top} kind="top" type={type} onOpen={setStudyItem} />
              <BriefSection title="精选内容" items={report.sections?.featured} kind="featured" type={type} onOpen={setStudyItem} />
              <BriefSection title="补充阅读" items={report.sections?.rest} kind="rest" type={type} onOpen={setStudyItem} />
            </>
          )}
          <div className="h-16" />
        </div>
      </main>
      {studyItem && <QuickStudyModal item={studyItem} onClose={() => setStudyItem(null)} />}
    </div>
  );
}

function BriefSection({ title, items, kind, type, onOpen }) {
  const list = (items || []).filter((it) => type === 'all' || (type === 'article' && it.kind !== 'video') || (type === 'video' && it.kind === 'video'));
  if (!list.length) return null;
  return (
    <section className="mt-8">
      <div className="flex items-center gap-3">
        <span className="flex-none w-[3px] h-5 rounded-full" style={{ background: 'var(--green)' }} />
        <h2 className="serif text-lg sm:text-xl font-bold t-text">{title}</h2>
        <span className="text-[11px] t-muted tabular-nums">{list.length} 条</span>
        <span className="flex-1 border-t hairline" />
      </div>
      <div className="mt-4 flex flex-col gap-4">
        {list.map((it, i) => kind === 'rest'
          ? <RestRow key={it.id} item={it} index={i} onOpen={onOpen} />
          : <BriefCard key={it.id} item={it} rank={kind === 'top' ? i + 1 : null} onOpen={onOpen} />)}
      </div>
    </section>
  );
}

function BriefCard({ item, rank, onOpen }) {
  return (
    <article className="card card-lift overflow-hidden cursor-pointer" onClick={() => onOpen?.(item)}>
      <div className="flex gap-4 p-3 sm:p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {rank && (
              <span className="flex-none text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--green)', color: '#fff' }}>
                TOP {rank}
              </span>
            )}
            <span className="badge-green flex-none">来自你的关注</span>
            <span className="text-[11px] t-muted truncate">{item.source}</span>
            <Stars score={item.totalScore} size={11} className="flex-none ml-auto" />
          </div>
          <h3 className="mt-2 text-[15px] font-bold leading-snug t-text line-clamp-2">{item.title}</h3>
          {item.summary && <p className="mt-2 text-[13px] leading-relaxed t-muted line-clamp-4">{item.summary}</p>}
          {Array.isArray(item.points) && item.points.length > 0 && (
            <ul className="mt-2 space-y-1">
              {item.points.map((p, i) => (
                <li key={i} className="text-[12px] leading-relaxed t-text flex gap-1.5">
                  <span className="t-accent flex-none">·</span><span>{p}</span>
                </li>
              ))}
            </ul>
          )}
          {item.quote && (
            <blockquote className="mt-2 pl-3 border-l-2 text-[12px] italic leading-relaxed t-muted" style={{ borderColor: 'var(--accent)' }}>
              {item.quote}
            </blockquote>
          )}
          <div className="mt-2.5 flex items-center gap-2">
            <TagPills tags={item.tags} max={4} />
            <span className="ml-auto text-[11px] t-muted flex-none">{relativeTime(item.published_at)}</span>
          </div>
        </div>
        {item.cover && (
          <img
            referrerPolicy="no-referrer" src={imgUrl(item.cover)} alt="" loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
            className="flex-none hidden sm:block w-36 h-24 object-cover rounded-lg"
          />
        )}
      </div>
    </article>
  );
}

function RestRow({ item, index, onOpen }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 card cursor-pointer hover:bg-[var(--surface-2)]" onClick={() => onOpen?.(item)}>
      <span className="flex-none w-5 text-right text-[11px] t-muted tabular-nums">{index + 4}</span>
      <span className="flex-1 min-w-0 truncate text-[13px] t-text">{item.title}</span>
      {item.explore && <span className="flex-none pill !py-0 !px-1.5 !text-[10px] t-accent-soft t-accent" title="探索：来自你未订阅源的高分内容（破茧）">探索</span>}
      {item.reason && <span className="flex-none hidden md:inline text-[10px] t-accent max-w-[30%] truncate">{item.reason}</span>}
      <span className="flex-none text-[11px] t-muted whitespace-nowrap">{item.source}</span>
    </div>
  );
}
