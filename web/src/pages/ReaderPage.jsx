import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { useRealtime } from '../hooks/useRealtime';
import { IconRail } from '../main.jsx';
import Sidebar from '../components/Sidebar.jsx';
import ArticleList from '../components/ArticleList.jsx';
import ArticleView from '../components/ArticleView.jsx';
import OverviewRail from '../components/OverviewRail.jsx'; // 2026-09-05 视觉精修：未选中文章时的右侧统计轨
import VideoGrid from '../components/VideoGrid.jsx';
import VideoDetail from '../components/VideoDetail.jsx';
import { toast } from '../toast';

const SORT_KEY = 'qwis.sort'; // 排序选择记忆

function readSort() {
  try { return localStorage.getItem(SORT_KEY) || 'new'; } catch { return 'new'; }
}

const EMPTY_FILTER = {
  tab: 'all', sourceId: null, groupId: null, from: null, to: null,
  sort: 'new', lang: 'all', scoreMin: 0, timePreset: 'all', keyword: '',
};

// 阅读器页（/reader/）：三栏布局 + 文章/视频双 Tab 共用 Sidebar（T16）
// T12/F4：文章与视频的筛选（含日期 from/to）各自独立记住
export default function ReaderPage() {
  const { settings, refresh: refreshStore } = useStore();
  const { newCount, lastEvent, consumeNewCount } = useRealtime();
  const [mode, setMode] = useState('article'); // article | video
  const [filters, setFilters] = useState({
    article: { ...EMPTY_FILTER, sort: readSort() },
    video: { ...EMPTY_FILTER },
  });
  const [q, setQ] = useState('');
  const [selectedArticleId, setSelectedArticleId] = useState(null);
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const [articleItems, setArticleItems] = useState([]);
  const [listCounts, setListCounts] = useState(null);
  const [sidebarKey, setSidebarKey] = useState(0);
  const [listKey, setListKey] = useState(0);

  // SSE 实时推送：新文章到达时 Toast 通知 + 自动刷新列表
  useEffect(() => {
    if (lastEvent?.type === 'new_articles' && newCount > 0) {
      const source = lastEvent.sourceName || '';
      const count = lastEvent.count || 1;
      toast(`${source ? source + ' ' : ''}新增 ${count} 篇文章`);
      // 如果未选中文章（正在浏览列表），自动刷新
      if (!selectedArticleId && mode === 'article') {
        setListKey((k) => k + 1);
        consumeNewCount();
      }
    }
  }, [lastEvent, newCount, selectedArticleId, mode, consumeNewCount]);

  // 2.1 增强：views 从全局 store 读取，不再独立请求 /api/settings
  const views = Array.isArray(settings?.views) ? settings.views : [];

  const filter = filters[mode];

  const refreshSidebar = useCallback(() => setSidebarKey((k) => k + 1), []);

  const onModeChange = (m) => {
    setMode(m);
    setQ('');
    setSelectedArticleId(null);
    setSelectedVideoId(null);
    setListCounts(null);
  };

  // 排序记忆
  const onFilterChange = useCallback((f) => {
    if (f.sort) {
      try { localStorage.setItem(SORT_KEY, f.sort); } catch {}
    }
    setFilters((prev) => ({ ...prev, [mode]: { ...prev[mode], ...f } }));
    setSelectedArticleId(null);
    setSelectedVideoId(null);
  }, [mode]);

  // DateFilter 改日期范围
  const onDateChange = useCallback(
    ({ from, to }) => {
      setFilters((prev) => ({ ...prev, [mode]: { ...prev[mode], from, to } }));
    },
    [mode]
  );

  // 读文章/稍后读等操作后：刷新侧栏计数；refreshList=true（全部已读）时同时刷新列表
  const onArticleChanged = useCallback(
    (refreshList) => {
      refreshSidebar();
      if (refreshList) setListKey((k) => k + 1);
    },
    [refreshSidebar]
  );

  const onMeta = useCallback((data) => {
    if (data && data.counts) setListCounts(data.counts);
  }, []);

  return (
    <div className="flex h-screen t-bg t-text overflow-hidden">
      <IconRail />
      <Sidebar
        mode={mode}
        onModeChange={onModeChange}
        filter={filter}
        onFilterChange={onFilterChange}
        counts={listCounts}
        reloadKey={sidebarKey}
        views={views}
        onViewsChange={() => refreshStore('settings')}
      />
      {mode === 'article' ? (
        <>
          <ArticleList
            filter={filter}
            q={q}
            onSearch={setQ}
            onDateChange={onDateChange}
            onFilterChange={onFilterChange}
            selectedId={selectedArticleId}
            onSelect={setSelectedArticleId}
            onMeta={onMeta}
            onItems={setArticleItems}
            reloadKey={listKey}
            views={views}
            onViewsChange={() => refreshStore('settings')}
            newCount={selectedArticleId ? newCount : 0}
            lastEvent={lastEvent}
            onBannerRefresh={() => { setListKey((k) => k + 1); consumeNewCount(); }}
          />
          {/* 2026-09-05：正文区与右侧本周概览解耦——ArticleView 自渲空态，OverviewRail 常驻右栏 */}
          <ArticleView
            articleId={selectedArticleId}
            items={articleItems}
            filter={filter}
            onSelect={setSelectedArticleId}
            onClose={() => setSelectedArticleId(null)}
            onChanged={onArticleChanged}
          />
          <OverviewRail />
        </>
      ) : selectedVideoId ? (
        <VideoDetail
          videoId={selectedVideoId}
          onBack={() => setSelectedVideoId(null)}
          onChanged={refreshSidebar}
        />
      ) : (
        <VideoGrid filter={filter} onDateChange={onDateChange} onSelect={setSelectedVideoId} onMeta={onMeta} reloadKey={listKey} />
      )}
    </div>
  );
}
