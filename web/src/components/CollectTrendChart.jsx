import React from 'react';

// T3-2 R2 监控折线图（2026-09-13）：采集成功率 / 入库量 趋势（近 N 轮心跳）
// 纯 SVG 零依赖。数据：GET /api/health/collect-history → history[{at, mode, stats}]
export default function CollectTrendChart({ history, height = 160 }) {
  const points = (history || [])
    .filter((h) => h && h.stats && typeof h.stats.total === 'number' && h.stats.total > 0)
    .slice(-72); // 最近 72 轮（约 18h）
  if (points.length < 2) {
    return <div className="py-8 text-center text-xs t-muted">心跳历史积累中（追加式心跳 2026-09-13 起生效，约 1 小时后出图）</div>;
  }

  const W = 720, H = height, PAD_L = 34, PAD_R = 8, PAD_T = 10, PAD_B = 18;
  const iw = W - PAD_L - PAD_R, ih = H - PAD_T - PAD_B;
  const x = (i) => PAD_L + (i / (points.length - 1)) * iw;
  const rateOf = (h) => Math.round(((h.stats.success || 0) / h.stats.total) * 100);
  const rates = points.map(rateOf);
  const arts = points.map((h) => h.stats.articles || 0);
  const maxArt = Math.max(...arts, 1);
  const yRate = (v) => PAD_T + ih - (v / 100) * ih;
  const yArt = (v) => PAD_T + ih - (v / maxArt) * ih;

  const line = (vals, yFn) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yFn(v).toFixed(1)}`).join(' ');
  const avgRate = Math.round(rates.reduce((a, b) => a + b, 0) / rates.length);

  return (
    <div>
      <div className="flex items-center gap-4 text-[11px] t-muted">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5" style={{ background: 'var(--accent)' }} /> 采集成功率（均值 {avgRate}%）</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5" style={{ background: 'var(--green)' }} /> 单轮入库量（峰值 {maxArt}）</span>
        <span className="flex-1" />
        <span>最近 {points.length} 轮</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full mt-2" role="img" aria-label="采集趋势折线图">
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={PAD_L} x2={W - PAD_R} y1={yRate(g)} y2={yRate(g)} stroke="var(--border)" strokeDasharray="3,3" strokeWidth="0.5" />
            <text x={PAD_L - 4} y={yRate(g) + 3} textAnchor="end" fontSize="9" fill="var(--text-muted, #888)">{g}</text>
          </g>
        ))}
        <path d={line(rates, yRate)} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
        <path d={line(arts, yArt)} fill="none" stroke="var(--green)" strokeWidth="1.5" />
        {points.map((h, i) => (
          i % Math.ceil(points.length / 8) === 0 ? (
            <text key={i} x={x(i)} y={H - 4} textAnchor="middle" fontSize="8" fill="var(--text-muted, #888)">
              {String(new Date(h.at).getHours()).padStart(2, '0')}:{String(new Date(h.at).getMinutes()).padStart(2, '0')}
            </text>
          ) : null
        ))}
      </svg>
    </div>
  );
}
