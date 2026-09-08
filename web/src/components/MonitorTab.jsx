// 5.4 采集失败率监控仪表盘
// 展示：各源最近 7 天成功率 + 任务队列实时状态 + 健康自检摘要
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';

function rateColor(rate) {
  if (rate >= 90) return 't-success';
  if (rate >= 70) return 't-warn';
  return 't-danger';
}

export default function MonitorTab() {
  const [health, setHealth] = useState(null);
  const [queueStats, setQueueStats] = useState(null);
  const [sourceStats, setSourceStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, qs, ss] = await Promise.all([
        api.get('/api/health/status').catch(() => null),
        api.get('/api/queue/stats').catch(() => null),
        api.get('/api/health/source-stats?days=7').catch(() => null),
      ]);
      setHealth(h);
      setQueueStats(qs);
      setSourceStats(ss);
    } catch (e) {
      toast('加载监控数据失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 自动刷新（60s）
  useEffect(() => {
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const srcItems = sourceStats?.items || [];
  const qs = queueStats || {};

  return (
    <div className="space-y-6">
      {/* 健康概览 */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">健康概览</h3>
        {health ? (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-4 text-[13px]">
            <div className="card t-surface2 px-3 py-2 text-center">
              <div className="text-lg font-bold t-text">{health.sources?.total ?? '—'}</div>
              <div className="text-xs t-muted">总源数</div>
            </div>
            <div className="card t-surface2 px-3 py-2 text-center">
              <div className="text-lg font-bold t-success">{health.sources?.enabled ?? '—'}</div>
              <div className="text-xs t-muted">已启用</div>
            </div>
            <div className="card t-surface2 px-3 py-2 text-center">
              <div className="text-lg font-bold t-warn">{health.sources?.error ?? '—'}</div>
              <div className="text-xs t-muted">异常</div>
            </div>
            <div className="card t-surface2 px-3 py-2 text-center">
              <div className="text-lg font-bold t-danger">{health.sources?.frozen ?? '—'}</div>
              <div className="text-xs t-muted">已熔断</div>
            </div>
          </div>
        ) : (
          <div className="mt-3 text-xs t-muted">加载中…</div>
        )}
      </section>

      {/* 任务队列状态 */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">任务队列</h3>
        {queueStats ? (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3 text-[13px]">
            {[
              { label: 'Pending', value: qs.pending ?? 0, cls: 't-muted' },
              { label: 'Running', value: qs.running ?? 0, cls: 't-accent' },
              { label: 'Completed', value: qs.completed ?? 0, cls: 't-success' },
              { label: 'Failed', value: qs.failed ?? 0, cls: 't-danger' },
              { label: 'Dead', value: qs.dead ?? 0, cls: 't-danger' },
            ].map((s) => (
              <div key={s.label} className="card t-surface2 px-3 py-2 text-center">
                <div className={`text-lg font-bold tabular-nums ${s.cls}`}>{s.value}</div>
                <div className="text-xs t-muted">{s.label}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-xs t-muted">队列接口不可用</div>
        )}
      </section>

      {/* 各源成功率 */}
      <section className="card p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold t-text">源抓取成功率（近 {sourceStats?.days || 7} 天）</h3>
          <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={load} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
        {srcItems.length > 0 ? (
          <div className="mt-3 card overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="t-surface2 text-left">
                  <th className="px-4 py-2 font-medium t-muted text-xs">源名称</th>
                  <th className="px-4 py-2 font-medium t-muted text-xs">类型</th>
                  <th className="px-4 py-2 font-medium t-muted text-xs text-right">总任务</th>
                  <th className="px-4 py-2 font-medium t-muted text-xs text-right">成功</th>
                  <th className="px-4 py-2 font-medium t-muted text-xs text-right">失败</th>
                  <th className="px-4 py-2 font-medium t-muted text-xs text-right">成功率</th>
                </tr>
              </thead>
              <tbody>
                {srcItems.slice(0, 50).map((r) => (
                  <tr key={r.source_id} className="border-t t-border">
                    <td className="px-4 py-2 t-text truncate max-w-[200px]" title={r.name}>{r.name}</td>
                    <td className="px-4 py-2 t-muted">{r.type}</td>
                    <td className="px-4 py-2 t-muted text-right tabular-nums">{r.total}</td>
                    <td className="px-4 py-2 t-success text-right tabular-nums">{r.success}</td>
                    <td className="px-4 py-2 t-danger text-right tabular-nums">{r.failed}</td>
                    <td className={`px-4 py-2 text-right tabular-nums font-medium ${rateColor(r.rate)}`}>
                      {r.rate}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-3 text-xs t-muted">暂无任务队列数据（源抓取尚未产生历史记录）</div>
        )}
      </section>
    </div>
  );
}
