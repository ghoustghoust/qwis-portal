import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { relativeTime } from '../util';
import {
  SearchIcon, SparklesIcon, LockIcon, StarIcon,
  FolderIcon, ChevronDownIcon, RefreshIcon, TrashIcon,
} from './icons.jsx';
import BackfillPreviewModal from './BackfillPreviewModal.jsx';
import SourceAvatar from './ui/SourceAvatar.jsx';

// 平台接入（spec30：公众号 RSS / B站 两个平台 Tab 并入源库，功能零丢失）
const WechatTab = lazy(() => import('./WechatTab.jsx'));
const BilibiliTab = lazy(() => import('./BilibiliTab.jsx'));

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

function extraOf(s) {
  try { return JSON.parse(s.extra || '{}'); } catch { return {}; }
}

// 问题源判定（29-source-groups「问题源视图」）：熔断/报错/近 48h 新增待确认
function isIssueSource(s, nowMs) {
  if (s.type === 'wemp') return false;
  if (!s.enabled && (s.fail_count || 0) >= 3) return true; // 熔断
  if (s.status === 'error' || (s.fail_count || 0) > 0) return true; // 报错/有失败计数
  const created = Date.parse(s.created_at || '');
  if (Number.isFinite(created) && nowMs - created < 48 * 3600e3) return true; // 新增未确认
  return false;
}

const VIEW_LABEL = { groups: '组合', issues: '问题源', search: '检索', platform: '平台接入' };

