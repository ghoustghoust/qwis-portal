import { useCallback, useState } from 'react';
import { IconRail } from '../main.jsx';
import Sidebar from '../components/Sidebar.jsx';
import ArticleList from '../components/ArticleList.jsx';
import ArticleView from '../components/ArticleView.jsx';
import VideoGrid from '../components/VideoGrid.jsx';
import VideoDetail from '../components/VideoDetail.jsx';

const EMPTY_FILTER = { tab: 'all', sourceId: null, groupId: null, from: null, to: null };

// 阅读器页（/reader/）：三栏布局 + 文章/视频双 Tab 共用 Sidebar（T16）
// T12/F4：文章与视频的筛选（含日期 from/to）各自独立记住
export default function ReaderPage() {
  const [mode, setMode] = useState('article'); // article | video
  const [filters, setFilters] = useState({ article: { ...EMPTY_FILTER }, video: { ...EMPTY_FILTER } });
  const [q, setQ] = useState('');
  const [selectedArticleId, setSelectedArticleId] = useState(null);
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const [articleItems, setArticleItems] = useState([]);
  const [listCounts, setListCounts] = useState(null); // 列表接口若返回 counts 则采用
  const [sidebarKey, setSidebarKey] = useState(0); // 侧栏（订阅源/计数）刷新
  const [listKey, setListKey] = useState(0); // 列表刷新（全部已读等）

  const filter = filters[mode];

  const refreshSidebar = useCallback(() => setSidebarKey((k) => k + 1), []);

  const onModeChange = (m) => {
    setMode(m);
    setQ('');
    setSelectedArticleId(null);
    setSelectedVideoId(null);
    setListCounts(null);
  };

  // Sidebar 换源/分组/Tab：保留当前模式的日期范围
  const onFilterChange = (f) => {
    setFilters((prev) => ({ ...prev, [mode]: { ...prev[mode], ...f } }));
    setSelectedArticleId(null);
    setSelectedVideoId(null);
  };

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
      />
      {mode === 'article' ? (
        <>
          <ArticleList
            filter={filter}
            q={q}
            onSearch={setQ}
            onDateChange={onDateChange}
            selectedId={selectedArticleId}
            onSelect={setSelectedArticleId}
            onMeta={onMeta}
            onItems={setArticleItems}
            reloadKey={listKey}
          />
          <ArticleView
            articleId={selectedArticleId}
            items={articleItems}
            filter={filter}
            onSelect={setSelectedArticleId}
            onClose={() => setSelectedArticleId(null)}
            onChanged={onArticleChanged}
          />
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
