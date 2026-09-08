import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { relativeTime } from '../util';
import {
  SearchIcon, SparklesIcon, LockIcon, StarIcon,
  FolderIcon, ChevronDownIcon, RefreshIcon,
} from './icons.jsx';
import BackfillPreviewModal from './BackfillPreviewModal.jsx';
import SourceAvatar from './ui/SourceAvatar.jsx';

// 类型判定（与 plan 模块设计对齐）
const VIDEO_TYPES_SET = new Set(['bilibili', 'douyin', 'youtube']);
function displayKind(s) {
  if (s.type === 'wemp') return 'retired';
  if (s.type === 'x') return 'tweet';
  if (s.type === 'hotlist' || (s.extra && JSON.parse(s.extra || '{}').aggregator)) return 'hotlist';
  if (s.type === 'rss') {
    const ex = JSON.parse(s.extra || '{}');
    if (ex.origin === 'bestblogs-podcast' || (s.url || '').includes('xiaoyuzhoufm')) return 'podcast';
  }
  if (VIDEO_TYPES_SET.has(s.type)) return 'video';
  return 'article';
}
const KIND_LABEL = { article: '文章', video: '视频', podcast: '播客', tweet: '推文', hotlist: '热榜', retired: '已退役' };
const KIND_ORDER = { article: 0, podcast: 1, video: 2, tweet: 3, hotlist: 4, retired: 5 };

// 状态判定（2026-09-05 视觉精修：收敛为 badge 三态）
function healthStatus(s) {
  if (s.type === 'wemp') return { label: '已退役', cls: 'badge-gray' };
  if (!s.enabled && s.fail_count >= 3) return { label: `熔断中(${s.fail_count})`, cls: 'badge-red' };
  if (!s.enabled) return { label: '已停用', cls: 'badge-gray' };
  return { label: '正常', cls: 'badge-green' };
}

