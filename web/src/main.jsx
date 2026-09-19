import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { ThemeProvider, ThemeButton } from './theme.jsx';
import { Toaster } from './toast.jsx';
import { api } from './api.js';
import { StoreProvider, useSettings } from './store.jsx';
import ReaderPage from './pages/ReaderPage.jsx';
import DailyPage from './pages/DailyPage.jsx';
import MyBriefPage from './pages/MyBriefPage.jsx';
import WeeklyPage from './pages/WeeklyPage.jsx';
import HotPage from './pages/HotPage.jsx';
import MyReadingPage from './pages/MyReadingPage.jsx';
import { RssIcon, CalendarIcon, FlameIcon, BookIcon, RadarLogo, SunIcon, DocIcon } from './components/icons.jsx';
import LoginGate from './components/LoginGate.jsx';
import { LanguageProvider, useI18n } from './i18n.jsx';

// P0-5 修复：客户端路由上下文
// 之前用 <a href> 整页跳转，每次销毁 JS 上下文，api 5s 缓存完全失效。
// 改为 pushState 客户端路由，保持 JS 上下文 + api 缓存跨页面存活。
const NavCtx = React.createContext({ path: '/', navigate: () => {} });
export const useNav = () => React.useContext(NavCtx);

// 各页面预取清单：hover 时预热 api 缓存，点击后页面 mount 直接命中缓存
const PAGE_PREFETCH = {
  '/reader/': ['/api/articles?sort=new', '/api/status'],
  '/daily/': ['/api/daily'],
  '/mybrief/': ['/api/mybrief'],
  '/hot/': ['/api/hot', '/api/hot/events'],
  '/reading/': ['/api/reading?tab=all'],
};

// 左侧窄导航栏（P0-5：改为客户端路由 + hover 预取）
// 管理后台是独立入口（admin.html → src/admin.jsx），不在本 bundle 内
// T15/F8：热点榜入口仅在 settings hot.enabled !== false 时显示
// 2.1 增强：IconRail 改为从 store 读取 settings，不再独立请求
export function IconRail() {
  const { path, navigate } = useNav();
  const settings = useSettings();
  const { t, toggleLang, lang } = useI18n();
  const hotEnabled = settings.hot?.enabled !== false;

  const items = [
    { href: '/reader/', Icon: RssIcon, label: t('nav.reader'), active: !path.startsWith('/daily') && !path.startsWith('/hot') && !path.startsWith('/reading') && !path.startsWith('/mybrief') && !path.startsWith('/weekly') },
    { href: '/daily/', Icon: CalendarIcon, label: t('nav.daily'), active: path.startsWith('/daily') },
    { href: '/mybrief/', Icon: SunIcon, label: t('nav.mybrief'), active: path.startsWith('/mybrief') },
    { href: '/weekly/', Icon: DocIcon, label: t('nav.weekly'), active: path.startsWith('/weekly') },
    ...(hotEnabled ? [{ href: '/hot/', Icon: FlameIcon, label: t('nav.hot'), active: path.startsWith('/hot') }] : []),
    { href: '/reading/', Icon: BookIcon, label: t('nav.reading'), active: path.startsWith('/reading') },
  ];

  // P0-5：hover 预取——mouseenter 时预热目标页面的 api 缓存
  const onPrefetch = useCallback((href) => {
    const urls = PAGE_PREFETCH[href];
    if (urls) urls.forEach((u) => api.get(u)); // api.get 内部有缓存去重，不会重复请求
  }, []);

  return (
    // T5-8/spec30（2026-09-15）：图标下方常驻文字标签——纯图标导航用户难辨功能
    <nav className="flex flex-col items-center w-16 flex-none border-r t-border t-surface py-3 gap-1">
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
          className={`rail-btn w-full transition-colors ${
            it.active ? 't-accent-soft t-accent' : 'hover:t-accent'
          }`}
          onClick={(e) => { e.preventDefault(); navigate(it.href); }}
          onMouseEnter={() => onPrefetch(it.href)}
        >
          <it.Icon />
          <span className="rail-label">{it.label}</span>
        </a>
      ))}
      <div className="mt-auto flex flex-col items-center gap-1.5">
        {/* 管理后台为独立应用,阅读器不再提供入口;直接访问 /admin/ 即可 */}
        <ThemeButton />
      </div>
    </nav>
  );
}

// 未知路径兜底页（B72）：可见地告诉用户「这里没有页面」，并给出去处的链接。
// data-e2e 是端到端评测 E10 的锚点——改类名可以，改这个属性必须同步 tools/eval-e2e.cjs。
function NotFoundPage({ path }) {
  const links = [
    ['/reader/', '阅读器'],
    ['/daily/', '每日早报'],
    ['/mybrief/', '我的早报'],
    ['/weekly/', '精选周刊'],
    ['/hot/', '热点榜'],
    ['/reading/', '我的阅读'],
  ];
  return (
    <div className="flex h-full">
      <IconRail />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-16 sm:py-24 text-center" data-e2e="notfound">
          <div className="serif text-5xl font-bold t-text">404</div>
          <p className="mt-4 text-[13px] t-muted break-all">
            没有这个页面：<code className="t-accent">{path}</code>
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {links.map(([href, label]) => (
              <a key={href} href={href} className="pill !cursor-pointer text-[12px]">{label}</a>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function App() {
  const [path, setPath] = useState(window.location.pathname);

  // P0-5：客户端路由——pushState 切换页面，不销毁 JS 上下文
  const navigate = useCallback((newPath) => {
    if (newPath !== path) {
      window.history.pushState({}, '', newPath);
      setPath(newPath);
    }
  }, [path]);

  // 监听浏览器前进/后退
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // B72：此前 else 分支无条件渲染阅读器 —— 拼错 /打错前缀的路径（如 /videos/）会得到一个
  // 看起来正常、但内容完全无关的阅读器页面，用户无从知道自己走错了（vercel.json 的
  // catch-all 让所有路径都回 200 + index.html，服务端也不会 404）。
  const KNOWN_PREFIXES = ['/daily', '/mybrief', '/weekly', '/hot', '/reading', '/reader', '/admin', '/api'];
  const known = path === '/' || path === '' || KNOWN_PREFIXES.some((p) => path.startsWith(p));
  let page;
  if (path.startsWith('/daily')) page = <DailyPage />;
  else if (path.startsWith('/mybrief')) page = <MyBriefPage />;
  else if (path.startsWith('/weekly')) page = <WeeklyPage />;
  else if (path.startsWith('/hot')) page = <HotPage />;
  else if (path.startsWith('/reading')) page = <MyReadingPage />;
  else if (known) page = <ReaderPage />;
  else page = <NotFoundPage path={path} />;

  return (
    <NavCtx.Provider value={{ path, navigate }}>
      <LanguageProvider>
        <StoreProvider>
          <ThemeProvider>
            {page}
            <Toaster />
            <LoginGate />
          </ThemeProvider>
        </StoreProvider>
      </LanguageProvider>
    </NavCtx.Provider>
  );
}

createRoot(document.getElementById('root')).render(<App />);
