import { useEffect, useMemo, useState } from 'react';
import SourceAvatar from './ui/SourceAvatar.jsx';
import { relativeTime } from '../util';

// 选源器（T3-8 批次2，形态基准：用户样图 docs/archive/样图/源库/1.png）
// 搜索 + 状态筛选 + 排序 + 行内勾选与重点标记 + 全选筛选结果 + 已选常显计数 + 分页。
// 每日早报的「文章来源 / 视频来源」用它；批次4 的源库总览检索共用此形态。
// 替代的旧形态：全量平铺 checkbox 列表、无搜索无批量（千级源只能线性滚动逐个点）。
// showSpotlight=false：隐藏重点轴（订阅管理等单轴场景，单一职责）——默认 true 保持旧用法。
export default function SourcePickerModal({ open, title, note, sources = [], selectedIds = [], spotlightIds = [], showSpotlight = true, instantApply = false, onClose, onConfirm }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all'); // all|on|off
  const [sort, setSort] = useState('default'); // default|name
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState([]);
  const [draftSpot, setDraftSpot] = useState([]);
  const PER = 30;

  useEffect(() => {
    if (open) {
      setDraft([...(selectedIds || [])]);
      setDraftSpot([...(spotlightIds || [])]);
      setQ('');
      setStatus('all');
      setSort('default');
      setPage(1);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const kw = (q || '').trim().toLowerCase();
    let arr = (sources || []).filter((s) => {
      if (kw && !(`${s.name || ''}`.toLowerCase().includes(kw) || `${s.url || ''}`.toLowerCase().includes(kw))) return false;
      if (status === 'on' && s.enabled === 0) return false;
      if (status === 'off' && s.enabled !== 0) return false;
      return true;
    });
    if (sort === 'name') arr = [...arr].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'));
    return arr;
  }, [sources, q, status, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PER));
  const cur = Math.min(page, pages);
  const slice = filtered.slice((cur - 1) * PER, cur * PER);
  const toggle = (arr, id) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.45)' }} onClick={onClose}>
      <div className="card p-4 w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <div className="text-sm font-semibold t-text flex-1">{title}</div>
          <span className="text-xs t-muted tabular-nums">{showSpotlight ? `已选 ${draft.length} · 其中重点 ${draftSpot.length}` : `已选 ${draft.length}`}</span>
          <button className="btn-ghost !py-1 !px-2 text-xs" onClick={onClose}>关闭</button>
        </div>
        {note && <div className="text-[11px] t-muted mb-2">{note}</div>}
        <div className="flex gap-2 flex-wrap mb-2">
          <input
            className="input flex-1 min-w-[180px]"
            placeholder="按名称搜索…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
          />
          <select className="input !w-auto text-[13px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="all">全部状态</option>
            <option value="on">启用中</option>
            <option value="off">已停用</option>
          </select>
          <select className="input !w-auto text-[13px]" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="default">默认排序</option>
            <option value="name">按名称</option>
          </select>
          <button
            className="btn-ghost !py-1 !px-2 text-xs"
            title="把当前筛选命中的全部来源加入已选"
            onClick={() => setDraft((d) => [...new Set([...d, ...filtered.map((s) => s.id)])])}
          >
            全选筛选结果
          </button>
          <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setDraft([])}>清空已选</button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 divide-y" style={{ borderColor: 'var(--border)' }}>
          {slice.map((s) => {
            const on = draft.includes(s.id);
            const spot = draftSpot.includes(s.id);
            const st = s.enabled === 0 ? '已停用' : (s.status === 'error' || (s.fail_count || 0) > 0) ? '异常' : '正常';
            const stCls = st === '正常' ? 'text-[var(--green)]' : st === '异常' ? 'text-[var(--warn)]' : 't-muted';
            return (
              <div key={s.id} className="flex items-center gap-3 px-2 py-2">
                <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                  <input type="checkbox" checked={on} onChange={() => setDraft((d) => toggle(d, s.id))} className="flex-none" />
                  <SourceAvatar name={s.name} avatar={s.avatar} size={22} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13px] truncate ${on ? 't-text' : 't-muted'}`}>{s.name || s.url}</span>
                    <span className="block text-[10px] t-muted truncate mt-0.5">
                      {s.type}
                      {s.itemCount != null && ` · ${s.itemCount} 条`}
                      {s.last_fetched_at && ` · ${relativeTime(s.last_fetched_at)}`}
                      <span className={`ml-1.5 ${stCls}`}>{st}</span>
                    </span>
                    {/* 用户 10-06 反馈：选择来源要有介绍——源 intro 或分组信息 */}
                    {(s.intro || s.group_name) && (
                      <span className="block text-[10px] t-muted truncate mt-0.5" title={s.intro || s.group_name}>
                        {s.group_name ? `📁 ${s.group_name}` : ''}{s.group_name && s.intro ? ' · ' : ''}{s.intro ? String(s.intro).slice(0, 50) : ''}
                      </span>
                    )}
                  </span>
                </label>
                {s.enabled === 0 && <span className="badge-gray flex-none">已停用</span>}
                {showSpotlight && (
                  <button
                    className={`flex-none text-sm ${spot ? 't-accent' : 't-muted'}`}
                    title="重点：该来源内容全部进入每日早报「重点更新」栏，并在阅读器智能排序中优先"
                    onClick={() => setDraftSpot((d) => toggle(d, s.id))}
                  >
                    {spot ? '★' : '☆'}
                  </button>
                )}
              </div>
            );
          })}
          {slice.length === 0 && <div className="px-2 py-8 text-center text-xs t-muted">无匹配来源</div>}
        </div>
        <div className="flex items-center justify-between pt-3 mt-2 border-t" style={{ borderColor: 'var(--border)' }}>
          <span className="text-xs t-muted tabular-nums">匹配 {filtered.length} 个 · 第 {cur}/{pages} 页</span>
          <div className="flex gap-2">
            <button className="btn-ghost !py-1 !px-2.5 text-xs" disabled={cur <= 1} onClick={() => setPage(cur - 1)}>上一页</button>
            <button className="btn-ghost !py-1 !px-2.5 text-xs" disabled={cur >= pages} onClick={() => setPage(cur + 1)}>下一页</button>
            <button className="btn-primary !py-1 !px-3 text-xs" onClick={() => onConfirm(draft, draftSpot)}>确定</button>
        {!instantApply && (<div className="text-[11px] t-muted pt-2">确定=暂存，还需页面底部「保存设置」落库。</div>)}
        {instantApply && <div className="text-[11px] t-muted pt-2">点「确定」即生效，无需再保存。</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
