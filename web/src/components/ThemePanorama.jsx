import React from 'react';
import MdText from './ui/MdText.jsx';

// T3-1 R0c 主题全景（2026-09-13）：把碎片聚合成主题全景，事件/领域/人物/产品对比四类视角。
// 数据：daily_reports stats.themes / mybrief.latest.themes（runner buildThemePanorama 产出）
const VIEW_BG = { 事件: 'var(--accent)', 领域: 'var(--green)', 人物: '#8A5A33', 产品对比: '#5B7A9E' };

// 同一主题簇里大量存在"跨源同题转载"（线上实测：「如何既享受期待，又避免失望」= 虎嗅 + L先生说；
// 「王毅同美国国务卿鲁比奥通电话」= 央视财经 + 央广网；V2EX 同一帖只差 #reply0/#reply1 锚点）。
// 原先一条一个 <a> 且 buildThemePanorama 算好的 source 根本没渲染 → 读者看到两行字面完全相同的
// 链接，以为页面坏了。这里按标题合并成一行，并把来源摊出来做区分。
function clusterRows(items) {
  const byTitle = new Map();
  for (const it of (items || [])) {
    const key = String(it.title || '').trim();
    if (!key) continue;
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(it);
  }
  return [...byTitle.entries()].map(([title, group]) => {
    const sources = [...new Set(group.map((g) => g.source).filter(Boolean))];
    return {
      key: title,
      title,
      url: group[0].url,
      kind: group[0].kind,
      sources: sources.length > 1 ? `${sources[0]} 等 ${sources.length} 源` : (sources[0] || ''),
      tip: sources.length > 1 ? `${title}（${sources.join(' / ')}）` : title,
    };
  });
}

function ThemeCard({ theme }) {
  const rows = clusterRows(theme.items);
  const shown = rows.slice(0, 6);
  const sourceCount = new Set((theme.items || []).map((i) => i.source).filter(Boolean)).size;
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <span
          className="flex-none pill !py-0 !px-1.5 !text-[10px] font-bold"
          style={{ background: VIEW_BG[theme.viewpoint] || 'var(--accent)', color: '#fff' }}
          title={`视角：${theme.viewpoint}`}
        >
          {theme.viewpoint}
        </span>
        <h3 className="serif text-[15px] font-bold t-text flex-1 min-w-0 truncate"><MdText text={theme.name} /></h3>
        {/* 原先显示 items.length 却标「源」，同题转载时两者不等；改按去重后的来源数 */}
        <span className="flex-none text-[11px] t-muted tabular-nums">{sourceCount || rows.length} 源</span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed t-muted"><MdText text={theme.summary} /></p>
      <div className="mt-2 flex flex-col gap-1">
        {shown.map((r) => (
          <a
            key={r.key}
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-baseline gap-2 text-[12px] min-w-0 hover:underline"
            title={r.tip}
          >
            <span className="flex-1 min-w-0 truncate t-accent">› {r.title}{r.kind === 'video' ? ' ▶' : ''}</span>
            {r.sources && <span className="flex-none max-w-[38%] truncate text-[11px] t-muted">{r.sources}</span>}
          </a>
        ))}
        {rows.length > shown.length && (
          <span className="text-[11px] t-muted">另有 {rows.length - shown.length} 条同主题内容</span>
        )}
      </div>
    </div>
  );
}

export default function ThemePanorama({ themes }) {
  if (!themes || !themes.length) return null;
  return (
    <section className="mt-6 sm:mt-8">
      <div className="text-[11px] tracking-widest t-accent font-medium">主题全景</div>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
        {themes.map((t) => <ThemeCard key={t.name} theme={t} />)}
      </div>
    </section>
  );
}
