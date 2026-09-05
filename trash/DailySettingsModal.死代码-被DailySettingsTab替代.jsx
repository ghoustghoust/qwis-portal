import { useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';

// 日报设置弹窗（F18）：统计窗口/生成时间/来源勾选+重点关照/栏目管理
// AI 配置已随 AI 摘要下线；本组件入口暂隐藏（第二期迁入管理后台）
export default function DailySettingsModal({ open, onClose, onSaved }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null); // {windowHours,time,articleSourceIds,videoSourceIds}
  const [articleSources, setArticleSources] = useState([]); // wechat + rss
  const [videoSources, setVideoSources] = useState([]); // bilibili + douyin
  const [focusA, setFocusA] = useState([]); // 文章源重点关照 id
  const [focusV, setFocusV] = useState([]); // 视频源重点关照 id
  const [columns, setColumns] = useState([]); // 栏目编辑态（keywords 以 kwText 逗号串编辑）

  const list = (d) => (Array.isArray(d) ? d : d?.items || d?.sources || []);

  const load = async () => {
    setLoading(true);
    try {
      const s = await api.get('/api/settings/daily');
      const d = s?.settings || s || {};
      // 优先用设置接口自带的来源清单（含 selected/focus），缺省再回退到 /api/sources
      let aSrc = d.articleSources;
      let vSrc = d.videoSources;
      if (!Array.isArray(aSrc) || !Array.isArray(vSrc)) {
        const [wx, rss, bili, dy] = await Promise.all([
          api.get('/api/sources?type=wechat').catch(() => []),
          api.get('/api/sources?type=rss').catch(() => []),
          api.get('/api/sources?type=bilibili').catch(() => []),
          api.get('/api/sources?type=douyin').catch(() => []),
        ]);
        aSrc = [...list(wx), ...list(rss)];
        vSrc = [...list(bili), ...list(dy)];
      }
      setArticleSources(aSrc);
      setVideoSources(vSrc);
      setForm({
        windowHours: d.windowHours ?? 48,
        time: d.time || '08:00',
        // null/缺省 = 全选
        articleSourceIds: d.articleSourceIds ?? aSrc.filter((x) => x.selected !== false).map((x) => x.id),
        videoSourceIds: d.videoSourceIds ?? vSrc.filter((x) => x.selected !== false).map((x) => x.id),
      });
      setFocusA(aSrc.filter((x) => x.focus).map((x) => x.id));
      setFocusV(vSrc.filter((x) => x.focus).map((x) => x.id));
      setColumns(
        (d.columns || []).map((c) => ({
          ...c,
          kwText: (c.keywords || []).join('，'),
        }))
      );
    } catch (e) {
      toast(e.message);
      setForm(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const toggleIn = (arr, id) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  const patch = (p) => setForm((f) => ({ ...f, ...p }));

  const restoreColumns = async () => {
    try {
      await api.put('/api/settings/daily', { restoreDefaultColumns: true });
      await load();
      toast('已恢复默认四栏目');
    } catch (e) {
      toast(e.message);
    }
  };

  const addColumn = () =>
    setColumns((cs) => [...cs, { id: `c${Date.now()}`, name: '', desc: '', kwText: '' }]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        windowHours: Number(form.windowHours) || 48,
        time: form.time || '08:00',
        articleSourceIds: form.articleSourceIds,
        videoSourceIds: form.videoSourceIds,
        focusSourceIds: [...focusA, ...focusV], // 重点关照全量写 sources.focus
        columns: columns.map((c) => {
          const base = { id: c.id, name: c.name.trim(), desc: (c.desc || '').trim() };
          if (c.special) return { ...base, special: c.special };
          return {
            ...base,
            keywords: (c.kwText || '')
              .split(/[,，]/)
              .map((s) => s.trim())
              .filter(Boolean),
          };
        }),
      };
      await api.put('/api/settings/daily', payload);
      toast('日报设置已保存');
      onSaved?.();
      onClose();
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  const renderSourceList = (sources, selectedKey, focusIds, setFocusIds) => {
    const selected = form[selectedKey];
    const allChecked = sources.length > 0 && sources.every((s) => selected.includes(s.id));
    return (
      <div className="card divide-y divide-[var(--border)]">
        <label className="flex items-center gap-2 px-4 py-2.5 text-[13px] t-text cursor-pointer">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={(e) =>
              patch({ [selectedKey]: e.target.checked ? sources.map((s) => s.id) : [] })
            }
          />
          全选（{selected.length}/{sources.length}）
        </label>
        {sources.map((s) => {
          const focused = focusIds.includes(s.id);
          return (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
              <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(s.id)}
                  onChange={() => patch({ [selectedKey]: toggleIn(selected, s.id) })}
                />
                <span className="text-[13px] t-text truncate">{s.name || s.url}</span>
              </label>
              {focused && (
                <span
                  className="flex-none text-[11px] px-2 py-0.5 rounded-full"
                  style={{
                    color: 'var(--red)',
                    border: '1px solid var(--red)',
                  }}
                >
                  已重点关照
                </span>
              )}
              <button
                className={`switch ${focused ? 'on' : ''}`}
                style={focused ? { background: 'var(--red)' } : undefined}
                title="重点关照：该来源内容全部进入「重点更新」栏"
                onClick={() => setFocusIds(toggleIn(focusIds, s.id))}
              />
            </div>
          );
        })}
        {sources.length === 0 && (
          <div className="px-4 py-6 text-center text-xs t-muted">暂无订阅源</div>
        )}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onClick={onClose}
    >
      <div
        className="card w-full max-w-[640px] max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start px-6 pt-4 pb-3 flex-none border-b t-border">
          <div>
            <div className="text-[10px] tracking-[0.2em] t-muted uppercase">Daily Settings</div>
            <div className="mt-0.5 text-base font-bold t-text">日报设置</div>
          </div>
          <div className="flex-1" />
          <button className="icon-btn" title="关闭" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading || !form ? (
            <div className="py-12 text-center text-sm t-muted">
              {loading ? '加载中…' : '设置加载失败'}
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {/* 基础 */}
              <section>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[13px] font-medium t-text">统计窗口（小时）</label>
                    <input
                      type="number"
                      min={1}
                      className="input mt-2"
                      value={form.windowHours}
                      onChange={(e) => patch({ windowHours: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-[13px] font-medium t-text">每日生成时间</label>
                    <input
                      type="time"
                      className="input mt-2"
                      value={form.time}
                      onChange={(e) => patch({ time: e.target.value })}
                    />
                  </div>
                </div>
              </section>

              {/* 文章来源 */}
              <section>
                <div className="text-[13px] font-medium t-text">公众号文章来源</div>
                <div className="mt-1 text-[11px] t-muted">
                  勾选纳入日报统计的来源；「重点关照」来源的内容全部进入「重点更新」栏。
                </div>
                <div className="mt-2">
                  {renderSourceList(articleSources, 'articleSourceIds', focusA, setFocusA)}
                </div>
              </section>

              {/* 视频来源 */}
              <section>
                <div className="text-[13px] font-medium t-text">视频订阅来源</div>
                <div className="mt-2">
                  {renderSourceList(videoSources, 'videoSourceIds', focusV, setFocusV)}
                </div>
              </section>

              {/* 栏目管理（F15） */}
              <section>
                <div className="flex items-center justify-between">
                  <div className="text-[13px] font-medium t-text">栏目管理</div>
                  <div className="flex gap-2">
                    <button className="btn-ghost !py-1 !px-2 text-xs" onClick={addColumn}>
                      ＋ 新增栏目
                    </button>
                    <button className="btn-ghost !py-1 !px-2 text-xs" onClick={restoreColumns}>
                      恢复默认四栏目
                    </button>
                  </div>
                </div>
                <div className="mt-1 text-[11px] t-muted">
                  栏目按顺序展示；关键词命中标题或内容即归入该栏，逗号分隔。
                </div>
                <div className="mt-2 flex flex-col gap-3">
                  {columns.map((c, i) => (
                    <div key={c.id || i} className="card p-3">
                      <div className="flex items-center gap-2">
                        <input
                          className="input"
                          value={c.name}
                          placeholder="栏目名称"
                          onChange={(e) =>
                            setColumns((cs) =>
                              cs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))
                            )
                          }
                        />
                        <button
                          className="btn-ghost !py-1 !px-2 text-xs flex-none"
                          disabled={!!c.special}
                          title={c.special ? '机制栏目不可删除' : '删除栏目'}
                          onClick={() => setColumns((cs) => cs.filter((_, j) => j !== i))}
                        >
                          删除
                        </button>
                      </div>
                      {c.special ? (
                        <div className="mt-2 text-[11px] t-muted">
                          {c.special === 'focus'
                            ? '机制栏目：重点关照来源的内容全部进入此栏，按时间倒序，不限数量。'
                            : '机制栏目：未命中任何栏目的入选内容进入此栏兜底。'}
                        </div>
                      ) : (
                        <>
                          <input
                            className="input mt-2"
                            value={c.desc || ''}
                            placeholder="说明文字（显示在栏目右侧）"
                            onChange={(e) =>
                              setColumns((cs) =>
                                cs.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x))
                              )
                            }
                          />
                          <input
                            className="input mt-2"
                            value={c.kwText}
                            placeholder="命中关键词，逗号分隔"
                            onChange={(e) =>
                              setColumns((cs) =>
                                cs.map((x, j) => (j === i ? { ...x, kwText: e.target.value } : x))
                              )
                            }
                          />
                        </>
                      )}
                    </div>
                  ))}
                  {columns.length === 0 && (
                    <div className="card px-4 py-6 text-center text-xs t-muted">
                      暂无栏目，可新增或恢复默认四栏目
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-3 flex-none border-t t-border">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" disabled={loading || !form || saving} onClick={save}>
            {saving ? '保存中…' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  );
}
