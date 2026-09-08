import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { SparklesIcon, XIcon } from './icons.jsx';

export default function BackfillPreviewModal({ onClose, onApplied }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [skippedLocked, setSkippedLocked] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [includeLocked, setIncludeLocked] = useState(false);
  const [noSuggestion, setNoSuggestion] = useState(0);
  const [checked, setChecked] = useState(new Set());
  const [applying, setApplying] = useState(false);

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.post('/api/sources/autoclassify', { dryRun: true, includeLocked, showAll });
      setItems(res.items || []);
      setTotal(res.total || 0);
      setSkippedLocked(res.skippedLocked || 0);
      setNoSuggestion(res.noSuggestion || 0);
      // 默认全选
      const ids = new Set((res.items || []).map((i) => i.id));
      setChecked(ids);
    } catch (e) {
      toast('预览加载失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [includeLocked, showAll]);

  useEffect(() => { fetchPreview(); }, [fetchPreview]);

  function toggleCheck(id) {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setChecked(next);
  }

  function toggleAll() {
    if (checked.size === items.length) {
      setChecked(new Set());
    } else {
      setChecked(new Set(items.map((i) => i.id)));
    }
  }

  async function doApply() {
    if (!checked.size) return;
    setApplying(true);
    try {
      const res = await api.post('/api/sources/autoclassify', { apply: true, ids: [...checked] });
      toast(`已应用 ${res.applied} 项变更${res.groupsCreated?.length ? `，新建文件夹 ${res.groupsCreated.length} 个` : ''}`);
      onApplied();
    } catch (e) {
      toast('执行失败: ' + e.message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="t-surface border t-border rounded-xl shadow-xl w-[680px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-center gap-2 px-5 py-3 border-b t-border">
          <SparklesIcon size={18} className="t-accent" />
          <h3 className="font-medium t-text">自动分类回填预览</h3>
          <span className="flex-1" />
          <button onClick={onClose} className="t-muted hover:t-text"><XIcon size={16} /></button>
        </div>

        {/* 统计 + 开关 */}
        <div className="flex items-center gap-3 px-5 py-2.5 text-sm t-muted border-b t-border/50">
          <span>共 {total} 个源{loading ? '' : `，${items.length} 条建议变更`}</span>
          {skippedLocked > 0 && <span>（跳过锁定 {skippedLocked} 条）</span>}
          {!loading && !showAll && noSuggestion > 0 && <span title="这些源无任何分类建议,保持现状,不会出现在变更清单">（{noSuggestion} 条无建议）</span>}
          <span className="flex-1" />
          <label className="flex items-center gap-1 text-xs cursor-pointer">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            显示全部
          </label>
          <label className="flex items-center gap-1 text-xs cursor-pointer">
            <input type="checkbox" checked={includeLocked} onChange={(e) => setIncludeLocked(e.target.checked)} />
            包含手动锁定源
          </label>
        </div>

        {/* 清单表格 */}
        <div className="flex-1 overflow-y-auto px-5 py-2">
          {loading ? (
            <div className="text-center py-8 t-muted text-sm">正在分析分类建议…</div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 t-muted text-sm">所有源已处于建议分类中，无需变更</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs t-muted border-b t-border">
                  <th className="py-1.5 w-8">
                    <input type="checkbox" checked={checked.size === items.length && items.length > 0} onChange={toggleAll} />
                  </th>
                  <th className="py-1.5 text-left">源名称</th>
                  <th className="py-1.5 text-left">当前</th>
                  <th className="py-1.5 text-left">建议</th>
                  <th className="py-1.5 text-left w-20">依据</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  let extra = {};
                  try { extra = JSON.parse(item.extra || '{}'); } catch { /* ignore */ }
                  return (
                    <tr key={item.id} className="border-b t-border/50">
                      <td className="py-1.5">
                        <input type="checkbox" checked={checked.has(item.id)} onChange={() => toggleCheck(item.id)} />
                      </td>
                      <td className="py-1.5 truncate max-w-[200px]">
                        <span className="flex items-center gap-1">
                          {item.name}
                          {item.locked && <span className="text-xs t-muted" title="手动锁定">🔒</span>}
                        </span>
                      </td>
                      <td className="py-1.5 t-muted">{item.currentGroup || '未分组'}</td>
                      <td className="py-1.5">
                        <span className={item.suggested ? 't-accent font-medium' : 't-muted'}>
                          {item.suggested || '未分组'}
                        </span>
                      </td>
                      <td className="py-1.5">
                        {item.reason === 'opml' && <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600">OPML 分类</span>}
                        {item.reason === 'keyword' && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-400/15 t-muted">关键词</span>}
                        {!item.reason && <span className="text-xs t-muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center gap-2 px-5 py-3 border-t t-border">
          <span className="text-sm t-muted">已选 {checked.size} 项</span>
          <span className="flex-1" />
          <button className="btn-ghost text-sm" onClick={onClose}>取消</button>
          <button
            className="px-4 py-1.5 rounded-lg text-sm text-white t-accent bg-[var(--accent)] disabled:opacity-50"
            disabled={!checked.size || applying}
            onClick={doApply}
          >
            {applying ? '执行中…' : `应用 ${checked.size} 项变更`}
          </button>
        </div>
      </div>
    </div>
  );
}
