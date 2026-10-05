import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { relativeTime, formatDateTime } from '../util';
import InfoTip from './InfoTip.jsx';

// 自愈调试板块（10-05 用户纠偏：系统分区独立子板块，不埋在源库）——
// 自愈引擎已在 runner 批次尾部跑（T4-1 Q7：冻结 48h 自动恢复/连续 3 次仍熔断冷却 7 天）。
// 本板块是它的观测与调试面：曾被恢复（活了没有）/ 冷却中（到点倒计时）/ 手动重启入口。
// 定时重启走 runner 的自愈档（策略在 settings.heal，当前由引擎固定规则承担——可调项见下）。

const TONE = { red: 'text-[var(--red)]', green: 'text-[var(--green)]', gray: 't-muted' };

export default function SelfHealTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await api.get('/api/self-heal', true));
    } catch (e) {
      setError(e.message || '加载失败');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // 一键重启：对所有"又熔断/冷却中"的源逐个解除熔断（它们是周期性被掐/限流，不是坏了）
  async function resumeAll() {
    const list = [...(data?.resumed || []).filter((r) => !r.aliveNow), ...(data?.cooling || [])];
    if (!list.length) return toast('当前没有需要重启的源');
    if (!window.confirm(`一键重启 ${list.length} 个源？\n\n会把它们全部解除熔断并重新启用（清失败计数、排入下一轮采集）。\nYouTube 这类周期性被限流的源靠这个恢复——它不是坏了，是到点需要重启。`)) return;
    setBusy('resumeAll');
    try {
      let done = 0;
      for (const r of list) {
        try { await api.post(`/api/health/unfreeze/${r.id}`); done++; } catch { /* 单个失败不阻断 */ }
      }
      toast(`已重启 ${done} 个源（排入下一轮采集）`);
      await load();
    } catch (e) {
      toast('重启失败: ' + e.message);
    } finally {
      setBusy('');
    }
  }

  async function resumeOne(r) {
    setBusy(String(r.id));
    try {
      await api.post(`/api/health/unfreeze/${r.id}`);
      toast(`已重启「${r.name}」`);
      await load();
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy('');
    }
  }

  if (error) return <div className="py-8 text-center text-sm" style={{ color: 'var(--red)' }}>加载失败：{error}</div>;
  if (!data) return <div className="py-8 text-center text-sm t-muted">加载中…</div>;

  const { rules, resumed, resumedTotal, aliveAfterResume, cooling, coolingTotal, throttled, throttledTotal } = data;
  const failedAgain = resumedTotal - aliveAfterResume;

  return (
    <div className="space-y-5">
      {/* 头部：规则 + 一键重启 */}
      <section className="card p-5">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold t-text">自愈引擎</h3>
          <InfoTip
            what="源的自动恢复机制：连续失败被自动停用（熔断）后，引擎定时把它重新启用——多数源不是坏了，是周期性被限流/被掐，到点重启就能活。"
            how="引擎在采集批次尾部自动跑，无需设置。下方「一键重启」是把当前所有熔断/冷却中的源立即全部重启（不等定时点）。"
            effect="恢复后正常抓取的源从问题清单消失；又熔断的会进冷却，连续 3 次仍熔断的冷却延长到 7 天。"
          />
        </div>
        <div className="mt-2 text-xs t-muted">
          规则：冻结超 {rules.autoResumeAfterHours}h 自动恢复（错峰 {rules.jitterHours}h 内随机）· 连续 {rules.cooldownAfterFails} 次仍熔断则冷却 {rules.cooldownDays} 天
        </div>
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <button
            className="btn-primary !py-2 !px-5 !text-sm"
            disabled={busy === 'resumeAll'}
            onClick={resumeAll}
          >{busy === 'resumeAll' ? '重启中…' : '一键重启全部异常源'}</button>
          <span className="text-[11px] t-muted">解除熔断 + 重新启用，排入下一轮采集（≤15 分钟）</span>
        </div>
      </section>

      {/* 统计三格 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold tabular-nums t-text">{resumedTotal}</div>
          <div className="text-[11px] t-muted">曾被自动恢复</div>
        </div>
        <div className="card p-4 text-center">
          <div className={`text-2xl font-bold tabular-nums ${aliveAfterResume > resumedTotal / 2 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>{aliveAfterResume}</div>
          <div className="text-[11px] t-muted">恢复后现健康{resumedTotal > 0 && `（${Math.round(aliveAfterResume / resumedTotal * 100)}%）`}</div>
        </div>
        <div className="card p-4 text-center">
          <div className={`text-2xl font-bold tabular-nums ${coolingTotal > 0 ? 'text-[var(--warn)]' : 'text-[var(--green)]'}`}>{coolingTotal}</div>
          <div className="text-[11px] t-muted">冷却中（到点自动恢复）</div>
        </div>
      </div>

      {/* 又熔断的（回环失败——重点关注） */}
      {failedAgain > 0 && (
        <section className="card p-5">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold t-text">恢复后又熔断（{failedAgain}）</h3>
            <span className="text-[11px] t-muted">自愈回环失败的源——这类要么是周期性被掐（值得保留+降频），要么是真死源（去「源库 → 清理」）</span>
          </div>
          <div className="mt-3 space-y-1 max-h-72 overflow-y-auto">
            {resumed.filter((r) => !r.aliveNow).map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-xs py-1.5 border-b t-border/40">
                <span className="t-text truncate flex-1" title={r.name}>{r.name}</span>
                <span className="t-muted flex-none">第 {r.resumeCount} 次</span>
                <span className="t-muted flex-none">{r.lastFetchedAt ? relativeTime(r.lastFetchedAt) : '—'}</span>
                <button className="btn-ghost !py-1 !px-2 text-xs flex-none" disabled={busy} onClick={() => resumeOne(r)}>
                  {busy === String(r.id) ? '…' : '重启'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 恢复后健康的（自愈起效的证据） */}
      {aliveAfterResume > 0 && (
        <section className="card p-5">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold t-text">恢复后现健康（{aliveAfterResume}）</h3>
            <span className="text-[11px] t-muted">自愈起效——这类源是周期性被掐，不是坏了</span>
          </div>
          <div className="mt-3 space-y-1 max-h-48 overflow-y-auto">
            {resumed.filter((r) => r.aliveNow).map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-xs py-1.5 border-b t-border/40">
                <span className="t-text truncate flex-1" title={r.name}>{r.name}</span>
                <span className="t-muted flex-none">恢复 {r.resumeCount} 次</span>
                <span className={`flex-none ${TONE.green}`}>健康</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 冷却中 */}
      {coolingTotal > 0 && (
        <section className="card p-5">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold t-text">冷却中（{coolingTotal}）</h3>
            <span className="text-[11px] t-muted">连续恢复 3 次仍熔断的源，冷却 7 天后再试——也可以现在手动重启</span>
          </div>
          <div className="mt-3 space-y-1">
            {cooling.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-xs py-1.5 border-b t-border/40">
                <span className="t-text truncate flex-1" title={r.name}>{r.name}</span>
                <span className="t-muted flex-none tabular-nums" title={r.resumeAt ? `预计 ${formatDateTime(r.resumeAt)}` : ''}>
                  {r.coolingLeftMs < 3600e3 ? `${Math.ceil(r.coolingLeftMs / 60000)} 分钟后` : `${Math.ceil(r.coolingLeftMs / 3600e3)} 小时后`}
                </span>
                <button className="btn-ghost !py-1 !px-2 text-xs flex-none" disabled={busy} onClick={() => resumeOne(r)}>
                  {busy === String(r.id) ? '…' : '提前重启'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 已被系统性降频（自愈动作的留痕） */}
      {throttledTotal > 0 && (
        <section className="card p-5">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold t-text">已被自动降频（{throttledTotal}）</h3>
            <span className="text-[11px] t-muted">同型同错 ≥10 个 = 平台级问题，自愈把整簇降到每 6 小时一次，省下白烧的重试；恢复后不自动回升（可在源库行内调回）</span>
          </div>
          <div className="mt-3 space-y-1 max-h-64 overflow-y-auto">
            {throttled.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-xs py-1.5 border-b t-border/40">
                <span className="t-text truncate flex-1" title={r.name}>{r.name}</span>
                <span className="badge-gray flex-none">{r.bucket}</span>
                <span className="t-muted flex-none tabular-nums">{r.intervalMin ? `每 ${r.intervalMin} 分钟` : '—'}</span>
                <span className="t-muted flex-none">{r.throttledAt ? relativeTime(r.throttledAt) : '—'}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {resumedTotal === 0 && coolingTotal === 0 && throttledTotal === 0 && (
        <div className="text-center py-8 t-muted text-sm">还没有自动恢复记录——自愈引擎在采集批次尾部跑，第一批记录要等熔断产生后 48h。</div>
      )}
    </div>
  );
}
