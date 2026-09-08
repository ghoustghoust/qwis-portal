import { useMemo, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { relativeTime } from '../util';
import {
  ChevronDownIcon, RefreshIcon, PlusIcon, XIcon, FolderIcon,
} from './icons.jsx';

const VIDEO_TYPES = ['bilibili', 'douyin', 'youtube'];
const COLLAPSED_KEY = 'qwis.groupsCollapsed';

function readCollapsed() {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

function sourceKind(source) {
  return VIDEO_TYPES.includes(source.type) ? 'video' : 'article';
}

const unreadOf = (s) => s.unread_count ?? s.unread ?? s.video_count ?? s.count ?? 0;

// 2.3 侧栏瘦身：分组渲染 + 拖拽 + 源列表 提取为独立组件
// 职责：分组折叠/展开、拖拽入组/移出、源渲染、新建/删除分组
export default function SidebarGroups({ kind, sources, groups, filter, onFilterChange, reloadKey, onReload }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [dragOverKey, setDragOverKey] = useState(null);
  const [newGroupId, setNewGroupId] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [sourceQuery, setSourceQuery] = useState('');

  const grouped = useMemo(() => {
    const q = sourceQuery.trim().toLowerCase();
    const visible = q
      ? sources.filter((s) => `${s.name || ''} ${s.url || ''}`.toLowerCase().includes(q))
      : sources;
    const byGroup = new Map(groups.map((g) => [g.id, []]));
    const ungrouped = [];
    for (const s of visible) {
      if (s.group_id && byGroup.has(s.group_id)) byGroup.get(s.group_id).push(s);
      else ungrouped.push(s);
    }
    return { byGroup, ungrouped };
  }, [groups, sources, sourceQuery]);

  const toggleGroupCollapsed = (e, id) => {
    e.stopPropagation();
    setCollapsed((m) => {
      const next = { ...m, [id]: m[id] === false ? true : false };
      try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const createGroup = async () => {
    const name = groupName.trim();
    if (!name) return;
    try {
      const r = await api.post('/api/groups', { name, kind });
      const id = r?.id ?? r?.item?.id ?? null;
      if (id) {
        setNewGroupId(id);
        setCollapsed((m) => {
          const next = { ...m, [id]: false };
          try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch {}
          return next;
        });
      }
      setGroupName('');
      setAddingGroup(false);
      onReload?.();
    } catch (e) { toast(e.message); }
  };

  const deleteGroup = async (g) => {
    if (!window.confirm(`删除分组「${g.name}」？组内订阅会移出分组。`)) return;
    try {
      await api.del(`/api/groups/${g.id}`);
      if (filter.groupId === g.id) onFilterChange({ ...filter, tab: 'all', sourceId: null, groupId: null });
      onReload?.();
    } catch (e) { toast(e.message); }
  };

  const onDragStart = (e, source) => {
    e.dataTransfer.setData('text/source-id', String(source.id));
    e.dataTransfer.effectAllowed = 'move';
    setDragging(true);
  };

  const onDropTo = async (e, groupId) => {
    e.preventDefault();
    setDragOverKey(null);
    setDragging(false);
    const id = Number(e.dataTransfer.getData('text/source-id'));
    if (!id) return;
    try {
      await api.post('/api/groups/move', { source_id: id, group_id: groupId });
      onReload?.();
    } catch (err) { toast(err.message); }
  };

  const dropProps = (key, groupId) => ({
    onDragOver: (e) => { e.preventDefault(); setDragOverKey(key); },
    onDragLeave: () => setDragOverKey((cur) => (cur === key ? null : cur)),
    onDrop: (e) => onDropTo(e, groupId),
  });

  const refreshSource = async (e, s) => {
    e.stopPropagation();
    try {
      await api.post(`/api/sources/${s.id}/refresh`);
      toast(`已触发刷新：${s.name}`);
      onReload?.();
    } catch (err) { toast(err.message); }
  };

  const renderSource = (s) => {
    const active = filter.sourceId === s.id;
    const unread = unreadOf(s);
    const schedTip = [
      s.last_fetched_at ? `上次抓取 ${relativeTime(s.last_fetched_at)}` : '',
      s.next_fetch_at ? `下次抓取 ${relativeTime(s.next_fetch_at)}` : '',
    ].filter(Boolean).join(' · ');
    return (
      <div key={s.id}>
        <div
          draggable
          onDragStart={(e) => onDragStart(e, s)}
          onDragEnd={() => setDragging(false)}
          onClick={() => onFilterChange({ ...filter, tab: 'all', sourceId: s.id, groupId: null })}
          title={schedTip || s.name || s.url}
          className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-[13px] ${
            active ? 't-accent-soft t-text font-medium' : 'hover:bg-[var(--surface-2)]'
          }`}
        >
          {s.avatar ? (
            <img referrerPolicy="no-referrer" src={s.avatar} alt=""
              className="w-[18px] h-[18px] rounded-full flex-none object-cover" loading="lazy"
              onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          ) : (
            <span className="w-[18px] h-[18px] rounded-full flex-none t-surface2 t-muted flex items-center justify-center text-[10px]">
              {(s.name || '?').slice(0, 1)}
            </span>
          )}
          <span className="flex-1 truncate t-text">{s.name || s.url}</span>
          <button className="icon-btn !w-6 !h-6 opacity-0 group-hover:opacity-100"
            title="手动刷新" onClick={(e) => refreshSource(e, s)}>
            <RefreshIcon size={13} />
          </button>
          {unread > 0 && <span className="text-[11px] t-muted flex-none tabular-nums">{unread}</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto px-3 pb-3">
      {/* 源搜索 */}
      <input
        className="input !py-1.5 mb-2 text-xs"
        placeholder="搜索来源…"
        value={sourceQuery}
        onChange={(e) => setSourceQuery(e.target.value)}
      />

      {/* 分组区 */}
      <div className="mt-4">
        <div className="flex items-center px-2 mb-1">
          <span className="flex-1 text-[11px] t-muted tracking-wide">
            {kind === 'article' ? '分组' : '视频分组'}
          </span>
          <button className="icon-btn !w-5 !h-5" title="新建分组"
            onClick={() => setAddingGroup((v) => !v)}>
            <PlusIcon size={13} />
          </button>
        </div>
        {addingGroup && (
          <div className="flex gap-1 px-1 mb-1">
            <input autoFocus className="input !py-1 !text-xs" placeholder="分组名称"
              value={groupName} onChange={(e) => setGroupName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createGroup()} />
            <button className="btn-primary !px-2 !py-1 !text-xs" onClick={createGroup}>建</button>
          </div>
        )}
        <div className="space-y-0.5">
          {groups.map((g) => {
            const active = filter.groupId === g.id;
            const over = dragOverKey === g.id;
            const members = grouped.byGroup.get(g.id) || [];
            if (members.length === 0 && g.id !== newGroupId) return null;
            const groupUnread = members.reduce((n, s) => n + unreadOf(s), 0);
            const isCollapsed = collapsed[g.id] !== false && !sourceQuery.trim();
            return (
              <div key={g.id}>
                <div
                  {...dropProps(g.id, g.id)}
                  onClick={() => onFilterChange({ ...filter, tab: 'all', sourceId: null, groupId: g.id })}
                  className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-[13px] ${
                    over ? 't-accent-soft outline outline-2 outline-[var(--accent)]'
                      : active ? 't-accent-soft t-text font-medium'
                      : 't-muted hover:bg-[var(--surface-2)]'
                  }`}
                >
                  <button className="w-4 h-4 flex-none flex items-center justify-center rounded t-muted hover:t-text"
                    title={isCollapsed ? '展开分组' : '折叠分组'} aria-expanded={!isCollapsed}
                    onClick={(e) => toggleGroupCollapsed(e, g.id)}>
                    <ChevronDownIcon size={13} className="transition-transform duration-200"
                      style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none' }} />
                  </button>
                  <FolderIcon size={14} className="flex-none t-muted" />
                  <span className="flex-1 truncate t-text" title={`${g.name} · ${members.length} 个源`}>{g.name}</span>
                  <button className="icon-btn !w-5 !h-5 opacity-0 group-hover:opacity-100"
                    title="删除分组" onClick={(e) => { e.stopPropagation(); deleteGroup(g); }}>
                    <XIcon size={11} />
                  </button>
                  {groupUnread > 0 && (
                    <span className="text-[11px] t-muted tabular-nums flex-none" title="组内未读合计">{groupUnread}</span>
                  )}
                </div>
                {!isCollapsed && <div className="ml-3">{members.map(renderSource)}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* 未分组源 */}
      {(grouped.ungrouped.length > 0 || sources.length === 0 || dragging) && (
        <div className="mt-4 rounded-lg" {...dropProps('ungrouped', null)}
          style={dragOverKey === 'ungrouped' ? { outline: '2px dashed var(--accent)' } : undefined}>
          <div className="px-2 mb-1 text-[11px] t-muted tracking-wide">
            {kind === 'article' ? '订阅源' : '视频订阅'}
          </div>
          <div className="space-y-0.5">{grouped.ungrouped.map(renderSource)}</div>
          {sources.length === 0 && (
            <div className="px-2 py-3 text-xs t-muted">暂无订阅，去管理后台（/admin/）添加</div>
          )}
        </div>
      )}
    </div>
  );
}
