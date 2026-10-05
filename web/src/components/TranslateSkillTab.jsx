// 翻译配置（T3-9 云端化落地）：云端管理台直接配置——开关/自动翻译/runner 三档提示词
// （translate / translate-refine / translate-polish）。写面按 BL9 同口径：审计+变更告警。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import InfoTip from './InfoTip.jsx';

const THRESHOLD_FIELDS = [
  { key: 'latinMin', label: '拉丁字符占比下限', note: '判英文（默认 0.5）', min: 0.1, max: 0.9, step: 0.05 },
  { key: 'cjkMax', label: '中文字符占比上限', note: '判英文（默认 0.2）', min: 0, max: 0.5, step: 0.05 },
  { key: 'minTextLen', label: '最短文本长度', note: '短于此不判英文（默认 20）', min: 5, max: 200, step: 1 },
  { key: 'thinBodyMax', label: '薄正文阈值', note: '低于此走仅标题通道（默认 400）', min: 100, max: 2000, step: 50 },
  { key: 'refineMinLen', label: '长文精翻阈值', note: '高于此走第三轮润色（默认 1500）', min: 500, max: 5000, step: 100 },
];

const PROMPT_TABS = [
  { key: 'promptTranslate', field: 'translate', label: '初翻', note: '原文 → 初译' },
  { key: 'promptRefine', field: 'refine', label: '精翻', note: '初译 → 术语对齐' },
  { key: 'promptPolish', field: 'polish', label: '润色', note: '术语对齐 → 成稿' },
];