export default function SourceLibraryTab() {
  const [items, setItems] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState('');
  const [filterKind, setFilterKind] = useState('all');
  const [filterGroup, setFilterGroup] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [showBackfill, setShowBackfill] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [libData, grpData] = await Promise.all([
        api.get('/api/sources/library'),
        api.get('/api/groups'),
      ]);
      setItems(libData.items || []);
      setGroups(grpData.items || []);
    } catch (e) {
      toast('加载源库失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 筛选
  const filtered = useMemo(() => {
    let arr = items;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      arr = arr.filter((s) => (s.name || '').toLowerCase().includes(q) || (s.url || '').toLowerCase().includes(q));
    }
    if (filterKind !== 'all') {
      arr = arr.filter((s) => displayKind(s) === filterKind);
    }
    if (filterGroup !== 'all') {
      const gid = filterGroup === 'none' ? null : Number(filterGroup);
      arr = arr.filter((s) => s.group_id === gid);
    }
    if (filterStatus === 'disabled') arr = arr.filter((s) => !s.enabled && s.type !== 'wemp');
    else if (filterStatus === 'breaker') arr = arr.filter((s) => !s.enabled && s.fail_count >= 3);
    else if (filterStatus === 'focus') arr = arr.filter((s) => s.focus);
    return arr;
  }, [items, search, filterKind, filterGroup, filterStatus]);

  // 分页
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  // 全选本页
  const allPageSelected = pageItems.length > 0 && pageItems.every((s) => selected.has(s.id));
  function toggleSelectAll() {
    const next = new Set(selected);
    if (allPageSelected) {
      for (const s of pageItems) next.delete(s.id);
    } else {
      for (const s of pageItems) next.add(s.id);
    }
    setSelected(next);
  }
  function toggleSelect(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  // 批量操作
  async function doBatch(action, extra = {}) {
    if (!selected.size) return;
    setBatchBusy(true);
    try {
      const res = await api.post('/api/sources/batch', { ids: [...selected], action, ...extra });
      toast(`${action} 完成：成功 ${res.succeeded}${res.failed ? `，失败 ${res.failed}` : ''}`);
      setSelected(new Set());
      await load();
    } catch (e) {
      toast('批量操作失败: ' + e.message);
    } finally {
      setBatchBusy(false);
    }
  }

  // 单点操作（复用 batch 接口）
  async function doSingle(id, action, extra = {}) {
    try {
      await api.post('/api/sources/batch', { ids: [id], action, ...extra });
      await load();
    } catch (e) {
      toast('操作失败: ' + e.message);
    }
  }

  // 单点改组
  async function doMove(id, groupId) {
    try {
      await api.post('/api/groups/move', { source_id: id, group_id: groupId });
      await load();
    } catch (e) {
      toast(e.message);
    }
  }

  // 筛选用的文件夹列表（按 kind 过滤）
  const filterGroups = useMemo(() => {
    if (filterKind === 'all') return groups;
    if (filterKind === 'video') return groups.filter((g) => g.kind === 'video');
    return groups.filter((g) => g.kind === 'article');
  }, [groups, filterKind]);

  return (
    <div>
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-1.5 t-surface border t-border rounded-lg px-2.5 py-1.5 flex-1 min-w-[200px] max-w-[320px]">
          <SearchIcon size={15} className="t-muted flex-none" />
          <input
            className="bg-transparent outline-none text-sm w-full t-text placeholder:t-muted"
            placeholder="搜索源名称…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select className="input !w-auto" value={filterKind} onChange={(e) => { setFilterKind(e.target.value); setPage(1); }}>
          <option value="all">全部类型</option>
          <option value="article">文章</option>
          <option value="podcast">播客</option>
          <option value="video">视频</option>
          <option value="tweet">推文</option>
          <option value="hotlist">热榜</option>
        </select>
        <select className="input !w-auto" value={filterGroup} onChange={(e) => { setFilterGroup(e.target.value); setPage(1); }}>
          <option value="all">全部文件夹</option>
          <option value="none">未分组</option>
          {filterGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <select className="input !w-auto" value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
          <option value="all">全部状态</option>
          <option value="disabled">仅未启用</option>
          <option value="breaker">仅熔断</option>
          <option value="focus">仅特别关注</option>
        </select>
        <span className="flex-1" />
        <button className="btn-ghost text-sm flex items-center gap-1" onClick={() => setShowBackfill(true)}>
          <SparklesIcon size={15} /> 自动分类回填
        </button>
      </div>

      {/* 批量浮动条 */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-3 p-2.5 rounded-lg t-accent-soft border t-border">
          <span className="text-sm font-medium t-text">已选 {selected.size} 项</span>
          <span className="flex-1" />
          <button className="btn-ghost text-xs" disabled={batchBusy} onClick={() => doBatch('enable')}>启用</button>
          <button className="btn-ghost text-xs" disabled={batchBusy} onClick={() => doBatch('disable')}>停用</button>
          <button className="btn-ghost text-xs" disabled={batchBusy} onClick={() => doBatch('focus')}>特别关注</button>
          <button className="btn-ghost text-xs" disabled={batchBusy} onClick={() => doBatch('unfocus')}>取消关注</button>
          <div className="flex items-center gap-1">
            <span className="text-xs t-muted">移动到</span>
            <select className="input !w-auto !py-1 !text-xs" onChange={(e) => { if (e.target.value) { doBatch('move', { groupId: e.target.value === 'null' ? null : Number(e.target.value) }); e.target.value = ''; } }}>
              <option value="">选择文件夹…</option>
              <option value="null">未分组</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <button className="btn-ghost text-xs" onClick={() => setSelected(new Set())}>取消选择</button>
        </div>
      )}

      {/* 表格 */}
      {loading ? (
        <div className="text-center py-12 t-muted text-sm">加载中…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 t-muted text-sm">
          {items.length === 0 ? '源库为空，请先添加订阅源' : '没有匹配筛选条件的源'}
        </div>
      ) : (
        <div className="overflow-x-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b t-border text-xs t-muted">
                <th className="py-2 px-1.5 w-8">
                  <input type="checkbox" checked={allPageSelected} onChange={toggleSelectAll} />
                </th>
                <th className="py-2 px-1.5 w-9"></th>
                <th className="py-2 px-1.5 text-left">名称</th>
                <th className="py-2 px-1.5 text-left w-16">类型</th>
                <th className="py-2 px-1.5 text-left w-32">文件夹</th>
                <th className="py-2 px-1.5 text-left w-20">状态</th>
                <th className="py-2 px-1.5 text-right w-16">条目</th>
                <th className="py-2 px-1.5 text-left w-24">最近抓取</th>
                <th className="py-2 px-1.5 w-8">☆</th>
                <th className="py-2 px-1.5 w-10">启用</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((s) => {
                const kind = displayKind(s);
                const hs = healthStatus(s);
                let extra = {};
                try { extra = JSON.parse(s.extra || '{}'); } catch { /* ignore */ }
                const locked = !!extra.categoryLocked;
                // 文件夹下拉可用的组（同 kind）
                const sourceKind = VIDEO_TYPES_SET.has(s.type) ? 'video' : 'article';
                const availableGroups = groups.filter((g) => g.kind === sourceKind);
                return (
                  <tr key={s.id} className="border-b t-border/50 hover:t-surface/50">
                    <td className="py-2 px-1.5">
                      <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} />
                    </td>
                    <td className="py-2 px-1.5">
                      <SourceAvatar name={s.name} avatar={s.avatar} size={24} />
                    </td>
                    <td className="py-2 px-1.5">
                      <div className="flex items-center gap-1">
                        <span className="truncate max-w-[200px]" title={s.name}>{s.name}</span>
                        {locked && <LockIcon size={12} className="t-muted flex-none" title="手动锁定" />}
                      </div>
                    </td>
                    <td className="py-2 px-1.5">
                      <span className="pill">{KIND_LABEL[kind] || kind}</span>
                    </td>
                    <td className="py-2 px-1.5">
                      <select
                        className="input !py-0.5 !px-1.5 !text-xs w-full"
                        value={s.group_id ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          doMove(s.id, val === '' ? null : Number(val));
                        }}
                      >
                        <option value="">未分组</option>
                        {availableGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </td>
                    <td className="py-2 px-1.5">
                      <span className={hs.cls}>{hs.label}</span>
                    </td>
                    <td className="py-2 px-1.5 text-right tabular-nums">{s.itemCount}</td>
                    <td className="py-2 px-1.5 text-xs t-muted">{s.last_fetched_at ? relativeTime(s.last_fetched_at) : '—'}</td>
                    <td className="py-2 px-1.5">
                      <button
                        className="icon-btn !w-7 !h-7"
                        title={s.focus ? '取消特别关注' : '设为特别关注'}
                        onClick={() => doSingle(s.id, s.focus ? 'unfocus' : 'focus')}
                      >
                        <StarIcon
                          size={14}
                          className={s.focus ? 't-accent' : ''}
                          style={s.focus ? { fill: 'currentColor' } : undefined}
                        />
                      </button>
                    </td>
                    <td className="py-2 px-1.5">
                      <button
                        className={`switch ${s.enabled ? 'on' : ''}`}
                        onClick={() => doSingle(s.id, s.enabled ? 'disable' : 'enable')}
                        title={s.enabled ? '点击停用' : '点击启用'}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页（2026-09-05 视觉精修：页码 pill 化） */}
      {filtered.length > pageSize && (
        <div className="flex items-center justify-between mt-4 text-xs t-muted">
          <div className="flex items-center gap-2">
            <span>共 {filtered.length} 条</span>
            <select className="input !w-auto !py-0.5 !px-1.5 !text-xs" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
              <option value={20}>20条/页</option>
              <option value={50}>50条/页</option>
              <option value={100}>100条/页</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <button className="btn-ghost !py-1 !px-2.5" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
            <span className="pill on tabular-nums">{page} / {totalPages}</span>
            <button className="btn-ghost !py-1 !px-2.5" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</button>
          </div>
        </div>
      )}

      {/* 回填预览弹窗 */}
      {showBackfill && (
        <BackfillPreviewModal
          onClose={() => setShowBackfill(false)}
          onApplied={() => { setShowBackfill(false); load(); }}
        />
      )}
    </div>
  );
}
