import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { FilterIcon, XIcon } from './icons.jsx';

// 十一期：高级筛选面板（浮层）
// 维度：排序（智能/最新/最早）、时间（全部/今天/本周/本月）、语言（全部/中/英）、评分（不限/≥80/≥90）、关键词
// 支持「保存为视图」→ PUT /api/settings {views:[...]}
// 全 t-* 变量，三主题适配

const SORT_OPTIONS = [
  { value: 'smart', label: '智能排序' },
  { value: 'new', label: '最新' },
  { value: 'old', label: '最早' },
];
const TIME_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'today', label: '今天' },
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
];
const LANG_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英文' },
];
const SCORE_OPTIONS = [
  { value: 0, label: '不限' },
  { value: 80, label: '≥ 80' },
  { value: 90, label: '≥ 90' },
];

// 时间预设 → 本地日期（from）
export function timePresetToDate(preset) {
  if (!preset || preset === 'all') return null;
  const now = new Date();
  if (preset === 'today') {
    return now.toISOString().slice(0, 10);
  }
  if (preset === 'week') {
    const d = new Date(now);
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1; // 周一为起点
    d.setDate(d.getDate() - diff);
    return d.toISOString().slice(0, 10);
  }
  if (preset === 'month') {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  }
  return null;
}

export default function FilterPanel({ filter, onChange, dedup, views, onViewsChange }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewName, setViewName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const panelRef = useRef(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const update = useCallback(
    (patch) => onChange({ ...filter, ...patch }),
    [filter, onChange]
  );

  const clearAll = () => {
    onChange({
      ...filter,
      sort: 'new',
      lang: 'all',
      scoreMin: 0,
      timePreset: 'all',
      keyword: '',
      from: null,
      to: null,
    });
  };

  const hasActiveFilter = filter.sort !== 'new' || filter.lang !== 'all' ||
    filter.scoreMin > 0 || (filter.timePreset && filter.timePreset !== 'all') ||
    (filter.keyword && filter.keyword.trim());

  const saveView = async () => {
    const name = viewName.trim();
    if (!name) return;
    if (name.length > 20) { toast('视图名称不超过 20 字'); return; }
    const currentViews = views || [];
    if (currentViews.length >= 20) { toast('视图已达上限（20），请先删除旧视图'); return; }
    const newView = {
      id: 'v' + Date.now().toString(36),
      name,
      filter: {
        tab: filter.tab,
        sourceId: filter.sourceId || null,
        groupId: filter.groupId || null,
        sort: filter.sort || 'new',
        lang: filter.lang || 'all',
        scoreMin: filter.scoreMin || 0,
        timePreset: filter.timePreset || 'all',
        keyword: filter.keyword || '',
        from: filter.from || null,
        to: filter.to || null,
      },
    };
    try {
      await api.put('/api/settings', { views: [...currentViews, newView] });
      onViewsChange?.([...currentViews, newView]);
      setViewName('');
      setShowSaveInput(false);
      toast(`视图「${name}」已保存`);
    } catch (e) {
      toast(e.message || '保存失败');
    }
  };

  return (
    <div className="relative inline-block" ref={panelRef}>
      <button
        className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border t-border transition-colors ${
          hasActiveFilter ? 't-accent-soft t-accent font-medium' : 't-muted hover:t-text'
        }`}
        title="高级筛选"
        onClick={() => setOpen((v) => !v)}
      >
        <FilterIcon width={12} height={12} /> 筛选
      </button>

      {open && (
        // 2026-09-05 视觉精修：按「每维度一行（左小标题 + 右 pill 组）」重排，底栏 btn-ghost/btn-primary
        <div className="absolute left-0 top-full mt-1 z-50 w-80 p-3 rounded-lg border t-border t-surface shadow-lg space-y-2.5">
          <div className="flex items-center pb-1 border-b t-border">
            <span className="text-xs font-medium t-text">筛选</span>
          </div>

          {/* 时间 */}
          <div className="flex items-start gap-2">
            <div className="w-12 flex-none pt-1 text-xs t-muted">时间</div>
            <div className="flex flex-wrap gap-1.5">
              {TIME_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className={`pill cursor-pointer ${(filter.timePreset || 'all') === o.value ? 'on' : ''}`}
                  onClick={() => {
                    const from = timePresetToDate(o.value);
                    update({ timePreset: o.value, from, to: null });
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* 语言 */}
          <div className="flex items-start gap-2">
            <div className="w-12 flex-none pt-1 text-xs t-muted" title={dedup ? '合并模式下不可用' : undefined}>
              语言
            </div>
            <div className="flex flex-wrap gap-1.5">
              {LANG_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  disabled={dedup && o.value !== 'all'}
                  className={`pill ${
                    dedup && o.value !== 'all'
                      ? 'opacity-40 cursor-not-allowed'
                      : `cursor-pointer ${(filter.lang || 'all') === o.value ? 'on' : ''}`
                  }`}
                  onClick={() => !dedup && update({ lang: o.value })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* 评分 */}
          <div className="flex items-start gap-2">
            <div className="w-12 flex-none pt-1 text-xs t-muted" title="仅热点榜条目有评分">评分</div>
            <div className="flex flex-wrap gap-1.5">
              {SCORE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className={`pill cursor-pointer ${(filter.scoreMin || 0) === o.value ? 'on' : ''}`}
                  onClick={() => update({ scoreMin: o.value })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* 排序 */}
          <div className="flex items-start gap-2">
            <div className="w-12 flex-none pt-1 text-xs t-muted">排序</div>
            <div className="flex flex-wrap gap-1.5">
              {SORT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className={`pill cursor-pointer ${(filter.sort || 'new') === o.value ? 'on' : ''}`}
                  onClick={() => update({ sort: o.value })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* 关键词 */}
          <div className="flex items-center gap-2">
            <div className="w-12 flex-none text-xs t-muted">关键词</div>
            <input
              className="input !py-1 !text-xs flex-1"
              placeholder="搜索标题/摘要/正文"
              value={filter.keyword || ''}
              onChange={(e) => update({ keyword: e.target.value })}
            />
          </div>

          {/* 底部操作 */}
          <div className="flex items-center gap-2 pt-2 border-t t-border">
            <button
              className="text-[11px] t-muted hover:t-text"
              onClick={clearAll}
            >
              清除全部
            </button>
            <div className="flex-1" />
            {!showSaveInput ? (
              <>
                <button
                  className="btn-ghost !px-2.5 !py-1 !text-xs"
                  onClick={() => setShowSaveInput(true)}
                >
                  保存为视图…
                </button>
                <button
                  className="btn-primary !px-2.5 !py-1 !text-xs"
                  onClick={() => setOpen(false)}
                >
                  应用筛选
                </button>
              </>
            ) : (
              <div className="flex gap-1 items-center">
                <input
                  autoFocus
                  className="input !py-0.5 !text-xs w-28"
                  placeholder="视图名称"
                  maxLength={20}
                  value={viewName}
                  onChange={(e) => setViewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveView();
                    if (e.key === 'Escape') { setShowSaveInput(false); setViewName(''); }
                  }}
                />
                <button className="btn-primary !px-2 !py-0.5 !text-xs" onClick={saveView}>
                  存
                </button>
                <button
                  className="text-[11px] t-muted hover:t-text"
                  onClick={() => { setShowSaveInput(false); setViewName(''); }}
                >
                  <XIcon width={12} height={12} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
