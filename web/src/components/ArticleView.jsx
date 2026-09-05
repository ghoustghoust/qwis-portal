import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { copyText, formatDateTime } from '../util';

// 文章阅读栏（F5~F7）：完整渲染 content_html + 顶部工具条
export default function ArticleView({ articleId, items, filter, onSelect, onClose, onChanged }) {
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const contentRef = useRef(null);

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
        tip.textContent = '▶ 内嵌视频已失效（源站签名过期），点击打开原文观看 ↗';
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
      toast(later ? '已加入稍后阅读' : '已取消稍后阅读');
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
      toast('已全部标为已读');
      onChanged?.(true); // 全部已读需同时刷新列表
    } catch (e) {
      toast(e.message);
    }
  };

  if (!articleId) {
    return (
      <section className="flex-1 flex items-center justify-center t-muted text-sm t-bg">
        从左侧列表选择一篇文章开始阅读
      </section>
    );
  }

  const laterActive = !!(article && article.later);

  return (
    <section className="flex-1 flex flex-col h-full min-w-0 t-bg">
      {/* 顶部工具条（F5） */}
      <div className="flex items-center gap-1 px-4 h-12 flex-none border-b t-border t-surface">
        <button
          className="icon-btn"
          title={laterActive ? '取消稍后阅读' : '稍后阅读'}
          onClick={toggleLater}
          style={laterActive ? { color: 'var(--purple)' } : undefined}
        >
          {laterActive ? '♥' : '♡'}
        </button>
        <button
          className="icon-btn"
          title="打开原文"
          onClick={() => article?.url && window.open(article.url, '_blank', 'noopener')}
        >
          ↗
        </button>
        <div className="relative">
          <button className="icon-btn" title="更多" onClick={() => setMoreOpen((v) => !v)}>
            ⋯
          </button>
          {moreOpen && (
            <div className="absolute left-0 top-9 z-20 card p-1 w-32" onClick={() => setMoreOpen(false)}>
              <button
                className="w-full text-left px-3 py-1.5 text-xs rounded-md hover:bg-[var(--surface-2)] t-text"
                onClick={() => article?.url && copyText(article.url)}
              >
                复制链接
              </button>
              <button
                className="w-full text-left px-3 py-1.5 text-xs rounded-md hover:bg-[var(--surface-2)] t-text"
                onClick={() => article?.title && copyText(article.title)}
              >
                复制标题
              </button>
            </div>
          )}
        </div>
        <div className="flex-1" />
        <button className="btn-ghost !py-1 !px-2 text-xs" title="全部标为已读" onClick={readAll}>
          ✓ 全部已读
        </button>
        <button
          className="icon-btn"
          title="上一篇"
          disabled={!prevId}
          onClick={() => prevId && onSelect(prevId)}
        >
          ↑
        </button>
        <button
          className="icon-btn"
          title="下一篇"
          disabled={!nextId}
          onClick={() => nextId && onSelect(nextId)}
        >
          ↓
        </button>
        <button className="icon-btn" title="关闭" onClick={onClose}>
          ✕
        </button>
      </div>

      {/* 正文 */}
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="py-16 text-center text-sm t-muted">加载中…</div>}
        {!loading && article && (
          <article className="max-w-[720px] mx-auto px-6 py-8">
            <div className="text-xs t-muted">{article.source_name || article.author || ''}</div>
            <h1 className="mt-1 text-2xl font-bold leading-snug t-text">{article.title}</h1>
            <div className="mt-2 text-xs t-muted">
              发布于 {formatDateTime(article.published_at)}
            </div>
            <div
              ref={contentRef}
              className="article-content mt-6"
              dangerouslySetInnerHTML={{ __html: article.content_html || article.summary || '' }}
            />
          </article>
        )}
        {!loading && !article && (
          <div className="py-16 text-center text-sm t-muted">文章加载失败</div>
        )}
      </div>
    </section>
  );
}
