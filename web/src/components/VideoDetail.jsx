import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { formatDateTime, imgUrl } from '../util';
import SourceAvatar from './ui/SourceAvatar.jsx'; // 2026-09-05 视觉精修

// 播客详情视图（2026-09-14：播客并入视频板块后的点击落点；图片+声音播放器）
function PodcastDetail({ articleId, onBack }) {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get(`/api/articles/${articleId}`)
      .then((d) => { if (!cancelled) setItem(d?.item || d?.article || d); })
      .catch((e) => toast(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [articleId]);
  return (
    <section className="flex-1 flex flex-col h-full min-w-0 t-bg">
      <div className="px-5 h-12 flex items-center flex-none border-b t-border t-surface">
        <button className="btn-ghost !py-1 !px-2.5 text-xs inline-flex items-center gap-1" onClick={onBack}>
          ← 返回视频列表
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[720px] mx-auto px-6 py-6">
          {loading && <div className="py-10 text-center text-sm t-muted">加载中…</div>}
          {item && (
            <>
              <span className="badge-green">🎧 播客</span>
              <h1 className="mt-3 text-xl font-bold leading-snug t-text">{item.translated_title || item.title}</h1>
              {item.translated_title && item.title !== item.translated_title && (
                <div className="mt-1 text-[12px] t-muted">{item.title}</div>
              )}
              <div className="meta mt-2">
                <SourceAvatar name={item.source_name || item.author} avatar={item.source_avatar} size={18} />
                <span className="t-text truncate">{item.source_name || item.author || ''}</span>
                <span className="sep">·</span>
                <span className="flex-none">{formatDateTime(item.published_at)}</span>
              </div>
              {/* 图片+声音播放器 */}
              <div className="mt-5 rounded-xl border t-border p-4 flex items-center gap-4">
                {(item.cover || item.source_avatar) ? (
                  <img
                    src={imgUrl(item.cover || item.source_avatar)}
                    alt=""
                    className="w-20 h-20 rounded-lg object-cover flex-none"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : (
                  <span className="w-20 h-20 rounded-lg t-accent-soft flex-none flex items-center justify-center text-3xl">🎧</span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] t-muted mb-1.5">点击播放</div>
                  <audio controls preload="none" src={item.audio_url} className="w-full h-10" />
                </div>
              </div>
              {item.summary && (
                <p className="mt-4 text-[13px] leading-relaxed t-muted whitespace-pre-wrap">{item.summary}</p>
              )}
              <div className="mt-6 border-t t-border pt-4">
                <button
                  className="btn-primary"
                  onClick={() => item.url && window.open(item.url, '_blank', 'noopener')}
                >
                  打开原始页面 ↗
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// 视频详情页（F9）：HTML5 播放器（默认 direct 直链，可切官方 embed）+ 收藏/原平台打开
export default function VideoDetail({ videoId, onBack, onChanged }) {
  // 播客分流（id 'a<数字>' 前缀 = articles 表的播客单集）
  if (typeof videoId === 'string' && /^a\d+$/.test(videoId)) {
    return <PodcastDetail articleId={Number(videoId.slice(1))} onBack={onBack} />;
  }
  return <VideoDetailInner videoId={videoId} onBack={onBack} onChanged={onChanged} />;
}

function VideoDetailInner({ videoId, onBack, onChanged }) {
  const [video, setVideo] = useState(null);
  const [play, setPlay] = useState(null); // { mode, url }
  const [loading, setLoading] = useState(false);
  const [playError, setPlayError] = useState('');

  const loadPlay = useCallback(
    async (mode) => {
      setPlayError('');
      try {
        const data = await api.get(`/api/videos/${videoId}/play?mode=${mode}`);
        const url = data?.url || data?.play_url || data?.embed_url;
        setPlay({ mode: data?.mode || mode, url, embedUrl: data?.embed_url });
        if (!url) setPlayError('未获取到播放地址，可切回官方播放器');
      } catch (e) {
        setPlay(null);
        setPlayError(e.message);
      }
    },
    [videoId]
  );

  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    setLoading(true);
    setVideo(null);
    api
      .get(`/api/videos/${videoId}`)
      .then((data) => {
        if (!cancelled) setVideo(data?.item || data?.video || data);
      })
      .catch((e) => toast(e.message))
      .finally(() => !cancelled && setLoading(false));
    loadPlay('direct'); // 默认本机直链（F9）
    return () => {
      cancelled = true;
    };
  }, [videoId, loadPlay]);

  const toggleFavorite = async () => {
    try {
      const data = await api.post(`/api/videos/${videoId}/favorite`);
      const fav = data?.favorite ?? data?.video?.favorite ?? (video?.favorite ? 0 : 1);
      setVideo((v) => (v ? { ...v, favorite: fav } : v));
      toast(fav ? '已收藏' : '已取消收藏');
      onChanged?.();
    } catch (e) {
      toast(e.message);
    }
  };

  const usingOfficial = play?.mode === 'official';
  const isExternal = play?.mode === 'external'; // douyin 等无 iframe embed 的平台
  const favActive = !!(video && video.favorite);

  return (
    <section className="flex-1 flex flex-col h-full min-w-0 t-bg">
      <div className="px-5 h-12 flex items-center flex-none border-b t-border t-surface">
        <button className="btn-ghost !py-1 !px-2.5 text-xs inline-flex items-center gap-1" onClick={onBack}>
          ← 返回视频列表
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[900px] mx-auto px-6 py-5">
          {/* 播放器 */}
          <div className="rounded-xl overflow-hidden border t-border bg-black aspect-video flex items-center justify-center">
            {isExternal ? (
              <div className="text-center px-6">
                {video?.cover && (
                  <img referrerPolicy="no-referrer" src={imgUrl(video.cover)} alt="" className="mx-auto mb-3 max-h-40 rounded-lg object-cover opacity-70" />
                )}
                <div className="text-sm text-neutral-300 mb-3">该平台暂不支持内嵌播放</div>
                <button
                  className="btn-primary"
                  onClick={() => play?.url && window.open(play.url, '_blank', 'noopener')}
                >
                  在原平台打开 ↗
                </button>
              </div>
            ) : play?.url && !usingOfficial ? (
              <video key={play.url} src={play.url} controls className="w-full h-full" />
            ) : usingOfficial && (play?.embedUrl || play?.url) ? (
              <iframe
                key={play.embedUrl || play.url}
                src={play.embedUrl || play.url}
                className="w-full h-full"
                allowFullScreen
                title="官方播放器"
              />
            ) : (
              <div className="text-sm text-neutral-400 px-6 text-center">
                {playError || '正在获取播放地址…'}
              </div>
            )}
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs t-muted">
            {!usingOfficial && !isExternal && !playError && play?.url && <span>已使用本机播放链路解析播放地址</span>}
            {playError && <span style={{ color: 'var(--red)' }}>{playError}</span>}
            {video?.platform === 'bilibili' && (
              <button
                className="t-purple hover:underline"
                onClick={() => loadPlay(usingOfficial ? 'direct' : 'official')}
              >
                {usingOfficial ? '改用本机直链播放' : '切回官方播放器'}
              </button>
            )}
          </div>

          {loading && <div className="py-10 text-center text-sm t-muted">加载中…</div>}
          {video && (
            <>
              {/* 2026-09-05 视觉精修：标题 + meta 行（UP 主 · 发布时间），用 .meta token 统一字号/间距 */}
              <h1 className="mt-5 text-xl font-bold leading-snug t-text">{video.title}</h1>
              <div className="meta mt-2">
                <SourceAvatar name={video.author || video.source_name} avatar={video.avatar || video.source_avatar} size={20} />
                <span className="t-text truncate">{video.author || video.source_name || ''}</span>
                <span className="sep">·</span>
                <span className="flex-none">{formatDateTime(video.published_at)}</span>
              </div>
              {video.intro && (
                <p className="mt-4 text-[13px] leading-relaxed t-muted whitespace-pre-wrap">
                  {video.intro}
                </p>
              )}
              <div className="mt-6 flex items-center gap-3 border-t t-border pt-4">
                <button
                  className="btn-ghost"
                  onClick={toggleFavorite}
                  style={favActive ? { color: 'var(--purple)', borderColor: 'var(--purple)' } : undefined}
                >
                  {favActive ? '★ 已收藏' : '☆ 收藏'}
                </button>
                <button
                  className="btn-primary"
                  onClick={() => video.url && window.open(video.url, '_blank', 'noopener')}
                >
                  在原平台打开 ↗
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
