import React, { useState } from 'react';

// T3-2 R2 监控折线图（2026-09-13）：采集成功率 / 入库量 趋势（近 N 轮心跳）
// 纯 SVG 零依赖。数据：GET /api/health/collect-history → history[{at, mode, stats}]
// 10-06 优化（用户：更现代/动态/直观）：面积渐变 + hover 十字线+tooltip + 双 Y 轴（成功率% / 入库量）。
export default function CollectTrendChart({ history, height = 160 }) {
  const [hover, setHover] = useState(null); // hover 的点索引
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

  // 面积渐变路径（成功率折线下方填充）
  const areaPath = (() => {
    const pts = rates.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yRate(v).toFixed(1)}`).join(' ');
    return `${pts} L${x(rates.length - 1).toFixed(1)},${(PAD_T + ih).toFixed(1)} L${x(0).toFixed(1)},${(PAD_T + ih).toFixed(1)} Z`;
  })();
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((relX - PAD_L) / iw) * (points.length - 1));
    setHover(i >= 0 && i < points.length ? i : null);
  };

  return (
    <div>
      <div className="flex items-center gap-4 text-[11px] t-muted">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5" style={{ background: 'var(--accent)' }} /> 采集成功率（均值 {avgRate}%）</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5" style={{ background: 'var(--green)' }} /> 单轮入库量（峰值 {maxArt}）</span>
        <span className="flex-1" />
        <span>最近 {points.length} 轮</span>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full mt-2 cursor-crosshair" role="img" aria-label="采集趋势折线图"
          onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <defs>
            <linearGradient id="rateGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[0, 50, 100].map((g) => (
            <g key={g}>
              <line x1={PAD_L} x2={W - PAD_R} y1={yRate(g)} y2={yRate(g)} stroke="var(--border)" strokeDasharray="3,3" strokeWidth="0.5" />
              <text x={PAD_L - 4} y={yRate(g) + 3} textAnchor="end" fontSize="9" fill="var(--text-muted, #888)">{g}%</text>
            </g>
          ))}
          {/* 双 Y 轴右侧：入库量 */}
          {[0, Math.round(maxArt / 2), maxArt].map((g) => (
            <text key={g} x={W - PAD_R + 4} y={yArt(g) + 3} fontSize="9" fill="var(--green)" opacity="0.7">{g}</text>
          ))}
          <path d={areaPath} fill="url(#rateGrad)" />
          <path d={line(rates, yRate)} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <path d={line(arts, yArt)} fill="none" stroke="var(--green)" strokeWidth="1.5" strokeDasharray="4,2" opacity="0.8" />
          {hover !== null && points[hover] && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + ih} stroke="var(--text-muted, #888)" strokeWidth="0.5" strokeDasharray="2,2" />
              <circle cx={x(hover)} cy={yRate(rates[hover])} r="3.5" fill="var(--accent)" stroke="#fff" strokeWidth="1.5" />
              <circle cx={x(hover)} cy={yArt(arts[hover])} r="3" fill="var(--green)" stroke="#fff" strokeWidth="1.5" />
            </g>
          )}
          {points.map((h, i) => (
            i % Math.ceil(points.length / 8) === 0 ? (
              <text key={i} x={x(i)} y={H - 4} textAnchor="middle" fontSize="8" fill="var(--text-muted, #888)">
                {String(new Date(h.at).getHours()).padStart(2, '0')}:{String(new Date(h.at).getMinutes()).padStart(2, '0')}
              </text>
            ) : null
          ))}
        </svg>
        {hover !== null && points[hover] && (
          <div
            className="absolute card px-2.5 py-1.5 text-[11px] shadow-lg pointer-events-none z-10"
            style={{
              left: `${(x(hover) / W) * 100}%`,
              top: 0,
              transform: `translateX(${x(hover) > W * 0.7 ? '-110%' : '10px'})`,
              border: '1px solid var(--border)',
            }}
          >
            <div className="t-muted tabular-nums">{new Date(points[hover].at).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
            <div className="mt-0.5 flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />成功率 {rates[hover]}%</div>
            <div className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--green)' }} />入库 {arts[hover]} 条</div>
          </div>
        )}
      </div>
    </div>
  );
}
