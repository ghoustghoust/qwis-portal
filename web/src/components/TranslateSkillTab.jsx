// 翻译 Skill 管理 Tab（后台管理页固定模块）
// 功能：展示翻译配置、编辑 Prompt、手动触发翻译、查看翻译统计
import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

export default function TranslateSkillTab() {
  const [config, setConfig] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [message, setMessage] = useState('');

  const loadConfig = useCallback(async () => {
    try {
      const data = await api.get('/api/ai/translate/config');
      setConfig(data);
      setPrompt(data.prompt || data.defaultPrompt || '');
    } catch (err) {
      setMessage('加载配置失败: ' + err.message);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      await api.put('/api/ai/translate/config', { prompt });
      setMessage('✅ 提示词已保存');
      loadConfig();
    } catch (err) {
      setMessage('保存失败: ' + err.message);
    }
    setSaving(false);
  };

  const handleRestoreDefault = async () => {
    if (!confirm('确定恢复默认提示词？当前自定义内容将丢失。')) return;
    setSaving(true);
    try {
      await api.put('/api/ai/translate/config', { restoreDefault: true });
      await loadConfig();
      setPrompt(config?.defaultPrompt || '');
      setMessage('✅ 已恢复默认提示词');
    } catch (err) {
      setMessage('恢复失败: ' + err.message);
    }
    setSaving(false);
  };

  const handleBatchTranslate = async () => {
    setTranslating(true);
    setMessage('');
    try {
      const result = await api.post('/api/ai/translate/batch', { limit: 10 });
      if (result.translated > 0) {
        setMessage(`✅ 成功翻译 ${result.translated} 篇文章`);
      } else {
        setMessage('ℹ️ ' + (result.message || '没有待翻译的英文文章'));
      }
      loadConfig();
    } catch (err) {
      setMessage('翻译失败: ' + err.message);
    }
    setTranslating(false);
  };

  const handleToggleEnabled = async (enabled) => {
    try {
      await api.put('/api/ai/translate/config', { enabled });
      loadConfig();
      setMessage(enabled ? '✅ 翻译功能已启用' : '⚠️ 翻译功能已停用');
    } catch (err) {
      setMessage('操作失败: ' + err.message);
    }
  };

  const handleToggleAuto = async (autoTranslate) => {
    try {
      await api.put('/api/ai/translate/config', { autoTranslate });
      loadConfig();
      setMessage(autoTranslate ? '✅ 自动翻译已启用' : '⚠️ 自动翻译已停用');
    } catch (err) {
      setMessage('操作失败: ' + err.message);
    }
  };

  if (!config) {
    return <div className="py-8 text-center text-sm t-muted">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      {/* 标题区 */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-bold t-text">PDF Translate · 精翻 Skill</h2>
          <p className="text-sm t-muted">对英文资讯、论文、工程文章进行高质量中文翻译</p>
        </div>
      </div>

      {/* 状态消息 */}
      {message && (
        <div className="px-4 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-sm text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
          {message}
        </div>
      )}

      {/* 功能开关区 */}
      <div className="t-surface rounded-xl border t-border p-4 space-y-4">
        <h3 className="font-semibold t-text text-sm">功能控制</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => handleToggleEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300"
            />
            <div>
              <div className="text-sm font-medium t-text">启用翻译功能</div>
              <div className="text-xs t-muted">关闭后所有翻译接口将返回错误</div>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={config.autoTranslate}
              onChange={(e) => handleToggleAuto(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300"
            />
            <div>
              <div className="text-sm font-medium t-text">自动翻译</div>
              <div className="text-xs t-muted">抓取到新英文文章时自动触发翻译</div>
            </div>
          </label>
        </div>
      </div>

      {/* 统计区 */}
      <div className="t-surface rounded-xl border t-border p-4">
        <h3 className="font-semibold t-text text-sm mb-3">翻译统计</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold t-text">{config.stats?.totalArticles || 0}</div>
            <div className="text-xs t-muted">总文章数</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{config.stats?.translatedArticles || 0}</div>
            <div className="text-xs t-muted">已翻译</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-orange-600">{config.stats?.pendingArticles || 0}</div>
            <div className="text-xs t-muted">待翻译</div>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            onClick={handleBatchTranslate}
            disabled={translating}
            className="btn-ghost !text-sm disabled:opacity-50"
          >
            {translating ? '翻译中...' : '手动翻译下一批 (10篇)'}
          </button>
        </div>
      </div>

      {/* Prompt 编辑区 */}
      <div className="t-surface rounded-xl border t-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold t-text text-sm">翻译提示词 (Prompt)</h3>
          <button
            onClick={handleRestoreDefault}
            disabled={saving}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            恢复默认
          </button>
        </div>
        <p className="text-xs t-muted mb-3">
          提示词决定翻译的风格和质量。可以针对新闻资讯、学术论文、工程文档等不同场景进行调整。
        </p>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={12}
          className="w-full px-3 py-2 rounded-lg border t-border t-bg t-text text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          placeholder="输入翻译提示词..."
        />
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary !text-sm disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存提示词'}
          </button>
          <span className="text-xs t-muted self-center">
            当前字符数: {prompt.length}
          </span>
        </div>
      </div>

      {/* 默认 Prompt 预览（折叠） */}
      <details className="t-surface rounded-xl border t-border p-4">
        <summary className="font-semibold t-text text-sm cursor-pointer">
          查看默认提示词
        </summary>
        <pre className="mt-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 text-xs t-muted overflow-x-auto whitespace-pre-wrap">
          {config.defaultPrompt}
        </pre>
      </details>
    </div>
  );
}
