import { useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { formatDateTime } from '../util';
import { useSettings, useStatus } from '../useSettings';

// 队列同步折叠区（F25/F31/F41）：队列 API 地址 / Token（留空不覆盖）/ 轮询间隔 / 启用开关 / 保存 / 同步
// 后端契约：PUT /api/settings 的 queue 分区 {baseUrl, token(留空不覆盖), intervalMin, enabled}
//          POST /api/queue/sync（可带 {name}）→ {ok:true, message:'导入 N 个，更新 N 个，清空云端 N 个；本地后台正在解析订阅'}
export default function QueuePanel({ type, title, endpointFile, note, onSynced }) {
  const { settings, save } = useSettings();
  const { status } = useStatus();
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [intervalMin, setIntervalMin] = useState(10);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState('');
  const [syncMsg, setSyncMsg] = useState('');
  const [syncError, setSyncError] = useState('');

  const q = settings?.queue || {};
  const qs = status?.queue || status?.queueSync || {};
  const tokenConfigured = !!(q.tokenConfigured ?? q.token_configured);

  useEffect(() => {
    setBaseUrl(q.baseUrl || '');
    setIntervalMin(q.intervalMin ?? 10);
    setEnabled(!!q.enabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const cleanBase = baseUrl.trim().replace(/\/+$/, '');
  const fullEndpoint = cleanBase ? `${cleanBase}/${endpointFile}` : `（未配置）/${endpointFile}`;

  const saveQueue = async () => {
    if (busy) return;
    setBusy('save');
    try {
      await save({
        queue: {
          baseUrl: cleanBase,
          token: token.trim() || undefined, // 留空不覆盖已保存 Token（N2）
          intervalMin: Number(intervalMin) || 10,
          enabled,
        },
      });
      setToken('');
      toast('队列设置已保存');
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy('');
    }
  };

  const syncQueue = async () => {
    if (busy) return;
    setBusy('sync');
    setSyncMsg('');
    setSyncError('');
    try {
      const d = await api.post('/api/queue/sync', { name: type });
      const msg = d?.message || '同步完成';
      setSyncMsg(msg);
      toast(msg);
      onSynced && onSynced({ ok: true, message: msg });
    } catch (e) {
      setSyncError(e.message);
      onSynced && onSynced({ ok: false, message: e.message });
    } finally {
      setBusy('');
    }
  };

  return (
    <details className="card p-5">
      <summary className="text-sm font-semibold t-text cursor-pointer select-none">{title}</summary>
      <div className="mt-4 space-y-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-3">
          <label className="t-muted w-24 flex-none">队列 API 地址</label>
          <input
            className="input flex-1 min-w-[220px] font-mono !text-xs"
            placeholder="https://api.qianmeng.news"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>
        <div className="text-[11px] t-muted ml-0 md:ml-28">
          本队列端点：<span className="font-mono">{fullEndpoint}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="t-muted w-24 flex-none">Token</label>
          <input
            type="password"
            className="input flex-1 min-w-[220px] font-mono !text-xs"
            placeholder={tokenConfigured ? '已保存 Token，输入新值可覆盖；留空不覆盖' : '粘贴云端队列 Token'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <span className="text-[11px] t-muted flex-none">
            已保存 Token：{tokenConfigured ? '已配置' : '未配置'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="t-muted w-24 flex-none">轮询间隔（分钟）</label>
          <input
            type="number"
            min="1"
            className="input !w-24"
            value={intervalMin}
            onChange={(e) => setIntervalMin(e.target.value)}
          />
          <label
            className="flex items-center gap-2 t-muted cursor-pointer"
            onClick={() => setEnabled((v) => !v)}
          >
            <span className={`switch ${enabled ? 'on' : ''}`} />
            启用队列同步
          </label>
          <div className="flex-1" />
          <button className="btn-ghost" disabled={!!busy} onClick={saveQueue}>
            保存队列设置
          </button>
          <button className="btn-primary" disabled={!!busy} onClick={syncQueue}>
            {busy === 'sync' ? '同步中…' : '同步队列'}
          </button>
        </div>
        <div className="text-[11px] t-muted">
          上次同步 {formatDateTime(qs.last_sync || qs.lastSync)} · 下次同步{' '}
          {formatDateTime(qs.next_sync || qs.nextSync)}
        </div>
        {syncMsg && (
          <div
            className="rounded-lg px-3 py-2 text-xs leading-relaxed"
            style={{ color: 'var(--green)', background: 'var(--surface-2)' }}
          >
            {syncMsg}
          </div>
        )}
        {syncError && (
          <div
            className="rounded-lg px-3 py-2 text-xs leading-relaxed"
            style={{ color: 'var(--red)', background: 'var(--surface-2)' }}
          >
            同步失败：{syncError}
          </div>
        )}
        {note && <p className="text-xs t-muted">{note}</p>}
      </div>
    </details>
  );
}
