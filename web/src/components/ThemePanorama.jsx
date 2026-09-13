import React from 'react';

// T3-1 R0c 主题全景（2026-09-13）：把碎片聚合成主题全景，事件/领域/人物/产品对比四类视角。
// 数据：daily_reports stats.themes / mybrief.latest.themes（runner buildThemePanorama 产出）
const VIEW_BG = { 事件: 'var(--accent)', 领域: 'var(--green)', 人物: '#8A5A33', 产品对比: '#5B7A9E' };

export default function ThemePanorama({ themes }) {
  if (!themes || !themes.length) return null;
  return (
    <section className="mt-6 sm:mt-8">
      <div className="text-[11px] tracking-widest t-accent font-medium">主题全景</div>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
        {themes.map((t) => (
          <div key={t.name} className="card p-4">
            <div className="flex items-center gap-2">
              <span
                className="flex-none pill !py-0 !px-1.5 !text-[10px] font-bold"
                style={{ background: VIEW_BG[t.viewpoint] || 'var(--accent)', color: '#fff' }}
                title={`视角：${t.viewpoint}`}
              >
                {t.viewpoint}
              </span>
              <h3 className="serif text-[15px] font-bold t-text flex-1 min-w-0 truncate">{t.name}</h3>
              <span className="flex-none text-[11px] t-muted tabular-nums">{t.items?.length || 0} 源</span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed t-muted">{t.summary}</p>
            <div className="mt-2 flex flex-col gap-1">
              {(t.items || []).map((it) => (
                <a
                  key={it.id}
                  href={it.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] t-accent truncate hover:underline"
                  title={it.title}
                >
                  › {it.title}{it.kind === 'video' ? ' ▶' : ''}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
