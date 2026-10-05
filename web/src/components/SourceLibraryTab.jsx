import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { relativeTime } from '../util';
import {
  SearchIcon, LockIcon,
  FolderIcon, RefreshIcon, TrashIcon,
} from './icons.jsx';
import BackfillPreviewModal from './BackfillPreviewModal.jsx';
import SourcePickerModal from './SourcePickerModal.jsx';
import SourceDetailDrawer from './SourceDetailDrawer.jsx';
import IntervalPicker from './IntervalPicker.jsx';
import SourceAvatar from './ui/SourceAvatar.jsx';

// 平台接入（spec30：公众号 RSS / B站 两个平台 Tab 并入源库，功能零丢失）
const WechatTab = lazy(() => import('./WechatTab.jsx'));
const BilibiliTab = lazy(() => import('./BilibiliTab.jsx'));

// ── 用户语言术语表（10-05 验收反馈：熔断/调频/failover/跟随全局 是工程话，全部换掉） ──
const T = {
  breaker: '异常暂停',   // 连续失败被自动停用
  freq: '抓取频率',
  failover: '备用切换',
  followDefault: '跟随默认',
};

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

// 统一状态模型（10-05 反馈第 4 条）：一个源只三种状态——正常 / 异常 / 已停用（已退役是引擎事实，保留）。
// "熔断中(10)" 的括号数字没人懂，去掉；红色只留给「需要你现在处理」的形态（问题源视图/异常暂停）。
function healthStatus(s) {
  if (s.type === 'wemp') return { label: '已退役', tone: 'gray' };
  if (!s.enabled) return (s.fail_count || 0) >= 3 ? { label: T.breaker, tone: 'red' } : { label: '已停用', tone: 'gray' };
  if (s.status === 'error' || (s.fail_count || 0) > 0) return { label: '异常', tone: 'orange' };
  return { label: '正常', tone: 'green' };
}
const TONE_CLS = { green: 'text-[var(--green)]', orange: 'text-[var(--warn)]', red: 'text-[var(--red)]', gray: 't-muted' };

function extraOf(s) {
  try { return JSON.parse(s.extra || '{}'); } catch { return {}; }
}

// 需要处理的源（问题源视图）：异常 / 异常暂停 / 近 48h 新增未确认
function isIssueSource(s, nowMs) {
  if (s.type === 'wemp') return false;
  if (!s.enabled && (s.fail_count || 0) >= 3) return true;
  if (s.enabled && (s.status === 'error' || (s.fail_count || 0) > 0)) return true; // 手动停用=已处理，不再算待处理
  const created = Date.parse(s.created_at || '');
  if (Number.isFinite(created) && nowMs - created < 48 * 3600e3) return true;
  return false;
}

const VIEW_LABEL = { groups: '健康概览', issues: '问题源', issues_cleanup: '清理', search: '检索', platform: '平台接入' };
const VIEW_HINT = {
  groups: '各文件夹的健康概况。组级操作（暂停/频率/备用/屏蔽）在卡片「⋯」菜单；单源细处理点「进入」。',
  issues: '只列需要你处理的源（异常 / 异常暂停 / 新增未确认），处理完就从这里消失。',
  issues_cleanup: '库里没内容 / 长期没活到的启用源——批量停用或删除，一次清一片。',
  search: '干活视图：搜索、单源操作（行悬停出现）、勾选后上方浮出批量条。',
  platform: '公众号 RSS 与 B 站的平台级配置（Cookie、间隔、队列）。',
};

// ── 卡片「⋯」菜单（10-05 反馈第 2 条：主操作唯一化，低频操作收进菜单） ──
function CardMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  if (!items.length) return null;
  return (
    <span className="relative inline-flex" ref={ref}>
      <button
        className="icon-btn !w-7 !h-7 t-muted"
        aria-label="更多操作"
        onClick={() => setOpen(!open)}
      >⋯</button>
      {open && (
        <div className="absolute right-0 z-30 card p-1 w-44 shadow-lg">
          {items.map((it) => (
            <button
              key={it.label}
              className={`block w-full text-left px-3 py-1.5 text-xs rounded hover:t-surface2 ${it.danger ? 'text-[var(--red)]' : 't-text'}`}
              onClick={() => { setOpen(false); it.onClick(); }}
            >{it.label}</button>
          ))}
        </div>
      )}
    </span>
  );
}

