// 2.1 全局状态共享层：轻量 React Context，集中管理跨页面共享数据
// 解决的问题：IconRail/ReaderPage/DailyPage 各自独立请求 /api/settings 等公共数据，
// 页面切换时全部重新拉取。本 store 在 App 层一次性加载，子组件按需消费。
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api';

const StoreCtx = createContext(null);

// 共享数据初始值
const INIT = {
  settings: null,      // GET /api/settings 全量
  enabledSources: null, // GET /api/sources?enabled=1
  groups: null,         // GET /api/groups
};

function StoreProvider({ children }) {
  const [state, setState] = useState(INIT);
  const loadedRef = useRef(false);

  // 一次性加载所有共享数据
  const loadAll = useCallback(async () => {
    try {
      const [settings, sources, groups] = await Promise.all([
        api.get('/api/settings'),
        api.get('/api/sources?enabled=1'),
        api.get('/api/groups'),
      ]);
      setState({
        settings: settings?.settings || settings || {},
        enabledSources: Array.isArray(sources) ? sources : sources?.items || sources?.sources || [],
        groups: Array.isArray(groups) ? groups : groups?.items || groups?.groups || [],
      });
      loadedRef.current = true;
    } catch (err) {
      // 部分接口未就绪时降级：保留已有数据，不覆盖为 null
      console.warn('[store] 加载共享数据部分失败:', err.message);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // 局部刷新：按 key 重新拉取单个数据源
  const refresh = useCallback(async (key) => {
    try {
      if (key === 'settings') {
        const s = await api.get('/api/settings');
        setState((prev) => ({ ...prev, settings: s?.settings || s || {} }));
      } else if (key === 'sources') {
        const s = await api.get('/api/sources?enabled=1');
        setState((prev) => ({
          ...prev,
          enabledSources: Array.isArray(s) ? s : s?.items || s?.sources || [],
        }));
      } else if (key === 'groups') {
        const g = await api.get('/api/groups');
        setState((prev) => ({
          ...prev,
          groups: Array.isArray(g) ? g : g?.items || g?.groups || [],
        }));
      }
    } catch (err) {
      console.warn(`[store] 刷新 ${key} 失败:`, err.message);
    }
  }, []);

  // 直接更新 settings（写操作后调用，避免重新拉取全量）
  const patchSettings = useCallback((patch) => {
    setState((prev) => ({
      ...prev,
      settings: prev.settings ? { ...prev.settings, ...patch } : patch,
    }));
  }, []);

  return (
    <StoreCtx.Provider value={{ ...state, loadAll, refresh, patchSettings }}>
      {children}
    </StoreCtx.Provider>
  );
}

// 消费 hook：返回共享状态 + 刷新方法
function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useStore 必须在 StoreProvider 内使用');
  return ctx;
}

// 便捷 hook：只取 settings
function useSettings() {
  const { settings } = useStore();
  return settings || {};
}

export { StoreProvider, useStore, useSettings };
