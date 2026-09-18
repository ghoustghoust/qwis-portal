// 精选周刊页（/weekly/，20-weekly-picks）：本周必看 20 条，圈内必看（无破圈）
// 刊头（第N期+日期范围+导语）+ 类别分组（行业大变化/重大影响/教学课程/新理解/其它）+ 归档切换
// T5-6（2026-09-15）：最左期号侧栏索引 + 右侧本期文章索引（anchor 跳转）；spec 32：综述/导语 markdown 渲染
import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { IconRail } from '../main.jsx';
import { imgUrl, relativeTime } from '../util';
import Stars from '../components/ui/Stars.jsx';
import TagPills from '../components/ui/TagPills.jsx';
import MdText from '../components/ui/MdText.jsx';
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
  const [err, setErr] = useState(null);
  const [issue, setIssue] = useState(0); // 0=最新
  const [studyItem, setStudyItem] = useState(null);

  const load = () => {
    setErr(null);
    setData(undefined);
    const url = issue > 0 ? `/api/weekly?issue=${issue}` : '/api/weekly';
    // 2026-09-18：原先 .catch(()=>setData(null)) 让任何接口失败都渲染成完全空白页
    // （刊头/分组/归档全落空），"周报没有文章"因此在数据故障与渲染故障之间无法区分。
    api.get(url).then(setData).catch((e) => setErr(String(e?.message || e)));
  };
  useEffect(() => { load(); }, [issue]);

  const report = data?.report;
  const archive = data?.archive || [];

  // 主线策展覆盖率：AI 只是被"要求"尽量覆盖（api/_ai.js:410），而越界编号、不足 2 条的主线
  // 会被丢弃且从不回填 → 刊头写「本周必看 20 条」页面却只有被选中的那些，其余静默消失。
  // 这里把没被任何主线覆盖的条目补成一节，保证"一条不丢"。
  const coveredIds = new Set((report?.storylines || []).flatMap((sl) => (sl.items || []).map((it) => it.id)));
  const uncovered = (report?.items || []).filter((it) => !coveredIds.has(it.id));

  // T5-6：本期文章索引（主线版按主线分组列条目；旧版按主题列）——anchor 用 rank
  const indexGroups = [];
  if (report) {
    if (report.storylines?.length) {
      for (const sl of report.storylines) {
        indexGroups.push({ title: sl.title, items: sl.items.map((it) => ({ rank: it.rank, title: it.title })) });
      }
      if (uncovered.length) indexGroups.push({ title: '其它精选', items: uncovered.map((it) => ({ rank: it.rank, title: it.title })) });
    } else {
      for (const theme of THEME_ORDER) {
        const list = (report.items || []).filter((it) => it.weeklyTheme === theme);
        if (list.length) indexGroups.push({ title: theme, items: list.map((it) => ({ rank: it.rank, title: it.title })) });
      }
    }
  }

  return (
    <div className="flex h-full">
      <IconRail />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10 lg:flex lg:gap-8">
          {/* T5-6 左栏：期号索引（sticky；移动端用刊头下方 pills） */}
          {archive.length > 0 && (
            <aside className="hidden lg:block w-24 flex-none">
              <div className="sticky top-8">
                <div className="text-[11px] tracking-widest t-muted font-medium mb-2">期号</div>
                <div className="space-y-1">
                  <button
                    className={`block w-full text-left pill !text-[11px] cursor-pointer ${issue === 0 ? 'on' : ''}`}
                    onClick={() => setIssue(0)}
                  >
                    最新
                  </button>
                  {[...archive].reverse().map((a) => (
                    <button
                      key={a.issue}
                      className={`block w-full text-left pill !text-[11px] cursor-pointer ${issue === a.issue ? 'on' : ''}`}
                      title={`${a.dateStart} ~ ${a.dateEnd}${a.theme ? '｜' + a.theme : ''}`}
                      onClick={() => setIssue(a.issue)}
                    >
                      第 {a.issue} 期
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          )}
          <div className="flex-1 min-w-0 max-w-3xl">
          {err && (
            <div className="card px-6 py-16 text-center">
              <DocIcon className="mx-auto t-accent" />
              <div className="serif mt-4 text-xl font-bold t-text">精选周刊加载失败</div>
              <p className="mt-3 text-[13px] t-muted break-all">{err}</p>
              <button type="button" className="btn-primary mt-6" onClick={load}>重试</button>
            </div>
          )}
          {data === undefined && !err && <div className="py-20 text-center text-sm t-muted">加载中…</div>}

          {data?.empty === 'no-content' && (
            <div className="card px-6 py-16 text-center">
              <DocIcon className="mx-auto t-accent" />
              <div className="serif mt-4 text-xl font-bold t-text">首期精选周刊将在周五 18:00 生成</div>
              <p className="mt-3 text-[13px] t-muted">AI 每周从全周内容里精选 20 条圈内必看</p>
            </div>
          )}

          {report && (
            <>
              {/* 封面头（specs/24 杂志版：有 coverTheme 用大字主题，否则回退期号） */}
              <header>
                <div className="text-[11px] tracking-widest t-accent font-medium">精选周刊 · 本周必看 {report.items?.length || 0} 条</div>
                <h1 className="serif mt-2 text-3xl sm:text-5xl font-bold t-text">
                  {report.coverTheme ? `第 ${report.issue} 期——${report.coverTheme}` : `第 ${report.issue} 期`}
                </h1>
                <div className="mt-1 text-[13px] t-muted">
                  {report.coverTheme ? `本周必看 ${report.items?.length || 0} 条 · ` : ''}{report.dateStart} ~ {report.dateEnd}
                </div>
                {report.theme && (
                  <p className="serif mt-3 text-base sm:text-xl italic leading-relaxed t-muted"><MdText text={report.theme} /></p>
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

              {/* 编辑长综述（specs/24；spec 32：markdown 渲染，段落结构保留） */}
              {report.editorNote && (
                <section className="mt-8 card p-5 sm:p-6">
                  <div className="text-[11px] tracking-widest t-accent font-medium">编辑综述</div>
                  <p className="serif mt-3 text-[15px] sm:text-base leading-loose t-text whitespace-pre-line"><MdText text={report.editorNote} /></p>
                </section>
              )}

              {/* 主线策展（specs/24 杂志版） */}
              {(report.storylines || []).map((sl, i) => (
                <section key={sl.title} className="mt-8">
                  <div className="flex items-baseline gap-3">
                    <span className="serif flex-none text-2xl t-accent font-bold">{i + 1}</span>
                    <h2 className="serif text-lg sm:text-2xl font-bold t-text flex-1 min-w-0">{sl.title}</h2>
                    <span className="flex-none text-[11px] t-muted tabular-nums">{sl.items.length} 条</span>
                  </div>
                  {sl.narrative && <p className="mt-2 text-[13.5px] leading-relaxed t-muted"><MdText text={sl.narrative} /></p>}
                  <div className="mt-4 flex flex-col gap-4">
                    {sl.items.map((it) => (
                      <WeeklyCard key={it.id} item={it} onOpen={setStudyItem} />
                    ))}
                  </div>
                </section>
              ))}

              {/* 主线未覆盖到的条目补一节——刊头是 items.length，正文必须一条不丢 */}
              {!!report.storylines?.length && uncovered.length > 0 && (
                <section className="mt-8">
                  <div className="flex items-center gap-3">
                    <span className="flex-none w-[3px] h-5 rounded-full" style={{ background: THEME_COLOR['其它'] }} />
                    <h2 className="serif text-lg sm:text-xl font-bold t-text">其它精选</h2>
                    <span className="text-[11px] t-muted tabular-nums">{uncovered.length} 条</span>
                    <span className="flex-1 border-t hairline" />
                  </div>
                  <div className="mt-4 flex flex-col gap-4">
                    {uncovered.map((it) => (
                      <WeeklyCard key={it.id} item={it} onOpen={setStudyItem} />
                    ))}
                  </div>
                </section>
              )}

              {/* 旧版分主题视图（无杂志结构的期号兼容） */}
              {!report.storylines?.length && THEME_ORDER.map((theme) => {
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

              {/* 降级模式兜底：items 无 weeklyTheme 时直接按 rank 顺序全部渲染 */}
              {!report.storylines?.length && !(report.items || []).some((it) => it.weeklyTheme) && (report.items || []).length > 0 && (
                <section className="mt-8">
                  <div className="flex items-center gap-3">
                    <span className="flex-none w-[3px] h-5 rounded-full" style={{ background: THEME_COLOR['其它'] }} />
                    <h2 className="serif text-lg sm:text-xl font-bold t-text">精选内容</h2>
                    <span className="text-[11px] t-muted tabular-nums">{report.items.length} 条</span>
                    <span className="flex-1 border-t hairline" />
                  </div>
                  <div className="mt-4 flex flex-col gap-4">
                    {report.items.map((it) => (
                      <WeeklyCard key={it.id} item={it} onOpen={setStudyItem} />
                    ))}
                  </div>
                </section>
              )}

              {/* 周报 AI 总结注脚（T3-1 R8） */}
              {report.weeklySummary && (
                <footer className="mt-10 card p-4 sm:p-5">
                  <div className="text-[11px] tracking-widest t-accent font-medium">本周总结</div>
                  <p className="mt-2 text-[13.5px] leading-relaxed t-text"><MdText text={report.weeklySummary} /></p>
                </footer>
              )}
            </>
          )}
          <div className="h-16" />
          </div>

          {/* T5-6 右栏：本期文章索引（anchor 跳转，手动选条） */}
          {report && indexGroups.length > 0 && (
            <aside className="hidden xl:block w-56 flex-none">
              <div className="sticky top-8 max-h-[85vh] overflow-y-auto pr-1">
                <div className="text-[11px] tracking-widest t-muted font-medium mb-2">本期索引</div>
                {indexGroups.map((g) => (
                  <div key={g.title} className="mb-3">
                    <div className="text-[11px] t-accent font-medium truncate" title={g.title}>{g.title}</div>
                    <div className="mt-1 space-y-0.5">
                      {g.items.map((it) => (
                        <a
                          key={it.rank}
                          href={`#wc-${it.rank}`}
                          className="block text-[11px] leading-snug t-muted hover:t-accent truncate no-underline"
                          title={it.title}
                          onClick={(e) => {
                            e.preventDefault();
                            document.getElementById(`wc-${it.rank}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }}
                        >
                          <span className="tabular-nums t-accent">{it.rank}.</span> {it.title}
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          )}
        </div>
      </main>
      {studyItem && <QuickStudyModal item={studyItem} onClose={() => setStudyItem(null)} />}
    </div>
  );
}

function WeeklyCard({ item, onOpen }) {
  return (
    <article id={`wc-${item.rank}`} className="card card-lift overflow-hidden cursor-pointer scroll-mt-24" onClick={() => onOpen?.(item)}>
      <div className="flex gap-4 p-3 sm:p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex-none text-[10px] font-bold px-1.5 py-0.5 rounded t-accent-soft t-accent">
              #{item.rank}
            </span>
            {/* 降级/裸产物没有 weeklyTheme，原先无条件渲染会在每条上挂一个空绿胶囊 */}
            {item.weeklyTheme && (
              <span className="flex-none text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--green) 12%, transparent)', color: 'var(--green)' }}>
                {item.weeklyTheme}
              </span>
            )}
            <span className="text-[11px] t-muted truncate">{item.source}</span>
            {item.totalScore != null && <Stars score={item.totalScore} size={11} className="flex-none ml-auto" />}
          </div>
          <h3 className="mt-2 text-[15px] font-bold leading-snug t-text line-clamp-2">{item.title}</h3>
          {item.summary && <p className="mt-2 text-[13px] leading-relaxed t-muted line-clamp-4"><MdText text={item.summary} /></p>}
          {item.reason && <p className="mt-2 text-[12px] leading-relaxed t-accent">必看：<MdText text={item.reason} /></p>}
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
