import { useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';

// 管理后台日报设置 Tab（F18）：统计窗口/生成时间/来源勾选 + 重点关照/栏目管理
// 替代 DailySettingsModal 弹窗，独立页面展示
export default function DailySettingsTab() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);
  const [articleSources, setArticleSources] = useState([]);
  const [videoSources, setVideoSources] = useState([]);
  const [focusA, setFocusA] = useState([]);
  const [focusV, setFocusV] = useState([]);
  const [columns, setColumns] = useState([]);

  const list = (d) => (Array.isArray(d) ? d : d?.items || d?.sources || []);

  const load = async () => {
    setLoading(true);
    try {
      const s = await api.get('/api/settings/daily');
      // 后端返回的是扁平结构，不是 { ok: true, settings: {...} }
      const d = s || {};
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
    load();
  }, []);

  if (!form && loading) {
    return <div className="py-12 text-center text-sm t-muted">加载中…</div>;
  }

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
        focusSourceIds: [...focusA, ...focusV],
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
                <span className="badge-red flex-none">已重点关照</span>
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
    <div className="flex flex-col gap-6">
      {/* 基础设置 */}
      <section>
        <div className="text-base font-bold t-text mb-1">基础设置</div>
        <div className="text-[11px] t-muted mb-3">配置日报统计窗口和每日自动生成时间</div>
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
        <div className="text-base font-bold t-text mb-1">公众号文章来源</div>
        <div className="text-[11px] t-muted mb-3">
          勾选纳入日报统计的来源；「重点关照」来源的内容全部进入「重点更新」栏。
        </div>
        {renderSourceList(articleSources, 'articleSourceIds', focusA, setFocusA)}
      </section>

      {/* 视频来源 */}
      <section>
        <div className="text-base font-bold t-text mb-1">视频订阅来源</div>
        {renderSourceList(videoSources, 'videoSourceIds', focusV, setFocusV)}
      </section>

      {/* 栏目管理 */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <div className="text-base font-bold t-text">栏目管理</div>
          <div className="flex gap-2">
            <button className="btn-ghost !py-1 !px-2 text-xs" onClick={addColumn}>
              ＋ 新增栏目
            </button>
            <button className="btn-ghost !py-1 !px-2 text-xs" onClick={restoreColumns}>
              恢复默认四栏目
            </button>
          </div>
        </div>
        <div className="text-[11px] t-muted mb-3">
          栏目按顺序展示；关键词命中标题或内容即归入该栏，逗号分隔。
        </div>
        <div className="flex flex-col gap-3">
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

      {/* 操作按钮 */}
      <div className="flex justify-end gap-2 pt-4 border-t t-border">
        <button className="btn-ghost" onClick={() => load()}>
          重置
        </button>
        <button className="btn-primary" disabled={saving} onClick={save}>
          {saving ? '保存中…' : '保存设置'}
        </button>
      </div>
    </div>
  );
}
