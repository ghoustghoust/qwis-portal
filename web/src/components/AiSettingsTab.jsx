// AI 设置管理 Tab（T3-8 批次5 重做：供应商下拉 / 自动列模型 / 延迟红黄绿 / 各管线用量）
// B51 摘除了 4 个假功能开关；批次5 摘除 FLOW_DESCRIPTIONS 死常量与"功能开关·操作流程"副标题残留
import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import InfoTip from './InfoTip.jsx';

// 供应商预设：选中即回填 base（可再手改）。"自定义"不清空，留给任何 OpenAI 兼容端点
const PROVIDERS = [
  { id: 'agnes', label: 'Agnes AI（默认）', base: 'https://apihub.agnes-ai.com/v1' },
  { id: 'deepseek', label: 'DeepSeek', base: 'https://api.deepseek.com/v1' },
  { id: 'openai', label: 'OpenAI 兼容', base: '' },
];

// 管线 kind 中文名（kind 集合由 api/_ai.js 的调用点决定：chat/translate/filter/analyze/theme）
const KIND_LABEL = {
  chat: '对话 / 未标注调用',
  translate: '翻译',
  filter: '初筛',
  analyze: '事件分析',
  theme: '主题全景 / 周刊主题',
};

// 延迟红黄绿阈值（口径：管理台单次探测的墙钟耗时，含限流排队与供应商重试——
// 不是跑批任务的单条耗时，两者不可比）。绿 <3s / 黄 <8s / 红 ≥8s
function latencyBand(ms) {
  if (ms == null) return { cls: 'badge-gray', label: '—' };
  if (ms < 3000) return { cls: 'badge-green', label: `${(ms / 1000).toFixed(1)}s` };
  if (ms < 8000) return { cls: 'badge-gray', label: `${(ms / 1000).toFixed(1)}s` };
  return { cls: 'badge-red', label: `${(ms / 1000).toFixed(1)}s` };
}

