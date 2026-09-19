import { lazy, Suspense, useState } from 'react';
import { ThemeButton } from '../theme.jsx';
import { RadarLogo } from '../components/icons.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import AdminRefCard from '../components/AdminRefCard.jsx';
import { SkeletonList } from '../components/Skeleton.jsx';

// 2.2 性能优化：管理后台 Tab 懒加载（用户每次只看一个 Tab，无需同步加载全部 ~2500 行组件）
// spec30（2026-09-15）：12 Tab 收敛为 5——公众号RSS/B站并入源库「平台接入」视图；日报设置并入早报中心；
// 翻译 Skill 并入 AI 能力；数据/监控/报警并入系统；抖音板块下架（T5-10，永不云端化的本地功能退出后台）
const SourceLibraryTab = lazy(() => import('../components/SourceLibraryTab.jsx'));
const HotSettings = lazy(() => import('../components/HotSettings.jsx'));
const DataTab = lazy(() => import('../components/DataTab.jsx'));
const AlertsTab = lazy(() => import('../components/AlertsTab.jsx'));
const DailySettingsTab = lazy(() => import('../components/DailySettingsTab.jsx'));
const MonitorTab = lazy(() => import('../components/MonitorTab.jsx'));
const TranslateSkillTab = lazy(() => import('../components/TranslateSkillTab.jsx'));
const AiSettingsTab = lazy(() => import('../components/AiSettingsTab.jsx'));
const BriefCenterTab = lazy(() => import('../components/BriefCenterTab.jsx'));

// Tab 切换时的加载占位（B11：文字「加载中…」→ 骨架屏，与前台同语言）
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

// 管理后台（/admin/；/wechat/ 兼容同渲染）：独立外壳，不带阅读器 IconRail
// 顶部标题栏（RadarLogo + 标题 + 主题切换/返回阅读器）+ 横向 Tab 导航
// spec30：5 Tab（源库/早报中心/热点榜策展/AI能力/系统）+ 每 Tab 顶部前台对照卡（C1）
export default function AdminPage() {
  const [tab, setTab] = useState('library');
  const tabs = [
    { id: 'library', label: '源库' },
    { id: 'brief', label: '早报中心' },
    { id: 'hot', label: '热点榜策展' },
    { id: 'ai', label: 'AI 能力' },
    { id: 'system', label: '系统' },
  ];
  return (
    <div className="flex flex-col h-screen t-bg t-text overflow-hidden">
      {/* 顶部标题栏 */}
      <header className="flex-none border-b t-border t-surface">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-6 pt-4">
          <div className="flex items-center gap-2.5">
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
          {/* 横向 Tab 导航（pill 式；移动端横向滚动） */}
          <div className="mt-3 pb-3 flex gap-1.5 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`pill !px-3.5 !py-1.5 !text-[13px] flex-none ${tab === t.id ? 'on' : ''}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
        <div className={tab === 'library' ? 'max-w-[1160px] mx-auto' : 'max-w-[960px] mx-auto'}>
          <AdminRefCard tab={tab} />
          <ErrorBoundary fallback="当前标签页">
            <Suspense fallback={<TabLoader />}>
              {tab === 'library' && <SourceLibraryTab />}
              {tab === 'brief' && (
                <>
                  <BriefCenterTab />
                  <div className="mt-8 pt-6 border-t t-border">
                    <Zone title="每日早报设置" note="作用于 每日早报（/daily/）的统计窗口/生成时间/来源勾选/栏目">
                      <DailySettingsTab />
                    </Zone>
                  </div>
                </>
              )}
              {tab === 'hot' && <HotSettings />}
              {tab === 'ai' && (
                <>
                  <Zone title="AI 能力配置" note="作用于 早报策展 / 六维评分 / 摘要（全部 AI 产出页）">
                    <AiSettingsTab />
                  </Zone>
                  <Zone title="翻译 Skill" note="作用于 阅读器与早报的中英对照（runner 每 15 分钟出队）">
                    <TranslateSkillTab />
                  </Zone>
                </>
              )}
              {tab === 'system' && (
                <>
                  <Zone title="数据" note="作用于 存储占用与内容保留策略（Turso 云库）">
                    <DataTab />
                  </Zone>
                  <Zone title="监控" note="作用于 采集心跳与源健康（全站）">
                    <MonitorTab />
                  </Zone>
                  <Zone title="报警管理" note="作用于 熔断/停滞/失败事件的 webhook 推送">
                    <AlertsTab />
                  </Zone>
                </>
              )}
            </Suspense>
          </ErrorBoundary>
          <div className="h-8" />
        </div>
      </main>
    </div>
  );
}
