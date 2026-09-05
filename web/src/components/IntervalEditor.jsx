import { useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';

// 源级刷新间隔编辑（T16/F2）：分钟输入 + 保存 + 恢复默认（PUT /api/sources/:id/interval）
export default function IntervalEditor({ source, onSaved }) {
  const [val, setVal] = useState(source?.intervalMin ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setVal(source?.intervalMin ?? '');
  }, [source?.id, source?.intervalMin]);

  const save = async (intervalMin) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.put(`/api/sources/${source.id}/interval`, { intervalMin });
      toast(intervalMin ? `刷新间隔已设为 ${intervalMin} 分钟` : '已恢复默认间隔');
      onSaved?.();
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        type="number"
        min="1"
        className="input !w-16 !px-1.5 !py-0.5 !text-[11px]"
        placeholder="默认"
        title="刷新间隔（分钟），留空跟随全局"
        value={val}
        onChange={(e) => setVal(e.target.value)}
      />
      <button
        className="btn-ghost !px-2 !py-0.5 !text-[11px]"
        disabled={busy || val === '' || Number(val) <= 0}
        onClick={() => save(Number(val))}
      >
        保存
      </button>
      {source?.intervalMin ? (
        <button
          className="btn-ghost !px-2 !py-0.5 !text-[11px] t-muted"
          disabled={busy}
          title="清除源级覆盖，跟随全局间隔"
          onClick={() => save(null)}
        >
          恢复默认
        </button>
      ) : null}
    </span>
  );
}
