import { lazy, Suspense, useEffect, useState } from 'react';
import { ThemeButton } from '../theme.jsx';
import { RadarLogo } from '../components/icons.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import AdminRefCard from '../components/AdminRefCard.jsx';
import { SkeletonList } from '../components/Skeleton.jsx';

// 管理后台懒加载（用户每次只看一个板块，无需同步加载全部组件）
// spec30（2026-09-15）：12 Tab 收敛为 5；抖音板块下架（T5-10）
// T3-8 批次1（2026-10-04）：顶部横向 Tab → 左栏父/子板块两级导航（用户拍板）。
// 本批零功能改动：现有组件按子板块重新分组，子板块=导航定位（进 URL hash，刷新不丢）；
// render 只在该子板块激活时调用，lazy 语义不变。首页仪表盘在批次 6 加入，届时左栏顶部新增。
const SourceLibraryTab = lazy(() => import('../components/SourceLibraryTab.jsx'));
const HotSettings = lazy(() => import('../components/HotSettings.jsx'));
const DataTab = lazy(() => import('../components/DataTab.jsx'));
const AlertsTab = lazy(() => import('../components/AlertsTab.jsx'));
const LogsTab = lazy(() => import('../components/LogsTab.jsx'));
const SelfHealTab = lazy(() => import('../components/SelfHealTab.jsx'));
const DailySettingsTab = lazy(() => import('../components/DailySettingsTab.jsx'));
const MonitorTab = lazy(() => import('../components/MonitorTab.jsx'));
const TranslateSkillTab = lazy(() => import('../components/TranslateSkillTab.jsx'));
const AiSettingsTab = lazy(() => import('../components/AiSettingsTab.jsx'));
const BriefOverview = lazy(() => import('../components/BriefOverview.jsx'));
const DashboardTab = lazy(() => import('../components/DashboardTab.jsx'));
const MyBriefPanel = lazy(() => import('../components/MyBriefPanel.jsx'));
const WeeklyPanel = lazy(() => import('../components/WeeklyPanel.jsx'));

// Tab 切换时的加载占位（B11：骨架屏，与前台同语言）
function TabLoader() {
  return (
    <div className="card">
      <SkeletonList n={6} />
    </div>
  );
}

// 合并分区块的小标题 + C2 作用对象标注
function Zone({ title, note, children }) {
  return (
    <section className="mb-8">
      <div className="text-base font-bold t-text mb-1">{title}</div>
      {note && <div className="text-[11px] t-muted mb-3">→ {note}</div>}
      {children}
    </section>
  );
}

// 子板块定义。id=导航定位；ref=前台对照卡的口径（AdminRefCard 只认五 Tab 值）；wide=内容区宽版
const SECTIONS = [
  {
    parent: '首页',
    items: [
      { id: 'home', label: '仪表盘', ref: null, wide: true, wider: true, render: () => <DashboardTab /> },
    ],
  },
  {
    parent: '源',
    items: [
      { id: 'library', label: '源库', ref: 'library', wide: true, render: () => <SourceLibraryTab key="library" initialView="search" /> },
      { id: 'hot', label: '热点榜', ref: 'hot', render: () => <HotSettings /> },
    ],
  },
  {
    parent: '报',
    items: [
      { id: 'brief', label: '总览', ref: 'brief', render: () => <BriefOverview /> },
      {
        id: 'daily',
        label: '每日早报',
        ref: 'brief',
        render: () => <DailySettingsTab />,
      },
      { id: 'mybrief', label: '我的早报', ref: 'brief', render: () => <MyBriefPanel /> },
      { id: 'weekly', label: '周刊', ref: 'brief', render: () => <WeeklyPanel /> },
    ],
  },
  {
    parent: 'AI',
    items: [
      {
        id: 'ai',
        label: 'AI 配置',
        ref: 'ai',
        render: () => (
          <>
            <Zone title="AI 能力配置" note="作用于 早报策展 / 六维评分 / 摘要（全部 AI 产出页）">
              <AiSettingsTab />
            </Zone>
            <Zone title="翻译 Skill" note="作用于 阅读器与早报的中英对照（runner 每 15 分钟出队）">
              <TranslateSkillTab />
            </Zone>
          </>
        ),
      },
    ],
  },
  {
    parent: '系统',
    items: [
      {
        id: 'data',
        label: '数据',
        ref: 'system',
        render: () => (
          <Zone title="数据" note="作用于 存储占用与内容保留策略（Turso 云库）">
            <DataTab />
          </Zone>
        ),
      },
      {
        id: 'monitor',
        label: '监控',
        ref: 'system',
        render: () => (
          <Zone title="监控" note="作用于 采集心跳与源健康（全站）">
            <MonitorTab />
          </Zone>
        ),
      },
      {
        id: 'alerts',
        label: '报警',
        ref: 'system',
        render: () => (
          <Zone title="报警" note="作用于 熔断/停滞/失败事件的 webhook 推送（配置面；发生过的记录在「日志」板块）">
            <AlertsTab />
          </Zone>
        ),
      },
      {
        id: 'selfheal',
        label: '自愈',
        ref: 'system',
        render: () => (
          <Zone title="自愈" note="源的自动恢复：周期性被限流的源到点重启，不是坏了——观测恢复记录与一键重启">
            <SelfHealTab />
          </Zone>
        ),
      },
      {
        id: 'logs',
        label: '日志',
        ref: 'system',
        render: () => (
          <Zone title="日志" note="作业运行史 / 报警事件流 / 数据层失败留痕 / 服务器与部署日志的查看指引">
            <LogsTab />
          </Zone>
        ),
      },
    ],
  },
];

