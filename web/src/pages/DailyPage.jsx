import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconRail } from '../main.jsx';
import { api } from '../api';
import { toast } from '../toast';
import DailyHeader from '../components/DailyHeader.jsx';
import StatCards from '../components/StatCards.jsx';
import ColumnSection from '../components/ColumnSection.jsx';
import IssueIndex from '../components/IssueIndex.jsx';
import ThemePanorama from '../components/ThemePanorama.jsx';
import QuickStudyModal from '../components/QuickStudyModal.jsx';
import MdText from '../components/ui/MdText.jsx';
import MdRich from '../components/ui/MdRich.jsx';

// 每日情报日报页（/daily/，F13~F20）：报纸风页头 + 统计卡 + 栏目 + 快速学习弹窗
// 设置入口已下线（第二期迁入管理后台），日报设置仅剩管理后台可改
// 2026-09-05b 改版：工具条（栏目导航/全部折叠/排序/关键词高亮）+ 偏好 localStorage 持久化

const LS = {
  collapsed: 'qwis.daily.collapsed', // { [col_id]: true }
  sort: 'qwis.daily.sort', // default | time | heat
  hl: 'qwis.daily.hl', // '0' 关闭，其余开启
};

function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function lsSet(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* 隐私模式静默降级 */
  }
}

