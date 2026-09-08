import { useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { copyText, formatDateTime, formatWords, readingMinutes } from '../util';
import { safeHtml } from '../sanitize';

// 快速学习弹窗（F17/F20）：类型标签 + 标题 + 来源时间 + 收藏/复制链接/打开原文 + 内容简介 + 正文
// 2026-09-05 视觉精修：meta 行补字数/阅读时长，统一 .meta token
export default function QuickStudyModal({ item, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fav, setFav] = useState(false);

  const isVideo = item?.kind === 'video';

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setDetail(null);
    setFav(false);
    setLoading(true);
    const path = isVideo ? `/api/videos/${item.ref_id}` : `/api/articles/${item.ref_id}`;
    api
      .get(path)
      .then((data) => {
        if (cancelled) return;
        const d = data?.item || data?.video || data?.article || data;
        setDetail(d);
        setFav(!!(d?.favorite ?? d?.later));
      })
      .catch(() => !cancelled && setDetail(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  if (!item) return null;

  const toggleFavorite = async () => {
    try {
      const path = isVideo
        ? `/api/videos/${item.ref_id}/favorite`
        : `/api/articles/${item.ref_id}/later`;
      const data = await api.post(path);
      const next = data?.favorite ?? data?.later ?? (fav ? 0 : 1);
      setFav(!!next);
      toast(next ? '已加入收藏' : '已取消收藏');
    } catch (e) {
      toast(e.message);
    }
  };

  const contentHtml = detail?.content_html;
  const intro = detail?.intro || detail?.summary || item.summary;
  // 2026-09-05 视觉精修：meta 行字数（优先纯文本字数列，缺失回退正文/简介长度）
  const contentLen = detail?.word_count ?? (contentHtml || intro || '').length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onClick={onClose}
    >
      <div
        className="card w-full max-w-[760px] max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部（QUICK STUDY） */}
        <div className="flex items-start px-6 pt-4 pb-3 flex-none border-b t-border">
          <div>
            <div className="text-[10px] tracking-[0.2em] t-muted uppercase">Quick Study</div>
            <div className="mt-0.5 text-base font-bold t-text">快速学习</div>
          </div>
          <div className="flex-1" />
          <button className="icon-btn" title="关闭" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <span className="badge-green">{isVideo ? '视频' : '公众号文章'}</span>
              <h1 className="serif mt-2 text-xl font-bold leading-snug t-text">{item.title}</h1>
              {/* 2026-09-05 视觉精修：meta 行 = 来源 · 时间 · 字数 · 阅读时长 */}
              <div className="meta mt-2 flex-wrap">
                <span className="truncate">{item.source_name || '未知来源'}</span>
                <span className="sep">·</span>
                <span className="tabular-nums">{formatDateTime(item.published_at)}</span>
                {formatWords(contentLen) && (
                  <>
                    <span className="sep">·</span>
                    <span className="tabular-nums">
                      {formatWords(contentLen)}（{readingMinutes(contentLen)}）
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="flex-none flex items-center gap-2">
              <button
                className="btn-ghost"
                onClick={toggleFavorite}
                style={fav ? { color: 'var(--purple)', borderColor: 'var(--purple)' } : undefined}
              >
                {fav ? '已收藏' : '加入收藏'}
              </button>
              <button className="btn-ghost" onClick={() => item.url && copyText(item.url)}>
                复制链接
              </button>
              <button
                className="btn-primary"
                style={{ background: 'var(--green)' }}
                onClick={() => item.url && window.open(item.url, '_blank', 'noopener')}
              >
                打开原文
              </button>
            </div>
          </div>

          {/* 内容简介卡（历史日报数据中的 AI 摘要仍可展示） */}
          {item.summary ? (
            <div
              className="mt-5 rounded-xl border p-4"
              style={{
                borderColor: 'var(--green)',
                background: 'color-mix(in srgb, var(--green) 7%, var(--surface))',
              }}
            >
              <div className="text-xs font-medium" style={{ color: 'var(--green)' }}>
                ● 内容简介
              </div>
              <p className="mt-2 text-[13px] leading-relaxed t-text whitespace-pre-wrap">
                {item.summary}
              </p>
            </div>
          ) : null}

          {/* 正文内容 */}
          <div className="mt-6 border-t t-border pt-5">
            {loading && <div className="py-8 text-center text-sm t-muted">加载中…</div>}
            {!loading && isVideo && (
              <p className="text-[13px] leading-relaxed t-muted whitespace-pre-wrap">
                {intro || '（暂无视频简介）'}
              </p>
            )}
            {!loading && !isVideo && (
              <div
                className="article-content"
                dangerouslySetInnerHTML={{ __html: safeHtml(contentHtml || intro || '') }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