// 29-source-groups（2026-09-15）：三视图。10-05 按用户验收反馈按「任务导向」重排：
// 健康概览（原组合视图，只看+进组）/ 问题源 / 检索（干活）+ 平台接入。
// 功能隔离（10-05）：重点轴归「报 → 每日早报」的选源器、订阅轴归「报 → 我的早报」——
// 源库不再设这两轴的操作入口（查看筛选保留），星标/订阅按钮已从此处摘除。
export default function SourceLibraryTab({ initialView = 'groups' }) {
  const [view, setView] = useState(initialView);
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
  const [pendingMove, setPendingMove] = useState(null); // {gid, name}：新建文件夹后等待选源移入
  const [detail, setDetail] = useState(null); // 源详情抽屉（10-05 用户点单②）
  const [intervalPick, setIntervalPick] = useState(null); // {kind:'one'|'group', target}：频率预设选择器（10-05 用户点单④）
  const [cleanup, setCleanup] = useState(null); // 死源清理器候选（10-05 用户点单①）
  const [clusters, setClusters] = useState(null); // 失败原因聚类（10-05 用户点单③）
  const [heal, setHeal] = useState(null); // 自愈调试面板（10-05 用户点单）
  const [importOpml, setImportOpml] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const fileRef = useRef(null);
  const [cleanupSel, setCleanupSel] = useState(new Set());
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const toolsRef = useRef(null);

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

  // 死源清理器候选：进清理视图时拉（对抗审查 C：条件此前写错视图名=直进清理页/批量操作
  // 后永久卡"加载中"；force 绕过 90s GET 缓存——失效匹配是精确路径打不掉本端点）
  useEffect(() => {
    if (view !== 'issues_cleanup' || cleanup) return;
    (async () => {
      try { setCleanup(await api.get('/api/sources/cleanup-candidates', true)); } catch { /* 拉不到不阻断 */ }
    })();
  }, [view, cleanup]);

  // 失败原因聚类：进问题源视图时拉
  useEffect(() => {
    if (view !== 'issues' || clusters) return;
    (async () => {
      try { setClusters(await api.get('/api/sources/error-clusters', true)); } catch { /* 拉不到不阻断 */ }
    })();
  }, [view, clusters]);

  // 自愈调试面板：进问题源视图时拉
  useEffect(() => {
    if (view !== 'issues' || heal) return;
    (async () => {
      try { setHeal(await api.get('/api/self-heal', true)); } catch { /* 拉不到不阻断 */ }
    })();
  }, [view, heal]);

  // ── 健康概览聚合：组卡片数据（需要处理的组排前） ──
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
      const intervalText = intervals.length === 0 ? T.followDefault
        : new Set(intervals).size === 1 ? `每 ${intervals[0]} 分钟` : '混合频率';
      const mutedN = members.filter((s) => s.muted).length;
      const invisibleN = members.filter((s) => s.reader_visible === 0).length;
      cards.push({
        gid, name: g ? g.name : '未分组', total, okN,
        okRate: total ? Math.round((okN / total) * 100) : 100,
        breakerN, errorN, disabledN, issueN, intervalText,
        mutedN, invisibleN,
        allDisabled: disabledN + breakerN === total,
      });
    }
    cards.sort((a, b) => (b.issueN - a.issueN) || (b.total - a.total));
    return cards;
  }, [items, groups]);

  const issueSources = useMemo(() => {
    const nowMs = Date.now();
    return items.filter((s) => isIssueSource(s, nowMs))
      .sort((a, b) => (b.fail_count || 0) - (a.fail_count || 0) || (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0));
  }, [items]);

  // 组级操作（27b ②：组级走 groupScopeId 单条 SQL）
  async function doGroup(gid, action, extra = {}, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      const r = await api.post('/api/sources/batch', { groupScopeId: gid, action, ...extra });
      toast(`完成：${r.succeeded} 个源${r.group ? `（${r.group}）` : ''}`);
      await load();
    } catch (e) {
      toast('操作失败: ' + e.message);
    }
  }

  // 组管理（10-05 用户反馈"分组不能自己创建/设置"）：重命名与删除——云端路由随本批补齐
  async function renameGroup(g) {
    const name = window.prompt(`重命名文件夹「${g.name}」：`, g.name);
    if (!name || !name.trim() || name.trim() === g.name) return;
    try {
      await api.put(`/api/groups/${g.id}`, { name: name.trim() });
      toast('已重命名');
      await load();
    } catch (e) { toast(e.message); }
  }
  async function deleteGroup(g) {
    if (!window.confirm(`删除文件夹「${g.name}」？其中的源不会被删，会回到「未分组」。`)) return;
    try {
      await api.del(`/api/groups/${g.id}`);
      toast('文件夹已删除');
      await load();
    } catch (e) { toast(e.message); }
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
    else if (filterStatus === 'erroring') arr = arr.filter((s) => s.enabled && (s.status === 'error' || (s.fail_count || 0) > 0));
    else if (filterStatus === 'spotlight') arr = arr.filter((s) => s.spotlight);
    else if (filterStatus === 'subscribed') arr = arr.filter((s) => s.subscribed);
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
      toast(`完成：成功 ${res.succeeded}${res.failed ? `，失败 ${res.failed}` : ''}`);
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

  // 死源清理动作（停用=可回退的常态操作；删除=级联清内容，confirm 更狠）
  async function cleanupBatch(action) {
    if (cleanupBusy) return; // 对抗审查 C：busy 锁防双击并发重入
    const ids = [...cleanupSel];
    if (!ids.length) return toast('先勾选要清理的源');
    const text = action === 'disable'
      ? `停用勾选的 ${ids.length} 个源？（停止采集，数据保留，随时可启用回来）`
      : `删除勾选的 ${ids.length} 个源？其全部内容将级联删除，不可恢复——建议先停用观察。`;
    if (!window.confirm(text)) return;
    setCleanupBusy(true);
    try {
      let done = 0;
      for (let i = 0; i < ids.length; i += 25) {
        const chunk = ids.slice(i, i + 25);
        if (action === 'disable') {
          const r = await api.post('/api/sources/batch', { ids: chunk, action: 'disable' });
          done += r.succeeded || 0;
        } else {
          for (const id of chunk) { await api.del('/api/sources/' + id); done++; }
        }
        toast(`处理中… ${done}/${ids.length}`); // 进度反馈（无进度可双击的根因）
      }
      toast(`${action === 'disable' ? '已停用' : '已删除'} ${done} 个源`);
      setCleanupSel(new Set());
      setCleanup(null);
      await load();
    } catch (e) { toast('清理失败: ' + e.message); }
    finally { setCleanupBusy(false); }
  }

  // 单源立即抓取（runner 侧 next_fetch_at 置到期，15 分钟节奏内被拾起）
  async function refreshOne(s) {
    try {
      await api.post(`/api/sources/${s.id}/refresh`);
      toast(`已安排「${s.name || s.url}」尽快抓取`);
    } catch (e) {
      toast(e.message);
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

  // 单源删除
  async function deleteOne(s) {
    if (!window.confirm(`确认删除源「${s.name || s.url}」？其全部内容将一并删除，不可恢复。`)) return;
    try { await api.del('/api/sources/' + s.id); toast('已删除'); load(); } catch (e) { toast(e.message); }
  }

  // 单源抓取频率：预设选择器（10-05 用户点单④：弹窗输数字 → 预设按钮）
  function promptInterval(s) {
    setIntervalPick({ kind: 'one', target: s });
  }
  function applyInterval(min) {
    if (!intervalPick) return;
    if (intervalPick.kind === 'one') {
      doSingle(intervalPick.target.id, 'interval', { intervalMin: min === null ? null : Number(min) });
    } else {
      doGroup(intervalPick.target.gid, 'interval', { intervalMin: min === null ? null : Number(min) });
    }
    setIntervalPick(null);
  }

  // 筛选用的文件夹列表（按 kind 过滤）
  const filterGroups = useMemo(() => {
    if (filterKind === 'all') return groups;
    if (filterKind === 'video') return groups.filter((g) => g.kind === 'video');
    return groups.filter((g) => g.kind === 'article');
  }, [groups, filterKind]);

  // 工具菜单（低频工具收纳：10-05 反馈第 5 条）
  useEffect(() => {
    if (!toolsOpen) return;
    const onDoc = (e) => { if (toolsRef.current && !toolsRef.current.contains(e.target)) setToolsOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [toolsOpen]);

  async function dedupeFlow() {
    try {
      const prev = await api.post('/api/sources/dedupe', {});
      if (!prev.groups) return toast('查重完成：无重复');
      if (!window.confirm(`发现 ${prev.groups} 组重复源。\n合并将停用每组冗余源（保留启用中/失败最少的一个）并标记。\n执行合并？`)) return;
      const r = await api.post('/api/sources/dedupe', { apply: true });
      toast(`已合并 ${r.merged} 个冗余源（${r.groups} 组）`);
      load();
    } catch (e) { toast(e.message); }
  }

  // 新建文件夹 → 立即选源移入（10-05：创建/设置/选源一步完成）
  // OPML 导入（10-05 用户点单⑤）：前端解析 XML（无 multipart 后端——文件不走服务端，浏览器侧
  // 读 XML 出 {url,name} 列表），分批调 POST /api/sources（自带 url 幂等查重——重复源会跳过）。
  // 分批 20/请求防超时（创建源逐条写库，同自动分类教训）。
  async function importOpmlFlow(file) {
    if (!file) return;
    setImportBusy(true);
    try {
      const xml = await file.text();
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      if (doc.querySelector('parsererror')) { toast('不是合法的 OPML/XML 文件'); setImportBusy(false); return; }
      const outlines = [...doc.querySelectorAll('outline[xmlUrl]')];
      const feeds = outlines.map((o) => ({ url: o.getAttribute('xmlUrl'), name: o.getAttribute('title') || o.getAttribute('text') || '' }))
        .filter((f) => f.url && /^https?:/i.test(f.url));
      if (!feeds.length) { toast('OPML 里没有可导入的订阅源'); setImportBusy(false); return; }
      if (!window.confirm(`从「${file.name}」读到 ${feeds.length} 个订阅源。导入会逐条创建（已有同 url 的自动跳过）。开始？`)) { setImportBusy(false); return; }
      let created = 0, dup = 0, failed = 0;
      for (let i = 0; i < feeds.length; i += 20) {
        for (const f of feeds.slice(i, i + 20)) {
          try {
            const r = await api.post('/api/sources', { url: f.url, name: f.name || undefined });
            if (r.duplicated) dup++; else created++;
          } catch { failed++; }
        }
        toast(`导入中… ${Math.min(i + 20, feeds.length)}/${feeds.length}`);
      }
      toast(`导入完成：新建 ${created} · 已存在跳过 ${dup}${failed ? ` · 失败 ${failed}` : ''}`);
      setImportOpml(false);
      await load();
    } catch (e) {
      toast('导入失败: ' + e.message);
    } finally {
      setImportBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function createGroupFlow() {
    const name = window.prompt('新文件夹名称：');
    if (!name || !name.trim()) return;
    const kind = filterKind === 'video' ? 'video' : 'article';
    try {
      const r = await api.post('/api/groups', { name: name.trim(), kind });
      const gid = r.item?.id;
      toast('已创建文件夹「' + name.trim() + '」，现在选择要放进去的源');
      await load();
      setPendingMove({ gid, name: name.trim() });
    } catch (e) { toast(e.message); }
  }

  // 创建后选源批量移入（分批 25/请求，防逐条写超时——与自动分类同教训）
  async function batchMove(ids, groupId) {
    let done = 0;
    for (let i = 0; i < ids.length; i += 25) {
      const chunk = ids.slice(i, i + 25);
      const r = await api.post('/api/sources/batch', { ids: chunk, action: 'move', groupId });
      done += r.succeeded || 0;
    }
    toast(`已把 ${done} 个源移入文件夹`);
    await load();
  }

  const toolsMenu = (
    <span className="relative inline-flex" ref={toolsRef}>
      <button className="btn-ghost text-sm" onClick={() => setToolsOpen(!toolsOpen)}>批量工具 ▾</button>
      {toolsOpen && (
        <div className="absolute right-0 z-30 card p-1 w-44 shadow-lg">
          <button className="block w-full text-left px-3 py-1.5 text-xs rounded hover:t-surface2 t-text" onClick={() => { setToolsOpen(false); createGroupFlow(); }}>新建文件夹</button>
          <button className="block w-full text-left px-3 py-1.5 text-xs rounded hover:t-surface2 t-text" onClick={() => { setToolsOpen(false); dedupeFlow(); }}>查重合并</button>
          <button className="block w-full text-left px-3 py-1.5 text-xs rounded hover:t-surface2 t-text" onClick={() => { setToolsOpen(false); setImportOpml(true); }}>导入 OPML</button>
          <a className="block w-full text-left px-3 py-1.5 text-xs rounded hover:t-surface2 t-text" href="/api/opml/export" download="qwis-sources.opml" onClick={() => setToolsOpen(false)}>导出 OPML</a>
          <button className="block w-full text-left px-3 py-1.5 text-xs rounded hover:t-surface2 t-text" onClick={() => { setToolsOpen(false); setShowBackfill(true); }}>自动分类回填</button>
        </div>
      )}
    </span>
  );

  return (
    <div>
      {/* 视图切换 */}
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        {['groups', 'issues', 'issues_cleanup', 'search', 'platform'].map((v) => (
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
      {/* 指引行（10-05 反馈：指引不清晰——每个视图一句话说清它是干嘛的） */}
      <div className="text-[11px] t-muted mb-4">{VIEW_HINT[view]}</div>

      {loading ? (
        <div className="text-center py-12 t-muted text-sm">加载中…</div>
      ) : view === 'groups' ? (
        /* ── 健康概览：健康度图形化（10-05 反馈第 3 条）+ 主操作唯一化（第 2 条）——只看+进组 ── */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {groupCards.map((c) => {
            // 异常数用 c.issueN（isIssueSource 按源去重）——breakerN/errorN 不互斥（熔断源
            // status='error' 不复位，两集合必交），双计数会污染进度条与异常数（对抗审查 A）
            const issueN = c.issueN;
            const okPct = c.total ? (c.okN / c.total) * 100 : 100;
            const issuePct = c.total ? (issueN / c.total) * 100 : 0;
            const healthTone = issueN === 0 ? 'green' : (c.okRate >= 70 ? 'orange' : 'red');
            return (
              <div key={c.gid ?? 'none'} className="card p-5">
                <div className="flex items-center gap-2">
                  <FolderIcon size={15} className="t-muted flex-none" />
                  <span className="font-medium t-text truncate flex-1" title={c.name}>{c.name}</span>
                  <span className={`flex-none text-xs ${TONE_CLS[healthTone]}`}>
                    ● {c.okRate}% 正常
                  </span>
                </div>
                {/* 健康度一条进度条说完：绿=正常 红=异常 灰=已停用 */}
                <div className="mt-3 h-1.5 rounded-full overflow-hidden flex bg-[var(--surface-2)]">
                  <div style={{ width: `${okPct}%`, background: 'var(--green)' }} />
                  <div style={{ width: `${issuePct}%`, background: 'var(--red)' }} />
                </div>
                <div className="mt-2 flex items-center text-[11px] t-muted">
                  <span className="flex-1">{c.total} 源 · {c.intervalText}</span>
                  {issueN > 0 && <span className="text-[var(--red)]">{issueN} 异常</span>}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button className="btn-primary !py-1.5 !px-5 !text-xs" onClick={() => enterGroup(c.gid)}>进入</button>
                  <span className="flex-1" />
                  {c.gid !== null && (
                    <CardMenu
                      items={[
                        {
                          label: '重命名文件夹…',
                          onClick: () => renameGroup(groups.find((x) => x.id === c.gid) || { id: c.gid, name: c.name }),
                        },
                        { label: '删除文件夹（源回到未分组）', danger: true, onClick: () => deleteGroup(groups.find((x) => x.id === c.gid) || { id: c.gid, name: c.name }) },
                        c.allDisabled
                          ? { label: '恢复整组采集', onClick: () => doGroup(c.gid, 'enable') }
                          : { label: '暂停整组采集', onClick: () => doGroup(c.gid, 'disable', {}, `暂停「${c.name}」整组（${c.total} 源停止采集，数据保留）？`) },
                        {
                          label: `整组${T.freq}…`,
                          onClick: () => setIntervalPick({ kind: 'group', target: c }),
                        },
                        {
                          label: `${T.failover}…`,
                          onClick: () => {
                            const v = window.prompt(`「${c.name}」${T.failover}组名（同名字母互为备用，主源异常暂停时自动换备用；留空清除）：`, '');
                            if (v === null) return;
                            doGroup(c.gid, 'failover', { failoverGroup: v.trim() });
                          },
                        },
                        c.mutedN === c.total
                          ? { label: '整组恢复显示（解除屏蔽）', onClick: () => doGroup(c.gid, 'unmute') }
                          : { label: '整组屏蔽（热点榜/阅读器隐藏）', onClick: () => doGroup(c.gid, 'mute', {}, `屏蔽「${c.name}」整组？其内容将从热点榜/阅读器隐藏（数据仍在）`) },
                        c.invisibleN === c.total
                          ? { label: '整组恢复收录（回阅读器）', onClick: () => doGroup(c.gid, 'visible') }
                          : { label: '整组移出阅读器', onClick: () => doGroup(c.gid, 'invisible') },
                      ].filter(Boolean)}
                    />
                  )}
                </div>
                {c.gid === null && (
                  <div className="mt-2 text-[11px] t-muted">
                    这些源还没分进文件夹（多为历史批量导入）。不分类也能正常采集；想归类：进入后勾选「移动到」，或用「批量工具 → 自动分类回填」一键按内容归类。
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : view === 'issues' ? (
        /* ── 问题源视图：只列需要处理的（任务导向正面样本，保留） ── */
        <>
        {clusters && clusters.clusters.length > 0 && (
          <div className="card p-4 mb-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold t-text">按原因聚类</h3>
              <span className="text-[11px] t-muted">同一种病的源放一起——系统级问题（≥10 个同类型同错）排最前</span>
            </div>
            <div className="mt-3 space-y-2">
              {clusters.clusters.map((c) => (
                <div key={c.key} className="rounded-lg border t-border p-3" style={c.systemic ? { borderLeft: '3px solid var(--red)' } : undefined}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-medium t-text">{c.label}</span>
                    <span className={`text-xs tabular-nums ${c.count >= 10 ? 'text-[var(--red)] font-semibold' : 't-muted'}`}>{c.count} 个源</span>
                    {c.systemic && <span className="badge-red">系统级 · 全是 {c.systemic}</span>}
                    <span className="flex-1" />
                    <button
                      className="btn-ghost !py-1 !px-2.5 text-xs"
                      onClick={() => {
                        setFilterStatus('erroring');
                        setFilterKind('all');
                        setFilterGroup('all');
                        setSearch('');
                        setView('search');
                      }}
                    >去检索处理 →</button>
                  </div>
                  <div className="mt-1.5 text-[11px] t-muted">
                    {c.items.slice(0, 6).map((it) => it.name || it.type).join('、')}{c.count > 6 ? ` 等 ${c.count} 个` : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {heal && (heal.resumedTotal > 0 || heal.coolingTotal > 0) && (
          <div className="card p-4 mb-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold t-text">自愈调试</h3>
              <span className="text-[11px] t-muted">冻结超 {heal.rules.autoResumeAfterHours}h 自动恢复（错峰）· 连续 {heal.rules.cooldownAfterFails} 次仍熔断则冷却 {heal.rules.cooldownDays} 天</span>
            </div>
            <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 恢复过——活了没有 */}
              <div>
                <div className="text-xs t-muted mb-1.5">曾被自动恢复（共 {heal.resumedTotal} 个）· <span className="text-[var(--green)]">现在健康 {heal.aliveAfterResume}</span> / <span style={{ color: 'var(--red)' }}>又熔断 {heal.resumedTotal - heal.aliveAfterResume}</span></div>
                <div className="space-y-1 max-h-56 overflow-y-auto">
                  {heal.resumed.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 text-xs py-1 border-b t-border/40">
                      <button className="truncate flex-1 text-left t-text hover:t-accent" onClick={() => setDetail(items.find((x) => x.id === r.id) || r)}>{r.name}</button>
                      <span className="t-muted flex-none">第 {r.resumeCount} 次</span>
                      <span className={`flex-none ${r.aliveNow ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>{r.aliveNow ? '健康' : '又熔断'}</span>
                    </div>
                  ))}
                  {heal.resumed.length === 0 && <div className="text-xs t-muted py-2">还没有自动恢复记录</div>}
                </div>
              </div>
              {/* 冷却中——什么时候轮到它 */}
              <div>
                <div className="text-xs t-muted mb-1.5">冷却中（共 {heal.coolingTotal} 个）· 到点自动恢复</div>
                <div className="space-y-1 max-h-56 overflow-y-auto">
                  {heal.cooling.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 text-xs py-1 border-b t-border/40">
                      <button className="truncate flex-1 text-left t-text hover:t-accent" onClick={() => setDetail(items.find((x) => x.id === r.id) || r)}>{r.name}</button>
                      <span className="t-muted flex-none tabular-nums" title={`预计 ${r.resumeAt ? formatDateTime(r.resumeAt) : '—'}`}>{r.coolingLeftMs < 3600e3 ? `${Math.ceil(r.coolingLeftMs / 60000)} 分钟后` : `${Math.ceil(r.coolingLeftMs / 3600e3)} 小时后`}</span>
                    </div>
                  ))}
                  {heal.cooling.length === 0 && <div className="text-xs t-muted py-2">没有冷却中的源</div>}
                </div>
              </div>
            </div>
          </div>
        )}
        {issueSources.length === 0 ? (
          <div className="text-center py-12 t-muted text-sm">没有需要处理的源——都正常。</div>
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
                  <th className="py-2 px-1.5 text-left w-24">加入时间</th>
                  <th className="py-2 px-1.5 w-28">操作</th>
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
                        <button className="truncate max-w-[200px] inline-block align-middle hover:t-accent cursor-pointer" title="查看源详情" onClick={() => setDetail(s)}>{s.name || s.url}</button>
                        {isNew && <span className="pill on ml-1.5">新增</span>}
                      </td>
                      <td className="py-2 px-1.5 text-xs t-muted">{g ? g.name : '未分组'}</td>
                      <td className="py-2 px-1.5"><span className={`text-xs font-medium ${TONE_CLS[hs.tone]}`}>{hs.label}</span></td>
                      <td className="py-2 px-1.5 text-xs t-muted truncate max-w-[260px]" title={ex.lastError || ''}>{ex.lastError || '—'}</td>
                      <td className="py-2 px-1.5 text-xs t-muted">{s.created_at ? relativeTime(s.created_at) : '—'}</td>
                      <td className="py-2 px-1.5">
                        <div className="flex items-center gap-1">
                          {!s.enabled && (s.fail_count || 0) >= 3 && (
                            <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => doSingle(s.id, 'enable')}>重新启用</button>
                          )}
                          <button className="icon-btn !w-7 !h-7 t-muted" title={s.enabled ? '停用采集' : '启用采集'} onClick={() => doSingle(s.id, s.enabled ? 'disable' : 'enable')}>⏸</button>
                          <button className="icon-btn !w-7 !h-7 t-muted" title={T.freq} onClick={() => promptInterval(s)}>⏱</button>
                          <button className="icon-btn !w-7 !h-7 t-muted hover:text-red-500" title="删除" onClick={() => deleteOne(s)}><TrashIcon size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </>
      ) : view === 'issues_cleanup' ? (
        /* ── 死源清理器（10-05 用户点单①）：从未成功/超两周没活的源，批量停用或删除 ── */
        !cleanup ? (
          <div className="text-center py-12 t-muted text-sm">加载中…</div>
        ) : cleanup.items.length === 0 ? (
          <div className="text-center py-12 t-muted text-sm">库很干净——没有从未成功或长期没活的启用源。</div>
        ) : (
          <>
          <div className="card p-4 mb-3">
            <div className="flex items-center gap-3 flex-wrap text-[13px]">
              <span className="t-text font-medium">勾选要清理的源（已选 {cleanupSel.size} / {cleanup.items.length}）</span>
              <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => setCleanupSel(new Set(cleanup.items.map((x) => x.id)))}>全选</button>
              <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => setCleanupSel(new Set())}>全不选</button>
              <span className="flex-1" />
              <button className="btn-ghost !py-1.5 !px-4 !text-xs" disabled={!cleanupSel.size || cleanupBusy} onClick={() => cleanupBatch('disable')}>{cleanupBusy ? '处理中…' : '停用勾选'}</button>
              <button className="btn-primary !py-1.5 !px-4 !text-xs" disabled={!cleanupSel.size || cleanupBusy} onClick={() => cleanupBatch('delete')}>{cleanupBusy ? '处理中…' : '删除勾选'}</button>
            </div>
            <div className="mt-2 text-[11px] t-muted">
              判据：{Object.entries(cleanup.rules).map(([k, v]) => v).join('；')}。这些源启用中但库里没内容——注意：将来内容清理（按保留天数）放行后，低频活源的旧内容也会过保被删，届时要配合"最近入库时间"再判。
              停用=停止采集可回退；删除=级联清内容不可恢复，建议先停用观察。
            </div>
          </div>
          <div className="overflow-x-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b t-border text-xs t-muted">
                  <th className="py-2 px-1.5 w-8"></th>
                  <th className="py-2 px-1.5 text-left">名称</th>
                  <th className="py-2 px-1.5 text-left w-16">类型</th>
                  <th className="py-2 px-1.5 text-left w-24">文件夹</th>
                  <th className="py-2 px-1.5 text-left w-28">情况</th>
                  <th className="py-2 px-1.5 text-left w-24">加入时间</th>
                </tr>
              </thead>
              <tbody>
                {cleanup.items.map((s) => {
                  const g = groups.find((x) => x.id === s.groupId);
                  return (
                    <tr key={s.id} className="border-b t-border/50 hover:t-surface/50">
                      <td className="py-2 px-1.5">
                        <input
                          type="checkbox"
                          checked={cleanupSel.has(s.id)}
                          onChange={() => {
                            const next = new Set(cleanupSel);
                            if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                            setCleanupSel(next);
                          }}
                        />
                      </td>
                      <td className="py-2 px-1.5">
                        <div className="truncate max-w-[260px]" title={`${s.name || s.url}
${s.url}`}>{s.name || s.url}</div>
                        <div className="text-[11px] t-muted truncate max-w-[260px]">{s.url}</div>
                      </td>
                      <td className="py-2 px-1.5 t-muted">{s.type}</td>
                      <td className="py-2 px-1.5 text-xs t-muted">{g ? g.name : '未分组'}</td>
                      <td className="py-2 px-1.5 text-xs" style={{ color: 'var(--warn)' }}>{s.reason === 'never_ok' ? '抓到但没产出' : '长期没抓到'}</td>
                      <td className="py-2 px-1.5 text-xs t-muted">{s.createdAt ? relativeTime(s.createdAt) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )
      ) : view === 'platform' ? (
        /* ── 平台接入（spec30） ── */
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
        /* ── 检索视图：干活的地方（10-05 反馈第 5/6 条：表格降噪 + 可调控件补齐） ── */
        <>
      {/* 工具栏：搜索 + 筛选 + 批量工具（低频工具收进菜单） */}
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
          <option value="erroring">仅异常</option>
          <option value="breaker">仅异常暂停</option>
          <option value="disabled">仅已停用</option>
          <option value="spotlight">仅重点（每日早报）</option>
          <option value="subscribed">仅订阅（我的早报）</option>
          <option value="muted">仅屏蔽</option>
          <option value="invisible">仅未收录</option>
        </select>
        <span className="flex-1" />
        {toolsMenu}
      </div>

      {/* 批量浮动条：勾选后浮出（重点/订阅轴已按功能隔离迁往早报板块） */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-3 p-2.5 rounded-lg t-accent-soft border t-border flex-wrap">
          <span className="text-sm font-medium t-text">已选 {selected.size} 项</span>
          <span className="flex-1" />
          <button className="btn-ghost text-xs" disabled={batchBusy} onClick={() => doBatch('enable')}>启用</button>
          <button className="btn-ghost text-xs" disabled={batchBusy} onClick={() => doBatch('disable')}>停用</button>
          <button className="btn-ghost text-xs" disabled={batchBusy} title="从热点榜/阅读器隐藏（数据保留）" onClick={() => doBatch('mute')}>屏蔽</button>
          <button className="btn-ghost text-xs" disabled={batchBusy} onClick={() => doBatch('unmute')}>恢复显示</button>
          <button className="btn-ghost text-xs" disabled={batchBusy} title="移出阅读器列表（数据保留）" onClick={() => doBatch('invisible')}>移出阅读器</button>
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

      {/* 表格：常驻 4 元素（勾选/名称块/开关），其余 hover 出现 */}
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
                <th className="py-2 px-1.5 text-left">源</th>
                <th className="py-2 px-1.5 text-right w-16 text-xs font-normal" title="启用 = 是否采集；异常暂停的源用它重新启用">采集</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((s) => {
                const kind = displayKind(s);
                const hs = healthStatus(s);
                const ex = extraOf(s);
                const locked = !!ex.categoryLocked;
                const g = groups.find((x) => x.id === s.group_id);
                const sourceKind = VIDEO_TYPES_SET.has(s.type) ? 'video' : 'article';
                const availableGroups = groups.filter((x) => x.kind === sourceKind);
                const stateWord = hs.label === '正常' ? null : hs.label;
                return (
                  <tr key={s.id} className="group border-b t-border/50 hover:t-surface/50">
                    <td className="py-2.5 px-1.5 align-middle">
                      <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} />
                    </td>
                    <td className="py-2.5 px-1.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <SourceAvatar name={s.name} avatar={s.avatar} size={30} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <button
                              className="truncate font-medium t-text max-w-[220px] text-left hover:t-accent cursor-pointer"
                              title="查看源详情"
                              onClick={() => setDetail(s)}
                            >{s.name || s.url}</button>
                            {locked && <LockIcon size={12} className="t-muted flex-none" title="手动锁定（自动分类不改动它）" />}
                          </div>
                          <div className="mt-0.5 text-[11px] t-muted truncate">
                            {KIND_LABEL[kind] || kind}
                            <span className="mx-1">·</span>{g ? g.name : '未分组'}
                            {stateWord && (<><span className="mx-1">·</span><span className={TONE_CLS[hs.tone]}>{stateWord}</span></>)}
                            <span className="mx-1">·</span>{s.itemCount} 条
                            <span className="mx-1">·</span>{s.last_fetched_at ? relativeTime(s.last_fetched_at) : '未抓取过'}
                          </div>
                        </div>
                        {/* hover 才出现的行操作（10-05 反馈第 5 条）：立即抓取 / 抓取频率 / 移动 / 删除 */}
                        <div className="flex md:opacity-0 md:group-hover:opacity-100 transition-opacity items-center gap-1 flex-none">
                          <button className="icon-btn !w-7 !h-7" title="立即抓取（下个采集批次优先处理）" onClick={() => refreshOne(s)}><RefreshIcon size={13} /></button>
                          <button className="icon-btn !w-7 !h-7" title={`${T.freq}（分钟；现为 ${ex.intervalMin ? `${ex.intervalMin} 分钟` : T.followDefault}）`} onClick={() => promptInterval(s)}>⏱</button>
                          <select
                            className="input !py-0.5 !px-1 !text-xs !w-auto max-w-[110px] opacity-70"
                            title="移动到文件夹"
                            value={s.group_id ?? ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              doMove(s.id, val === '' ? null : Number(val));
                            }}
                          >
                            <option value="">未分组</option>
                            {availableGroups.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                          <button className="icon-btn !w-7 !h-7 t-muted hover:text-red-500" title="删除源（级联删除内容，不可恢复）" onClick={() => deleteOne(s)}><TrashIcon size={13} /></button>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-1.5 text-right align-middle">
                      <button
                        className={`switch ${s.enabled ? 'on' : ''}`}
                        style={s.type === 'wemp' ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                        disabled={s.type === 'wemp'}
                        onClick={() => doSingle(s.id, s.enabled ? 'disable' : 'enable')}
                        title={s.type === 'wemp' ? '已退役：采集引擎已下线，无法重新启用' : (s.enabled ? '点击停用采集' : '点击启用采集')}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页 */}
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

      {/* 抓取频率预设选择器（10-05 用户点单④） */}
      <IntervalPicker
        open={!!intervalPick}
        title={intervalPick?.kind === 'group' ? `「${intervalPick.target.name}」整组${T.freq}` : `「${intervalPick?.target?.name || intervalPick?.target?.url || ''}」${T.freq}`}
        currentMin={intervalPick ? (intervalPick.kind === 'group' ? null : (extraOf(intervalPick.target).intervalMin ?? null)) : null}
        onClose={() => setIntervalPick(null)}
        onPick={applyInterval}
      />

      {/* OPML 导入弹窗（10-05 用户点单⑤） */}
      {importOpml && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.35)' }} onClick={() => setImportOpml(false)}>
          <div className="card p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold t-text">导入 OPML</div>
            <div className="mt-1 text-[11px] t-muted">从其他 RSS 阅读器导出的 OPML/XML 文件，一次性批量迁入订阅源；已有同链接的自动跳过，重复导入安全。</div>
            <input
              ref={fileRef}
              type="file"
              accept=".opml,.xml"
              className="mt-4 w-full text-sm t-text"
              onChange={(e) => importOpmlFlow(e.target.files?.[0])}
              disabled={importBusy}
            />
            {importBusy && <div className="mt-3 text-xs t-muted">导入中（逐条创建，大文件需要一两分钟）…</div>}
          </div>
        </div>
      )}

      {/* 源详情抽屉（10-05 用户点单②）：点源名看全——操作后同步刷新库数据 */}
      {detail && (
        <SourceDetailDrawer
          source={items.find((x) => x.id === detail.id) || detail}
          groups={groups}
          onClose={() => setDetail(null)}
          onRefresh={refreshOne}
          onToggle={(src) => doSingle(src.id, src.enabled ? 'disable' : 'enable')}
          onDelete={(src) => { setDetail(null); deleteOne(src); }}
        />
      )}

      {/* 新建文件夹后的选源移入（确认即移入，可跳过） */}
      <SourcePickerModal
        open={!!pendingMove}
        title={`把源移进「${pendingMove?.name || ''}」`}
        note="勾选后点确定即移入；也可以先跳过，之后在行内「移动到」里随时归类。"
        sources={items}
        selectedIds={[]}
        showSpotlight={false}
        instantApply
        onClose={() => setPendingMove(null)}
        onConfirm={(ids) => {
          const target = pendingMove;
          setPendingMove(null);
          if (target && ids.length) batchMove(ids, target.gid);
        }}
      />
    </div>
  );
}