export default function DailyPage() {
  const [report, setReport] = useState(undefined); // undefined=加载中，null=尚未生成
  const [dateParam, setDateParam] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('date');
    return /^\d{4}-\d{2}-\d{2}$/.test(q || '') ? q : null;
  });
  // 往期日期列表（A：近 30 天有日报的北京日）——用户 10-07：侧栏升级为"每期索引"，
  // 对齐周刊：pill 除日期外带当期导语短词（数据源 /api/brief/history 的 daily[].theme，已随接口返回）
  const [dailyArchive, setDailyArchive] = useState([]); // [{ date, theme }]
  const [dailySettings, setDailySettings] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [autoGen, setAutoGen] = useState(false); // T13/F3：stale 打开即补的「正在生成」态
  const [notice, setNotice] = useState(''); // 生成后顶部提示条（F19）
  const [studyItem, setStudyItem] = useState(null);
  const autoGenRef = useRef(false); // 每次 mount 只自动补一次

  // 交互偏好（持久化）
  const [collapsed, setCollapsed] = useState(() => lsGet(LS.collapsed, {}));
  const [sort, setSort] = useState(() => lsGet(LS.sort, 'default'));
  const [hl, setHl] = useState(() => lsGet(LS.hl, '1') !== '0');

  const regenerate = useCallback(async (isAuto) => {
    setRegenerating(true);
    if (isAuto) setAutoGen(true);
    try {
      const data = await api.post('/api/daily/regenerate');
      setReport(data?.report ?? null);
      setNotice('已生成今日情报日报。');
    } catch (e) {
      toast(e.message);
    } finally {
      setRegenerating(false);
      setAutoGen(false);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.get(dateParam ? `/api/daily?date=${dateParam}` : '/api/daily');
      setReport(data?.report ?? null);
      // T13/F3：打开即补——今日生成时间已过且今日无日报时自动触发生成
      if (data?.stale === true && !autoGenRef.current) {
        autoGenRef.current = true;
        regenerate(true);
      }
    } catch (e) {
      setReport(null); // 后端未就绪/无日报 → 空态引导
    }
    api
      .get('/api/settings/daily')
      .then((d) => setDailySettings(d?.settings || d))
      .catch(() => setDailySettings(null));
  }, [dateParam, regenerate]); // 用户 10-06：往期切换没反应——load 闭包不含 dateParam，改日期后 useEffect 不重跑

  useEffect(() => {
    load();
  }, [load]);
  // 往期日期列表（A：近 30 天有日报的北京日）
  useEffect(() => {
    api.get('/api/brief/history').then((d) => {
      const byDay = new Map();
      for (const r of d?.daily || []) {
        const day = String(r.generatedAt || '').slice(0, 10);
        if (!day) continue;
        // 同一天多批（关键词版/深析版）时保留 AI 版的导语（theme 非空优先）
        if (!byDay.has(day) || (!byDay.get(day) && r.theme)) byDay.set(day, r.theme || null);
      }
      setDailyArchive([...byDay.entries()].map(([date, theme]) => ({ date, theme })).sort((a, b) => b.date.localeCompare(a.date)));
    }).catch(() => {});
  }, []);

  const windowHours = report?.window_hours ?? dailySettings?.windowHours ?? 48;
  const sections = report?.sections || [];

  // 栏目标识：col_id 优先（2026-09-05b 后端新增），历史日报无 col_id 时回退栏目名
  const secKey = useCallback((sec, i) => sec?.col_id || sec?.column || `s${i}`, []);

  // col_id/栏目名 → 关键词（供标题高亮）；破茧栏无关键词
  const keywordsOf = useMemo(() => {
    const byId = new Map();
    const byName = new Map();
    for (const c of dailySettings?.columns || []) {
      if (Array.isArray(c.keywords) && c.keywords.length) {
        if (c.id) byId.set(c.id, c.keywords);
        if (c.name) byName.set(c.name, c.keywords);
      }
    }
    return (sec) => byId.get(sec?.col_id) || byName.get(sec?.column) || [];
  }, [dailySettings]);

  const totalItems = useMemo(
    () => sections.reduce((n, s) => n + (s.items?.length || 0), 0),
    [sections]
  );

  // 本期索引数据（用户 10-07：周刊同款右栏）。条目锚点 di-{id} 挂在 ColumnSection 的卡片/列表行上，
  // colKey 随条目带上——折叠中的栏目点击索引时先展开再滚。
  const indexGroups = useMemo(
    () =>
      sections.map((sec, i) => {
        const key = secKey(sec, i);
        return {
          key,
          title: sec.column,
          items: (sec.items || []).map((it) => ({
            id: it.id,
            anchor: `di-${it.id}`,
            title: it.title || '',
            colKey: key,
          })),
        };
      }).filter((g) => g.items.length),
    [sections, secKey]
  );

  const toggleCol = useCallback(
    (key) =>
      setCollapsed((m) => {
        const next = { ...m, [key]: !m[key] };
        lsSet(LS.collapsed, next);
        return next;
      }),
    []
  );

  const allCollapsed = sections.length > 0 && sections.every((s, i) => collapsed[secKey(s, i)]);
  const toggleAll = useCallback(() => {
    setCollapsed((m) => {
      const target = !sections.every((s, i) => m[secKey(s, i)]); // 当前非全折叠 → 折叠全部
      const next = {};
      if (target) for (const [i, s] of sections.entries()) next[secKey(s, i)] = true;
      lsSet(LS.collapsed, next);
      return next;
    });
  }, [sections, secKey]);

  const changeSort = (v) => {
    setSort(v);
    lsSet(LS.sort, v);
  };
  const toggleHl = () => {
    setHl((v) => {
      lsSet(LS.hl, v ? '0' : '1');
      return !v;
    });
  };

  return (
    <div className="flex h-screen t-bg t-text overflow-hidden">
      <IconRail />
      <main className="flex-1 overflow-y-auto min-w-0">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 flex gap-6">
          {/* 往期左侧索引（用户 10-06：和我的早报/周刊同款——顶部 pill 改左侧 sticky） */}
          {dailyArchive.length > 0 && (
            <aside className="hidden lg:block w-28 flex-none">
              <div className="sticky top-8">
                <div className="text-[11px] tracking-widest t-muted font-medium mb-2">往期早报</div>
                <div className="space-y-1 max-h-[70vh] overflow-y-auto">
                  <button
                    className={`block w-full text-left pill !text-[11px] cursor-pointer ${!dateParam ? 'on' : ''}`}
                    onClick={() => setDateParam(null)}
                  >
                    最新
                  </button>
                  {dailyArchive.slice(0, 30).map(({ date: d, theme: t }) => {
                    const label = t ? String(t).replace(/^["'「『]|["'」』。]+$/g, '').slice(0, 12) : '';
                    return (
                      <button
                        key={d}
                        className={`block w-full text-left pill !text-[11px] cursor-pointer ${dateParam === d ? 'on' : ''}`}
                        title={`${d}${label ? '｜' + label : ''}`}
                        onClick={() => setDateParam(d)}
                      >
                        <span className="block">{d.slice(5)}</span>
                        {label && <span className="block truncate text-[10px] t-muted">{label}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </aside>
          )}
          <div className="flex-1 min-w-0 max-w-[1080px]">
          {/* 生成提示条（F19） */}
          {notice && (
            <div
              className="mb-6 flex items-center rounded-xl border px-4 py-2.5 text-[13px]"
              style={{
                borderColor: 'var(--green)',
                color: 'var(--green)',
                background: 'color-mix(in srgb, var(--green) 7%, var(--surface))',
              }}
            >
              <span className="flex-1">{notice}</span>
              <button className="icon-btn !w-6 !h-6 text-xs" onClick={() => setNotice('')}>
                ✕
              </button>
            </div>
          )}

          <DailyHeader
            report={report || null}
            regenerating={regenerating}
            onRegenerate={() => regenerate(false)}
          />

          {/* 18-daily-ai-v2：今日主题导语区 */}
          {report?.theme && (
            <div className="mt-6">
              <div className="text-[11px] tracking-widest t-accent font-medium">今日主题</div>
              <div className="serif mt-2 text-lg sm:text-2xl italic leading-relaxed t-text">
                <MdRich text={report.theme} />
              </div>
              {report.degraded && (
                <div className="mt-2 text-[11px] t-muted">（今日为降级版：AI 不可用，已回退关键词策展）</div>
              )}
            </div>
          )}

          {/* T13/F3：stale 打开即补的进行中提示 */}
          {autoGen && (
            <div className="mt-6 card px-6 py-10 text-center text-[13px] t-muted">
              正在生成今日情报…（会先补抓到期的订阅源，请稍候）
            </div>
          )}

          <div className="mt-6 sm:mt-8 border-t-2" style={{ borderColor: 'var(--text)' }} />

          <div className="mt-5 sm:mt-6">
            <StatCards stats={report?.stats} windowHours={windowHours} totalItems={report ? totalItems : undefined} />
            <ThemePanorama themes={report?.stats?.themes} />
          </div>

          {report === undefined && (
            <div className="py-20 text-center text-sm t-muted">加载中…</div>
          )}

          {/* 空态引导 */}
          {report === null && (
            <div className="mt-6 card px-6 py-16 text-center">
              <div className="serif text-xl font-bold t-text">还没有生成日报</div>
              <div className="mt-3 text-[13px] t-muted leading-relaxed">
                点击右上角「重新生成」按钮，立即生成第一份每日情报；
                <br />
                之后每天会按「每日生成时间」自动生成。
              </div>
              <button
                className="btn-primary mt-6"
                style={{ background: 'var(--green)' }}
                disabled={regenerating}
                onClick={() => regenerate(false)}
              >
                {regenerating ? '生成中…' : '重新生成'}
              </button>
            </div>
          )}

          {/* 工具条：栏目导航 + 全部折叠/展开 + 排序 + 关键词高亮（sticky） */}
          {/* 2026-09-05 视觉精修：吸顶改 t-bg 实底 + hairline 底边，导航/开关收敛为 pill 样式 */}
          {report && sections.length > 0 && (
            <div className="sticky top-0 z-10 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-2 mt-6 flex flex-wrap items-center gap-2 t-bg border-b hairline">
              <div className="flex items-center gap-1.5 overflow-x-auto min-w-0 flex-1 py-0.5">
                {sections.map((sec, i) => {
                  const key = secKey(sec, i);
                  return (
                    <button
                      key={key}
                      type="button"
                      className="pill flex-none cursor-pointer"
                      onClick={() =>
                        document
                          .getElementById(`dailycol-${key}`)
                          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      }
                    >
                      {sec.column}
                      <span className="t-muted ml-1 tabular-nums">{sec.items?.length || 0}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-1.5 flex-none">
                <button type="button" className="pill cursor-pointer" onClick={toggleAll}>
                  {allCollapsed ? '全部展开' : '全部折叠'}
                </button>
                <select
                  className="input !w-auto !py-1 !px-2 !text-[11px]"
                  value={sort}
                  onChange={(e) => changeSort(e.target.value)}
                  title="栏目内排序"
                >
                  <option value="default">默认排序</option>
                  <option value="time">最新优先</option>
                  <option value="heat">热度优先</option>
                </select>
                <button
                  type="button"
                  className={`pill cursor-pointer ${hl ? 'on' : ''}`}
                  onClick={toggleHl}
                  title="标题关键词高亮"
                >
                  高亮
                </button>
              </div>
            </div>
          )}

          {/* 栏目区（F15，2026-09-05b 混合式） */}
      {report && (
            <div className="mt-6 sm:mt-8 flex flex-col gap-8 sm:gap-10">
              {sections.map((sec, i) => {
                const key = secKey(sec, i);
                return (
                  <ColumnSection
                    key={key}
                    section={sec}
                    keywords={keywordsOf(sec)}
                    collapsed={!!collapsed[key]}
                    onToggle={() => toggleCol(key)}
                    sort={sort}
                    highlight={hl}
                    onOpen={setStudyItem}
                  />
                );
              })}
              {sections.length === 0 && (
                <div className="card px-4 py-10 text-center text-xs t-muted">
                  这一栏暂时没有命中内容
                </div>
              )}
            </div>
          )}

          <div className="h-16" />
          </div>

          {/* 本期内容索引（用户 10-07：周刊同款右栏——按栏目分组列条目，点击展开折叠栏并滚动到条目） */}
          {report && indexGroups.length > 0 && (
            <IssueIndex
              groups={indexGroups}
              onJump={(it) => {
                if (it.colKey && collapsed[it.colKey]) toggleCol(it.colKey); // 折叠中的栏目先展开，否则锚点不存在
                requestAnimationFrame(() => requestAnimationFrame(() => {
                  document.getElementById(it.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }));
              }}
            />
          )}
        </div>
      </main>

      {studyItem && <QuickStudyModal item={studyItem} onClose={() => setStudyItem(null)} />}
    </div>
  );
}
