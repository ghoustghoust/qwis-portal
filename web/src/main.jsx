import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { ThemeProvider, ThemeButton } from './theme.jsx';
import { Toaster } from './toast.jsx';
import { api } from './api.js';
import { StoreProvider, useSettings } from './store.jsx';
import ReaderPage from './pages/ReaderPage.jsx';
import DailyPage from './pages/DailyPage.jsx';
import HotPage from './pages/HotPage.jsx';
import MyReadingPage from './pages/MyReadingPage.jsx';
import { RssIcon, CalendarIcon, FlameIcon, BookIcon, RadarLogo } from './components/icons.jsx';
import LoginGate from './components/LoginGate.jsx';

// 左侧窄导航栏：页面入口（后端把各路由都指向本 SPA，按 pathname 分发）
// 管理后台是独立入口（admin.html → src/admin.jsx），不在本 bundle 内；
// /admin/ 与 /wechat/ 由后端指向 admin.html，整页跳转
// T15/F8：热点榜入口仅在 settings hot.enabled !== false 时显示
// 2.1 增强：IconRail 改为从 store 读取 settings，不再独立请求
export function IconRail() {
  const path = window.location.pathname;
  const settings = useSettings();
  const hotEnabled = settings.hot?.enabled !== false;

  const items = [
    { href: '/reader/', Icon: RssIcon, label: '阅读器', active: !path.startsWith('/daily') && !path.startsWith('/hot') && !path.startsWith('/reading') },
    { href: '/daily/', Icon: CalendarIcon, label: '每日情报', active: path.startsWith('/daily') },
    ...(hotEnabled ? [{ href: '/hot/', Icon: FlameIcon, label: '热点榜', active: path.startsWith('/hot') }] : []),
    { href: '/reading/', Icon: BookIcon, label: '我的阅读', active: path.startsWith('/reading') },
  ];
  return (
    <nav className="flex flex-col items-center w-12 flex-none border-r t-border t-surface py-3 gap-1.5">
      <div
        className="logo-radar w-8 h-8 mb-2 t-accent flex items-center justify-center rounded-lg transition-colors hover:t-accent-soft"
        title="全网情报系统"
      >
        <RadarLogo size={22} />
      </div>
      {items.map((it) => (
        <a
          key={it.href}
          href={it.href}
          title={it.label}
          className={`icon-btn transition-colors ${
            it.active ? 't-accent-soft t-accent' : 'hover:t-accent'
          }`}
        >
          <it.Icon />
        </a>
      ))}
      <div className="mt-auto flex flex-col items-center gap-1.5">
        {/* 管理后台为独立应用,阅读器不再提供入口;直接访问 /admin/ 即可 */}
        <ThemeButton />
      </div>
    </nav>
  );
}

function App() {
  const path = window.location.pathname;
  let page;
  if (path.startsWith('/daily')) page = <DailyPage />;
  else if (path.startsWith('/hot')) page = <HotPage />;
  else if (path.startsWith('/reading')) page = <MyReadingPage />;
  else page = <ReaderPage />;
  return (
    <StoreProvider>
      <ThemeProvider>
        {page}
        <Toaster />
        <LoginGate />
      </ThemeProvider>
    </StoreProvider>
  );
}

createRoot(document.getElementById('root')).render(<App />);
