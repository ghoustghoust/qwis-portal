import { useState } from 'react';
import { ThemeButton } from '../theme.jsx';
import { RadarLogo } from '../components/icons.jsx';
import WechatTab from '../components/WechatTab.jsx';
import BilibiliTab from '../components/BilibiliTab.jsx';
import DouyinTab from '../components/DouyinTab.jsx';
import HotSettings from '../components/HotSettings.jsx';
import DataTab from '../components/DataTab.jsx';
import AlertsTab from '../components/AlertsTab.jsx';
import DailySettingsTab from '../components/DailySettingsTab.jsx';

// 管理后台（/admin/；/wechat/ 兼容同渲染）：独立外壳，不带阅读器 IconRail
// 顶部标题栏（RadarLogo + 标题 + 主题切换/返回阅读器）+ 横向 Tab 导航
// 热榜设置已提取为独立顶层导航 Tab，与日报/报警等 Tab 并列
export default function AdminPage() {
  const [tab, setTab] = useState('wechat');
  const tabs = [
    { id: 'wechat', label: '公众号 RSS' },
    { id: 'bilibili', label: 'B 站' },
    { id: 'douyin', label: '抖音' },
    { id: 'daily', label: '日报设置' },
    { id: 'data', label: '数据' },
    { id: 'alerts', label: '报警管理' },
    { id: 'hot', label: '热点榜' },
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
          {/* 横向 Tab 导航 */}
          <div className="mt-3 flex gap-1 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-[13px] rounded-t-lg border-b-2 -mb-px whitespace-nowrap ${
                  tab === t.id
                    ? 't-accent font-medium border-[var(--accent)]'
                    : 't-muted border-transparent hover:t-text'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-[960px] mx-auto">
          {tab === 'wechat' && <WechatTab />}
          {tab === 'bilibili' && <BilibiliTab />}
          {tab === 'douyin' && <DouyinTab />}
          {tab === 'daily' && <DailySettingsTab />}
          {tab === 'data' && <DataTab />}
          {tab === 'alerts' && <AlertsTab />}
          {tab === 'hot' && <HotSettings />}
          <div className="h-8" />
        </div>
      </main>
    </div>
  );
}
