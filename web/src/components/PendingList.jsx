import { formatDateTime } from '../util';

// 通用本地待处理订阅列表（F32）：名称 / 状态徽章 / 导入时间 / 原始链接
// 2026-09-05 视觉精修：状态徽章收敛为 badge 三态
const STATUS_MAP = {
  pending: { text: '待处理', cls: 'badge-gray' },
  resolved: { text: '已解析', cls: 'badge-green' },
  failed: { text: '解析失败', cls: 'badge-red' },
};

export default function PendingList({ items = [], empty = '暂无待处理条目' }) {
  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed t-border py-6 text-center text-xs t-muted">
        {empty}
      </div>
    );
  }
  return (
    <div className="card divide-y divide-[var(--border)]">
      {items.map((it) => {
        const st = STATUS_MAP[it.status] || STATUS_MAP.pending;
        return (
          <div key={it.id ?? it.url} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium t-text truncate">
                  {it.name || it.url}
                </span>
                <span className={st.cls}>{st.text}</span>
              </div>
              <div className="mt-0.5 text-[11px] t-muted break-all">
                导入时间 {formatDateTime(it.imported_at)} · {it.url}
              </div>
              {it.status === 'failed' && it.error && (
                <div className="mt-0.5 text-[11px]" style={{ color: 'var(--red)' }}>
                  {it.error}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
