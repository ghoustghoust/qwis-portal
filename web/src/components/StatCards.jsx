// 日报统计卡行（F14）：候选内容数 / 公众号文章数 / 视频数 / 统计窗口
export default function StatCards({ stats, windowHours }) {
  const items = [
    { label: '候选内容', value: stats?.candidates },
    { label: '公众号文章', value: stats?.articles },
    { label: '视频', value: stats?.videos },
    { label: '统计窗口', value: `${windowHours ?? 48}h` },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {items.map((it) => (
        <div key={it.label} className="card px-5 py-4">
          <div className="text-[11px] t-muted">{it.label}</div>
          <div className="serif mt-1 text-3xl font-bold t-text leading-none">
            {it.value ?? '—'}
          </div>
        </div>
      ))}
    </div>
  );
}
