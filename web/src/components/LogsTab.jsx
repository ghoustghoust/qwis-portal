import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { relativeTime, cleanTitle } from '../util';
import InfoTip from './InfoTip.jsx';

// T3-8 批次3：日志板块（观测面）——报警板块只管配置，发生过的记录都在这里（用户标注"报警、日志、监控各归各"）。
// 五类日志的落点受 serverless 约束（总规格 §五）：库内事件/心跳表 + 跳转指引，不给假表。
// ① 作业运行史（采集心跳 + 三报生成记录）② 报警事件流（自 AlertsTab 迁移，含真删除）
// ③ 数据层失败（valueFallbacks 坏值回落留痕）④ 服务器错误/部署失败 → 指路卡（库内无数据源，诚实指路）
export default function LogsTab() {
  const [collect, setCollect] = useState(null); // {history}
  const [brief, setBrief] = useState(null); // brief/history
  const [alertsCfg, setAlertsCfg] = useState(null); // {recentLog, eventMeta}
  const [fallbacks, setFallbacks] = useState(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (force) => {
    setLoading(true);
    try {
      const [c, b, a, st] = await Promise.all([
        api.get('/api/health/collect-history', force).catch(() => null),
        api.get('/api/brief/history', force).catch(() => null),
        api.get('/api/alerts/config', force).catch(() => null),
        api.get('/api/settings', force).catch(() => null),
      ]);
      setCollect(c);
      setBrief(b);
      setAlertsCfg(a);
      // 留痕键的返回形状做双路径容错（分区对象或独立键），空则如实显示"暂无"
      setFallbacks(st?.settings?.valueFallbacks || st?.valueFallbacks || []);
    } catch (e) {
      toast(e.message || '日志加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const deleteLogEntry = async (index, entry) => {
    if (!window.confirm('确认删除这条报警记录吗？此操作不可恢复')) return;
    try {
      await api.del(`/api/alerts/log/${index}?at=${encodeURIComponent(entry?.at || '')}`);
      toast('已删除该条报警记录');
      await load(true);
    } catch (e) {
      toast('删除失败：' + e.message);
    }
  };

  const clearLog = async () => {
    if (!window.confirm('确认清空报警历史记录吗？此操作不可恢复')) return;
    try {
      await api.del('/api/alerts/log');
      toast('已清空报警历史记录');
      await load(true);
    } catch (e) {
      toast('清空失败：' + e.message);
    }
  };

  if (loading && !alertsCfg && !brief) return <div className="py-12 text-center text-sm t-muted">加载中…</div>;

  // ── 作业运行史聚合 ──
  const hist = (collect?.history || []);
  const lastCollect = hist.length ? hist[hist.length - 1] : null;
  const daily = (brief?.daily || []).slice().sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
  const latestDaily = daily[0] || null;
  const mb = brief?.mybrief;
  const latestWeekly = (brief?.weekly || []).length
    ? (brief.weekly || []).slice().sort((a, b) => (b.issue || 0) - (a.issue || 0))[0]
    : null;
  const jobs = [
    { name: '全量采集（runner，节奏见作业文件）', at: lastCollect?.at, info: lastCollect ? `档位 ${lastCollect.mode || '—'}` : '暂无心跳', ok: !!lastCollect },
    { name: '每日早报（AI 批）', at: latestDaily?.generatedAt, info: latestDaily ? `${latestDaily.totalItems ?? 0} 条` : '暂无', ok: !!latestDaily },
    { name: '我的早报', at: mb?.generatedAt, info: mb && !mb.empty ? `${(mb.counts?.top || 0) + (mb.counts?.featured || 0) + (mb.counts?.rest || 0)} 条` : mb ? (mb.empty === 'no-subscription' ? '空态：无订阅源' : '空态') : '暂无', ok: !!mb },
    { name: '精选周刊', at: latestWeekly?.dateEnd, info: latestWeekly ? `第 ${latestWeekly.issue} 期 · ${latestWeekly.count} 条` : '暂无', ok: !!latestWeekly, atNote: '以内容窗口结束日计（生成时刻不在该接口返回中）' },
    { name: '阅读足迹小结', at: brief?.digest?.generatedAt || brief?.digest?.date, info: brief?.digest ? `读 ${brief.digest.readCount} 篇` : '暂无', ok: !!brief?.digest },
  ];

  // ── 报警事件流 ──
  const meta = alertsCfg?.eventMeta || {};
  const log = alertsCfg?.recentLog || [];
  const PAGE_SIZE = 10;
  const totalPages = Math.max(1, Math.ceil(log.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages - 1);
  const pageLog = log.slice(curPage * PAGE_SIZE, curPage * PAGE_SIZE + PAGE_SIZE);
  const pageIndexOffset = curPage * PAGE_SIZE;
  const metaTitle = (m) => cleanTitle(typeof m === 'string' ? m : (m && m.title) || '');

  // ── 数据层失败 ──
  const fb = Array.isArray(fallbacks) ? fallbacks : [];

  return (
    <div className="space-y-5">
      {/* 作业运行史 */}
      <section className="card p-5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold t-text">作业运行史</h3>
          <InfoTip
            what="各自动作业最近一次运行的留痕：什么时候跑的、产出了什么。"
            how="无需设置；采集心跳与三报生成记录自动汇集。"
            effect="只读；心跳保留时长即这张表的时间纵深（扩窗口是数据决策，另行拍板）。"
          />
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="t-surface2 text-left">
                <th className="px-3 py-2 font-medium t-muted text-xs">作业</th>
                <th className="px-3 py-2 font-medium t-muted text-xs">最近一次</th>
                <th className="px-3 py-2 font-medium t-muted text-xs">产出</th>
                <th className="px-3 py-2 font-medium t-muted text-xs">状态</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.name} className="border-t t-border">
                  <td className="px-3 py-2 t-text">{j.name}</td>
                  <td className="px-3 py-2 t-muted tabular-nums" title={j.atNote || ''}>{j.at ? relativeTime(j.at) : '—'}</td>
                  <td className="px-3 py-2 t-muted">{j.info}</td>
                  <td className="px-3 py-2">{j.ok ? <span className="badge-green">有留痕</span> : <span className="badge-gray">无记录</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 报警事件流（自 AlertsTab 迁移，含真删除——云端 DELETE 路由属 H55⑤，本批不补则删除仍会失败） */}
      <section>
        <div className="flex items-center mb-2">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium t-text">报警事件流（{log.length}）</div>
            <InfoTip
              what="报警引擎发过的每一次事件：熔断、清理闸、AI 失败等，含送达结果。"
              how="无需设置；每条可悬停删除，也可清空全部。"
              effect="只影响这份留痕，不影响报警判据本身。"
            />
          </div>
          <span className="flex-1" />
          <button
            className={`btn-ghost inline-flex items-center gap-1 !px-2.5 ${loading ? 'animate-spin' : ''}`}
            onClick={() => load(true)}
            disabled={loading}
          >
            刷新
          </button>
          <button
            className="text-xs hover:underline font-medium"
            style={{ color: 'var(--red)' }}
            onClick={clearLog}
            title="清除所有历史报警记录"
          >
            清空全部
          </button>
        </div>
        {log.length > 0 ? (
          <div className="card divide-y divide-[var(--border)] relative">
            <div className="absolute left-[26px] top-3 bottom-3 w-px" style={{ background: 'var(--border)' }} aria-hidden />
            {pageLog.map((r, i) => (
              <div key={r.at + i} className="px-4 py-2.5 relative group">
                <button
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => deleteLogEntry(pageIndexOffset + i, r)}
                  title="删除这条报警记录"
                  style={{ color: 'var(--red)' }}
                >
                  删除
                </button>
                <div className="flex items-start gap-2 flex-wrap">
                  <span className="flex-none w-2 h-2 rounded-full mt-1.5 -ml-1" style={{ background: 'var(--accent)' }} aria-hidden />
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] t-accent-soft tabular-nums font-medium mr-2" title={`${relativeTime(r.at)}（原始：${r.at}）`}>
                      {new Date(r.at).toLocaleString('zh-CN', { hour12: false })}
                    </span>
                    <span className="badge-green">{metaTitle(meta[r.event]) || r.event}</span>
                    <span className="flex-1" />
                    {(r.results || []).map((rr, j) => (
                      <span
                        key={j}
                        className={`${rr.ok ? 'badge-green' : 'badge-red'} inline-flex items-center gap-1`}
                        title={rr.ok ? rr.channel : `${rr.channel}：${rr.error || '发送失败'}`}
                      >
                        {rr.ok ? '✓' : '✗'} {rr.channel}
                        {!rr.ok && rr.error && <span className="ml-1 opacity-80">{'（'}{rr.error}{'）'}</span>}
                      </span>
                    ))}
                  </div>
                </div>
                {r.title && <div className="mt-1.5 text-[13px] t-text leading-snug pl-6 border-l-2 border-[var(--accent)]">{r.title}</div>}
              </div>
            ))}
          </div>
        ) : (
          <div className="card px-4 py-10 text-center text-xs t-muted">暂无报警事件</div>
        )}
        {log.length > PAGE_SIZE && (
          <div className="mt-3 flex items-center justify-center gap-3 text-xs">
            <button className="btn-ghost !px-2.5 !py-1 disabled:opacity-40" disabled={curPage === 0} onClick={() => setPage(curPage - 1)}>← 上一页</button>
            <span className="t-muted tabular-nums">第 {curPage + 1} / {totalPages} 页 · 共 {log.length} 条</span>
            <button className="btn-ghost !px-2.5 !py-1 disabled:opacity-40" disabled={curPage >= totalPages - 1} onClick={() => setPage(curPage + 1)}>下一页 →</button>
          </div>
        )}
      </section>

      {/* 数据层失败：坏值回落留痕 */}
      <section className="card p-5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold t-text">数据层失败 · 坏值回落留痕（{fb.length}）</h3>
          <InfoTip
            what="消费方读到非法设置值时'钳制→回落'的留痕：哪几个键正在吃代码缺省、从何时开始。"
            how="无需设置；同键 1 小时只记一次，上限 50 条。"
            effect="只读；某个键频繁出现说明它的配置值有问题，应修值而不是改代码。"
          />
        </div>
        {fb.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="t-surface2 text-left">
                  <th className="px-3 py-2 font-medium t-muted text-xs">时刻</th>
                  <th className="px-3 py-2 font-medium t-muted text-xs">设置键</th>
                  <th className="px-3 py-2 font-medium t-muted text-xs">原始值 → 回落值</th>
                </tr>
              </thead>
              <tbody>
                {fb.slice().reverse().map((e, i) => (
                  <tr key={i} className="border-t t-border">
                    <td className="px-3 py-2 t-muted tabular-nums">{relativeTime(e.at)}</td>
                    <td className="px-3 py-2 t-text font-mono text-xs">{e.key}</td>
                    <td className="px-3 py-2 t-muted font-mono text-xs truncate max-w-[420px]" title={`${e.raw} → ${e.fallback}`}>{e.raw} → {e.fallback}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-xs t-muted">暂无回落记录——没有设置键正在吃缺省（或该键尚未落库）。</p>
        )}
      </section>

      {/* 指路卡：库内没有的三类（诚实指路，不给假表） */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <div className="text-sm font-medium t-text">去哪里看（这三类在云端没有库内留痕）</div>
          <InfoTip
            what="服务器错误、部署失败、runner 完整日志这三类存不进 Turso（serverless 无文件系统），不在本页。"
            how="点下面的卡片到对应控制台查看。"
            effect="只读指引。"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <a className="card p-4 block" href="https://vercel.com/kwei888/qwis-intel/logs" target="_blank" rel="noreferrer">
            <div className="text-[13px] font-semibold t-text">服务器错误</div>
            <div className="mt-1 text-[11px] t-muted">Vercel 项目 → Logs（函数运行时报错在这里）</div>
          </a>
          <a className="card p-4 block" href="https://vercel.com/kwei888/qwis-intel/deployments" target="_blank" rel="noreferrer">
            <div className="text-[13px] font-semibold t-text">部署失败</div>
            <div className="mt-1 text-[11px] t-muted">Vercel 项目 → Deployments（构建/部署状态）</div>
          </a>
          <a className="card p-4 block" href="https://github.com/ghoustghoust/qwis-portal/actions" target="_blank" rel="noreferrer">
            <div className="text-[13px] font-semibold t-text">runner 完整日志</div>
            <div className="mt-1 text-[11px] t-muted">GitHub Actions（采集/生成每批的逐行日志）</div>
          </a>
        </div>
      </section>
    </div>
  );
}
