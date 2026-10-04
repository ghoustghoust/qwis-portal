// 首页仪表盘（T3-8 批次6）：形态参考 docs/archive/样图/仪表盘/工作台形态——
// 四指标大卡（节点可跳转）+ 采集趋势 + AI 用量 + 生成历史 + 入报 Top5。
// 数据：GET /api/dashboard（轻聚合，H57 教训内建：只投影不出大列表）+
//       GET /api/status/daily-sources（Top5，B26 懒加载设计自带 60s 缓存）。
// AdminRefCard 数据吸收：阅读侧（未读/阅读小结）直接进本页第三行，不再单挂对照卡。
import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import { relativeTime, formatDateTime } from '../util';
import InfoTip from './InfoTip.jsx';
import CollectTrendChart from './CollectTrendChart.jsx';
import SourceAvatar from './ui/SourceAvatar.jsx';

const KIND_LABEL = {
  chat: '对话 / 未标注', translate: '翻译', filter: '初筛', analyze: '事件分析', theme: '主题全景',
};

function jump(id) {
  window.location.hash = `/${id}`;
}

// 指标大卡：数值 + 口径标签 + 整卡可跳转
function MetricCard({ label, value, sub, tone, to, tip }) {
  return (
    <button
      onClick={() => to && jump(to)}
      className="card p-4 text-left w-full hover:t-surface2 transition-colors"
      style={{ cursor: to ? 'pointer' : 'default' }}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] t-muted">{label}</span>
        {tip && <InfoTip {...tip} />}
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone || 't-text'}`}>{value ?? '—'}</div>
      {sub && <div className="mt-0.5 text-[11px] t-muted">{sub}</div>}
    </button>
  );
}

const TIER_LABEL = { ai: 'AI 档', keyword: '关键词档', degraded: '降级' };

export default function DashboardTab() {
  const [data, setData] = useState(null);
  const [topSources, setTopSources] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const [d, ts] = await Promise.allSettled([
      api.get('/api/dashboard'),
      api.get('/api/status/daily-sources'),
    ]);
    if (d.status === 'fulfilled') setData(d.value);
    else setError('仪表盘数据加载失败: ' + d.reason?.message);
    if (ts.status === 'fulfilled') setTopSources(ts.value?.overview || null);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error && !data) {
    return <div className="py-8 text-center text-sm" style={{ color: 'var(--red)' }}>{error}</div>;
  }
  if (!data) {
    return <div className="py-8 text-center text-sm t-muted">加载中…</div>;
  }

  const { sources, ingest, collect, ai, briefs } = data;
  const lastRunOk = collect.lastRunAt && (Date.now() - Date.parse(collect.lastRunAt) < 2 * 3600e3);

  return (
    <div className="space-y-5">
      {/* 第一行：四指标大卡（节点可跳转） */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="抓取源" value={sources.enabled} to="library"
          sub={`总 ${sources.total}（含停用/退役） · 口径：启用且非噪声`}
          tip={{ what: '当前参与采集的源数量。', how: '在「源库」增删与启停。', effect: '启用数即时反映采集覆盖面；熔断的源不含在内（它们在「熔断中」）。' }}
        />
        <MetricCard
          label="今日入库" value={ingest.todayNew} to="monitor"
          sub={`近 7 天 ${ingest.weekNew} · 口径：北京日界起，非噪声源`}
          tip={{ what: '今天（北京日界）新入库的内容条数。', how: '由 runner 采集批次自动写入。', effect: '长期为零说明采集链路停了——配合下方采集趋势判断。' }}
        />
        <MetricCard
          label="熔断中" value={sources.frozen} to="monitor"
          tone={sources.frozen > 0 ? 'text-[var(--red)]' : 'text-[var(--green)]'}
          sub="连续失败 ≥3 次被自动停用"
          tip={{ what: '被熔断机制自动停用的源数。', how: '「监控」看明细；逐个恢复走源库行内开关（批量恢复已按 H15 摘除）。', effect: '数字上涨通常是源失效或网络故障；自愈（批次尾部自动恢复）落地后此处会自动回落。' }}
        />
        <MetricCard
          label="报错源" value={sources.errorActive} to="monitor"
          tone={sources.errorActive > 0 ? '' : 'text-[var(--green)]'}
          sub="启用中但最近一次抓取报错"
          tip={{ what: '还在采集但最近一轮失败的源。', how: '「监控」与源库问题源视图看具体错误。', effect: '偶发属正常；持续增长接近熔断。' }}
        />
      </div>

      {/* 第二行：采集趋势 + AI 用量 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <section className="card p-4 lg:col-span-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold t-text">采集趋势</h3>
            <InfoTip what="最近采集批次的成功率与单轮入库量。" how="自动加载；完整历史与口径在「监控」。"
              effect={`最近心跳 ${collect.lastRunAt ? relativeTime(collect.lastRunAt) : '—'}（${collect.mode || '—'} 档）${lastRunOk ? '' : '——超过 2 小时没有心跳，采集可能停了'}。`} />
            <span className="flex-1" />
            <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => jump('monitor')}>进监控 →</button>
          </div>
          <div className="mt-2">
            <CollectTrendChart history={collect.recent} height={150} />
          </div>
        </section>
        <section className="card p-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold t-text">AI 用量</h3>
            <InfoTip what="各 AI 管线近 24h 的调用与失败。" how="自动加载；完整口径在「AI 配置」的「各管线用量」。"
              effect={`统计环上限 ${ai.statsCap} 条，调用密集时计数是下界。`} />
            <span className="flex-1" />
            <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => jump('ai')}>进 AI →</button>
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-2xl font-bold tabular-nums t-text">{ai.total24h}</span>
            <span className="text-xs t-muted">次 / 24h</span>
            <span className={`text-xs ${ai.failed24h > 0 ? 'text-[var(--red)]' : 't-muted'}`}>失败 {ai.failed24h}</span>
          </div>
          <div className="mt-2 space-y-1">
            {ai.kinds.length === 0 && <div className="text-xs t-muted">近 24h 无调用</div>}
            {ai.kinds.map((k) => (
              <div key={k.kind} className="flex items-center gap-2 text-xs">
                <span className="t-text flex-1">{KIND_LABEL[k.kind] || k.kind}</span>
                <span className="tabular-nums t-muted">{k.calls} 次{k.failed ? ` · 失败 ${k.failed}` : ''}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* 第三行：生成历史 + 入报 Top5 + 阅读侧 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <section className="card p-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold t-text">生成历史（末 3 期）</h3>
            <span className="flex-1" />
            <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => jump('brief')}>进早报 →</button>
          </div>
          <div className="mt-2 space-y-1.5 text-xs">
            {briefs.daily.length === 0 && <div className="t-muted">暂无日报产物</div>}
            {briefs.daily.map((d) => (
              <div key={d.generatedAt} className="flex items-center gap-2">
                <span className={`badge-${d.tier === 'ai' ? 'green' : d.tier === 'degraded' ? 'red' : 'gray'}`}>{TIER_LABEL[d.tier] || d.tier}</span>
                <span className="t-muted flex-1">{formatDateTime(d.generatedAt)}</span>
                <span className="tabular-nums t-muted">{d.totalItems} 条</span>
              </div>
            ))}
            {briefs.weekly && (
              <div className="flex items-center gap-2 pt-1.5 border-t t-border">
                <span className={`badge-${briefs.weekly.degraded ? 'red' : 'green'}`}>周刊 #{briefs.weekly.issue}</span>
                <span className="t-muted flex-1">{briefs.weekly.dateEnd || '—'} 截稿</span>
                <span className="tabular-nums t-muted">{briefs.weekly.count} 条</span>
              </div>
            )}
            {briefs.mybrief && (
              <div className="flex items-center gap-2">
                <span className={briefs.mybrief.empty ? 'badge-gray' : 'badge-green'}>我的早报</span>
                <span className="t-muted flex-1">{briefs.mybrief.generatedAt ? formatDateTime(briefs.mybrief.generatedAt) : '—'}</span>
                {briefs.mybrief.empty && <span className="t-muted">{briefs.mybrief.empty}</span>}
              </div>
            )}
          </div>
        </section>

        <section className="card p-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold t-text">近 7 天入报 Top5</h3>
            <span className="flex-1" />
            <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => jump('library')}>进源库 →</button>
          </div>
          <div className="mt-2 space-y-1.5 text-xs">
            {!topSources && <div className="t-muted">加载中…</div>}
            {topSources && topSources.dailyTopSources?.length === 0 && <div className="t-muted">近 7 天无入报条目</div>}
            {(topSources?.dailyTopSources || []).map((t, i) => (
              <div key={t.name} className="flex items-center gap-2">
                <span className="t-muted tabular-nums w-4">{i + 1}</span>
                <SourceAvatar name={t.name} avatar={t.avatar} size={20} />
                <span className="t-text truncate flex-1" title={t.name}>{t.name}</span>
                <span className="tabular-nums t-muted">{t.count} 次</span>
              </div>
            ))}
            {topSources && <div className="text-[11px] t-muted pt-1 border-t t-border">共 {topSources.dailyItemCount} 条入报 · 已排热榜/聚合源</div>}
          </div>
        </section>

        <section className="card p-4">
          <h3 className="text-sm font-semibold t-text">阅读侧</h3>
          <div className="mt-2 grid grid-cols-2 gap-3 text-center">
            <div className="t-surface2 rounded-lg px-3 py-3">
              <div className="text-xl font-bold tabular-nums t-text">{ingest.unread3d}</div>
              <div className="text-[11px] t-muted">未读 · 近 3 天窗口口径</div>
            </div>
            <div className="t-surface2 rounded-lg px-3 py-3">
              <div className="text-xl font-bold tabular-nums t-text">{briefs.digest ? briefs.digest.readCount : '—'}</div>
              <div className="text-[11px] t-muted">已读 · {briefs.digest ? briefs.digest.date : '阅读小结未生成'}</div>
            </div>
          </div>
          <div className="mt-2 text-[11px] t-muted leading-relaxed">
            「零未读」不能当死源判据（H36），要配合「熔断中/报错源」与采集趋势一起读。
          </div>
        </section>
      </div>
    </div>
  );
}
