import { useEffect, useState } from 'react';
import { api } from '../api';
import StatCard from './ui/StatCard.jsx';

// 右侧统计轨（2026-09-05 视觉精修）：未选中文章时的右栏占位
// 数据来自 GET /api/status 的 overview（口径已去噪：不含热榜/聚合源）
// {enabledSources,unreadArticles,todayNew,weekNew,dailyItemCount,dailyTopSources}
const TIPS = [
  '点左侧文件夹即可读整个分组的聚合资讯，不用逐源点开',
  '开启「合并」开关，同一事件的多信源报道会折叠为一条',
  '筛选条件可在筛选面板里「保存为视图」，之后一键复用',
  '热榜类内容在「热点榜」页浏览，不占这里的未读数',
];

export default function OverviewRail() {
  const [ov, setOv] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/api/status')
      .then((d) => {
        if (!cancelled) setOv(d?.overview || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const top = ov?.dailyTopSources || [];

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
            <StatCard compact label="入早报条目" value={ov?.dailyItemCount ?? '—'} tone="soft" />
          </div>
        </div>

        {/* ② 近7天入早报 Top5 来源榜 */}
        <div className="card p-3">
          <div className="text-xs t-muted mb-2 tracking-wide">近7天入早报 · 来源榜</div>
          {top.length === 0 ? (
            <div className="py-4 text-center text-xs t-muted">本期暂无</div>
          ) : (
            <div className="space-y-1">
              {top.map((s, i) => (
                <div key={s.name} className="flex items-center gap-2.5 py-1 text-[13px]">
                  <span className="w-4 text-right text-xs t-muted tabular-nums flex-none">{i + 1}</span>
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
