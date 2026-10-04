import { useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';

// 一键触发生成批次（T3-8 批次2：POST /api/admin/trigger → GitHub workflow_dispatch，真执行在 GH runner）
// 未配置 GH_TRIGGER_PAT 时后端 400 诚实报缺凭据——按钮不装死（总规格准入：没有的写口不假装有）
export default function TriggerButton({ mode, label = '重新生成', confirmText, disabled = false, onDone }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const tip = confirmText || `确认触发「${label}」？生成需几十分钟，AI 额度照常消耗。`;
    if (!window.confirm(tip)) return;
    setBusy(true);
    try {
      const r = await api.post('/api/admin/trigger', { mode });
      toast(r.message || '已触发');
      onDone && onDone();
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="btn-ghost !py-1 !px-2.5 text-xs" disabled={busy || disabled} onClick={run}>
      {busy ? '触发中…' : label}
    </button>
  );
}
