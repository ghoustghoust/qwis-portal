import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { relativeTime } from '../util';
import InfoTip from './InfoTip.jsx';

// T3-8 批次2：早报中心总览——三报状态卡（每张可点跳转对应子板块）+ 生成历史一览
// （生成历史块自原 BriefCenterTab 迁移，逻辑未改）
export default function BriefOverview() {
  const [hist, setHist] = useState(null);
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

  if (loading) return <div className="py-12 text-center text-sm t-muted">加载中…</div>;
  if (!hist) return <div className="py-12 text-center text-sm t-muted">数据加载失败，请刷新重试</div>;

  // 各报"最近一次"：历史表按返回序不保证最新在前，按生成时刻取最大
  const latestDaily = (hist.daily || []).slice().sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)))[0] || null;
  const mb = hist.mybrief;
  const dg = hist.digest;
  const latestWeekly = (hist.weekly || []).length ? hist.weekly[hist.weekly.length - 1] : null; // 归档追加式，最新在末位

  const goto = (id) => { window.location.hash = `/${id}`; };

  const cards = [
    {
      id: 'daily', title: '每日早报', hash: 'daily',
      main: latestDaily ? (latestDaily.totalItems ?? 0) + ' 条' : '暂无',
      sub: latestDaily ? relativeTime(latestDaily.generatedAt) + (latestDaily.theme ? ` · ${String(latestDaily.theme).slice(0, 14)}` : '') : '等待第一期',
      badge: !latestDaily ? { t: 'gray', x: '未生成' }
        : latestDaily.degraded ? { t: 'red', x: '降级' }
        : latestDaily.tier === 'keyword' ? { t: 'warn', x: '无 AI' }
        : { t: 'green', x: 'AI 增强' },
    },
    {
      id: 'mybrief', title: '我的早报', hash: 'mybrief',
      main: mb && !mb.empty ? (mb.counts?.top || 0) + (mb.counts?.featured || 0) + (mb.counts?.rest || 0) + ' 条' : '空态',
      sub: mb ? relativeTime(mb.generatedAt) + (mb.empty === 'no-subscription' ? ' · 无订阅源' : mb.empty ? ' · 订阅源当日无内容' : '') : '暂无',
      badge: !mb ? { t: 'gray', x: '未生成' } : mb.empty ? { t: 'gray', x: '空态' } : { t: 'green', x: '正常' },
    },
    {
      id: 'weekly', title: '精选周刊', hash: 'weekly',
      main: latestWeekly ? `第 ${latestWeekly.issue} 期 · ${latestWeekly.count} 条` : '暂无',
      sub: latestWeekly ? `${latestWeekly.dateStart} ~ ${latestWeekly.dateEnd}` : '每周五 18:03 自动生成',
      badge: !latestWeekly ? { t: 'gray', x: '未生成' } : latestWeekly.degraded ? { t: 'warn', x: '骨架不全' } : { t: 'green', x: '正常' },
    },
  ];
  const badgeCls = { green: 'badge-green', warn: 'badge-warn', red: 'badge-red', gray: 'badge-gray' };

  return (
    <div className="space-y-5">
      {/* 三报状态卡：只读总览，操作在各报子板块 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {cards.map((c) => (
          <div
            key={c.id}
            className="card p-4 cursor-pointer"
            onClick={() => goto(c.hash)}
            title={`进入「${c.title}」`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold t-text">{c.title}</span>
              <span className={badgeCls[c.badge.t]}>{c.badge.x}</span>
            </div>
            <div className="mt-2 text-lg font-bold t-text tabular-nums">{c.main}</div>
            <div className="mt-1 text-[11px] t-muted truncate">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* 生成历史（原 BriefCenterTab 块迁移，逻辑未改） */}
      <section className="card p-5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold t-text">
            {'生成历史（近 '}{hist.windowDays || 7}{' 天，共 '}{hist.dailyCount || 0}{' 次'}
            {hist.dailyCount ? `，其中 ${hist.dailyAiCount || 0} 次为 AI 增强版` : ''}）
          </h3>
          <InfoTip
            what="三报每个批次的留痕：类型、时刻、产出与降级状态。"
            how="无需设置，每批自动追加。"
            effect="只读展示；单报的重生成入口在各报子板块页头。"
          />
        </div>
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
                  <td className="px-3 py-2">
                    {r.tier === 'ai' ? '每日早报 · AI 增强' : r.tier === 'degraded' ? '每日早报 · 降级' : '每日早报 · 裸关键词版'}
                  </td>
                  <td className="px-3 py-2 t-muted tabular-nums">{relativeTime(r.generatedAt)}</td>
                  <td className="px-3 py-2 tabular-nums">{r.totalItems} 条{r.theme ? ` · ${String(r.theme).slice(0, 16)}` : ''}</td>
                  <td className="px-3 py-2">
                    {r.degraded
                      ? <span className="badge-red">降级</span>
                      : r.tier === 'keyword'
                        ? <span className="badge-warn" title="该期没有六维评分/导语/主题全景，AI 未参与或已失效">无 AI</span>
                        : <span className="badge-green">正常</span>}
                  </td>
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
              {(hist.weekly.length === 0) && (
                <tr className="border-t t-border">
                  <td className="px-3 py-2">精选周刊</td>
                  <td className="px-3 py-2 t-muted" colSpan={3}>暂无（每周五 18:03 自动生成）</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
