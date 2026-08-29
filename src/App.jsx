import { useEffect, useState } from 'react';
import { RadarLogo, NewspaperIcon, FlameIcon, RssIcon } from './icons.jsx';
import { relativeTime } from './util.js';
import DailyTab from './tabs/DailyTab.jsx';
import EventsTab from './tabs/EventsTab.jsx';
import ReaderTab from './tabs/ReaderTab.jsx';

// 全网情报 · 只读门户：纯静态 SPA，数据全部来自 public/data/*.json（base './' → 相对路径加载）
// 单页三 Tab（底部 Tab 栏，手机优先）；深浅色跟随系统

const TABS = [
  { id: 'daily', label: '今日日报', Icon: NewspaperIcon },
  { id: 'events', label: '热点榜', Icon: FlameIcon },
  { id: 'reader', label: '阅读器', Icon: RssIcon },
];

async function fetchJson(name) {
  const res = await fetch(`data/${name}`);
  if (!res.ok) throw new Error(`${name} 加载失败（HTTP ${res.status}）`);
  return res.json();
}

export default function App() {
  const [tab, setTab] = useState('daily');
  const [data, setData] = useState(null); // {meta, daily, events, articles}
  const [error, setError] = useState(null);
  const [, forceTick] = useState(0); // 每 60s 刷新「N 分钟前更新」

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchJson('meta.json'),
      fetchJson('daily-latest.json'),
      fetchJson('events.json'),
      fetchJson('articles.json'),
    ])
      .then(([meta, daily, events, articles]) => {
        if (!cancelled) setData({ meta, daily, events, articles });
      })
      .catch((e) => !cancelled && setError(e.message || '数据加载失败'));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 60e3);
    return () => clearInterval(t);
  }, []);

  // 切 Tab 回到顶部
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  return (
    <div className="min-h-full t-bg t-text flex flex-col">
      {/* 顶栏：雷达 logo + 名称 + 更新时间 */}
      <header className="flex-none sticky top-0 z-20 t-surface border-b t-border">
        <div className="max-w-[720px] mx-auto flex items-center gap-2.5 px-4 h-12">
          <span className="logo-radar t-accent flex items-center" title="全网情报系统">
            <RadarLogo size={22} />
          </span>
          <span className="text-[15px] font-bold tracking-wide">全网情报</span>
          <span className="flex-1" />
          {data?.meta?.exportedAt && (
            <span className="text-[11px] t-muted tabular-nums">
              {relativeTime(data.meta.exportedAt)}更新
            </span>
          )}
        </div>
      </header>

      {/* 内容区（底部留出 Tab 栏高度） */}
      <main className="flex-1">
        <div className="max-w-[720px] mx-auto pb-24">
          {error && (
            <div className="card mx-4 mt-4 px-4 py-16 text-center text-[13px] t-muted">
              {error}
              <div className="mt-2 text-[11px]">数据文件缺失或未导出，请稍后刷新重试</div>
            </div>
          )}
          {!data && !error && (
            <div className="py-20 text-center text-[13px] t-muted">加载中…</div>
          )}
          {data && tab === 'daily' && <DailyTab daily={data.daily} />}
          {data && tab === 'events' && <EventsTab events={data.events} />}
          {data && tab === 'reader' && <ReaderTab articles={data.articles} />}

          {data?.meta && (
            <footer className="mt-8 px-4 text-center text-[11px] t-muted leading-relaxed">
              {data.meta.sources} 个信源 · 累计 {data.meta.articles} 条情报
              <br />
              全网情报系统 · 只读门户
            </footer>
          )}
        </div>
      </main>

      {/* 底部 Tab 栏（移动端友好） */}
      <nav className="tabbar fixed bottom-0 inset-x-0 z-20 t-surface border-t t-border">
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
