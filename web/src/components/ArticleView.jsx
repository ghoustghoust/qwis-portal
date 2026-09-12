import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { copyText, formatDateTime, formatWords, readingMinutes } from '../util';
import { safeHtml } from '../sanitize';
import { RadarLogo } from './icons.jsx';
import { useI18n } from '../i18n.jsx';

// 文章阅读栏（F5~F7）：完整渲染 content_html + 顶部工具条
export default function ArticleView({ articleId, items, filter, onSelect, onClose, onChanged }) {
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [showTranslated, setShowTranslated] = useState(true); // P0-4：翻译/原文切换
  const [translating, setTranslating] = useState(false); // 17-translate：手动翻译入队后轮询
  const contentRef = useRef(null);
  const { t } = useI18n();

  // 正文内图片/视频处理：图片加载失败隐藏破图；视频补 controls 并在失效时替换为「打开原文」提示
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.querySelectorAll('img').forEach((img) => {
      img.onerror = () => { img.style.display = 'none'; };
      if (img.complete && img.naturalWidth === 0) img.style.display = 'none';
    });
    el.querySelectorAll('video').forEach((v) => {
      v.setAttribute('controls', '');
      v.setAttribute('preload', 'metadata');
      v.style.maxWidth = '100%';
      v.onerror = () => {
        const tip = document.createElement('a');
        tip.href = article?.url || '#';
        tip.target = '_blank';
        tip.rel = 'noopener';
        tip.className = 'text-xs t-muted';
        tip.textContent = t('article.videoExpired');
        tip.style.cssText = 'display:inline-block;padding:8px 12px;border:1px solid var(--border);border-radius:8px;';
        v.replaceWith(tip);
      };
    });
  }, [article]);

  // GET :id 会顺手置 read_at（后端流转历史存档，F6）
  useEffect(() => {
    if (!articleId) return;
    let cancelled = false;
    setLoading(true);
    setArticle(null);
    api
      .get(`/api/articles/${articleId}`)
      .then((data) => {
        if (cancelled) return;
        setArticle(data?.item || data?.article || data);
        onChanged?.();
      })
      .catch((e) => toast(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId]);

  const { prevId, nextId } = useMemo(() => {
    const idx = (items || []).findIndex((a) => a.id === articleId);
    return {
      prevId: idx > 0 ? items[idx - 1].id : null,
      nextId: idx >= 0 && idx < items.length - 1 ? items[idx + 1].id : null,
    };
  }, [items, articleId]);

  // 切换文章时重置折叠态
  useEffect(() => {
    setMoreOpen(false);
  }, [articleId]);

  const toggleLater = async () => {
    try {
      const data = await api.post(`/api/articles/${articleId}/later`);
      const later = data?.later ?? data?.article?.later ?? (article?.later ? 0 : 1);
      setArticle((a) => (a ? { ...a, later } : a));
      toast(later ? t('article.addedLater') : t('article.removedLater'));
      onChanged?.();
    } catch (e) {
      toast(e.message);
    }
  };

  const readAll = async () => {
    try {
      await api.post('/api/articles/read-all', {
        tab: filter?.tab,
        source_id: filter?.sourceId || undefined,
        group_id: filter?.groupId || undefined,
      });
      toast(t('article.allMarkedRead'));
      onChanged?.(true); // 全部已读需同时刷新列表
    } catch (e) {
      toast(e.message);
    }
  };

  // 2026-09-05 视觉精修：空态由 OverviewRail 取代，本组件仅在选中文章时渲染
  // 2026-09-05：未选中文章时渲染空态引导（原 return null；右侧本周概览已常驻，空态回到正文区）
  if (!articleId) {
    return (
      <section className="flex-1 min-w-0 h-full t-bg flex flex-col items-center justify-center gap-3 select-none">
        <span className="t-accent opacity-40"><RadarLogo size={44} /></span>
        <div className="text-sm t-muted">{t('article.selectHint')}</div>
      </section>
    );
  }

  const laterActive = !!(article && article.later);
  const contentLen = article?.word_count ?? (article?.content_html || '').length; // 2026-09-05：优先用纯文本字数列，缺失时回退正文长度
  const hasTranslation = !!(article?.translated_title || article?.translated_content);
  // 17-translate：未翻译的英文文章显示手动翻译按钮（标题 ASCII 占比启发式）
  const isEnglishTitle = !!article?.title && (article.title.replace(/[^ -~]/g, '').length / article.title.length) > 0.7;

  // 17-translate：入队后每 60s 轮询，译文出现即自动切换
  useEffect(() => {
    if (!translating || !articleId) return;
    const timer = setInterval(() => {
      api.get(`/api/articles/${articleId}`).then((data) => {
        const item = data?.item || data?.article || data;
        if (item && (item.translated_title || item.translated_content)) {
          setArticle(item);
          setTranslating(false);
          setShowTranslated(true);
          toast(t('article.translateDone') || '翻译完成');
        }
      }).catch(() => {});
    }, 60000);
    return () => clearInterval(timer);
  }, [translating, articleId]);

  const requestTranslate = async () => {
    try {
      const r = await api.post(`/api/articles/${articleId}/translate`);
      if (r?.already) { toast(t('article.translated') || '已有翻译'); return; }
      setTranslating(true);
      toast(t('article.translateQueued') || '已加入翻译队列，约 20 分钟内完成');
    } catch (e) { toast(e.message); }
  };

  return (
    <section className="flex-1 flex flex-col h-full min-w-0 t-bg">
      {/* 顶部工具条（F5） */}
      <div className="flex items-center gap-1 px-4 h-12 flex-none border-b t-border t-surface">
        <button
          className="icon-btn"
          title={laterActive ? t('article.cancelLater') : t('article.readLater')}
          onClick={toggleLater}
          style={laterActive ? { color: 'var(--purple)' } : undefined}
        >
          {laterActive ? '♥' : '♡'}
        </button>
        <button
          className="icon-btn"
          title={t('article.openOriginal')}
          onClick={() => article?.url && window.open(article.url, '_blank', 'noopener')}
        >
          ↗
        </button>
        <div className="relative">
          <button className="icon-btn" title={t('article.more')} onClick={() => setMoreOpen((v) => !v)}>
            ⋯
          </button>
          {moreOpen && (
            <div className="absolute left-0 top-9 z-20 card p-1 w-32" onClick={() => setMoreOpen(false)}>
              <button
                className="w-full text-left px-3 py-1.5 text-xs rounded-md hover:bg-[var(--surface-2)] t-text"
                onClick={() => article?.url && copyText(article.url)}
              >
                {t('article.copyLink')}
              </button>
              <button
                className="w-full text-left px-3 py-1.5 text-xs rounded-md hover:bg-[var(--surface-2)] t-text"
                onClick={() => article?.title && copyText(article.title)}
              >
                {t('article.copyTitle')}
              </button>
            </div>
          )}
        </div>
        <div className="flex-1" />
        {/* 17-translate：未翻译英文文章的手动翻译按钮 */}
        {!hasTranslation && isEnglishTitle && (
          translating ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded t-muted flex-none animate-pulse">{t('article.translating') || '翻译中…'}</span>
          ) : (
            <button
              className="text-[10px] px-1.5 py-0.5 rounded t-accent-soft t-accent font-medium flex-none hover:opacity-80 transition-opacity"
              title={t('article.translateNow') || '翻译为中文'}
              onClick={requestTranslate}
            >
              {t('article.translateNow') || '翻译'}
            </button>
          )
        )}
        {hasTranslation && (
          <button
            className="text-[10px] px-1.5 py-0.5 rounded t-accent-soft t-accent font-medium flex-none hover:opacity-80 transition-opacity"
            title={showTranslated ? t('article.showOriginal') : t('article.showTranslation')}
            onClick={() => setShowTranslated((v) => !v)}
          >
            {showTranslated ? t('article.translated') : (t('article.showOriginal'))}
          </button>
        )}
        <button className="btn-ghost !py-1 !px-2 text-xs" title={t('article.readAllTitle')} onClick={readAll}>
          ✓ {t('article.readAll')}
        </button>
        <button
          className="icon-btn"
          title={t('article.prev')}
          disabled={!prevId}
          onClick={() => prevId && onSelect(prevId)}
        >
          ↑
        </button>
        <button
          className="icon-btn"
          title={t('article.next')}
          disabled={!nextId}
          onClick={() => nextId && onSelect(nextId)}
        >
          ↓
        </button>
        <button className="icon-btn" title={t('article.close')} onClick={onClose}>
          ✕
        </button>
      </div>

      {/* 正文 */}
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="py-16 text-center text-sm t-muted">{t('article.loading')}</div>}
        {!loading && article && (
          <article className="max-w-[720px] mx-auto px-6 py-8">
            <h1 className="text-2xl font-bold leading-snug t-text">
              {showTranslated ? (article.translated_title || article.title) : article.title}
            </h1>
            {/* P0-4：翻译模式下显示对照标题 */}
            {hasTranslation && showTranslated && article.translated_title && article.title !== article.translated_title && (
              <div className="mt-1.5 text-sm t-muted leading-relaxed italic">{article.title}</div>
            )}
            {/* 2026-09-05 视觉精修：正文头部 meta 行（源 · 发布时间 · 字数/阅读时长） */}
            <div className="meta mt-2">
              <span className="truncate">{article.source_name || article.author || ''}</span>
              <span className="sep">·</span>
              <span className="flex-none">{formatDateTime(article.published_at)}</span>
              {/* 17-translate：翻译来源徽章（诚实标记精翻/机翻） */}
              {hasTranslation && article.translation_provider && (
                <>
                  <span className="sep">·</span>
                  <span className="flex-none t-accent">
                    {article.translation_provider === 'agnes' ? (t('article.aiTranslated') || 'AI 精翻') : (t('article.machineTranslated') || '机翻')}
                  </span>
                </>
              )}
              {contentLen > 0 && (
                <>
                  <span className="sep">·</span>
                  <span className="flex-none">{formatWords(contentLen)}</span>
                  <span className="sep">·</span>
                  <span className="flex-none">{readingMinutes(contentLen)}</span>
                </>
              )}
            </div>
            <div
              ref={contentRef}
              className="article-content mt-6"
              dangerouslySetInnerHTML={{ __html: safeHtml(
                showTranslated
                  ? (article.translated_content || article.content_html || article.summary || '')
                  : (article.content_html || article.summary || '')
              ) }}
            />
            {/* P0-4：翻译/原文切换——快速切换按钮 */}
            {hasTranslation && article.translated_content && article.content_html && (
              <div className="mt-8 pt-4 border-t t-border">
                <button
                  className="text-xs t-accent hover:underline transition-colors"
                  onClick={() => setShowTranslated((v) => !v)}
                >
                  {showTranslated ? t('article.viewOriginal') : t('article.showTranslation')}
                </button>
              </div>
            )}
          </article>
        )}
        {!loading && !article && (
          <div className="py-16 text-center text-sm t-muted">{t('article.loadFailed')}</div>
        )}
      </div>
    </section>
  );
}
