import { useEffect, useState } from 'react';
import { api } from '../api';
import { useNav } from '../main.jsx';
import { relativeTime } from '../util';

// 今日早报摘要卡（27-reader-today，2026-09-15）：阅读器「今日」视图顶部的主入口卡——
// 导语（theme）+ 头条 3 条 + 点击跳早报全文。早报是四层金字塔的 L1 策展层主入口。
// 数据：GET /api/daily（api.js 自带 5s 缓存与去重，IconRail hover 预取已含 /api/daily）
export default function DailyBriefCard() {
  const { navigate } = useNav();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get('/api/daily')
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (failed) return null; // 早报接口挂了不拖累阅读器主列表
  const report = data?.report;
  if (!data || !report) return null; // 加载中/无早报：静默不占位

  const theme = report.theme || null;
  // 头条 3 条：跨栏目按顺序取前 3（破茧栏 event 类条目无 url，跳过）
  const headlines = [];
  for (const sec of report.sections || []) {
    for (const it of sec.items || []) {
      if (headlines.length >= 3) break;
      if (it.kind === 'event') continue;
      headlines.push({ id: it.id ?? it.ref_id, title: it.title, source: it.source_name || it.source });
    }
    if (headlines.length >= 3) break;
  }

  return (
    <div
      className="m-2 mb-0 card p-3 cursor-pointer border t-border hover:t-accent-soft transition-colors"
      style={{ borderLeft: '3px solid var(--accent)' }}
      title="打开今日早报全文"
      onClick={() => navigate('/daily/')}
    >
      <div className="flex items-center gap-2 text-[11px] t-muted">
        <span className="font-semibold t-accent">今日早报</span>
        {report.generated_at && <span className="tabular-nums">{relativeTime(report.generated_at)}</span>}
        {report.degraded && <span className="badge-gray">降级版</span>}
        <span className="flex-1" />
        <span className="t-accent">读全文 →</span>
      </div>
      {theme && (
        <div className="mt-1.5 text-[13px] leading-snug t-text font-medium line-clamp-2">{theme}</div>
      )}
      {headlines.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {headlines.map((h, i) => (
            <div key={h.id || i} className="text-xs t-muted leading-snug truncate">
              <span className="t-accent flex-none mr-1">{i + 1}.</span>
              {h.title}
              {h.source ? <span className="opacity-70"> · {h.source}</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
