import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, qs } from '../api';
import { toast } from '../toast';
import { relativeTime } from '../util';
import {
  DocIcon, HeartIcon, ClockIcon, PlayIcon, StarIcon,
  ChevronDownIcon, RefreshIcon, PlusIcon, XIcon,
} from './icons.jsx';

const VIDEO_TYPES = ['bilibili', 'douyin', 'youtube'];
const COLLAPSED_KEY = 'qwis.groupsCollapsed'; // 分组折叠状态（localStorage，默认全部展开）

function readCollapsed() {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function sourceKind(source) {
  return VIDEO_TYPES.includes(source.type) ? 'video' : 'article';
}

// 左侧导航：文章/视频双 Tab 共用（F1~F3）
export default function Sidebar({ mode, onModeChange, filter, onFilterChange, counts, reloadKey }) {
  const kind = mode === 'video' ? 'video' : 'article';
  const [groups, setGroups] = useState([]);
  const [sources, setSources] = useState([]);
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [dragOverKey, setDragOverKey] = useState(null); // group id 或 'ungrouped'
  const [collapsed, setCollapsed] = useState(readCollapsed); // { [groupId]: true }

  // 组头箭头点击折叠/展开，状态持久化（默认全部展开）
  const toggleGroupCollapsed = (e, id) => {
    e.stopPropagation();
    setCollapsed((m) => {
      const next = { ...m, [id]: !m[id] };
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const load = useCallback(async () => {
    try {
      const [g, s] = await Promise.all([
        api.get(`/api/groups${qs({ kind })}`),
        api.get('/api/sources?enabled=1'), // 读者侧栏只列启用源（停用/退役源不展示、不计未读）
      ]);
      const groupList = Array.isArray(g) ? g : g?.items || g?.groups || [];
      const srcList = Array.isArray(s) ? s : s?.items || s?.sources || [];
      // 标记型源（marksFeatured，如 AIHOT 精选全文）只做精选标注入，不产出自有内容，不进阅读器侧栏
      const visible = srcList.filter((x) => {
        try { return !JSON.parse(x.extra || '{}').marksFeatured; } catch { return true; }
      });
      setGroups(groupList.filter((x) => !x.kind || x.kind === kind));
      setSources(visible.filter((x) => sourceKind(x) === kind));
    } catch (e) {
      // 后端未就绪时保持空态
    }
  }, [kind]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const grouped = useMemo(() => {
    const byGroup = new Map(groups.map((g) => [g.id, []]));
    const ungrouped = [];
    for (const s of sources) {
      if (s.group_id && byGroup.has(s.group_id)) byGroup.get(s.group_id).push(s);
      else ungrouped.push(s);
    }
    return { byGroup, ungrouped };
  }, [groups, sources]);

  // 「全部/全部视频」计数 = 各源未读数之和（GET /api/sources 带 unread）；
  // 稍后阅读/历史存档/收藏计数在列表接口返回 counts 时采用（counts prop）
  const derivedAll = sources.reduce((n, s) => n + (s.unread ?? 0), 0);
  const navCount = (tab) => (tab === 'all' ? derivedAll : counts?.[tab]);

  const navItems =
    kind === 'article'
      ? [
          { tab: 'all', Icon: DocIcon, label: '全部' },
          { tab: 'later', Icon: HeartIcon, label: '稍后阅读' },
          { tab: 'history', Icon: ClockIcon, label: '历史存档' },
        ]
      : [
          { tab: 'all', Icon: PlayIcon, label: '全部视频' },
          { tab: 'favorite', Icon: StarIcon, label: '收藏' },
          { tab: 'history', Icon: ClockIcon, label: '历史存档' },
        ];

  const selectTab = (tab) => onFilterChange({ tab, sourceId: null, groupId: null });

  const createGroup = async () => {
    const name = groupName.trim();
    if (!name) return;
    try {
      await api.post('/api/groups', { name, kind });
      setGroupName('');
      setAddingGroup(false);
      load();
    } catch (e) {
      toast(e.message);
    }
  };

  const deleteGroup = async (g) => {
    if (!window.confirm(`删除分组「${g.name}」？组内订阅会移出分组。`)) return;
    try {
      await api.del(`/api/groups/${g.id}`);
      if (filter.groupId === g.id) selectTab(filter.tab);
      load();
    } catch (e) {
      toast(e.message);
    }
  };

  // HTML5 drag：把订阅源拖入分组（F2/F3）
  const onDragStart = (e, source) => {
    e.dataTransfer.setData('text/source-id', String(source.id));
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDropTo = async (e, groupId) => {
    e.preventDefault();
    setDragOverKey(null);
    const id = Number(e.dataTransfer.getData('text/source-id'));
    if (!id) return;
    try {
      await api.post('/api/groups/move', { source_id: id, group_id: groupId });
      load();
    } catch (err) {
      toast(err.message);
    }
  };
  const dropProps = (key, groupId) => ({
    onDragOver: (e) => {
      e.preventDefault();
      setDragOverKey(key);
    },
    onDragLeave: () => setDragOverKey((cur) => (cur === key ? null : cur)),
    onDrop: (e) => onDropTo(e, groupId),
  });

  const refreshSource = async (e, s) => {
    e.stopPropagation();
    try {
      await api.post(`/api/sources/${s.id}/refresh`);
      toast(`已触发刷新：${s.name}`);
      load();
    } catch (err) {
      toast(err.message);
    }
  };

  const renderSource = (s) => {
    const active = filter.sourceId === s.id;
    const unread = s.unread_count ?? s.unread ?? s.video_count ?? s.count;
    return (
      <div key={s.id}>
        <div
          draggable
          onDragStart={(e) => onDragStart(e, s)}
          onClick={() => onFilterChange({ ...filter, tab: 'all', sourceId: s.id, groupId: null })}
          className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-[13px] ${
            active ? 't-accent-soft t-text font-medium' : 'hover:bg-[var(--surface-2)]'
          }`}
        >
          {s.avatar ? (
            <img referrerPolicy="no-referrer"
              src={s.avatar}
              alt=""
              className="w-[18px] h-[18px] rounded-full flex-none object-cover"
              loading="lazy"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          ) : (
            <span className="w-[18px] h-[18px] rounded-full flex-none t-surface2 t-muted flex items-center justify-center text-[10px]">
              {(s.name || '?').slice(0, 1)}
            </span>
          )}
          <span className="flex-1 truncate t-text">{s.name || s.url}</span>
          <button
            className="icon-btn !w-6 !h-6 opacity-0 group-hover:opacity-100"
            title="手动刷新"
            onClick={(e) => refreshSource(e, s)}
          >
            <RefreshIcon size={13} />
          </button>
          {unread > 0 && <span className="text-[11px] t-muted flex-none tabular-nums">{unread}</span>}
        </div>
        {(s.last_fetched_at || s.next_fetch_at) && (
          <div className="pl-8 pr-2 -mt-0.5 pb-0.5 text-[10px] t-muted leading-tight">
            {s.last_fetched_at ? `上次 ${relativeTime(s.last_fetched_at)}` : ''}
            {s.last_fetched_at && s.next_fetch_at ? ' · ' : ''}
            {s.next_fetch_at ? `下次 ${relativeTime(s.next_fetch_at)}` : ''}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="w-60 flex-none border-r t-border t-bg flex flex-col h-full">
      {/* 文章 / 视频 双 Tab（F1） */}
      <div className="p-3 pb-2">
        <div className="flex rounded-lg t-surface2 p-0.5 text-[13px]">
          {[
            { id: 'article', label: '文章' },
            { id: 'video', label: '视频' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => onModeChange(t.id)}
              className={`flex-1 rounded-md py-1 transition-colors ${
                mode === t.id ? 't-surface t-text font-medium shadow-sm' : 't-muted'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {/* 视图导航（带计数，F2/F3） */}
        <div className="space-y-0.5">
          {navItems.map((it) => {
            const active = filter.tab === it.tab && !filter.sourceId && !filter.groupId;
            const n = navCount(it.tab);
            return (
              <button
                key={it.tab}
                onClick={() => selectTab(it.tab)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] text-left ${
                  active ? 't-accent-soft t-text font-medium' : 't-muted hover:bg-[var(--surface-2)]'
                }`}
              >
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

        {/* 分组区（新建分组 + 拖拽入组） */}
        <div className="mt-4">
          <div className="flex items-center px-2 mb-1">
            <span className="flex-1 text-[11px] t-muted tracking-wide">
              {kind === 'article' ? '分组' : '视频分组'}
            </span>
            <button
              className="icon-btn !w-5 !h-5"
              title="新建分组"
              onClick={() => setAddingGroup((v) => !v)}
            >
              <PlusIcon size={13} />
            </button>
          </div>
          {addingGroup && (
            <div className="flex gap-1 px-1 mb-1">
              <input
                autoFocus
                className="input !py-1 !text-xs"
                placeholder="分组名称"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createGroup()}
              />
              <button className="btn-primary !px-2 !py-1 !text-xs" onClick={createGroup}>
                建
              </button>
            </div>
          )}
          <div className="space-y-0.5">
            {groups.map((g) => {
              const active = filter.groupId === g.id;
              const over = dragOverKey === g.id;
              const members = grouped.byGroup.get(g.id) || [];
              const isCollapsed = !!collapsed[g.id];
              return (
                <div key={g.id}>
                  <div
                    {...dropProps(g.id, g.id)}
                    onClick={() =>
                      onFilterChange({ ...filter, tab: 'all', sourceId: null, groupId: g.id })
                    }
                    className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-[13px] ${
                      over
                        ? 't-accent-soft outline outline-2 outline-[var(--accent)]'
                        : active
                          ? 't-accent-soft t-text font-medium'
                          : 't-muted hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    <button
                      className="w-4 h-4 flex-none flex items-center justify-center rounded t-muted hover:t-text"
                      title={isCollapsed ? '展开分组' : '折叠分组'}
                      aria-expanded={!isCollapsed}
                      onClick={(e) => toggleGroupCollapsed(e, g.id)}
                    >
                      <ChevronDownIcon
                        size={13}
                        className="transition-transform duration-200"
                        style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none' }}
                      />
                    </button>
                    <span className="flex-1 truncate t-text">{g.name}</span>
                    <button
                      className="icon-btn !w-5 !h-5 opacity-0 group-hover:opacity-100"
                      title="删除分组"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteGroup(g);
                      }}
                    >
                      <XIcon size={11} />
                    </button>
                    <span className="text-[11px] t-muted tabular-nums">{members.length || ''}</span>
                  </div>
                  {!isCollapsed && <div className="ml-3">{members.map(renderSource)}</div>}
                </div>
              );
            })}
          </div>
        </div>

        {/* 订阅源列表（未分组；拖到这里移出分组） */}
        <div
          className="mt-4 rounded-lg"
          {...dropProps('ungrouped', null)}
          style={
            dragOverKey === 'ungrouped'
              ? { outline: '2px dashed var(--accent)' }
              : undefined
          }
        >
          <div className="px-2 mb-1 text-[11px] t-muted tracking-wide">
            {kind === 'article' ? '订阅源' : '视频订阅'}
          </div>
          <div className="space-y-0.5">{grouped.ungrouped.map(renderSource)}</div>
          {sources.length === 0 && (
            <div className="px-2 py-3 text-xs t-muted">暂无订阅，去管理后台（/admin/）添加</div>
          )}
        </div>
      </div>
    </aside>
  );
}
