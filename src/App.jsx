import { useEffect, useState } from 'react';
import { RadarLogo, NewspaperIcon, FlameIcon, RssIcon, SunIcon, MoonIcon } from './icons.jsx';
import { relativeTime } from './util.js';
import { getMeta } from './api.js';
import DailyTab from './tabs/DailyTab.jsx';
import EventsTab from './tabs/EventsTab.jsx';
import ReaderTab from './tabs/ReaderTab.jsx';

// 全网情报 · 只读门户：完整桌面应用（≥1024px 左侧固定导航 + 分栏内容）+ 移动端（底部 Tab 栏）
// 主题：light/dark 手动切换（localStorage: portal-theme），缺省跟随系统（index.html 内联脚本）
// 数据：/api/*（Vercel serverless）优先，404 回退 public/data/*.json（见 api.js）

const TABS = [
  { id: 'daily', label: '今日日报', Icon: NewspaperIcon },
  { id: 'events', label: '热点榜', Icon: FlameIcon },
  { id: 'reader', label: '阅读器', Icon: RssIcon },
];

function ThemeToggle({ size = 18, className = '' }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () =>
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle('dark', next);
      try {
        localStorage.setItem('portal-theme', next ? 'dark' : 'light');
      } catch {
        /* ignore */
      }
      return next;
    });
  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg transition-colors t-muted hover:t-accent ${className}`}
      title={dark ? '切换到浅色' : '切换到深色'}
      onClick={toggle}
    >
      {dark ? <SunIcon size={size} /> : <MoonIcon size={size} />}
    </button>
  );
}

export default function App() {
  const [tab, setTab] = useState('daily');
  const [meta, setMeta] = useState(null);
  const [mounted, setMounted] = useState({ daily: true }); // 懒挂载 + 保活（隐藏不卸载）
  const [, forceTick] = useState(0);

  useEffect(() => {
    getMeta().then(setMeta).catch(() => setMeta(null));
  }, []);

  useEffect(() => {
    setMounted((m) => (m[tab] ? m : { ...m, [tab]: true }));
    window.scrollTo(0, 0);
  }, [tab]);

  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 60e3);
    return () => clearInterval(t);
  }, []);

  const cur = TABS.find((t) => t.id === tab);

  return (
    <div className="min-h-full t-bg t-text">
      {/* 桌面端（≥1024px）左侧固定导航栏 */}
      <nav className="hidden lg:flex fixed left-0 top-0 bottom-0 z-30 w-16 flex-col items-center border-r t-border t-surface py-4 gap-2">
        <span className="logo-radar t-accent flex items-center justify-center w-10 h-10 mb-2" title="全网情报系统">
          <RadarLogo size={26} />
        </span>
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              title={t.label}
              className={`w-10 h-10 rounded-lg inline-flex items-center justify-center transition-colors ${
                active ? 't-accent-soft t-accent' : 't-muted hover:t-accent hover:t-accent-soft'
              }`}
            >
              <t.Icon size={20} />
            </button>
          );
        })}
        <div className="mt-auto">
          <ThemeToggle className="w-10 h-10 border t-border t-surface" />
        </div>
      </nav>

      <div className="lg:pl-16 min-h-full flex flex-col">
        {/* 顶栏 */}
        <header className="flex-none sticky top-0 z-20 t-surface border-b t-border">
          <div className="flex items-center gap-2.5 px-4 h-12">
            <span className="logo-radar t-accent flex items-center lg:hidden" title="全网情报系统">
              <RadarLogo size={22} />
            </span>
            <span className="text-[15px] font-bold tracking-wide">全网情报</span>
            <span className="hidden lg:inline text-[12px] t-muted">· {cur?.label}</span>
            <span className="flex-1" />
            {meta?.exportedAt && (
              <span className="text-[11px] t-muted tabular-nums">{relativeTime(meta.exportedAt)}更新</span>
            )}
            <ThemeToggle size={16} className="lg:hidden w-8 h-8" />
          </div>
        </header>

        {/* 内容区：保活挂载（切 Tab 不丢状态） */}
        <main className="flex-1 flex flex-col">
          {mounted.daily && (
            <div className={tab === 'daily' ? 'flex-1 flex flex-col' : 'hidden'}>
              <DailyTab />
            </div>
          )}
          {mounted.events && (
            <div className={tab === 'events' ? 'flex-1 flex flex-col' : 'hidden'}>
              <EventsTab />
            </div>
          )}
          {mounted.reader && (
            <div className={tab === 'reader' ? 'flex-1 flex flex-col' : 'hidden'}>
              <ReaderTab meta={meta} />
            </div>
          )}
        </main>

        {/* 页脚（阅读器桌面分栏时由列表自己撑高，页脚只在日报/热点下可见即可） */}
        {tab !== 'reader' && meta && (
          <footer className="mt-8 mb-24 lg:mb-6 px-4 text-center text-[11px] t-muted leading-relaxed">
            {meta.sources} 个信源 · 累计 {meta.articles} 条情报
            <br />
            全网情报系统 · 只读门户
          </footer>
        )}
      </div>

      {/* 底部 Tab 栏（仅 <1024px） */}
      <nav className="tabbar fixed bottom-0 inset-x-0 z-20 t-surface border-t t-border lg:hidden">
        <div className="max-w-[720px] mx-auto flex">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors ${
                  active ? 't-accent' : 't-muted'
                }`}
              >
                <t.Icon size={20} />
                <span className={`text-[10.5px] ${active ? 'font-medium' : ''}`}>{t.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
