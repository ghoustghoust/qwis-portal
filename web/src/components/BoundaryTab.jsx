// 平台边界板块（10-14 边界管理）：Turso / Vercel / GitHub / cron-job.org 四平台的配额与边界统一视图。
// 每条边界标 source：api=平台真实回传 / 估算=推算口径 / hidden=平台不回传（须去 dashboard）。
// 危险边界（超限=系统瘫痪）≥95% 由后端走 quota_critical 紧急报警，这里是日常观测面。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';

function pctColor(p) {
  if (p == null) return 't-muted';
  if (p >= 95) return 't-danger';
  if (p >= 80) return 't-warn';
  return 't-success';
}

function fmtBytes(n) {
  if (n == null) return '-';
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + ' GB';
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return String(n);
}

function fmtUsed(item) {
  if (item.used == null) return '-';
  if (/storage/i.test(item.key || '')) return fmtBytes(item.used);
  if (item.limit >= 1e6) return Math.round(item.used / 1e6) + 'M';
  return String(item.used);
}

function fmtLimit(item) {
  if (item.limit == null) return '无上限/平台未给';
  if (/storage/i.test(item.key || '')) return fmtBytes(item.limit);
  if (item.limit >= 1e6) return Math.round(item.limit / 1e6) + 'M';
  return String(item.limit);
}

function SourceBadge({ source }) {
  const map = {
    api: { t: '平台回传', c: 'badge-green' },
    估算: { t: '估算口径', c: 'pill' },
    hidden: { t: '平台未回传', c: 'pill opacity-60' },
  };
  const m = map[source] || { t: source, c: 'pill' };
  return <span className={`${m.c} flex-none !text-[10px]`}>{m.t}</span>;
}

function PlatformCard({ p }) {
  return (
    <div className={`card p-4 ${p.critical ? 'border-2' : ''}`} style={p.critical ? { borderColor: 'var(--danger, #c0392b)' } : undefined}>
      <div className="flex items-center gap-2">
        <span className="font-bold t-text">{p.name}</span>
        {p.critical && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white" style={{ background: '#c0392b' }}>🚨 临界</span>}
        {p.configured === false && <span className="pill !text-[10px] opacity-70">未配置凭据</span>}
      </div>
      {p.error && <div className="mt-2 text-[11px] t-danger">{p.error}</div>}
      {p.note && <div className="mt-2 text-[11px] t-muted leading-relaxed">{p.note}</div>}
      <div className="mt-3 space-y-3">
        {(p.items || []).map((it) => (
          <div key={it.key}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12px] t-text">{it.label}</span>
              <SourceBadge source={it.source} />
              <span className={`text-[12px] font-bold tabular-nums ml-auto ${pctColor(it.pct)}`}>
                {it.pct != null ? `${it.pct}%` : ''}
              </span>
            </div>
            {it.pct != null && (
              <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2, rgba(0,0,0,.08))' }}>
                <div className="h-full rounded-full" style={{ width: Math.min(100, it.pct) + '%', background: it.pct >= 95 ? '#c0392b' : it.pct >= 80 ? '#d68910' : 'var(--green, #3F7D54)' }} />
              </div>
            )}
            <div className="mt-1 text-[11px] t-muted tabular-nums">
              {fmtUsed(it)} / {fmtLimit(it)}
            </div>
            {it.note && <div className="mt-0.5 text-[11px] t-muted leading-snug">{it.note}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BoundaryTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/api/data/boundary');
      setData(r);
    } catch (e) {
      toast('加载平台边界数据失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-[11px] t-muted">
          各平台配额与硬边界。Turso 超限=硬拒绝服务（系统瘫痪）——三维度 ≥95% 会触发
          <span className="t-danger font-bold"> 🚨紧急报警</span>（6 小时重报）；Vercel 用量平台不回传，只能观测部署生命周期。
        </span>
        <button className="btn-ghost !py-1 !px-2 !text-[11px] flex-none ml-auto" onClick={load} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>
      {loading && !data && <div className="text-[12px] t-muted">加载中…</div>}
      <div className="grid gap-4 md:grid-cols-2">
        {(data?.platforms || []).map((p) => <PlatformCard key={p.id} p={p} />)}
      </div>
    </div>
  );
}