// 29-source-groups（2026-09-15）：源库从「1500 行表格」重构为三视图——
// 组合视图（默认，组为卡片）/ 问题源视图（只列异常）/ 检索视图（原全量表格）+ 平台接入（spec30 并入）
export default function SourceLibraryTab() {
  const [view, setView] = useState('groups');
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
      setGroups(grpData.items || grpData.groups || []);
    } catch (e) {
      toast('加载源库失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── 组合视图聚合：组卡片数据（29 验收①：组为卡片单位；需要处理的组排前） ──
  const groupCards = useMemo(() => {
    const nowMs = Date.now();
    const byGroup = new Map(); // gid | null → members[]
    for (const s of items) {
      const key = s.group_id ?? null;
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(s);
    }
    const cards = [];
    for (const [gid, members] of byGroup) {
      const g = gid === null ? null : groups.find((x) => x.id === gid);
      const total = members.length;
      const okN = members.filter((s) => s.enabled && s.status === 'ok' && !(s.fail_count > 0)).length;
      const breakerN = members.filter((s) => !s.enabled && (s.fail_count || 0) >= 3).length;
      const errorN = members.filter((s) => s.status === 'error' || (s.enabled && (s.fail_count || 0) > 0)).length;
      const disabledN = members.filter((s) => !s.enabled && (s.fail_count || 0) < 3).length;
      const issueN = members.filter((s) => isIssueSource(s, nowMs)).length;
      const intervals = members.map((s) => Number(extraOf(s).intervalMin)).filter((n) => Number.isFinite(n) && n > 0);
      const intervalText = intervals.length === 0 ? '跟随全局'
        : new Set(intervals).size === 1 ? `${intervals[0]}min` : '混合';
      // 四轴计数（组卡一键设轴的现状反馈）
      const spotlightN = members.filter((s) => s.spotlight).length;
      const mutedN = members.filter((s) => s.muted).length;
      const invisibleN = members.filter((s) => s.reader_visible === 0).length;
      cards.push({
        gid, name: g ? g.name : '未分组', kind: g ? g.kind : null, total, okN,
        okRate: total ? Math.round((okN / total) * 100) : 100,
        breakerN, errorN, disabledN, issueN, intervalText,
        spotlightN, mutedN, invisibleN,
        allDisabled: disabledN + breakerN === total,
        allSpotlight: spotlightN === total, allMuted: mutedN === total,
      });
    }
    // 需要处理的组排前（含熔断/报错），其余按源数降序
    cards.sort((a, b) => (b.issueN - a.issueN) || (b.total - a.total));
    return cards;
  }, [items, groups]);

  const issueSources = useMemo(() => {
    const nowMs = Date.now();
    return items.filter((s) => isIssueSource(s, nowMs))
      .sort((a, b) => (b.fail_count || 0) - (a.fail_count || 0) || (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0));
  }, [items]);

  // 组级操作（27b ②：源库可对组批量设各轴；组级走 groupScopeId 单条 SQL）
  async function doGroup(gid, action, extra = {}, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      const r = await api.post('/api/sources/batch', { groupScopeId: gid, action, ...extra });
      toast(`组级 ${action} 完成：${r.succeeded} 个源${r.group ? `（${r.group}）` : ''}`);
      await load();
    } catch (e) {
      toast('组级操作失败: ' + e.message);
    }
  }

  function enterGroup(gid) {
    setFilterGroup(gid === null ? 'none' : String(gid));
    setFilterKind('all');
    setFilterStatus('all');
    setSearch('');
    setPage(1);
    setView('search');
  }

  // 筛选（检索视图）
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
    else if (filterStatus === 'spotlight') arr = arr.filter((s) => s.spotlight);
    else if (filterStatus === 'muted') arr = arr.filter((s) => s.muted);
    else if (filterStatus === 'invisible') arr = arr.filter((s) => s.reader_visible === 0);
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

  // ── 表格行（检索视图与问题源视图共用的单源操作列） ──
  const rowOps = (s) => (
    <>
      <button
        className="icon-btn !w-7 !h-7"
        title={s.spotlight ? '取消重点（每日早报重点栏 + 智能排序加权）' : '设为重点（每日早报重点栏 + 智能排序加权）'}
        onClick={() => doSingle(s.id, s.spotlight ? 'unspotlight' : 'spotlight')}
      >
        <StarIcon
          size={14}
          className={s.spotlight ? 't-accent' : ''}
          style={s.spotlight ? { fill: 'currentColor' } : undefined}
        />
      </button>
      <button
        className="icon-btn !w-7 !h-7 t-muted hover:text-red-500"
        title="删除源（级联删除其全部文章/视频，不可恢复）"
        onClick={async () => {
          if (!window.confirm('确认删除源「' + s.name + '」？其全部文章/视频将一并删除。')) return;
          try { await api.del('/api/sources/' + s.id); toast('已删除 ' + s.name); load(); } catch (e) { toast(e.message); }
        }}
      >
        <TrashIcon size={13} />
      </button>
      <button
        className={`switch ${s.enabled ? 'on' : ''}`}
        style={s.type === 'wemp' ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
        disabled={s.type === 'wemp'}
        onClick={() => doSingle(s.id, s.enabled ? 'disable' : 'enable')}
        title={s.type === 'wemp' ? '已退役：该源采集引擎已下线，无法重新启用——请改用 wechat2rss 新源' : (s.enabled ? '点击停用' : '点击启用')}
      />
    </>
  );

  return (
    <div>
      {/* 视图切换（29：默认组合视图） */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {['groups', 'issues', 'search', 'platform'].map((v) => (
          <button
            key={v}
            className={`pill !px-3 !py-1.5 !text-[13px] cursor-pointer ${view === v ? 'on' : ''}`}
            onClick={() => setView(v)}
          >
            {VIEW_LABEL[v]}
            {v === 'issues' && issueSources.length > 0 && (
              <span className="ml-1 badge-red">{issueSources.length}</span>
            )}
          </button>
        ))}
        <span className="flex-1" />
        <span className="text-xs t-muted">{items.length} 源 · {groups.length} 组</span>
      </div>

      {loading ? (
        <div className="text-center py-12 t-muted text-sm">加载中…</div>
      ) : view === 'groups' ? (
        /* ── 组合视图：组卡片（需要处理的组排前） ── */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {groupCards.map((c) => (
            <div key={c.gid ?? 'none'} className="card p-4">
              <div className="flex items-center gap-2">
                <FolderIcon size={15} className="t-muted flex-none" />
                <span className="font-medium t-text truncate flex-1" title={c.name}>{c.name}</span>
                {c.breakerN > 0 && <span className="badge-red flex-none">熔断 {c.breakerN}</span>}
                {c.errorN > 0 && <span className="badge-red flex-none">报错 {c.errorN}</span>}
              </div>
              <div className="mt-2 flex items-center gap-2 text-[11px] t-muted tabular-nums flex-wrap">
                <span>{c.total} 源</span>
                <span className="sep">·</span>
                <span className={c.okRate >= 90 ? 'text-[var(--green)]' : c.okRate >= 70 ? '' : 'text-[var(--red)]'}>正常率 {c.okRate}%</span>
                <span className="sep">·</span>
                <span>{c.intervalText}</span>
              </div>
              {/* 四轴现状（27b：一轴一控件只管一件事，点按=全组设置/取消）
                  未分组卡（gid=null）无组级操作目标——后端 groupScopeId 需非空 id，禁用并引导去检索视图（对抗审查 P1-1） */}
              {c.gid === null ? (
                <div className="mt-2.5 text-[11px] t-muted">未分组源请「进入」后在检索视图按 ids 批量操作</div>
              ) : (
              <>
              <div className="mt-2.5 flex items-center gap-1.5 flex-wrap text-[11px]">
                <button
                  className={`pill cursor-pointer ${c.allSpotlight ? 'on' : ''}`}
                  title={`重点轴：进每日早报「重点更新」栏 + 智能排序加权（当前 ${c.spotlightN}/${c.total}）——点击${c.allSpotlight ? '全组取消' : '全组设为'}重点`}
                  onClick={() => doGroup(c.gid, c.allSpotlight ? 'unspotlight' : 'spotlight')}
                >重点 {c.spotlightN}</button>
                <button
                  className="pill cursor-pointer"
                  title="订阅轴：高分内容进「我的早报」（整组加入订阅）"
                  onClick={() => doGroup(c.gid, 'subscribe', {}, `把「${c.name}」整组加入我的早报订阅？`)}
                >订阅</button>
                <button
                  className={`pill cursor-pointer ${c.allMuted ? 'on' : ''}`}
                  title={`屏蔽轴：从热点榜/阅读器排除（当前 ${c.mutedN}/${c.total}）——点击${c.allMuted ? '全组解除' : '全组屏蔽'}`}
                  onClick={() => doGroup(c.gid, c.allMuted ? 'unmute' : 'mute', {}, c.allMuted ? undefined : `屏蔽「${c.name}」整组？其内容将从热点榜/阅读器隐藏（数据仍在，检索源时可见）`)}
                >屏蔽 {c.mutedN}</button>
                <button
                  className={`pill cursor-pointer ${c.invisibleN === c.total ? 'on' : ''}`}
                  title={`收录轴：内容是否进阅读器列表（当前 ${c.total - c.invisibleN}/${c.total} 收录）——点击全组${c.invisibleN === c.total ? '恢复收录' : '移出阅读器'}`}
                  onClick={() => doGroup(c.gid, c.invisibleN === c.total ? 'visible' : 'invisible')}
                >收录 {c.total - c.invisibleN}</button>
              </div>
              <div className="mt-2.5 pt-2.5 border-t t-border flex items-center gap-1.5 flex-wrap">
                <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => enterGroup(c.gid)}>进入</button>
                {c.allDisabled ? (
                  <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => doGroup(c.gid, 'enable')}>恢复组</button>
                ) : (
                  <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => doGroup(c.gid, 'disable', {}, `暂停「${c.name}」整组（${c.total} 源停止采集，数据保留）？`)}>暂停组</button>
                )}
                <button
                  className="btn-ghost !py-1 !px-2.5 text-xs"
                  title="整组刷新间隔（分钟）；留空=跟随全局"
                  onClick={() => {
                    const v = window.prompt(`「${c.name}」整组调频（分钟，留空跟随全局）：`, '');
                    if (v === null) return;
                    const t = v.trim();
                    doGroup(c.gid, 'interval', { intervalMin: t === '' ? null : Number(t) });
                  }}
                >调频</button>
                <button
                  className="btn-ghost !py-1 !px-2.5 text-xs"
                  title="failover 组标记：同组名互为备用，主源熔断时 runner 自动换备用源（T4-2 R2）；留空清除"
                  onClick={() => {
                    const v = window.prompt(`「${c.name}」failover 组名（同名字母互为备用；留空清除）：`, '');
                    if (v === null) return;
                    doGroup(c.gid, 'failover', { failoverGroup: v.trim() });
                  }}
                >failover</button>
              </div>
              </>
              )}
            </div>
          ))}
        </div>
      ) : view === 'issues' ? (
        /* ── 问题源视图：只列熔断/报错/新增未确认（29 验收②） ── */
        issueSources.length === 0 ? (
          <div className="text-center py-12 t-muted text-sm">🎉 没有需要处理的问题源</div>
        ) : (
          <div className="overflow-x-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b t-border text-xs t-muted">
                  <th className="py-2 px-1.5 w-9"></th>
                  <th className="py-2 px-1.5 text-left">名称</th>
                  <th className="py-2 px-1.5 text-left w-24">文件夹</th>
                  <th className="py-2 px-1.5 text-left w-24">状态</th>
                  <th className="py-2 px-1.5 text-left">最近错误</th>
                  <th className="py-2 px-1.5 text-left w-24">入库时间</th>
                  <th className="py-2 px-1.5 w-24">操作</th>
                </tr>
              </thead>
              <tbody>
                {issueSources.map((s) => {
                  const hs = healthStatus(s);
                  const ex = extraOf(s);
                  const g = groups.find((x) => x.id === s.group_id);
                  const isNew = !s.fail_count && s.status !== 'error';
                  return (
                    <tr key={s.id} className="border-b t-border/50 hover:t-surface/50">
                      <td className="py-2 px-1.5"><SourceAvatar name={s.name} avatar={s.avatar} size={24} /></td>
                      <td className="py-2 px-1.5">
                        <span className="truncate max-w-[200px] inline-block align-middle" title={s.name}>{s.name}</span>
                        {isNew && <span className="pill on ml-1.5">新增</span>}
                      </td>
                      <td className="py-2 px-1.5 text-xs t-muted">{g ? g.name : '未分组'}</td>
                      <td className="py-2 px-1.5"><span className={hs.cls}>{hs.label}</span></td>
                      <td className="py-2 px-1.5 text-xs t-muted truncate max-w-[260px]" title={ex.lastError || ''}>{ex.lastError || '—'}</td>
                      <td className="py-2 px-1.5 text-xs t-muted">{s.created_at ? relativeTime(s.created_at) : '—'}</td>
                      <td className="py-2 px-1.5">
                        <div className="flex items-center gap-1">{rowOps(s)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : view === 'platform' ? (
        /* ── 平台接入（spec30：公众号 RSS / B站 原独立 Tab 并入，功能零丢失） ── */
        <div className="space-y-8">
          <section>
            <div className="text-base font-bold t-text mb-1">公众号 RSS</div>
            <div className="text-[11px] t-muted mb-3">→ 作用于 阅读器文章流 / 每日早报文章来源</div>
            <Suspense fallback={<div className="py-12 text-center text-sm t-muted">加载中…</div>}>
              <WechatTab />
            </Suspense>
          </section>
          <section>
            <div className="text-base font-bold t-text mb-1">B 站</div>
            <div className="text-[11px] t-muted mb-3">→ 作用于 阅读器视频板块 / 每日早报视频栏</div>
            <Suspense fallback={<div className="py-12 text-center text-sm t-muted">加载中…</div>}>
              <BilibiliTab />
            </Suspense>
          </section>
        </div>
      ) : (
        /* ── 检索视图：原全量表格（29 验收④：现全部能力移入此视图） ── */
        <>
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
          <option value="spotlight">仅重点</option>
          <option value="muted">仅屏蔽</option>
          <option value="invisible">仅未收录</option>
        </select>
        <span className="flex-1" />
        <button
          className="btn-ghost text-sm flex items-center gap-1"
          title="新建文件夹后可在行内下拉把源移动进去"
          onClick={async () => {
            const name = window.prompt('新文件夹名称：');
            if (!name || !name.trim()) return;
            const kind = filterKind === 'video' ? 'video' : 'article';
            try {
              await api.post('/api/groups', { name: name.trim(), kind });
              toast('已创建文件夹「' + name.trim() + '」');
              load();
            } catch (e) { toast(e.message); }
          }}
        >
          <FolderIcon size={15} /> 新建文件夹
        </button>
        <button
          className="btn-ghost text-sm flex items-center gap-1"
          title="同 URL 或 同名同域 的重复源合并：每组保留最优，其余停用并标记"
          onClick={async () => {
            try {
              const prev = await api.post('/api/sources/dedupe', {});
              if (!prev.groups) return toast('查重完成：无重复');
              if (!window.confirm(`发现 ${prev.groups} 组重复源。
合并将停用每组冗余源（保留启用中/失败最少的一个）并标记 mergedInto。
执行合并？`)) return;
              const r = await api.post('/api/sources/dedupe', { apply: true });
              toast(`已合并 ${r.merged} 个冗余源（${r.groups} 组）`);
              load();
            } catch (e) { toast(e.message); }
          }}
        >
          查重合并
        </button>
        <a
          className="btn-ghost text-sm flex items-center gap-1"
          href="/api/opml/export"
          download="qwis-sources.opml"
          title="导出全部订阅源为标准 OPML，可导入其他 RSS 阅读器"
        >
          <RefreshIcon size={15} /> 导出 OPML
        </a>
        <button className="btn-ghost text-sm flex items-center gap-1" onClick={() => setShowBackfill(true)}>
          <SparklesIcon size={15} /> 自动分类回填
        </button>
      </div>

      {/* 批量浮动条（27b：四轴批量操作） */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-3 p-2.5 rounded-lg t-accent-soft border t-border flex-wrap">
          <span className="text-sm font-medium t-text">已选 {selected.size} 项</span>
          <span className="flex-1" />
          <button className="btn-ghost text-xs" disabled={batchBusy} onClick={() => doBatch('enable')}>启用</button>
          <button className="btn-ghost text-xs" disabled={batchBusy} onClick={() => doBatch('disable')}>停用</button>
          <button className="btn-ghost text-xs" disabled={batchBusy} title="重点轴：进每日早报重点栏 + 智能排序加权" onClick={() => doBatch('spotlight')}>设重点</button>
          <button className="btn-ghost text-xs" disabled={batchBusy} onClick={() => doBatch('unspotlight')}>取消重点</button>
          <button className="btn-ghost text-xs" disabled={batchBusy} title="订阅轴：高分内容进我的早报" onClick={() => doBatch('subscribe')}>订阅</button>
          <button className="btn-ghost text-xs" disabled={batchBusy} onClick={() => doBatch('unsubscribe')}>退订</button>
          <button className="btn-ghost text-xs" disabled={batchBusy} title="屏蔽轴：从热点榜/阅读器排除" onClick={() => doBatch('mute')}>屏蔽</button>
          <button className="btn-ghost text-xs" disabled={batchBusy} onClick={() => doBatch('unmute')}>解除屏蔽</button>
          <button className="btn-ghost text-xs" disabled={batchBusy} title="收录轴：移出阅读器列表（数据保留，检索源可见）" onClick={() => doBatch('invisible')}>移出阅读器</button>
          <button className="btn-ghost text-xs" disabled={batchBusy} onClick={() => doBatch('visible')}>恢复收录</button>
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
      {filtered.length === 0 ? (
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
                <th className="py-2 px-1.5 w-8" title="重点（每日早报重点栏 + 智能排序加权）">☆</th>
                <th className="py-2 px-1.5 w-8" title="删除源（级联删除其文章/视频）">删</th>
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
                        {!!s.muted && <span className="badge-gray flex-none" title="屏蔽轴：热点榜/阅读器已排除">屏</span>}
                        {s.reader_visible === 0 && <span className="badge-gray flex-none" title="收录轴：已移出阅读器列表">藏</span>}
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
                    <td className="py-2 px-1.5" colSpan={3}>
                      <div className="flex items-center gap-1">{rowOps(s)}</div>
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
        </>
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
