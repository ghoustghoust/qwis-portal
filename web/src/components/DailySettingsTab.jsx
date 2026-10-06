import { useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import SourcePickerModal from './SourcePickerModal.jsx';
import TriggerButton from './TriggerButton.jsx';
import InfoTip from './InfoTip.jsx';
import SourceAvatar from './ui/SourceAvatar.jsx';

// 已选源头像堆叠预览（用户 10-06：前 6 个头像 + 超了 +N——看到订阅了什么）
function SelectedAvatars({ sources, ids }) {
  const list = (ids || []).map((id) => (sources || []).find((x) => x.id === id)).filter(Boolean);
  if (!list.length) return null;
  const shown = list.slice(0, 6);
  const more = list.length - shown.length;
  return (
    <span className="flex items-center" title={list.map((x) => x.name).join('、')}>
      {shown.map((x, i) => (
        <span key={x.id} className="rounded-full overflow-hidden flex-none" style={{ marginLeft: i ? -6 : 0, border: '1.5px solid var(--surface-card, #fff)', position: 'relative', zIndex: 10 - i }}>
          <SourceAvatar name={x.name} avatar={x.avatar} size={20} />
        </span>
      ))}
      {more > 0 && <span className="text-[10px] t-muted ml-1.5 tabular-nums">+{more}</span>}
    </span>
  );
}

// 管理后台·每日早报设置（F18 → T3-8 批次2 改造）：
// ①生成管理（真触发入口，替代旧的纯文本命令壳）②基础设置 ③每源配额 ④来源勾选（选源器弹窗，替代全量平铺）⑤栏目管理（只读过渡，T5-3 将替代）
export default function DailySettingsTab() {
  const [loading, setLoading] = useState(true); // 初始必须为 true：首帧渲染 form=null 时不得穿透到表单（2026-09-12 日报设置崩溃根因）
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);
  const [articleSources, setArticleSources] = useState([]);
  const [videoSources, setVideoSources] = useState([]);
  const [focusA, setFocusA] = useState([]);
  const [focusV, setFocusV] = useState([]);
  const [columns, setColumns] = useState([]);
  // 级3 每源配额：独立于 form —— 它落在 settings 的点分键 prescreen.perSourceCap（不走 /api/settings/daily）
  const [capVal, setCapVal] = useState(2);
  const [capSaving, setCapSaving] = useState(false);
  // T3-8 批次2：选源器弹窗（null=关闭；'article'/'video'）——替代全量平铺勾选列表
  const [picker, setPicker] = useState(null);
  // T5-3：AI 动态栏目开关（daily.aiColumns.enabled——栏目名随当天内容，替换关键词归栏）
  const [aiCols, setAiCols] = useState(null); // null=未加载
  const [aiColsSaving, setAiColsSaving] = useState(false);

  const list = (d) => (Array.isArray(d) ? d : d?.items || d?.sources || []);

  const load = async () => {
    setLoading(true);
    try {
      const s = await api.get('/api/settings/daily');
      // 配额回显单独取（后端透出的是**归一后的值**，与四个消费方实际执行的那个数为同一条实现）
      api.get('/api/settings').then((g) => setCapVal(g?.prescreen?.perSourceCap ?? 2)).catch(() => {});
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
      setFocusA(aSrc.filter((x) => x.spotlight || x.focus).map((x) => x.id));
      setFocusV(vSrc.filter((x) => x.spotlight || x.focus).map((x) => x.id));
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

  if (!form) {
    // 加载中或加载失败都不得穿透到下方表单（form=null 时读 form.windowHours 会崩）
    return loading
      ? <div className="py-12 text-center text-sm t-muted">加载中…</div>
      : <div className="py-12 text-center text-sm t-muted">日报设置加载失败，请检查网络后<button className="ml-2 underline" onClick={() => { setLoading(true); load(); }}>重试</button></div>;
  }

  const patch = (p) => setForm((f) => ({ ...f, ...p }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        windowHours: Number(form.windowHours) || 48,
        time: form.time || '08:00',
        articleSourceIds: form.articleSourceIds,
        videoSourceIds: form.videoSourceIds,
        spotlightSourceIds: [...focusA, ...focusV],
        // 栏目管理只读过渡（用户 10-04 拍板）：columns 原样回传不改动，保存行为对后端无感
        columns: columns.map((c) => {
          const base = { id: c.id, name: (c.name || '').trim(), desc: (c.desc || '').trim() };
          if (c.special) return { ...base, special: c.special };
          return {
            ...base,
            keywords: (c.keywords || []),
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

  return (
    <div className="flex flex-col gap-6">
      {/* 生成管理（T3-8 批次2：真触发入口——旧版此处是三条本地命令的纯文本壳） */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="text-base font-bold t-text">生成管理</div>
            <InfoTip
              what="手动触发一次每日早报生成，跑在 GitHub runner 上（不是这个页面自己跑）。"
              how="点「重新生成」并确认即可；不需要等生成窗口。"
              effect="触发后几十分钟内出新一期，进度在 GitHub Actions 的 collect 运行里看。"
            />
          </div>
          <TriggerButton mode="daily-ai-evening" label="重新生成每日早报" confirmText="确认触发每日早报重新生成？生成需几十分钟，AI 额度照常消耗。" />
        </div>
        <div className="text-[11px] t-muted">
          自动生成：每晚 21:30（滚动 24h 窗口）、00:32 备跑（自然日窗口）；生成 &gt; 翻译：保护窗内翻译批次自动让路。
        </div>
      </section>

      {/* 基础设置 */}
      <section>
        <div className="flex items-center gap-2 mb-1">
          <div className="text-base font-bold t-text">基础设置</div>
          <InfoTip
            what="每日早报的统计窗口与自动生成时刻。"
            how="窗口为小时数；生成时间只影响本地调度器——生产链路的点位在作业文件里，界面改不动。"
            effect="保存后的下一个生成批次生效。"
          />
        </div>
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

      {/* 级3 每源配额（44 号 spec 步1）：独立保存，不跟底部「保存设置」按钮走（它写的是另一个键） */}
      <section>
        <div className="flex items-center gap-2 mb-1">
          <div className="text-base font-bold t-text">每源每日配额（进模型前先削减）</div>
          <InfoTip
            what="每个源每天最多送 N 篇进模型，其余按源丢弃——换的是源覆盖宽度，不是进报门槛。"
            how="填 1~100，独立保存（不跟底部按钮走）；日更 ≤N 的小源完全不受影响。"
            effect="下一个生成批次生效；改它不改变送模型总量（仍截 500 篇），改的是这 500 篇覆盖多少个源。"
          />
        </div>
        <div className="flex items-end gap-3">
          <div className="w-48">
            <label className="text-[13px] font-medium t-text">每源最多篇数（1~100）</label>
            <input
              type="number"
              min={1}
              max={100}
              className="input mt-2"
              value={capVal}
              onChange={(e) => setCapVal(e.target.value)}
            />
          </div>
          <button
            className="btn-primary"
            disabled={capSaving}
            onClick={async () => {
              setCapSaving(true);
              try {
                await api.put('/api/settings', { prescreen: { perSourceCap: Number(capVal) } });
                const g = await api.get('/api/settings');
                setCapVal(g?.prescreen?.perSourceCap ?? 2);
      api.get('/api/settings').then((st) => setAiCols(st?.daily?.aiColumns || { enabled: true })).catch(() => setAiCols({ enabled: true })); // 回读归一值：填 0/1.5/abc 会被后端退回默认，界面不骗人
                toast('每源配额已保存');
              } catch (e) {
                toast(e.message);
              } finally {
                setCapSaving(false);
              }
            }}
          >
            {capSaving ? '保存中…' : '保存配额'}
          </button>
        </div>
      </section>

      {/* 文章来源（T3-8 批次2：选源器弹窗，按用户样图形态——搜索/筛选/批量/已选计数） */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="text-base font-bold t-text">公众号文章来源</div>
            <InfoTip
              what="哪些来源的内容参与每日早报的候选池；「重点」来源的内容全部进「重点更新」栏。"
              how="点「选择来源」打开选源器：搜索、按状态筛选、勾选、全选筛选结果；★ 标重点。改完点底部「保存设置」落库。"
              effect="保存后的下一个生成批次生效。"
            />
          </div>
          {/* 已选源头像堆叠预览（用户 10-06：选了 57 个源要能看到订阅了什么——前 6 个头像 + 省略号 + 总数） */}
          <span className="flex items-center gap-1.5">
            <SelectedAvatars
              sources={articleSources}
              ids={form.articleSourceIds.length ? form.articleSourceIds : focusA}
            />
            <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => setPicker('article')}>
              选择来源（已选 {form.articleSourceIds.length || focusA.length}/{articleSources.length}）
            </button>
          </span>
        </div>
        <div className="text-[11px] t-muted mb-3">
          重点来源 {focusA.length} 个；来源的增删与启停在「源库」板块。
        </div>
      </section>

      {/* 视频来源 */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="text-base font-bold t-text">视频订阅来源</div>
            <InfoTip
              what="哪些视频/播客源参与每日早报候选。"
              how="与文章来源同一套选源器；改完点底部「保存设置」落库。"
              effect="保存后的下一个生成批次生效。"
            />
          </div>
          <span className="flex items-center gap-1.5">
            <SelectedAvatars
              sources={videoSources}
              ids={form.videoSourceIds.length ? form.videoSourceIds : focusV}
            />
            <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => setPicker('video')}>
              选择来源（已选 {form.videoSourceIds.length || focusV.length}/{videoSources.length}）
            </button>
          </span>
        </div>
      </section>

      {/* 栏目管理（只读过渡：用户 10-04 拍板——关键词归栏将被 AI 选题聚类 T5-3 替代，不再投入编辑面） */}
      <section>
        <div className="flex items-center gap-2 mb-1">
          <div className="text-base font-bold t-text">栏目管理</div>
          <InfoTip
            what="AI 动态栏目（T5-3）：AI 按当天内容把高分条目聚成 3~5 个主题栏（栏目名随内容变，如「模型发布」「行业动态」）。「重点更新」「其它重要」是机制栏目，始终保留。"
            how="开关打开即启用 AI 聚类（夜间主批生效，AI 聚类失败自动回退关键词栏）；关闭则回到下方关键词表归栏。"
            effect="下一期日报生效。启用的期，产物 stats.aiColumns.mode='ai'，前台栏目名每期可能不同——这是设计而非故障。"
          />
        </div>
        <div className="text-[11px] t-muted mb-3">
          {aiCols?.enabled !== false
            ? '当前：AI 动态栏目已启用——下方关键词表不参与归栏（AI 聚类失败时自动回退到它）。'
            : '当前：AI 动态栏目已关闭——按下方关键词表归栏。'}
        </div>
        <div className="mb-3 flex items-center gap-2 text-[13px]">
          <button
            className={`pill !px-3 !py-1.5 cursor-pointer ${aiCols?.enabled !== false ? 'on' : ''}`}
            disabled={aiColsSaving}
            onClick={async () => {
              setAiColsSaving(true);
              try {
                const next = { ...(aiCols || {}), enabled: !(aiCols?.enabled !== false) };
                await api.put('/api/settings/daily', { aiColumns: next });
                setAiCols(next);
                toast(next.enabled !== false ? 'AI 动态栏目已启用' : 'AI 动态栏目已关闭');
              } catch (e) { toast(e.message); }
              finally { setAiColsSaving(false); }
            }}
          >{aiCols?.enabled !== false ? 'AI 动态栏目：开' : 'AI 动态栏目：关'}</button>
          <span className="text-[11px] t-muted">点按切换（写 settings daily.aiColumns，下一期生效）</span>
        </div>
        <div className="flex flex-col gap-2">
          {columns.map((c, i) => (
            <div key={c.id || i} className="card px-3 py-2.5 text-[13px]">
              <div className="flex items-center gap-2">
                <span className="t-muted flex-none tabular-nums">{i + 1}.</span>
                <span className="font-medium t-text">{c.name || '(未命名)'}</span>
                {c.special && <span className="badge-gray flex-none">机制栏目</span>}
              </div>
              {c.special ? (
                <div className="mt-1 text-[11px] t-muted">
                  {c.special === 'spotlight' || c.special === 'focus'
                    ? '重点来源的内容全部进入此栏，按时间倒序，不限数量。'
                    : '未命中任何栏目的入选内容进入此栏兜底。'}
                </div>
              ) : (
                <div className="mt-1 text-[11px] t-muted truncate">
                  {c.desc ? `${c.desc} · ` : ''}关键词：{(c.keywords || []).length ? (c.keywords || []).join('，') : '（无）'}
                </div>
              )}
            </div>
          ))}
          {columns.length === 0 && (
            <div className="card px-4 py-6 text-center text-xs t-muted">暂无栏目配置</div>
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

      {/* 选源器弹窗：确认后写回本地暂存，仍需底部「保存设置」落库 */}
      <SourcePickerModal
        open={picker === 'article'}
        title="选择公众号文章来源"
        sources={articleSources}
        selectedIds={form.articleSourceIds.length ? form.articleSourceIds : focusA} // 空数组=靠 spotlight 兜底，弹窗显示 spotlight 为已选
        spotlightIds={focusA}
        onClose={() => setPicker(null)}
        onConfirm={(ids, spots) => { patch({ articleSourceIds: ids }); setFocusA(spots); setPicker(null); }}
      />
      <SourcePickerModal
        open={picker === 'video'}
        title="选择视频订阅来源"
        sources={videoSources}
        selectedIds={form.videoSourceIds.length ? form.videoSourceIds : focusV} // 空数组=靠 spotlight 兜底
        spotlightIds={focusV}
        onClose={() => setPicker(null)}
        onConfirm={(ids, spots) => { patch({ videoSourceIds: ids }); setFocusV(spots); setPicker(null); }}
      />
    </div>
  );
}
