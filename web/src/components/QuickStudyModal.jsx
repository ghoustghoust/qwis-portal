import { useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { copyText, formatDateTime, formatWords, readingMinutes, imgUrl } from '../util';
import { safeHtml } from '../sanitize';

// 快速学习弹窗（F17/F20）：类型标签 + 标题 + 来源时间 + 收藏/复制链接/打开原文 + 内容简介 + 正文
// 2026-09-05 视觉精修：meta 行补字数/阅读时长，统一 .meta token
export default function QuickStudyModal({ item, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fav, setFav] = useState(false);
  // 17-translate：中英切换 + 手动翻译
  const [showTranslated, setShowTranslated] = useState(true);
  const [translating, setTranslating] = useState(false);

  const isVideo = item?.kind === 'video';
  const articleId = item?.ref_id || item?.id;
  const hasTranslation = !!(detail?.translated_title || detail?.translated_content);
  const isEnglishTitle = !!item?.title && (item.title.replace(/[^ -~]/g, '').length / item.title.length) > 0.7;
  // 2026-09-14：视频条目弹窗内嵌播放（用户验收：早报里的视频要能正常播放）
  const [playUrl, setPlayUrl] = useState('');
  const [playExternal, setPlayExternal] = useState('');
  useEffect(() => {
    if (!isVideo || !item?.ref_id) return;
    let cancelled = false;
    api
      .get(`/api/videos/${item.ref_id}/play`)
      .then((d) => {
        if (cancelled) return;
        if (d?.mode === 'external') setPlayExternal(d.url || '');
        else setPlayUrl(d?.url || d?.embed_url || '');
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.ref_id, isVideo]);

  // 入队后轮询，译文出现即切换
  useEffect(() => {
    if (!translating || !articleId || isVideo) return;
    const timer = setInterval(() => {
      api.get(`/api/articles/${articleId}`).then((data) => {
        const d = data?.item || data?.article || data;
        if (d && (d.translated_title || d.translated_content)) {
          setDetail(d);
          setTranslating(false);
          setShowTranslated(true);
          toast('翻译完成');
        }
      }).catch(() => {});
    }, 60000);
    return () => clearInterval(timer);
  }, [translating, articleId, isVideo]);

  const requestTranslate = async () => {
    try {
      const r = await api.post(`/api/articles/${articleId}/translate`);
      if (r?.already) { toast('已有翻译'); return; }
      setTranslating(true);
      toast('已加入翻译队列，约 20 分钟内完成');
    } catch (e) { toast(e.message); }
  };

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setDetail(null);
    setFav(false);
    setLoading(true);
    const path = isVideo ? `/api/videos/${item.ref_id}` : `/api/articles/${item.ref_id || item.id}`;
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

  const contentHtml = showTranslated && detail?.translated_content
    ? detail.translated_content.replace(/\n/g, '<br/>')
    : detail?.content_html;
  const intro = detail?.intro || detail?.summary || item.summary;
  // 2026-09-05 视觉精修：meta 行字数（优先纯文本字数列，缺失回退正文/简介长度）
  const contentLen = detail?.word_count ?? (contentHtml || intro || '').length;
  // 2026-09-14 修复：日报条目的来源字段是 source（生成时 dailyFormatItem 写入），此前只读 source_name → 恒「未知来源」
  const sourceName = item.source_name || item.source || detail?.source_name || '未知来源';
  // 打开原文兜底：条目 url → 详情 url → original_url（此前 item.url 为空时点了没反应）
  const openUrl = item.url || detail?.url || detail?.original_url || '';
  // 中英对照标题：详情已译 → 中文主标题 + 英文原标题副行
  const zhTitle = detail?.translated_title || item.title;
  const origTitle = detail?.translated_title && detail.translated_title !== item.title ? item.title : (item.original_title || '');
  // 播客音频（2026-09-14：cover 里的音频 enclosure 已被服务端归位到 audio_url）
  const audioUrl = detail?.audio_url || item.audio_url || '';
  const audioImg = detail?.cover || detail?.source_avatar || item.cover || '';

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
              <span className="badge-green">{isVideo ? '视频' : audioUrl ? '播客' : '文章'}</span>
              <h1 className="serif mt-2 text-xl font-bold leading-snug t-text">{zhTitle}</h1>
              {origTitle && (
                <div className="mt-1 text-[12px] t-muted leading-snug">{origTitle}</div>
              )}
              {/* 2026-09-05 视觉精修：meta 行 = 来源 · 时间 · 字数 · 阅读时长 */}
              <div className="meta mt-2 flex-wrap">
                <span className="truncate">{sourceName}</span>
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
              <button className="btn-ghost" onClick={() => openUrl && copyText(openUrl)}>
                复制链接
              </button>
              {/* 17-translate：翻译按钮/切换 */}
              {!isVideo && hasTranslation && (
                <button className="btn-ghost" onClick={() => setShowTranslated((v) => !v)}>
                  {showTranslated ? '查看原文' : '查看译文'}
                </button>
              )}
              {!isVideo && !hasTranslation && isEnglishTitle && (
                translating
                  ? <span className="text-xs t-muted animate-pulse px-2">翻译中…</span>
                  : <button className="btn-ghost" onClick={requestTranslate}>翻译</button>
              )}
              <button
                className="btn-primary"
                style={{ background: 'var(--green)' }}
                disabled={!openUrl}
                onClick={() => openUrl && window.open(openUrl, '_blank', 'noopener')}
              >
                打开原文
              </button>
            </div>
          </div>

          {/* 视频内嵌播放（2026-09-14：早报里的视频点开即可看） */}
          {isVideo && playUrl && (
            <div className="mt-5 rounded-xl overflow-hidden border t-border bg-black aspect-video">
              <iframe src={playUrl} className="w-full h-full" allowFullScreen title="视频播放" />
            </div>
          )}
          {isVideo && !playUrl && playExternal && (
            <div className="mt-5">
              <a className="btn-primary inline-block" href={playExternal} target="_blank" rel="noopener noreferrer">
                ▶ 到原平台观看 ↗
              </a>
            </div>
          )}

          {/* 播客播放器（图片+声音，2026-09-14） */}
          {audioUrl && (
            <div className="mt-5 rounded-xl border t-border p-4 flex items-center gap-4">
              {audioImg ? (
                <img src={imgUrl(audioImg)} alt="" className="w-16 h-16 rounded-lg object-cover flex-none" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              ) : (
                <span className="w-16 h-16 rounded-lg t-accent-soft flex-none flex items-center justify-center text-2xl">🎧</span>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[11px] t-muted mb-1.5">🎧 播客音频</div>
                <audio controls preload="none" src={audioUrl} className="w-full h-9" />
              </div>
            </div>
          )}

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
