import { createContext, useContext, useEffect, useState } from 'react';
import { SunIcon, WavesIcon, MoonIcon } from './components/icons.jsx';

// 三套主题：warm-paper（米色底+棕色按钮，默认）/ blue-white / dark（F12）
export const THEMES = [
  { id: 'warm-paper', label: '暖色纸张', Icon: SunIcon },
  { id: 'blue-white', label: '蓝白', Icon: WavesIcon },
  { id: 'dark', label: '深色', Icon: MoonIcon },
];
const STORAGE_KEY = 'qw-theme';

function getInitialTheme() {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    if (THEMES.some((x) => x.id === t)) return t;
  } catch (e) {
    /* ignore */
  }
  return 'warm-paper';
}

const ThemeCtx = createContext({ theme: 'warm-paper', cycleTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      /* ignore */
    }
  }, [theme]);

  const cycleTheme = () => {
    const idx = THEMES.findIndex((x) => x.id === theme);
    setTheme(THEMES[(idx + 1) % THEMES.length].id);
  };

  return <ThemeCtx.Provider value={{ theme, cycleTheme }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx);
}

// 左下角主题按钮：循环切换，localStorage 持久化（F12/N6）
export function ThemeButton() {
  const { theme, cycleTheme } = useTheme();
  const cur = THEMES.find((x) => x.id === theme) || THEMES[0];
  return (
    <button
      onClick={cycleTheme}
      title={`主题：${cur.label}（点击切换）`}
      className="icon-btn border t-border t-surface"
      style={{ boxShadow: 'var(--shadow)' }}
    >
      <cur.Icon size={16} />
    </button>
  );
}
