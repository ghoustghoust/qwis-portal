import { formatDateTime } from '../util';

// 日报报纸风页头（F13）：标签 + 衬线超大标题 + 生成时间·排序方式·统计区间 + 重新生成
export default function DailyHeader({ report, regenerating, onRegenerate }) {
  const windowHours = report?.window_hours ?? 48;
  const generatedAt = report?.generated_at;
  const genTime = generatedAt ? new Date(generatedAt).getTime() : NaN;
  const valid = !Number.isNaN(genTime);

  const meta = valid
    ? `${formatDateTime(generatedAt)} 生成 · 关键词规则排序 · ${formatDateTime(new Date(genTime - windowHours * 3600 * 1000).toISOString())} 至 ${formatDateTime(generatedAt)}`
    : '尚未生成日报';

  return (
    <header className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="text-[11px] tracking-widest t-muted">{windowHours} 小时订阅情报</div>
        <h1 className="serif mt-2 text-5xl font-bold leading-tight t-text">每日情报</h1>
        <div className="mt-3 text-xs t-muted">{meta}</div>
      </div>
      <div className="flex-none flex items-center gap-2 pt-2">
        <button
          className="btn-primary"
          style={{ background: 'var(--green)' }}
          disabled={regenerating}
          onClick={onRegenerate}
        >
          {regenerating ? '生成中…' : '重新生成'}
        </button>
      </div>
    </header>
  );
}
