import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, qs } from '../api';
import { toast } from '../toast';
import {
  DocIcon, HeartIcon, ClockIcon, PlayIcon, StarIcon,
} from './icons.jsx';
import SidebarGroups from './SidebarGroups.jsx';
import { useI18n } from '../i18n.jsx';

const VIDEO_TYPES = ['bilibili', 'douyin', 'youtube'];

function sourceKind(source) {
  return VIDEO_TYPES.includes(source.type) ? 'video' : 'article';
}

// 2.3 侧栏瘦身：分组/拖拽/源渲染 提取至 SidebarGroups.jsx
// Sidebar 只保留：数据加载 + 双 Tab 切换 + 视图导航 + 组合 SidebarGroups
export default function Sidebar({ mode, onModeChange, filter, onFilterChange, counts, reloadKey, views, onViewsChange }) {
  const { t } = useI18n();
  const kind = mode === 'video' ? 'video' : 'article';
  const [groups, setGroups] = useState([]);
  const [sources, setSources] = useState([]);

  const load = useCallback(async () => {
    try {
      const [g, s] = await Promise.all([
        api.get(`/api/groups${qs({ kind })}`),
        api.get('/api/sources?enabled=1'),
      ]);
      const groupList = Array.isArray(g) ? g : g?.items || g?.groups || [];
      const srcList = Array.isArray(s) ? s : s?.items || s?.sources || [];
      const visible = srcList.filter((x) => {
        if (kind === 'article' && x.type === 'hotlist') return false;
        try {
          const ex = JSON.parse(x.extra || '{}');
          if (ex.marksFeatured) return false;
          if (kind === 'article' && ex.aggregator) return false;
        } catch { /* extra 解析失败按普通源处理 */ }
        return true;
      });
      setGroups(groupList.filter((x) => !x.kind || x.kind === kind));
      setSources(visible.filter((x) => sourceKind(x) === kind));
    } catch { /* 后端未就绪时保持空态 */ }
  }, [kind]);

  useEffect(() => { load(); }, [load, reloadKey]);

  const selectTab = (tab) => onFilterChange({ tab, sourceId: null, groupId: null });

  // 十一期：删除视图
  const deleteView = async (viewId) => {
    const currentViews = views || [];
    const next = currentViews.filter((v) => v.id !== viewId);
    try {
      await api.put('/api/settings', { views: next });
      onViewsChange?.(next);
    } catch (e) { toast(e.message); }
  };

  // 十一期：应用视图
  const applyView = (v) => {
    const f = v.filter || {};
    onFilterChange({
      tab: f.tab || 'all', sourceId: f.sourceId || null, groupId: f.groupId || null,
      sort: f.sort || 'new', lang: f.lang || 'all', scoreMin: f.scoreMin || 0,
      timePreset: 'all', keyword: f.keyword || '', from: f.from || null, to: f.to || null,
    });
  };

  const unreadOf = (s) => s.unread_count ?? s.unread ?? s.video_count ?? s.count ?? 0;
  const derivedAll = sources.reduce((n, s) => n + (s.unread ?? 0), 0);
  const navCount = (tab) => (tab === 'all' ? derivedAll : counts?.[tab]);

  const navItems = kind === 'article'
    ? [
        { tab: 'all', Icon: DocIcon, label: t('sidebar.all') },
        { tab: 'later', Icon: HeartIcon, label: t('sidebar.later') },
        { tab: 'history', Icon: ClockIcon, label: t('sidebar.history') },
      ]
    : [
        { tab: 'all', Icon: PlayIcon, label: t('sidebar.allVideo') },
        { tab: 'favorite', Icon: StarIcon, label: t('sidebar.favorite') },
        { tab: 'history', Icon: ClockIcon, label: t('sidebar.history') },
      ];

  return (
    <aside className="w-60 flex-none border-r t-border t-bg flex flex-col h-full">
      {/* 文章 / 视频 双 Tab */}
      <div className="p-3 pb-2">
        <div className="flex rounded-lg t-surface2 p-0.5 text-[13px]">
          {[
            { id: 'article', label: t('sidebar.article') },
            { id: 'video', label: t('sidebar.video') },
          ].map((item) => (
            <button key={item.id} onClick={() => onModeChange(item.id)}
              className={`flex-1 rounded-md py-1 transition-colors ${
                mode === item.id ? 't-surface t-text font-medium shadow-sm' : 't-muted'
              }`}>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* 视图导航 */}
      <div className="px-3 pb-2">
        <div className="space-y-0.5">
          {navItems.map((it) => {
            const active = filter.tab === it.tab && !filter.sourceId && !filter.groupId;
            const n = navCount(it.tab);
            return (
              <button key={it.tab} onClick={() => selectTab(it.tab)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] text-left ${
                  active ? 't-accent-soft t-text font-medium' : 't-muted hover:bg-[var(--surface-2)]'
                }`}>
                <span className="w-4 flex items-center justify-center flex-none" aria-hidden>
                  <it.Icon size={15} />
                </span>
                <span className="flex-1">{it.label}</span>
                {n !== undefined && n !== null && (
                  <span className="text-[11px] tabular-nums t-muted">{n}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* 我的视图 */}
        {kind === 'article' && views && views.length > 0 && (
          <div className="mt-4">
            <div className="px-2 mb-1 text-[11px] t-muted tracking-wide">{t('sidebar.myViews')}</div>
            <div className="space-y-0.5">
              {views.map((v) => (
                <div key={v.id} className="group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-[13px] t-muted hover:bg-[var(--surface-2)]">
                  <button className="flex-1 text-left truncate"
                    onClick={() => applyView(v)}
                    title={v.filter ? `排序=${v.filter.sort || 'new'} 语言=${v.filter.lang || 'all'} 评分≥${v.filter.scoreMin || 0}` : v.name}>
                    {v.name}
                  </button>
                  <button className="icon-btn !w-5 !h-5 opacity-0 group-hover:opacity-100"
                    title={t('sidebar.deleteView')} onClick={() => deleteView(v.id)}>
                    <span className="text-[10px]">×</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 分组 + 源列表（提取至 SidebarGroups） */}
      <SidebarGroups
        kind={kind}
        sources={sources}
        groups={groups}
        filter={filter}
        onFilterChange={onFilterChange}
        reloadKey={reloadKey}
        onReload={load}
      />
    </aside>
  );
}
