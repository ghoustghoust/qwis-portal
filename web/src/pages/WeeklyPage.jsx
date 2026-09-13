// 精选周刊页（/weekly/，20-weekly-picks）：本周必看 20 条，圈内必看（无破圈）
// 刊头（第N期+日期范围+导语）+ 类别分组（行业大变化/重大影响/教学课程/新理解/其它）+ 归档切换
import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { IconRail } from '../main.jsx';
import { imgUrl, relativeTime } from '../util';
import Stars from '../components/ui/Stars.jsx';
import TagPills from '../components/ui/TagPills.jsx';
import QuickStudyModal from '../components/QuickStudyModal.jsx';
import { DocIcon } from '../components/icons.jsx';

const THEME_ORDER = ['行业大变化', '重大影响', '教学课程', '新理解', '其它'];
const THEME_COLOR = {
  行业大变化: 'var(--accent)',
  重大影响: '#d64545',
  教学课程: 'var(--green)',
  新理解: '#7c5cd6',
  其它: 'var(--muted, #888)',
};

export default function WeeklyPage() {
  const [data, setData] = useState(undefined);
  const [issue, setIssue] = useState(0); // 0=最新
  const [studyItem, setStudyItem] = useState(null);

  useEffect(() => {
    const url = issue > 0 ? `/api/weekly?issue=${issue}` : '/api/weekly';
    api.get(url).then(setData).catch(() => setData(null));
  }, [issue]);

  const report = data?.report;
  const archive = data?.archive || [];

  return (
    <div className="flex h-full">
      <IconRail />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-10">
          {data === undefined && <div className="py-20 text-center text-sm t-muted">加载中…</div>}

          {data?.empty === 'no-content' && (
            <div className="card px-6 py-16 text-center">
              <DocIcon className="mx-auto t-accent" />
              <div className="serif mt-4 text-xl font-bold t-text">首期精选周刊将在周五 18:00 生成</div>
              <p className="mt-3 text-[13px] t-muted">AI 每周从全周内容里精选 20 条圈内必看</p>
            </div>
          )}

          {report && (
            <>
              <header>
                <div className="text-[11px] tracking-widest t-accent font-medium">精选周刊 · 本周必看 {report.items?.length || 0} 条</div>
                <h1 className="serif mt-2 text-3xl sm:text-5xl font-bold t-text">第 {report.issue} 期</h1>
                <div className="mt-1 text-[13px] t-muted">{report.dateStart} ~ {report.dateEnd}</div>
                {report.theme && (
                  <p className="serif mt-3 text-base sm:text-xl italic leading-relaxed t-muted">{report.theme}</p>
                )}
                {report.degraded && <div className="mt-2 text-[11px] t-muted">（本期为降级版：AI 不可用，按热度排序产出）</div>}
                {archive.length > 1 && issue === 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    <span className="pill on !cursor-default">第 {report.issue} 期</span>
                    {archive.slice(0, -1).reverse().map((a) => (
                      <button key={a.issue} className="pill cursor-pointer" onClick={() => setIssue(a.issue)}>
                        第 {a.issue} 期
                      </button>
                    ))}
                  </div>
                )}
                {issue > 0 && (
                  <button className="pill cursor-pointer mt-4" onClick={() => setIssue(0)}>← 返回最新一期</button>
                )}
              </header>

              <div className="mt-6 border-t-2" style={{ borderColor: 'var(--text)' }} />

              {THEME_ORDER.map((theme) => {
                const list = (report.items || []).filter((it) => it.weeklyTheme === theme);
                if (!list.length) return null;
                return (
                  <section key={theme} className="mt-8">
                    <div className="flex items-center gap-3">
                      <span className="flex-none w-[3px] h-5 rounded-full" style={{ background: THEME_COLOR[theme] }} />
                      <h2 className="serif text-lg sm:text-xl font-bold t-text">{theme}</h2>
                      <span className="text-[11px] t-muted tabular-nums">{list.length} 条</span>
                      <span className="flex-1 border-t hairline" />
                    </div>
                    <div className="mt-4 flex flex-col gap-4">
                      {list.map((it) => (
                        <WeeklyCard key={it.id} item={it} onOpen={setStudyItem} />
                      ))}
                    </div>
                  </section>
                );
              })}

              {/* 周报 AI 总结注脚（T3-1 R8） */}
              {report.weeklySummary && (
                <footer className="mt-10 card p-4 sm:p-5">
                  <div className="text-[11px] tracking-widest t-accent font-medium">本周总结</div>
                  <p className="mt-2 text-[13.5px] leading-relaxed t-text">{report.weeklySummary}</p>
                </footer>
              )}
            </>
          )}
          <div className="h-16" />
        </div>
      </main>
      {studyItem && <QuickStudyModal item={studyItem} onClose={() => setStudyItem(null)} />}
    </div>
  );
}

function WeeklyCard({ item, onOpen }) {
  return (
    <article className="card card-lift overflow-hidden cursor-pointer" onClick={() => onOpen?.(item)}>
      <div className="flex gap-4 p-3 sm:p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex-none text-[10px] font-bold px-1.5 py-0.5 rounded t-accent-soft t-accent">
              #{item.rank}
            </span>
            <span className="flex-none text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--green) 12%, transparent)', color: 'var(--green)' }}>
              {item.weeklyTheme}
            </span>
            <span className="text-[11px] t-muted truncate">{item.source}</span>
            {item.totalScore != null && <Stars score={item.totalScore} size={11} className="flex-none ml-auto" />}
          </div>
          <h3 className="mt-2 text-[15px] font-bold leading-snug t-text line-clamp-2">{item.title}</h3>
          {item.summary && <p className="mt-2 text-[13px] leading-relaxed t-muted line-clamp-4">{item.summary}</p>}
          {item.reason && <p className="mt-2 text-[12px] leading-relaxed t-accent">必看：{item.reason}</p>}
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