export default function AiSettingsTab() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({ apiKey: '', apiBase: '', model: '' });
  const [provider, setProvider] = useState('openai');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [ping, setPing] = useState(null); // { ok, provider, model, reply, elapsedMs, error }
  const [models, setModels] = useState(null); // 数组或 null
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [message, setMessage] = useState('');
  const [usage, setUsage] = useState(null);

  const loadConfig = useCallback(async () => {
    try {
      const data = await api.get('/api/ai/config');
      setConfig(data);
      setForm({ apiKey: '', apiBase: data.apiBase || '', model: data.model || '' });
      const hit = PROVIDERS.find((p) => p.base && p.base === (data.apiBase || ''));
      setProvider(hit ? hit.id : 'openai');
    } catch (err) {
      setMessage('加载配置失败: ' + err.message);
    }
  }, []);

  const loadUsage = useCallback(async () => {
    try {
      setUsage(await api.get('/api/ai/usage'));
    } catch { /* 用量加载失败不阻断配置区 */ }
  }, []);

  useEffect(() => { loadConfig(); loadUsage(); }, [loadConfig, loadUsage]);

  const pickProvider = (id) => {
    setProvider(id);
    const hit = PROVIDERS.find((p) => p.id === id);
    if (hit && hit.base) setForm((prev) => ({ ...prev, apiBase: hit.base }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const payload = { apiBase: form.apiBase, model: form.model };
      if (form.apiKey.trim()) payload.apiKey = form.apiKey;
      const r = await api.put('/api/ai/config', payload);
      if (r.changed && r.changed.length === 0) {
        setMessage('配置无变化，未写库');
      } else {
        setMessage(`✅ 已保存并探测通过（provider=${r.probe?.provider}，model=${r.probe?.model}）`);
      }
      setForm((prev) => ({ ...prev, apiKey: '' }));
      loadConfig();
    } catch (err) {
      setMessage('保存失败: ' + err.message);
    }
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setPing(null);
    try {
      const r = await api.post('/api/ai/ping', {});
      setPing(r);
    } catch (err) {
      setPing({ ok: false, error: err.message });
    }
    setTesting(false);
  };

  const handleListModels = async () => {
    setLoadingModels(true);
    setModelsError('');
    try {
      const body = { apiBase: form.apiBase };
      if (form.apiKey.trim()) body.apiKey = form.apiKey;
      const r = await api.post('/api/ai/models', body);
      setModels(r.models || []);
      if (!r.models?.length) setModelsError(r.error || '供应商未返回模型');
    } catch (err) {
      setModels(null);
      setModelsError(err.message);
    }
    setLoadingModels(false);
  };

  if (!config) {
    return <div className="py-8 text-center text-sm t-muted">加载中...</div>;
  }

  const band = latencyBand(ping?.ok ? ping.elapsedMs : null);

  return (
    <div className="space-y-6">
      {/* 标题区 */}
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-lg font-bold t-text">AI 能力</h2>
          <p className="text-sm t-muted">供应商配置 · 模型与延迟 · 管线用量</p>
        </div>
      </div>

      {/* 状态消息 */}
      {message && (
        <div className="px-4 py-2 rounded-lg text-sm border t-border t-surface t-text">{message}</div>
      )}

      {/* 提供商配置 */}
      <section className="t-surface rounded-xl border t-border p-4 space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold t-text text-sm">供应商配置</h3>
          <InfoTip
            what="AI 供应商的接口地址、密钥与模型。系统所有 AI 管线（初筛/深析/翻译/主题/导语）共用这一份配置。"
            how="选供应商自动回填地址；粘贴密钥；「列出模型」拉取该 API 支持的模型后下拉选择，也可手填。保存后系统会用新配置真实调用一次做探测。"
            effect="保存成功 = 探测通过并生效，下一批任务即用新配置；探测失败会自动回滚旧配置并提示原因。每次变更会留审计记录并触发「AI 配置变更」报警（可在报警覆盖矩阵关掉）。"
          />
        </div>
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-xs t-muted mb-1">供应商</label>
            <select className="input" value={provider} onChange={(e) => pickProvider(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs t-muted mb-1">API Key {config.apiKeyConfigured && <span className="text-[var(--green)]">（已配置）</span>}</label>
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm(prev => ({ ...prev, apiKey: e.target.value }))}
              placeholder={config.apiKeyConfigured ? '已配置，留空保持不变' : '输入 API Key'}
              className="input"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs t-muted mb-1">API Base URL</label>
              <input
                type="text"
                value={form.apiBase}
                onChange={(e) => { setForm(prev => ({ ...prev, apiBase: e.target.value })); setProvider('openai'); }}
                placeholder="https://…/v1"
                className="input font-mono !text-xs"
              />
            </div>
            <div>
              <label className="block text-xs t-muted mb-1">模型</label>
              {models && models.length ? (
                <select
                  className="input font-mono !text-xs"
                  value={models.includes(form.model) ? form.model : ''}
                  onChange={(e) => setForm(prev => ({ ...prev, model: e.target.value }))}
                >
                  {!models.includes(form.model) && <option value="">（当前值不在列表中，手输）</option>}
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <input
                  type="text"
                  value={form.model}
                  onChange={(e) => setForm(prev => ({ ...prev, model: e.target.value }))}
                  className="input font-mono !text-xs"
                />
              )}
            </div>
          </div>
          {modelsError && <div className="text-xs" style={{ color: 'var(--red)' }}>列模型失败：{modelsError}</div>}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button onClick={handleSave} disabled={saving} className="btn-primary !text-sm disabled:opacity-50">
            {saving ? '保存并探测中…' : '保存配置'}
          </button>
          <button onClick={handleListModels} disabled={loadingModels} className="btn-ghost !text-sm disabled:opacity-50">
            {loadingModels ? '列模型中…' : '列出该 API 支持的模型'}
          </button>
          <span className="flex-1" />
          <button onClick={handleTest} disabled={testing} className="btn-ghost !text-sm disabled:opacity-50">
            {testing ? '测试中…' : '测试连通'}
          </button>
          {ping && (
            <span className="flex items-center gap-1.5 text-xs t-muted">
              延迟 <span className={band.cls}>{band.label}</span>
              {ping.ok ? ` · ${ping.provider} · ${ping.model}` : ` · 失败：${ping.error}`}
              <InfoTip
                what="单次真实调用的墙钟耗时（含限流排队与供应商重试）。"
                how="点「测试连通」即测。"
                effect="绿 <3s / 黄 3~8s / 红 ≥8s。这是管理台探测口径，不代表跑批任务的单条耗时。"
              />
            </span>
          )}
        </div>
      </section>

      {/* 当前状态概览 */}
      <section className="t-surface rounded-xl border t-border p-4">
        <h3 className="font-semibold t-text text-sm mb-3">当前生效</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div className="p-2 rounded-lg t-surface2">
            <div className={`text-lg ${config.apiKeyConfigured ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
              {config.apiKeyConfigured ? '✅' : '❌'}
            </div>
            <div className="text-xs t-muted">API Key</div>
          </div>
          <div className="p-2 rounded-lg t-surface2">
            <div className="text-sm font-mono t-text truncate" title={config.apiBase}>{config.apiBase?.replace(/^https?:\/\//, '')}</div>
            <div className="text-xs t-muted">API 地址</div>
          </div>
          <div className="p-2 rounded-lg t-surface2">
            <div className="text-sm font-mono t-text">{config.model}</div>
            <div className="text-xs t-muted">当前模型</div>
          </div>
        </div>
      </section>

      {/* 各管线用量 */}
      <section className="t-surface rounded-xl border t-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="font-semibold t-text text-sm">各管线用量（近 24h）</h3>
          <InfoTip
            what="系统里每条 AI 管线（初筛/深析/翻译/主题全景等）的调用次数、失败数与平均耗时。"
            how="只读，自动加载，无需配置。"
            effect="统计来自统一 AI 通道的调用环，上限 500 条——调用密集时窗口内计数是下界；失败数持续上涨先看报警事件流的 AI 调用失败记录。"
          />
          <span className="text-[11px] t-muted">口径：滑动 24h 窗{usage?.statsCap ? ` · 统计环上限 ${usage.statsCap} 条` : ''}</span>
        </div>
        {!usage ? (
          <div className="text-sm t-muted py-4 text-center">加载中…</div>
        ) : usage.total === 0 ? (
          <div className="text-sm t-muted py-4 text-center">近 24h 无 AI 调用记录（统计环上限 {usage.statsCap} 条，只留最近的调用）</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b t-border text-xs t-muted">
                <th className="py-2 px-1.5 text-left">管线</th>
                <th className="py-2 px-1.5 text-right">调用</th>
                <th className="py-2 px-1.5 text-right">失败</th>
                <th className="py-2 px-1.5 text-right">平均耗时</th>
              </tr>
            </thead>
            <tbody>
              {usage.kinds.map((k) => (
                <tr key={k.kind} className="border-b t-border/50">
                  <td className="py-2 px-1.5">{KIND_LABEL[k.kind] || k.kind}</td>
                  <td className="py-2 px-1.5 text-right tabular-nums">{k.calls}</td>
                  <td className={`py-2 px-1.5 text-right tabular-nums ${k.failed > 0 ? 'text-[var(--red)]' : ''}`}>{k.failed}</td>
                  <td className="py-2 px-1.5 text-right tabular-nums">{k.avgMs != null ? `${(k.avgMs / 1000).toFixed(1)}s` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
