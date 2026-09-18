// 我的早报页（/mybrief/，19-my-brief）：订阅源专属 AI 策展
// UI 按用户样图：大日期 + 编辑导语 + 关键词标签行 + 头条推荐3/精选内容7/补充阅读N 分层
// 三态：no-subscription（引导标记）/ no-content（今日无更新）/ 正常
import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { IconRail } from '../main.jsx';
import { imgUrl, relativeTime } from '../util';
import Stars from '../components/ui/Stars.jsx';
import TagPills from '../components/ui/TagPills.jsx';
import MdText from '../components/ui/MdText.jsx';
import QuickStudyModal from '../components/QuickStudyModal.jsx';
import ThemePanorama from '../components/ThemePanorama.jsx';
import SourceAvatar from '../components/ui/SourceAvatar.jsx';
import { SunIcon } from '../components/icons.jsx';
import { SkeletonCards } from '../components/Skeleton.jsx';

const TYPES = [
  { key: 'all', label: '全部' },
  { key: 'article', label: '文章' },
  { key: 'video', label: '视频' },
  { key: 'podcast', label: '播客', disabled: true },
  { key: 'tweet', label: '推文', disabled: true },
];

export default function MyBriefPage() {
  const [data, setData] = useState(undefined);
  const [err, setErr] = useState(null);
  const [type, setType] = useState('all');
  const [studyItem, setStudyItem] = useState(null);

  const load = () => {
    setErr(null);
    setData(undefined);
    // 2026-09-18：原先 .catch(()=>setData(null)) 把任何接口失败（401/500/504）都变成 data=null，
    // 而下方所有分支都以 data 存在为前提 → 整页一个字都不剩，用户与排障者都无从判断是"没内容"还是"挂了"。
    api.get('/api/mybrief').then(setData).catch((e) => setErr(String(e?.message || e)));
  };

  useEffect(() => { load(); }, []);

  const report = data?.report;
  const digest = data?.digest;
  const empty = data?.empty || report?.empty;

  return (
    <div className="flex h-full">
      <IconRail />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-10">
          {err && (
            <div className="card px-6 py-16 text-center">
              <SunIcon className="mx-auto t-accent" />
              <div className="serif mt-4 text-xl font-bold t-text">我的早报加载失败</div>
              <p className="mt-3 text-[13px] t-muted break-all">{err}</p>
              <button type="button" className="btn-primary mt-6" onClick={load}>重试</button>
            </div>
          )}

          {/* 引导态：无订阅 */}
          {empty === 'no-subscription' && (
            <div className="card px-6 py-16 text-center">
              <SunIcon className="mx-auto t-accent" />
              <div className="serif mt-4 text-xl font-bold t-text">我的早报需要你的订阅</div>
              <p className="mt-3 text-[13px] t-muted leading-relaxed">
                去管理后台「源库」把你关心的源加入订阅（27b 四轴之订阅轴，独立于重点标记），
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

          {data === undefined && !err && <div className="space-y-4"><SkeletonCards n={3} /></div>}

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
                    今日聚焦：<MdText text={report.theme} />
                  </p>
                )}
                {report.degraded && (
                  <div className="mt-2 text-[11px] t-muted">（今日为降级版：AI 不可用，已回退关键词策展）</div>
                )}
                {Array.isArray(report.keywords) && report.keywords.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {report.keywords.map((k) => (
                      <span key={k} className="pill on !cursor-default text-[11px]">{k}</span>
                    ))}
                  </div>
                )}
              </header>
              <ThemePanorama themes={report.themes} />

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
              {/* 2026-09-14：视频与播客栏（窗口内新媒体，点开即可播放/收听） */}
              <BriefSection title="视频与播客" items={report.sections?.media} kind="rest" type={type} onOpen={setStudyItem} />
              <BriefSection title="补充阅读" items={report.sections?.rest} kind="rest" type={type} onOpen={setStudyItem} />
            </>
          )}

          {/* T3-1 R7：阅读足迹小结（晚间批生成；读不到不给键） */}
          {digest && (
            <section className="mt-8 card p-4 sm:p-5">
              <div className="text-[11px] tracking-widest t-accent font-medium">阅读足迹 · {digest.date}</div>
              <div className="mt-2 text-[13px] t-text">
                过去 24 小时读了 <b className="t-accent">{digest.readCount}</b> 篇 · 稍后读 {digest.laterCount} 条
              </div>
              {digest.topSources?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                  {digest.topSources.map((src) => (
                    <span key={src.name} className="flex items-center gap-1.5 text-[12px] t-muted">
                      <SourceAvatar name={src.name} avatar={src.avatar} size={16} />
                      {src.name} · {src.count}
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}

          <div className="h-16" />
        </div>
      </main>
      {studyItem && <QuickStudyModal item={studyItem} onClose={() => setStudyItem(null)} />}
    </div>
  );
}

function BriefSection({ title, items, kind, type, onOpen }) {
  const list = (items || []).filter((it) => type === 'all' || (type === 'article' && it.kind !== 'video' && it.kind !== 'podcast') || (type === 'video' && (it.kind === 'video' || it.kind === 'podcast')));
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
    <article className="card card-lift overflow-hidden cursor-pointer" onClick={() => { if (item.kind === 'video') { window.open(item.url, '_blank', 'noopener'); return; } onOpen?.(item); }}>
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
          {item.original_title && (
            <div className="mt-0.5 text-[11px] t-muted leading-snug truncate" title={item.original_title}>
              {item.original_title}
            </div>
          )}
          {item.summary && <p className="mt-2 text-[13px] leading-relaxed t-muted line-clamp-4 whitespace-pre-line"><MdText text={item.summary} /></p>}
          {item.reason && (
            <p className="mt-2 text-[12px] leading-relaxed t-accent">推荐：<MdText text={item.reason} /></p>
          )}
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
              <MdText text={item.quote} />
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
    <div className="flex items-center gap-3 px-3 py-2 card cursor-pointer hover:bg-[var(--surface-2)]" onClick={() => { if (item.kind === 'video') { window.open(item.url, '_blank', 'noopener'); return; } onOpen?.(item); }}>
      <span className="flex-none w-5 text-right text-[11px] t-muted tabular-nums">{index + 4}</span>
      <span className="flex-1 min-w-0">
        <span className="block truncate text-[13px] t-text">{item.title}</span>
        {item.original_title && (
          <span className="block truncate text-[11px] t-muted mt-0.5" title={item.original_title}>{item.original_title}</span>
        )}
      </span>
      {item.explore && <span className="flex-none pill !py-0 !px-1.5 !text-[10px] t-accent-soft t-accent" title="探索：来自你未订阅源的高分内容（破茧）">探索</span>}
      {item.reason && <span className="flex-none hidden md:inline text-[10px] t-accent max-w-[30%] truncate" title={item.reason}>{item.reason}</span>}
      <span className="flex-none text-[11px] t-muted whitespace-nowrap">{item.source}</span>
    </div>
  );
}