export default function TranslateSkillTab() {
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState('');
  const [promptTab, setPromptTab] = useState('promptTranslate');
  const [glossary, setGlossary] = useState(null);
  const [newTerm, setNewTerm] = useState({ en: '', zh: '' });

  const load = useCallback(async () => {
    try {
      const [c, g] = await Promise.all([
        api.get('/api/ai/translate/config'),
        api.get('/api/ai/glossary').catch(() => ({ items: [] })),
      ]);
      setCfg(c);
      setGlossary(g.items || []);
    } catch (e) {
      toast('加载失败: ' + e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (patch, msg = '已保存') => {
    setBusy('save');
    try {
      await api.put('/api/ai/translate/config', patch);
      toast(msg);
      await load();
    } catch (e) {
      toast('保存失败: ' + e.message);
    } finally {
      setBusy('');
    }
  };

  // 开关改为本地暂存，统一保存（用户反馈：要有明确的保存动作）
  const [draft, setDraft] = useState(null); // {enabled, autoTranslate, minChars}
  const openDraft = () => setDraft({ enabled: cfg.enabled !== false, autoTranslate: cfg.autoTranslate !== false, minChars: cfg.minChars || 0, ...Object.fromEntries(THRESHOLD_FIELDS.map(f => [f.key, cfg[f.key]])) });
  const saveAll = async () => {
    if (!draft) return;
    await save({ enabled: draft.enabled, autoTranslate: draft.autoTranslate, minChars: draft.minChars, ...Object.fromEntries(THRESHOLD_FIELDS.map(f => [f.key, draft[f.key]])) }, '已保存');
    setDraft(null);
  };

  // 术语表操作
  const addTerm = async () => {
    if (!newTerm.en.trim() || !newTerm.zh.trim()) return toast('英文与中文都要填');
    await api.post('/api/ai/glossary', { add: { en: newTerm.en.trim(), zh: newTerm.zh.trim(), locked: true } });
    setNewTerm({ en: '', zh: '' });
    toast('已加入术语表');
    load();
  };
  const toggleLockTerm = async (en) => { await api.post('/api/ai/glossary', { toggleLock: { en } }); load(); };
  const removeTerm = async (en) => {
    if (!window.confirm(`从术语表删除「${en}」？（自动生长可能再加回来——锁定才是长期固化）`)) return;
    await api.post('/api/ai/glossary', { remove: { en } });
    load();
  };

  if (!cfg) return <div className="py-8 text-center text-sm t-muted">加载中…</div>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold t-text">翻译</h2>
        <p className="text-sm t-muted">云端管理台直接配置 · 改动即写云端，下一批翻译生效</p>
      </div>

      {/* 开关 */}
      <section className="card p-5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold t-text">开关</h3>
          <InfoTip
            what="翻译功能的总开关与自动翻译开关。关掉后新内容不再翻译，存量译文保留。"
            how="点开关即写云端，无需再保存。"
            effect="下一个翻译批次生效（runner 每 15 分钟出队）。"
          />
        </div>
        <div className="mt-3 space-y-2.5 text-[13px]">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={draft ? draft.enabled : (cfg.enabled !== false)}
              disabled={busy === 'save'}
              onChange={(e) => { const d = draft || { enabled: cfg.enabled !== false, autoTranslate: cfg.autoTranslate !== false, minChars: cfg.minChars || 0 }; setDraft({ ...d, enabled: e.target.checked }); }}
            />
            <span className="t-text">启用翻译功能</span>
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={draft ? draft.autoTranslate : (cfg.autoTranslate !== false)}
              disabled={busy === 'save'}
              onChange={(e) => { const d = draft || { enabled: cfg.enabled !== false, autoTranslate: cfg.autoTranslate !== false, minChars: cfg.minChars || 0 }; setDraft({ ...d, autoTranslate: e.target.checked }); }}
            />
            <span className="t-text">抓到英文内容时自动翻译</span>
          </label>
          <div className="flex items-center gap-2 pt-1">
            <span className="t-muted text-xs">翻译门槛：正文短于</span>
            <input
              type="number" min="0" className="input !w-20 !py-1 !text-xs"
              value={draft ? draft.minChars : (cfg.minChars || 0)}
              disabled={busy === 'save'}
              onChange={(e) => { const d = draft || { enabled: cfg.enabled !== false, autoTranslate: cfg.autoTranslate !== false, minChars: cfg.minChars || 0, ...Object.fromEntries(THRESHOLD_FIELDS.map(f => [f.key, cfg[f.key]])) }; setDraft({ ...d, minChars: Number(e.target.value) || 0 }); }}
            />
            <span className="t-muted text-xs">字的内容不翻译（0=都翻译）。短文（标题式提交信息）不烧额度。</span>
          </div>
          {/* 五档细腻调节（10-05 用户反馈"太粗犷"） */}
          <div className="mt-3 pt-3 border-t t-border">
            <div className="text-xs t-muted mb-2">翻译判据（五档可调——默认与现状一致，改了下一批翻译生效）：</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {THRESHOLD_FIELDS.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-xs">
                  <span className="t-muted w-32 flex-none" title={f.note}>{f.label}</span>
                  <input
                    type="number" min={f.min} max={f.max} step={f.step} className="input !w-20 !py-1 !text-xs"
                    value={draft ? (draft[f.key] ?? cfg[f.key]) : cfg[f.key]}
                    disabled={busy === 'save'}
                    onChange={(e) => { const d = draft || { enabled: cfg.enabled !== false, autoTranslate: cfg.autoTranslate !== false, minChars: cfg.minChars || 0, ...Object.fromEntries(THRESHOLD_FIELDS.map(x => [x.key, cfg[x.key]])) }; setDraft({ ...d, [f.key]: Number(e.target.value) }); }}
                  />
                  <span className="text-[10px] t-muted">{f.note}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="pt-2 flex items-center gap-2">
            <button
              className="btn-primary !py-1.5 !px-4 !text-xs"
              disabled={busy === 'save' || !draft}
              onClick={saveAll}
            >保存设置</button>
            {draft && <button className="btn-ghost !py-1.5 !px-3 !text-xs" onClick={() => setDraft(null)}>放弃改动</button>}
            {draft && <span className="text-[11px] t-muted">有未保存的改动</span>}
          </div>
        </div>
      </section>

      {/* 三档提示词 */}
      <section className="card p-5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold t-text">提示词（runner 批量翻译三档）</h3>
          <InfoTip
            what="翻译管线的三段式提示词：初翻（原文→初译）、精翻（初译→术语对齐）、润色（术语对齐→成稿）。"
            how="选档 → 改文本 → 保存。保存即写云端，下一批翻译生效；改坏可以清空内容恢复默认（留空=用系统默认提示词）。"
            effect="改动只影响新翻译的内容，已翻好的不变。"
          />
        </div>
        <div className="mt-3 flex gap-1.5 border-b t-border pb-2">
          {PROMPT_TABS.map((t) => (
            <button
              key={t.key}
              className={`pill !px-3 !py-1.5 !text-xs cursor-pointer ${promptTab === t.key ? 'on' : ''}`}
              onClick={() => setPromptTab(t.key)}
            >
              {t.label}
              <span className="ml-1 text-[10px] t-muted">{t.note}</span>
            </button>
          ))}
        </div>
        {PROMPT_TABS.map((t) => (
          promptTab === t.key && (
            <div key={t.key} className="mt-3">
              <PromptEditor
                key={t.key}
                field={t.key}
                label={t.label}
                value={cfg.prompts?.[t.field] || ''}
                onSave={(v) => save({ [t.key]: v }, `${t.label}提示词已保存`)}
                busy={busy === 'save'}
              />
            </div>
          )
        ))}
      </section>

      {/* 术语表（沉淀术语对照——你说的"把实时变化的此沉淀下来作为术语对照"就是这个） */}
      <section className="card p-5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold t-text">术语表（{glossary ? glossary.length : '…'}）</h3>
          <InfoTip
            what="AI 翻译时强制对齐的术语对照（en → zh）。runner 翻译时会自动沉淀高频术语对进来；锁定=人工固化，不再被自动覆盖。"
            how="下方可手动加（加进来即锁定）；点 🔒/🔓 切换锁定；删除=移除（自动生长可能再加回来）。"
            effect="改动即写云端，下一批翻译生效——所有翻译提示词里的 {{glossary}} 就是这张表。"
          />
        </div>
        <div className="mt-3 flex gap-2">
          <input className="input flex-1 !text-xs" placeholder="英文（如 Transformer）" value={newTerm.en} onChange={(e) => setNewTerm({ ...newTerm, en: e.target.value })} />
          <input className="input flex-1 !text-xs" placeholder="中文（如 变换器）" value={newTerm.zh} onChange={(e) => setNewTerm({ ...newTerm, zh: e.target.value })} />
          <button className="btn-primary !py-1.5 !px-3 !text-xs" onClick={addTerm} disabled={busy === 'save'}>加入</button>
        </div>
        <div className="mt-3 max-h-64 overflow-y-auto">
          {!glossary ? (
            <div className="text-xs t-muted py-3 text-center">加载中…</div>
          ) : glossary.length === 0 ? (
            <div className="text-xs t-muted py-3 text-center">还没有术语——翻译跑起来会自动沉淀，或手动加第一条。</div>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {glossary.map((t) => (
                  <tr key={t.en} className="border-b t-border/40">
                    <td className="py-1.5 pr-2 font-mono t-text">{t.en}</td>
                    <td className="py-1.5 pr-2 t-text">{t.zh}</td>
                    <td className="py-1.5 text-right t-muted tabular-nums">{t.occurrenceCount || 0} 次</td>
                    <td className="py-1.5 text-right w-16">
                      <button className="icon-btn !w-6 !h-6" title={t.locked ? '已锁定（人工固化）' : '未锁定（自动生长可覆盖）'} onClick={() => toggleLockTerm(t.en)}>
                        {t.locked ? '🔒' : '🔓'}
                      </button>
                      <button className="icon-btn !w-6 !h-6 t-muted hover:text-red-500" title="删除" onClick={() => removeTerm(t.en)}>🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* 现状说明 */}
      <section className="card p-5 text-sm leading-relaxed">
        <div className="text-xs t-muted space-y-1.5">
          <div>翻译跑在 GH runner 的采集批次里（每 15 分钟出队）；生成窗口内翻译批次自动让路给早报/周刊。</div>
          <div>本地端「翻译」页（精翻档）与这里的三档互不相通——本地页编辑的是阅读器精翻，这里的三档管 runner 批量翻译。</div>
          <div>调用统计（次数/失败/耗时）看「AI 配置 → 各管线用量」。</div>
        </div>
      </section>
    </div>
  );
}

// 提示词编辑器：显式保存（用户反馈"没有保存按钮"）
function PromptEditor({ field, label, value, onSave, busy }) {
  const [v, setV] = useState(value);
  const dirty = v !== value;
  return (
    <div>
      <textarea
        className="input w-full font-mono !text-xs"
        rows={10}
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={`${label}提示词（留空=系统默认）`}
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button className="btn-primary !py-1.5 !px-4 !text-xs" disabled={busy || !dirty} onClick={() => onSave(v)}>保存{label}提示词</button>
        {dirty && <button className="btn-ghost !py-1.5 !px-3 !text-xs" onClick={() => setV(value)}>放弃改动</button>}
        {dirty && <span className="text-[11px] t-muted">有未保存的改动</span>}
      </div>
    </div>
  );
}
