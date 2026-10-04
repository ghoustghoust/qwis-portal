import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import InfoTip from './InfoTip.jsx';
import TriggerButton from './TriggerButton.jsx';

// T3-8 批次2：精选周刊子板块——当期状态、归档管理（删除）、真触发入口
// （归档块自原 BriefCenterTab 迁移；weekly 设置键是死键 H12——生成器不读，不做格子）
export default function WeeklyPanel() {
  const [hist, setHist] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setHist(await api.get('/api/brief/history').catch(() => null));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const deleteWeeklyIssue = async (issue) => {
    if (!window.confirm(`确认删除周刊第 ${issue} 期归档？不可恢复。`)) return;
    setBusy(true);
    try {
      await api.del(`/api/weekly/archive/${issue}`); // 专用端点：读改写 weekly.archive + latest 指向处理
      toast(`已删除第 ${issue} 期`);
      load();
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="py-12 text-center text-sm t-muted">加载中…</div>;
  if (!hist) return <div className="py-12 text-center text-sm t-muted">数据加载失败，请刷新重试</div>;
  const weekly = hist.weekly || [];

  return (
    <div className="space-y-5">
      {/* 页头：真触发入口（T3-8 批次2；触发门=周五18:00~周日窗口+本期产物+认领键，显式补跑不看窗） */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="text-base font-bold t-text">生成管理</div>
            <InfoTip
              what="手动触发一次精选周刊生成（取数窗口=生成时刻往前 7 天），跑在 GitHub runner 上。"
              how="点「重新生成周刊」并确认。自动档是每周五 18:03（丢轮由后台自动补）；手动触发随时可用。"
              effect="触发后几十分钟出新一期；同一内容窗口重跑会原地替换归档，不另算新期。"
            />
          </div>
          <TriggerButton mode="weekly" label="重新生成周刊" confirmText="确认触发精选周刊重新生成？生成需几十分钟，AI 额度照常消耗。" />
        </div>
        <div className="text-[11px] t-muted">
          条目不足下限时整期不发布（保住上一期）；栏目与配额写死在生成器里，无可配置项。
        </div>
      </section>

      {/* 归档管理（原块迁移） */}
      <section className="card p-5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold t-text">周刊归档（{weekly.length} 期，永久保留）</h3>
          <InfoTip
            what="每周五生成的精选周刊的完整存档。"
            how="删除是唯一可操作项，不可恢复。"
            effect="只动归档与当期指向，不回退条目上的精选打标、不删文章。"
          />
        </div>
        {weekly.length === 0 ? (
          <p className="mt-2 text-xs t-muted">首期将在周五 18:03 自动生成（或用上方按钮手动触发）</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {weekly.map((w) => (
              <div key={w.issue} className="flex items-center gap-3 px-3 py-2 card text-[13px]">
                <span className="font-medium t-text flex-none">第 {w.issue} 期</span>
                <span className="t-muted tabular-nums flex-none">{w.dateStart} ~ {w.dateEnd}</span>
                <span className="flex-1 min-w-0 truncate t-muted">{w.theme || '—'}{w.degraded ? '（降级）' : ''}</span>
                <span className="tabular-nums flex-none t-muted">{w.count} 条</span>
                <button
                  className="btn-ghost !py-1 !px-2 flex-none"
                  style={{ color: 'var(--red)' }}
                  disabled={busy}
                  onClick={() => deleteWeeklyIssue(w.issue)}
                  title="删除该期归档"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
