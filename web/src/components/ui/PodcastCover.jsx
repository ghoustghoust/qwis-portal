// 播客音频封面（2026-09-14：替代「米色块+大 emoji」的占位——用户验收嫌丑）
// 设计：主题色渐变底 + 居中波形条 + 左上「播客」徽章 + 右下播放钮；有头像/封面时可叠加显示
const BARS = [0.42, 0.75, 0.5, 0.95, 0.66, 0.38, 0.82, 0.55, 0.9, 0.48, 0.7, 0.36];

export default function PodcastCover({ className = '', barColor = 'var(--accent)', mini = false }) {
  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        background:
          'linear-gradient(135deg, color-mix(in srgb, var(--accent) 16%, var(--surface)), color-mix(in srgb, var(--accent) 42%, var(--surface-2)))',
      }}
      aria-hidden
    >
      {/* 波形 */}
      <div className="absolute inset-0 flex items-center justify-center gap-[3px] px-6">
        {BARS.map((h, i) => (
          <span
            key={i}
            style={{
              height: `${Math.round(h * 42)}%`,
              width: 3,
              borderRadius: 2,
              background: barColor,
              opacity: 0.5 + (i % 3) * 0.15,
            }}
          />
        ))}
      </div>
      {!mini && (
        <>
          {/* 左上徽章 */}
          <span
            className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] leading-4"
            style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
            </svg>
            播客
          </span>
          {/* 右下播放钮 */}
          <span
            className="absolute bottom-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center"
            style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </>
      )}
    </div>
  );
}
