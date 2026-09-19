import { useEffect, useState } from 'react';
import { api } from '../api';
import StatCard from './ui/StatCard.jsx';
import SourceAvatar from './ui/SourceAvatar.jsx';

// 右侧统计轨（2026-09-05 视觉精修）：未选中文章时的右栏占位
// 数据分两路（B26 拆首屏）：
//   GET /api/status               → {enabledSources,unreadArticles,todayNew,weekNew}（轻投影）
//   GET /api/status/daily-sources → {dailyItemCount,dailyTopSources}（要聚合 daily_reports BLOB，懒加载）
// 口径已去噪：不含热榜/聚合源
const TIPS = [
  '点左侧文件夹即可读整个分组的聚合资讯，不用逐源点开',
  '开启「合并」开关，同一事件的多信源报道会折叠为一条',
  '筛选条件可在筛选面板里「保存为视图」，之后一键复用',
  '热榜类内容在「热点榜」页浏览，不占这里的未读数',
];

// B12：模块级缓存——切页回来立即命中（60s TTL），不再重新拉取
let _ovCache = { data: null, ts: 0 };
// B26：入报统计（条目数 + 来源榜）拆成独立按需请求，故单独一份缓存
let _ovHeavyCache = { data: null, ts: 0 };
const OV_TTL = 60e3;

export default function OverviewRail() {
  const [ov, setOv] = useState(_ovCache.data && Date.now() - _ovCache.ts < OV_TTL ? _ovCache.data : null);
  const [heavy, setHeavy] = useState(_ovHeavyCache.data && Date.now() - _ovHeavyCache.ts < OV_TTL ? _ovHeavyCache.data : null);

  useEffect(() => {
    let cancelled = false;
    if (_ovCache.data && Date.now() - _ovCache.ts < OV_TTL) return;
    api
      .get('/api/status')
      .then((d) => {
        _ovCache = { data: d?.overview || null, ts: Date.now() };
        if (!cancelled) setOv(_ovCache.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // B26（2026-09-19）：dailyItemCount / dailyTopSources 原先夹在 /api/status 里，
  // 而这两个值要聚合近 7 天 daily_reports 的 BLOB（实测单次 214KB / 2.0s），
  // 是首屏那个冷态 12~30s 端点的组成部分之一。它们不是首屏必需 → 拆到
  // GET /api/status/daily-sources 懒加载；失败要显示得出来，不再 .catch(()=>{}) 静默成"本期暂无"。
  useEffect(() => {
    let cancelled = false;
    if (_ovHeavyCache.data && Date.now() - _ovHeavyCache.ts < OV_TTL) return;
    api
      .get('/api/status/daily-sources')
      .then((d) => {
        _ovHeavyCache = { data: d?.overview || {}, ts: Date.now() };
        if (!cancelled) setHeavy(_ovHeavyCache.data);
      })
      .catch(() => { if (!cancelled) setHeavy({ loadError: true }); });
    return () => {
      cancelled = true;
    };
  }, []);

  const top = heavy?.dailyTopSources || [];

  // 2026-09-05 排版修正：钉在右缘的常驻窄边栏（对照样图 2.png 的右栏）；
  // 选中文章后不再卸载（正文加载不影响本周概览）；窄屏（<xl）让位隐藏
  return (
    <section className="hidden xl:flex w-[320px] flex-none border-l t-border h-full t-bg overflow-y-auto">
      <div className="px-4 py-5 space-y-4 w-full">
        {/* ① 本周概览：2×2 紧凑统计卡 */}
        <div>
          <div className="text-xs t-muted mb-2 tracking-wide">本周概览</div>
          <div className="grid grid-cols-2 gap-2.5">
            <StatCard compact label="未读文章" value={ov?.unreadArticles ?? '—'} tone="soft" />
            <StatCard compact label="今日新增" value={ov?.todayNew ?? '—'} tone="surface" />
            <StatCard compact label="近7天更新" value={ov?.weekNew ?? '—'} tone="surface2" />
            <StatCard compact label="入早报条目" value={heavy?.loadError ? '—' : (heavy?.dailyItemCount ?? '—')} tone="soft" />
          </div>
        </div>

        {/* ② 近7天入早报 Top5 来源榜（B26：懒加载，加载失败要说得出口） */}
        <div className="card p-3">
          <div className="text-xs t-muted mb-2 tracking-wide">近7天入早报 · 来源榜</div>
          {heavy?.loadError ? (
            <div className="py-4 text-center text-xs t-muted">来源榜加载失败（不影响左侧阅读）</div>
          ) : !heavy ? (
            <div className="py-4 text-center text-xs t-muted">正在统计…</div>
          ) : top.length === 0 ? (
            <div className="py-4 text-center text-xs t-muted">本期暂无</div>
          ) : (
            <div className="space-y-1">
              {top.map((s, i) => (
                <div key={s.name} className="flex items-center gap-2.5 py-1 text-[13px]">
                  <span className="w-4 text-right text-xs t-muted tabular-nums flex-none">{i + 1}</span>
                  <SourceAvatar name={s.name} avatar={s.avatar} size={18} />
                  <span className="flex-1 truncate t-text">{s.name}</span>
                  <span className="text-xs t-muted tabular-nums flex-none">{s.count} 次</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ③ 使用提示 */}
        <div className="card p-3">
          <div className="text-xs t-muted mb-2 tracking-wide">使用提示</div>
          <ul className="space-y-1.5">
            {TIPS.map((t) => (
              <li key={t} className="flex gap-2 text-xs t-muted leading-relaxed">
                <span className="flex-none" aria-hidden>💡</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
