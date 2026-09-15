import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { relativeTime } from '../util';

// T3-2 R1 早报中心（2026-09-13）：三报生成历史一览 + 我的早报推送开关 + 周刊归档管理
// 日报来源/栏目配置在「日报设置」Tab（不重复）；手动生成命令见页底说明（Hobby 10s 跑不了 runner 任务）
export default function BriefCenterTab() {
  const [hist, setHist] = useState(null);
  const [mybriefCfg, setMybriefCfg] = useState(null);
  const [weeklyCfg, setWeeklyCfg] = useState(null);
  const [quotas, setQuotas] = useState({}); // T3-1 R5：Domain 篇数配额编辑态
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, st] = await Promise.all([
        api.get('/api/brief/history').catch(() => null),
        api.get('/api/settings').catch(() => null),
      ]);
      setHist(h);
      setMybriefCfg(st?.mybrief || {});
      setWeeklyCfg(st?.weekly || {});
      setQuotas(h?.domainQuotas || {});
    } catch (e) {
      toast('加载失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveCfg = async (section, patch) => {
    setBusy(true);
    try {
      await api.put('/api/settings', { [section]: patch });
      toast('已保存');
      load();
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

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

  const mb = hist.mybrief;
  const dg = hist.digest;

  return (
    <div className="space-y-5">
      {/* 生成历史 */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">生成历史（近 7 天）</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="t-surface2 text-left">
                <th className="px-3 py-2 font-medium t-muted text-xs">类型</th>
                <th className="px-3 py-2 font-medium t-muted text-xs">时间</th>
                <th className="px-3 py-2 font-medium t-muted text-xs">产出</th>
                <th className="px-3 py-2 font-medium t-muted text-xs">状态</th>
              </tr>
            </thead>
            <tbody>
              {hist.daily.map((r) => (
                <tr key={'d' + r.id} className="border-t t-border">
                  <td className="px-3 py-2">每日早报</td>
                  <td className="px-3 py-2 t-muted tabular-nums">{relativeTime(r.generatedAt)}</td>
                  <td className="px-3 py-2 tabular-nums">{r.totalItems} 条{r.theme ? ` · ${String(r.theme).slice(0, 16)}` : ''}</td>
                  <td className="px-3 py-2">{r.degraded ? <span className="badge-gray">降级</span> : <span className="badge-green">正常</span>}</td>
                </tr>
              ))}
              {mb && !mb.empty && (
                <tr className="border-t t-border">
                  <td className="px-3 py-2">我的早报</td>
                  <td className="px-3 py-2 t-muted tabular-nums">{relativeTime(mb.generatedAt)}</td>
                  <td className="px-3 py-2 tabular-nums">{(mb.counts?.top || 0) + (mb.counts?.featured || 0) + (mb.counts?.rest || 0)} 条</td>
                  <td className="px-3 py-2"><span className="badge-green">正常</span></td>
                </tr>
              )}
              {mb?.empty && (
                <tr className="border-t t-border">
                  <td className="px-3 py-2">我的早报</td>
                  <td className="px-3 py-2 t-muted tabular-nums">{relativeTime(mb.generatedAt)}</td>
                  <td className="px-3 py-2 t-muted">{mb.empty === 'no-subscription' ? '无订阅源（去源库标记 ☆）' : '订阅源当日无内容'}</td>
                  <td className="px-3 py-2"><span className="badge-gray">空态</span></td>
                </tr>
              )}
              {dg && (
                <tr className="border-t t-border">
                  <td className="px-3 py-2">阅读足迹</td>
                  <td className="px-3 py-2 t-muted tabular-nums">{relativeTime(dg.generatedAt || dg.date)}</td>
                  <td className="px-3 py-2 tabular-nums">读 {dg.readCount} 篇 · 稍后读 {dg.laterCount}</td>
                  <td className="px-3 py-2"><span className="badge-green">正常</span></td>
                </tr>
              )}
              {hist.weekly.length === 0 && (
                <tr className="border-t t-border">
                  <td className="px-3 py-2">精选周刊</td>
                  <td className="px-3 py-2 t-muted" colSpan={3}>暂无（每周五 18:03 自动生成）</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 周刊归档管理 */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">周刊归档（{hist.weekly.length} 期，永久保留）</h3>
        {hist.weekly.length === 0 ? (
          <p className="mt-2 text-xs t-muted">首期将在周五 18:03 自动生成</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {hist.weekly.map((w) => (
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

      {/* 我的早报设置 */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">我的早报设置</h3>
        <label className="mt-3 flex items-center gap-2.5 text-[13px] cursor-pointer">
          <input
            type="checkbox"
            checked={mybriefCfg?.pushEnabled !== false}
            disabled={busy}
            onChange={(e) => saveCfg('mybrief', { ...mybriefCfg, pushEnabled: e.target.checked })}
          />
          生成后推送到飞书（含导语与头条 3 条）
        </label>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-[13px] t-text">探索强度（补充阅读里来自未订阅源的比例）：</span>
          {[['low', '低（2 条）'], ['mid', '中（4 条）'], ['high', '高（6 条）']].map(([k, label]) => (
            <button
              key={k}
              className={`pill !py-1 !px-2.5 cursor-pointer ${String(mybriefCfg?.exploreStrength || 'mid') === k ? 'on' : ''}`}
              disabled={busy}
              onClick={() => saveCfg('mybrief', { ...mybriefCfg, exploreStrength: k })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs t-muted">订阅源在「源库」组合视图/批量条中加入订阅（27b 订阅轴，与重点轴独立）；探索位按 MMR 多样性选源（specs/23 L6）；行为画像与 Domain 篇数配额见下方区块。</p>
      </section>

      {/* 行为画像 + Domain 篇数配额（T3-1 R5） */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">兴趣画像（近 30 天阅读行为驱动）</h3>
        {(hist.profile?.tags || []).length === 0 ? (
          <p className="mt-2 text-xs t-muted">暂无画像——阅读文章后自动积累标签权重（每晚随早报更新）</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {hist.profile.tags.map((t, i) => (
              <span key={t.tag} className="pill on !cursor-default text-[11px]" title={`权重 ${t.weight}`}>
                {t.tag}<span className="t-muted ml-1">{Math.round(t.weight)}</span>
                {i < 5 && <span className="ml-1 t-accent" title="参与我的早报排序加权">★</span>}
              </span>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] t-muted">★ = 参与「我的早报」排序加权（每命中 +8，上限 +24）。画像每晚随早报自动更新。</p>

        {(hist.profile?.tags || []).length > 0 && (
          <div className="mt-4">
            <div className="text-[13px] font-medium t-text">Domain 篇数配额（主标签每日入报上限，留空不限）</div>
            <div className="mt-2 flex flex-wrap gap-3">
              {hist.profile.tags.slice(0, 8).map((t) => (
                <label key={t.tag} className="flex items-center gap-1.5 text-[12px]">
                  <span className="t-muted truncate max-w-[120px]" title={t.tag}>{t.tag}</span>
                  <input
                    type="number" min="0" max="20"
                    className="input !w-16 !py-1 !text-xs"
                    value={quotas[t.tag] ?? ''}
                    placeholder="不限"
                    onChange={(e) => setQuotas((prev) => {
                      const next = { ...prev };
                      const v = e.target.value;
                      if (v === '') delete next[t.tag]; else next[t.tag] = Math.max(0, Number(v));
                      return next;
                    })}
                  />
                </label>
              ))}
            </div>
            <button
              className="btn-ghost !py-1 !px-2.5 mt-3"
              disabled={busy}
              onClick={async () => {
                try { await api.put('/api/settings', { mybrief: { ...mybriefCfg, domainQuotas: quotas } }); toast('Domain 配额已保存（次日凌晨生成生效）'); load(); }
                catch (e) { toast(e.message); }
              }}
            >
              保存配额
            </button>
          </div>
        )}
      </section>

      {/* 周刊设置 + 手动生成 */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">生成时间与手动触发</h3>
        <div className="mt-2 text-[13px] t-text space-y-1">
          <div>· 每日早报 + 我的早报：每晚 <b>21:30</b>（滚动 24h 窗口）；00:32 备跑（自然日窗口）</div>
          <div>· 精选周刊：每周五 <b>18:03</b>（前 7 天窗口，永久归档）</div>
          <div>· 生成 &gt; 翻译：保护窗（每日 18:30–次日 03:30、周五 15:00–21:00）内翻译批次自动让路</div>
        </div>
        <p className="mt-3 text-xs t-muted">
          手动生成（Vercel 10s 限制跑不了 runner 任务，需本地执行）：
          <code className="ml-1 px-1.5 py-0.5 rounded t-surface2">node tools/collect-turso.js mybrief</code>
          <code className="ml-1 px-1.5 py-0.5 rounded t-surface2">node tools/collect-turso.js weekly</code>
          <code className="ml-1 px-1.5 py-0.5 rounded t-surface2">node tools/collect-turso.js daily-ai --rolling24</code>
        </p>
      </section>
    </div>
  );
}
