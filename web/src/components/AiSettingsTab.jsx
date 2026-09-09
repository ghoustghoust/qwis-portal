// AI 设置管理 Tab（Agencs AI 平台集成）
// 功能：AI 提供商配置、功能开关、连通性测试、操作流程说明
import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

const FEATURES = [
  { key: 'translate', label: '翻译', desc: '英文文章自动/手动翻译为中文', icon: '🌐' },
  { key: 'summary', label: '摘要', desc: 'AI 生成文章/视频智能摘要', icon: '📝' },
  { key: 'classify', label: '分类', desc: 'AI 辅助日报栏目分类（补充规则引擎）', icon: '🏷️' },
  { key: 'analyze', label: '分析', desc: 'AI 辅助事件关联分析', icon: '🔍' },
];

const FLOW_DESCRIPTIONS = {
  translate: {
    trigger: '文章详情页 → 点击"翻译"按钮，或启用自动翻译后抓取时触发',
    process: '提取文章正文 → 调用 AI 翻译 API → 保存翻译结果 → 前端展示',
    output: '中文翻译文本，保留专有名词英文原文',
  },
  summary: {
    trigger: '日报生成时自动调用，或文章详情页手动触发',
    process: '提取文章内容 → AI 分析核心要点 → 生成结构化摘要',
    output: '核心要点 + 关键信息（3-5 条）+ 影响/意义',
  },
  classify: {
    trigger: '日报生成流程中，规则分类后叠加 AI 分类',
    process: '获取规则未匹配文章 → AI 判断最佳栏目归属 → 合并到日报',
    output: '栏目 ID + 置信度分数',
  },
  analyze: {
    trigger: '事件聚合页面手动触发，或定时分析',
    process: '获取近 72h 文章 → AI 判断事件关联 → 合并/拆分事件簇',
    output: '事件关联图谱 + 关联强度评分',
  },
};