const ALL_ITEMS = SECTIONS.flatMap((g) => g.items);
const itemOf = (id) => ALL_ITEMS.find((i) => i.id === id) || ALL_ITEMS[0];
const parentOf = (id) => SECTIONS.find((g) => g.items.some((i) => i.id === id)) || SECTIONS[0];
const readHash = () => {
  const id = window.location.hash.replace(/^#\/?/, '');
  return ALL_ITEMS.some((i) => i.id === id) ? id : 'home';
};

// 空闲预热全部板块 chunk：lazy() 与这里的 import() 同路径会被打包器合并为同一模块，
// 预热完成后切换子板块零 chunk 下载等待（9 个组件合计约 150kB gzip，一次性成本）
const WARM_IMPORTS = [
  () => import('../components/DashboardTab.jsx'),
  () => import('../components/SourceLibraryTab.jsx'),
  () => import('../components/HotSettings.jsx'),
  () => import('../components/BriefOverview.jsx'),
  () => import('../components/MyBriefPanel.jsx'),
  () => import('../components/WeeklyPanel.jsx'),
  () => import('../components/DailySettingsTab.jsx'),
  () => import('../components/AiSettingsTab.jsx'),
  () => import('../components/TranslateSkillTab.jsx'),
  () => import('../components/DataTab.jsx'),
  () => import('../components/MonitorTab.jsx'),
  () => import('../components/AlertsTab.jsx'),
  () => import('../components/LogsTab.jsx'),
  () => import('../components/SelfHealTab.jsx'),
];

// 管理后台（/admin/；/wechat/ 兼容同渲染）：独立外壳，不带阅读器 IconRail
export default function AdminPage() {
  const [view, setView] = useState(readHash);
  const [parent, setParent] = useState(() => parentOf(readHash()));

  // hash 同步：刷新/直链不丢位置，浏览器前进后退可用
  useEffect(() => {
    const onHash = () => {
      const id = readHash();
      setView(id);
      setParent(parentOf(id));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // 进入后台 1.5s 后台预热其余板块代码（首屏优先渲染，不抢带宽）
  useEffect(() => {
    const t = setTimeout(() => WARM_IMPORTS.forEach((f) => f()), 1500);
    return () => clearTimeout(t);
  }, []);
  const go = (id) => {
    setView(id);
    setParent(parentOf(id));
    window.location.hash = `/${id}`;
  };

  const item = itemOf(view);
  return (
    <div className="flex flex-col h-screen t-bg t-text overflow-hidden">
      {/* 顶部标题栏 */}
      <header className="flex-none border-b t-border t-surface">
        <div className="px-4 sm:px-6 pt-4 pb-3 flex items-center gap-2.5">
          <span className="logo-radar t-accent flex items-center" title="全网情报系统">
            <RadarLogo size={22} />
          </span>
          <h1 className="text-lg font-bold t-text">全网情报 · 管理后台</h1>
          <span className="flex-1" />
          <ThemeButton />
          <a href="/reader/" className="btn-ghost">
            返回阅读器
          </a>
        </div>
        {/* 移动端（md 以下）：父板块行 + 当前父的子板块行，两级横向滚动 */}
        <div className="md:hidden px-4 pb-3 space-y-2">
          <div className="flex gap-1.5 overflow-x-auto">
            {SECTIONS.map((g) => (
              <button
                key={g.parent}
                onClick={() => setParent(g)}
                className={`pill !px-3 !py-1 !text-[12px] flex-none ${parent.parent === g.parent ? 'on' : ''}`}
              >
                {g.parent}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5 overflow-x-auto">
            {parent.items.map((it) => (
              <button
                key={it.id}
                onClick={() => go(it.id)}
                className={`pill !px-3 !py-1 !text-[12px] flex-none ${view === it.id ? 'on' : ''}`}
              >
                {it.label}
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        {/* 桌面左栏（md 以上）：父板块分组标题 + 子板块条目 */}
        <nav className="hidden md:flex flex-none w-44 lg:w-48 border-r t-border t-surface overflow-y-auto px-2.5 py-4 flex-col gap-5">
          {SECTIONS.map((g) => (
            <div key={g.parent}>
              <div className="text-[11px] t-muted px-2.5 mb-1.5 font-semibold tracking-wide">{g.parent}</div>
              {g.items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => go(it.id)}
                  className={`block w-full text-left px-2.5 py-1.5 rounded-lg text-[13px] mb-0.5 ${
                    view === it.id ? 't-accent font-semibold t-surface2' : 't-text'
                  }`}
                >
                  {it.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
          <div className={item.wider ? 'max-w-[1500px] mx-auto' : item.wide ? 'max-w-[1160px] mx-auto' : 'max-w-[960px] mx-auto'}>
            {item.ref ? <AdminRefCard tab={item.ref} /> : null}
            <ErrorBoundary fallback="当前板块">
              <Suspense fallback={<TabLoader />}>{item.render()}</Suspense>
            </ErrorBoundary>
            <div className="h-8" />
          </div>
        </main>
      </div>
    </div>
  );
}
