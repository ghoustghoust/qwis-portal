import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { copyText, formatDateTime, relativeTime, parseTags, sourceLabel } from '../util';
import Stars from './ui/Stars.jsx';
import TagPills from './ui/TagPills.jsx';
import { safeHtml } from '../sanitize';

// 热点榜详情弹窗（七期 T10/F4）：对齐 AIHOT 详情页结构
// 返回/精选徽章/AI 评分/♡收藏/打开原文/标题/信源+时间/「AI 导读」/「推荐理由」/标签
// 正文区「中文|原文」切换：original_html 优先直渲；无则 /api/hot/original 兜底抓取；再失败「阅读原文 ↗」
// 收藏与阅读器「稍后阅读」同一字段（articles.later）
// 2026-09-05 视觉精修：parseTags/sourceLabel 改共享引用；评分 → Stars；推荐理由 → accent-soft 浅底块；语言切换 → pill

// 小节标题（AI 导读 / 推荐理由 / 标签）
function Section({ title, children }) {
  return (
    <div className="mt-5">
      <div className="text-[12px] font-semibold t-accent">{title}</div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export default function HotDetail({ item, onClose, onToggleLater }) {
  const [article, setArticle] = useState(null); // 完整中文内容（GET /api/articles/:id）
  const [lang, setLang] = useState('zh'); // zh | orig
  const [orig, setOrig] = useState(null); // {html, sourceUrl} 原文（original_html 或兜底抓取）
  const [origState, setOrigState] = useState('idle'); // idle | loading | ok | fail
  const contentRef = useRef(null);

  const tags = parseTags(item.tags || article?.tags);
  const score = typeof item.score === 'number' ? item.score : typeof article?.score === 'number' ? article.score : null;
  const reasonRaw = item.reason || article?.reason || '';
  const reason = (reasonRaw === 'null' || reasonRaw === 'undefined') ? '' : reasonRaw;
  const summary = article?.summary || item.summary || '';

  // 拉完整条目（中文正文 + 可能的 original_html）；失败回退摘要
  useEffect(() => {
    let cancelled = false;
    api
      .get(`/api/articles/${item.id}`)
      .then((d) => {
        if (cancelled) return;
        const a = d?.item || d?.article || d;
        setArticle(a);
        // F1 已存原文全文 → 直接可用，无需再抓
        const oh = a?.original_html || item.original_html;
        if (oh) {
          setOrig({ html: oh, sourceUrl: a?.original_url || item.original_url || a?.url || item.url });
          setOrigState('ok');
        }
      })
      .catch(() => !cancelled && setArticle(null));
    return () => {
      cancelled = true;
    };
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc 关闭
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 正文内图片失败隐藏破图
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.querySelectorAll('img').forEach((img) => {
      img.onerror = () => {
        img.style.display = 'none';
      };
      if (img.complete && img.naturalWidth === 0) img.style.display = 'none';
    });
  }, [article, orig, lang]);

  // 切到「原文」：无 original_html 时走六期兜底路由抓原页
  const switchLang = (next) => {
    setLang(next);
    if (next === 'orig' && origState === 'idle') {
      setOrigState('loading');
      api
        .post('/api/hot/original', { id: item.id })
        .then((d) => {
          if (!d?.html) throw new Error(d?.error || '原文抓取失败');
          setOrig({ html: d.html, sourceUrl: d.sourceUrl });
          setOrigState('ok');
        })
        .catch((e) => {
          setOrigState('fail');
          toast(e.message || '原文抓取失败');
        });
    }
  };

  const zhHtml = article?.content_html || item.content_html || '';
  const openUrl =
    article?.original_url || item.original_url || orig?.sourceUrl || article?.url || item.url;
  const laterActive = !!item.later;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onClick={onClose}
    >
      <div
        className="card w-full max-w-[760px] max-h-[86vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶栏：返回 + 徽章/操作 */}
        <div className="px-5 pt-4 pb-3 border-b t-border flex-none">
          <div className="flex items-center gap-2">
            <button className="btn-ghost !px-2.5" onClick={onClose}>
              ← 返回
            </button>
            <span className="flex-1" />
            {!!item.featured && (
              <span
                className="badge-green"
                style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
              >
                ✦ 精选
              </span>
            )}
            {score !== null && <Stars score={score} size={13} className="flex-none" />}
            <button
              className="icon-btn text-[15px]"
              title={laterActive ? '取消稍后阅读' : '加入稍后阅读（阅读器可见）'}
              style={laterActive ? { color: 'var(--purple)' } : undefined}
              onClick={() => onToggleLater?.(item)}
            >
              {laterActive ? '♥' : '♡'}
            </button>
            <button className="btn-ghost" onClick={() => copyText(openUrl)}>
              复制链接
            </button>
            <a className="btn-primary" href={openUrl} target="_blank" rel="noopener noreferrer">
              打开原文 ↗
            </a>
          </div>

          {/* 标题 + 元信息 */}
          <h2 className="mt-3 text-lg font-bold leading-snug t-text">{item.title}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs t-muted">
            <span className="uppercase tracking-wide">{sourceLabel(item)}</span>
            <span className="tabular-nums">· {formatDateTime(item.published_at)}</span>
            <span>· {relativeTime(item.published_at)}</span>
            {(item.rawCategory || item.hotCategory || item.category) && (
              <span className="badge-green" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>
                {item.rawCategory || item.hotCategory || item.category}
              </span>
            )}
          </div>
        </div>

        {/* 滚动区：AI 导读 / 推荐理由 / 标签 / 正文（双语切换） */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {summary && (
            <Section title="AI 导读">
              <p className="text-[14px] leading-relaxed t-text whitespace-pre-line">{summary}</p>
            </Section>
          )}
          {reason && (
            <Section title="推荐理由">
              {/* 2026-09-05 视觉精修：推荐理由收敛为 accent-soft 浅底圆角块 */}
              <p className="rounded-xl t-accent-soft px-4 py-3 text-[13px] leading-relaxed t-text">
                {reason}
              </p>
            </Section>
          )}
          {tags.length > 0 && (
            <Section title="标签">
              <TagPills tags={tags} max={8} />
            </Section>
          )}

          {/* 正文区：中文 | 原文 切换 */}
          <div className="mt-6 pt-4 border-t t-border">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[12px] t-muted">
                正文 · {lang === 'zh' ? 'AI 翻译' : '原文'}
              </span>
              <span className="flex-1" />
              {/* 2026-09-05 视觉精修：中文/原文切换收敛为 .pill/.pill.on */}
              <div className="flex items-center gap-1.5" role="tablist">
                {[
                  { id: 'zh', label: '中文' },
                  { id: 'orig', label: '原文' },
                ].map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={lang === t.id}
                    onClick={() => switchLang(t.id)}
                    className={`pill !text-[12px] !px-3.5 !py-1 cursor-pointer ${lang === t.id ? 'on' : ''}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {lang === 'zh' &&
              (zhHtml ? (
                <div ref={contentRef} className="article-content" dangerouslySetInnerHTML={{ __html: safeHtml(zhHtml) }} />
              ) : (
                <div>
                  {summary && <p className="text-[14px] leading-relaxed t-text whitespace-pre-line">{summary}</p>}
                  {!article && !summary && <div className="py-6 text-center text-xs t-muted">正文加载中…</div>}
                </div>
              ))}

            {lang === 'orig' && origState === 'loading' && (
              <div className="py-10 text-center text-xs t-muted">正在抓取原文…</div>
            )}
            {lang === 'orig' && origState === 'ok' && (
              <div ref={contentRef} className="article-content" dangerouslySetInnerHTML={{ __html: safeHtml(orig.html) }} />
            )}
            {lang === 'orig' && origState === 'fail' && (
              <div className="py-10 text-center">
                <div className="text-[13px] t-muted">原文抓取失败，可点击下方链接到源站阅读。</div>
                <a className="btn-primary inline-block mt-4" href={openUrl} target="_blank" rel="noopener noreferrer">
                  阅读原文 ↗
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
