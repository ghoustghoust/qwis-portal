import StatCard from './ui/StatCard.jsx';

// 日报统计卡行（F14）：候选内容数 / 公众号文章数 / 视频数 / 入报条目 / 统计窗口
// 2026-09-05b：新增「入报条目」（各栏 items 合计，前端算）；移动端数字降档
// 2026-09-05 视觉精修：改用共享 StatCard（浅底 + stat-num 大数字），tone 交替降噪，flex-wrap 响应式
const TONES = ['surface', 'soft', 'surface2', 'soft', 'surface'];

export default function StatCards({ stats, windowHours, totalItems }) {
  const items = [
    { label: '候选内容', value: stats?.candidates },
    { label: '公众号文章', value: stats?.articles },
    { label: '视频', value: stats?.videos },
    { label: '入报条目', value: totalItems },
    { label: '统计窗口', value: `${windowHours ?? 48}h` },
  ];
  return (
    <div className="flex flex-wrap gap-3">
      {items.map((it, i) => (
        <StatCard
          key={it.label}
          label={it.label}
          value={it.value ?? '—'}
          tone={TONES[i % TONES.length]}
          className="flex-1 min-w-[130px]"
        />
      ))}
    </div>
  );
}
