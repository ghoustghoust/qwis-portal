import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconRail } from '../main.jsx';
import { api } from '../api';
import { toast } from '../toast';
import DailyHeader from '../components/DailyHeader.jsx';
import StatCards from '../components/StatCards.jsx';
import ColumnSection from '../components/ColumnSection.jsx';
import QuickStudyModal from '../components/QuickStudyModal.jsx';

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
      const data = await api.get('/api/daily');
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
  }, [regenerate]);

  useEffect(() => {
    load();
  }, [load]);

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
        <div className="max-w-[1080px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
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
              <p className="serif mt-2 text-lg sm:text-2xl italic leading-relaxed t-text">
                {report.theme}
              </p>
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
      </main>

      {studyItem && <QuickStudyModal item={studyItem} onClose={() => setStudyItem(null)} />}
    </div>
  );
}
