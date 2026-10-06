// 5.4 采集失败率监控仪表盘
// 展示：各源最近 7 天成功率 + 任务队列实时状态 + 健康自检摘要
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import CollectTrendChart from './CollectTrendChart.jsx';

function rateColor(rate) {
  if (rate >= 90) return 't-success';
  if (rate >= 70) return 't-warn';
  return 't-danger';
}

export default function MonitorTab() {
  const [health, setHealth] = useState(null);
  const [queueStats, setQueueStats] = useState(null);
  const [sourceStats, setSourceStats] = useState(null);
  const [collectHistory, setCollectHistory] = useState(null);
  const [loading, setLoading] = useState(true);

  // force=true 绕 90s 缓存强拉（手动刷新按钮与 60s 自动轮询用；挂载首渲染吃缓存瞬时呈现）
  const load = useCallback(async (force) => {
    setLoading(true);
    try {
      const [h, ss, ch] = await Promise.all([
        api.get('/api/health/status', force).catch(() => null),
        // /api/queue/stats 云端路由已摘（10-06 pending_items 收摊）——本地端仍有，云端不再拉
        api.get('/api/health/source-stats?days=7', force).catch(() => null),
        api.get('/api/health/collect-history', force).catch(() => null),
      ]);
      setHealth(h);
      setQueueStats(null); // 云端无此端点（10-06 摘）——卡片显示"云端无此数据"
      setSourceStats(ss);
      setCollectHistory(ch);
    } catch (e) {
      toast('加载监控数据失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 自动刷新（60s；force 绕缓存保数据新鲜）
  useEffect(() => {
    const t = setInterval(() => load(true), 60000);
    return () => clearInterval(t);
  }, [load]);

  const srcItems = sourceStats?.items || [];
  // B47：后端返回 {overall:{...}, byType:{...}}，前端曾读顶层 qs.pending → 恒 undefined→0（线上真实 pending=177 显示为 0）
  const qs = queueStats?.overall || queueStats || {};

  return (
    <div className="space-y-6">
      {/* T3-2 R2：采集趋势折线图 */}
      <section className="card p-5 mb-4">
        <h3 className="text-sm font-semibold t-text">采集趋势（心跳追加式历史）</h3>
        <div className="mt-3">
          <CollectTrendChart history={collectHistory?.history} />
        </div>
      </section>
      {/* 健康概览 */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">健康概览</h3>
        {health ? (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-4 text-[13px]">
            <div className="card t-surface2 px-3 py-2 text-center">
              <div className="text-lg font-bold t-text">{health.sources?.total ?? '—'}</div>
              <div className="text-xs t-muted">总源数（含停用/退役）</div>
            </div>
            <div className="card t-surface2 px-3 py-2 text-center">
              <div className="text-lg font-bold t-success">{health.sources?.enabled ?? '—'}</div>
              <div className="text-xs t-muted">已启用（enabled=1）</div>
            </div>
            <div className="card t-surface2 px-3 py-2 text-center">
              <div className="text-lg font-bold t-warn">{health.sources?.error ?? '—'}</div>
              <div className="text-xs t-muted">异常（启用中且报错）</div>
            </div>
            <div className="card t-surface2 px-3 py-2 text-center">
              <div className="text-lg font-bold t-danger">{health.sources?.frozen ?? '—'}</div>
              <div className="text-xs t-muted">熔断冻结（失败≥3 且停用；合并退役亦计入，与解冻清单同口径）</div>
            </div>
          </div>
        ) : (
          <div className="mt-3 text-xs t-muted">加载中…</div>
        )}
      </section>

      {/* 待处理清单（pending_items 云端只读路由已摘 10-06——云端无此数据，本地端保留 queue 路由） */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">待处理清单<span className="ml-2 text-[11px] t-muted font-normal">（云端无此数据，本地端专属）</span></h3>
        <div className="mt-1 text-xs t-muted">任务队列是本地调度器的概念，云端没有这张表——本地端显示真实待处理条目，云端此区为空。</div>
        {queueStats ? (
          <div className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
            {[
              { label: '待处理', value: qs.pending ?? 0, cls: 't-muted' },
              { label: '失败', value: qs.failed ?? 0, cls: 't-danger' },
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
          <h3 className="text-sm font-semibold t-text">源健康近似值</h3>
          <span className="text-[11px] t-muted">（按当前状态近似，无历史分母）——口径详见说明</span>
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
