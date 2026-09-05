// 状态卡（F23/F28）
export default function StatusCard({ label, value, sub }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] t-muted">{label}</div>
      <div className="mt-1 text-base font-semibold t-text break-all leading-snug">
        {value ?? '—'}
      </div>
      {sub && <div className="mt-1 text-[11px] t-muted">{sub}</div>}
    </div>
  );
}
