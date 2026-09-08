import { lazy, Suspense, useState } from 'react';
import { ThemeButton } from '../theme.jsx';
import { RadarLogo } from '../components/icons.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';

// 2.2 性能优化：管理后台 Tab 懒加载（用户每次只看一个 Tab，无需同步加载全部 ~2500 行组件）
const SourceLibraryTab = lazy(() => import('../components/SourceLibraryTab.jsx'));
const WechatTab = lazy(() => import('../components/WechatTab.jsx'));
const BilibiliTab = lazy(() => import('../components/BilibiliTab.jsx'));
const DouyinTab = lazy(() => import('../components/DouyinTab.jsx'));
const HotSettings = lazy(() => import('../components/HotSettings.jsx'));
const DataTab = lazy(() => import('../components/DataTab.jsx'));
const AlertsTab = lazy(() => import('../components/AlertsTab.jsx'));
const DailySettingsTab = lazy(() => import('../components/DailySettingsTab.jsx'));
const MonitorTab = lazy(() => import('../components/MonitorTab.jsx'));

// Tab 切换时的加载占位
function TabLoader() {
  return <div className="py-16 text-center text-sm t-muted">加载中…</div>;
}

// 管理后台（/admin/；/wechat/ 兼容同渲染）：独立外壳，不带阅读器 IconRail
// 顶部标题栏（RadarLogo + 标题 + 主题切换/返回阅读器）+ 横向 Tab 导航
// 热榜设置已提取为独立顶层导航 Tab，与日报/报警等 Tab 并列
export default function AdminPage() {
  const [tab, setTab] = useState('library');
  const tabs = [
    { id: 'library', label: '源库' },
    { id: 'wechat', label: '公众号 RSS' },
    { id: 'bilibili', label: 'B 站' },
    { id: 'douyin', label: '抖音' },
    { id: 'daily', label: '日报设置' },
    { id: 'data', label: '数据' },
    { id: 'alerts', label: '报警管理' },
    { id: 'hot', label: '热点榜' },
    { id: 'monitor', label: '监控' },
  ];
  return (
    <div className="flex flex-col h-screen t-bg t-text overflow-hidden">
      {/* 顶部标题栏 */}
      <header className="flex-none border-b t-border t-surface">
        <div className="max-w-[1100px] mx-auto px-6 pt-4">
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
          {/* 横向 Tab 导航（2026-09-05 视觉精修：pill 式导航，选中 .pill.on） */}
          <div className="mt-3 pb-3 flex gap-1.5 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`pill !px-3.5 !py-1.5 !text-[13px] ${tab === t.id ? 'on' : ''}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto px-6 py-5">
        <div className={tab === 'library' ? 'max-w-[1160px] mx-auto' : 'max-w-[960px] mx-auto'}>
          <ErrorBoundary fallback="当前标签页">
            <Suspense fallback={<TabLoader />}>
              {tab === 'library' && <SourceLibraryTab />}
              {tab === 'wechat' && <WechatTab />}
              {tab === 'bilibili' && <BilibiliTab />}
              {tab === 'douyin' && <DouyinTab />}
              {tab === 'daily' && <DailySettingsTab />}
              {tab === 'data' && <DataTab />}
              {tab === 'alerts' && <AlertsTab />}
              {tab === 'hot' && <HotSettings />}
              {tab === 'monitor' && <MonitorTab />}
            </Suspense>
          </ErrorBoundary>
          <div className="h-8" />
        </div>
      </main>
    </div>
  );
}