export default function AiSettingsTab() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({ apiKey: '', apiBase: '', model: '' });
  const [features, setFeatures] = useState({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState('');
  const [expandedFlow, setExpandedFlow] = useState(null);

  const loadConfig = useCallback(async () => {
    try {
      const data = await api.get('/api/ai/config');
      setConfig(data);
      setForm({
        apiKey: '',
        apiBase: data.apiBase || 'https://apihub.agnes-ai.com/v1',
        model: data.model || 'agnes-2.5-flash',
      });
      setFeatures(data.features || { translate: true, summary: true, classify: false, analyze: false });
    } catch (err) {
      setMessage('加载配置失败: ' + err.message);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const payload = { apiBase: form.apiBase, model: form.model, features };
      if (form.apiKey.trim()) payload.apiKey = form.apiKey;
      await api.put('/api/ai/config', payload);
      setMessage('✅ 配置已保存');
      loadConfig();
    } catch (err) {
      setMessage('保存失败: ' + err.message);
    }
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setMessage('');
    try {
      const result = await api.post('/api/ai/ping', {});
      if (result.ok) {
        setMessage(`✅ 连通成功！模型: ${result.model}，回复: ${result.reply || '(空)'}`);
      } else {
        setMessage('❌ 连通失败: ' + (result.error || '未知错误'));
      }
    } catch (err) {
      setMessage('测试失败: ' + err.message);
    }
    setTesting(false);
  };

  const handleFeatureToggle = (key, value) => {
    setFeatures(prev => ({ ...prev, [key]: value }));
  };

  if (!config) {
    return <div className="py-8 text-center text-sm t-muted">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      {/* 标题区 */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-bold t-text">AI 能力管理</h2>
          <p className="text-sm t-muted">Agencs AI 平台配置 · 功能开关 · 操作流程</p>
        </div>
      </div>

      {/* 状态消息 */}
      {message && (
        <div className={`px-4 py-2 rounded-lg text-sm border ${
          message.startsWith('✅') ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800' :
          message.startsWith('❌') ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800' :
          'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
        }`}>
          {message}
        </div>
      )}

      {/* 提供商配置 */}
      <div className="t-surface rounded-xl border t-border p-4 space-y-4">
        <h3 className="font-semibold t-text text-sm">AI 提供商配置</h3>
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-xs t-muted mb-1">API Key {config.apiKeyConfigured && <span className="text-green-600">(已配置)</span>}</label>
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm(prev => ({ ...prev, apiKey: e.target.value }))}
              placeholder={config.apiKeyConfigured ? '已配置，留空保持不变' : '输入 API Key'}
              className="w-full px-3 py-2 rounded-lg border t-border t-bg t-text text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs t-muted mb-1">API Base URL</label>
              <input
                type="text"
                value={form.apiBase}
                onChange={(e) => setForm(prev => ({ ...prev, apiBase: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border t-border t-bg t-text text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
            </div>
            <div>
              <label className="block text-xs t-muted mb-1">模型</label>
              <input
                type="text"
                value={form.model}
                onChange={(e) => setForm(prev => ({ ...prev, model: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border t-border t-bg t-text text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary !text-sm disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存配置'}
          </button>
          <button
            onClick={handleTest}
            disabled={testing}
            className="btn-ghost !text-sm disabled:opacity-50"
          >
            {testing ? '测试中...' : '🔗 测试连通'}
          </button>
        </div>
      </div>

      {/* 功能开关 */}
      <div className="t-surface rounded-xl border t-border p-4 space-y-4">
        <h3 className="font-semibold t-text text-sm">功能开关</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FEATURES.map(f => (
            <label key={f.key} className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
              <input
                type="checkbox"
                checked={!!features[f.key]}
                onChange={(e) => handleFeatureToggle(f.key, e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded border-gray-300"
              />
              <div>
                <div className="text-sm font-medium t-text">{f.icon} {f.label}</div>
                <div className="text-xs t-muted">{f.desc}</div>
              </div>
            </label>
          ))}
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary !text-sm disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存功能开关'}
        </button>
      </div>

      {/* 操作流程说明 */}
      <div className="t-surface rounded-xl border t-border p-4 space-y-3">
        <h3 className="font-semibold t-text text-sm">操作流程说明</h3>
        <div className="space-y-2">
          {FEATURES.map(f => (
            <div key={f.key} className="rounded-lg border t-border overflow-hidden">
              <button
                onClick={() => setExpandedFlow(expandedFlow === f.key ? null : f.key)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium t-text hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
              >
                <span>{f.icon} {f.label}流程</span>
                <svg className={`w-4 h-4 t-muted transition-transform ${expandedFlow === f.key ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {expandedFlow === f.key && (
                <div className="px-4 pb-3 space-y-2 text-xs t-muted border-t t-border">
                  <div className="pt-2">
                    <span className="font-medium t-text">触发条件：</span>{FLOW_DESCRIPTIONS[f.key].trigger}
                  </div>
                  <div>
                    <span className="font-medium t-text">处理流程：</span>{FLOW_DESCRIPTIONS[f.key].process}
                  </div>
                  <div>
                    <span className="font-medium t-text">输出格式：</span>{FLOW_DESCRIPTIONS[f.key].output}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 当前状态概览 */}
      <div className="t-surface rounded-xl border t-border p-4">
        <h3 className="font-semibold t-text text-sm mb-3">当前状态</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div className="p-2 rounded-lg bg-gray-50 dark:bg-gray-800/30">
            <div className={`text-lg ${config.apiKeyConfigured ? 'text-green-600' : 'text-red-500'}`}>
              {config.apiKeyConfigured ? '✅' : '❌'}
            </div>
            <div className="text-xs t-muted">API Key</div>
          </div>
          <div className="p-2 rounded-lg bg-gray-50 dark:bg-gray-800/30">
            <div className="text-sm font-mono t-text truncate" title={config.apiBase}>{config.apiBase?.replace(/^https?:\/\//, '').slice(0, 20)}</div>
            <div className="text-xs t-muted">API 地址</div>
          </div>
          <div className="p-2 rounded-lg bg-gray-50 dark:bg-gray-800/30">
            <div className="text-sm font-mono t-text">{config.model}</div>
            <div className="text-xs t-muted">当前模型</div>
          </div>
          <div className="p-2 rounded-lg bg-gray-50 dark:bg-gray-800/30">
            <div className="text-sm font-bold t-text">{Object.values(features).filter(Boolean).length}/{FEATURES.length}</div>
            <div className="text-xs t-muted">已启用功能</div>
          </div>
        </div>
      </div>
    </div>
  );
}
