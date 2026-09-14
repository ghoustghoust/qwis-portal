// 媒体识别（2026-09-14：播客音频支持）
// 背景：播客源（小宇宙等）的 RSS enclosure 是音频文件，采集端历史上把 enclosure.url 落进了 articles.cover，
// 导致播客单集以「封面=音频文件」的形态混在文章流里（封面破图、无法播放）。
// 口径：cover 命中音频特征 → audio_url=cover、cover=null（由源头像/正文图兜底展示）。
// 消费方：api/[...slug].js（云端读层）与 server/routes（本地）共用，勿分叉。
const AUDIO_EXT_RE = /\.(m4a|mp3|aac|ogg|oga|flac|wav|opus)(\?|#|$)/i;
const AUDIO_HOST_RE = /(^|\.)(xyzcdn\.net|podcast\.co|libsyn\.com|megaphone\.fm|simplecast\.com|buzzsprout\.com|transistor\.fm|captivate\.fm|spreaker\.com|podtrac\.com|acast\.com)$/i;

function detectAudioUrl(url) {
  const u = String(url || '');
  if (!u) return false;
  if (AUDIO_EXT_RE.test(u)) return true;
  try {
    const h = new URL(u).hostname;
    if (AUDIO_HOST_RE.test(h) && !/\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i.test(u)) return true;
  } catch { /* 原样 */ }
  return false;
}

// 行映射：识别 cover 里的音频 → audio_url/cover 归位。原行不被修改（返回新对象）
function mapAudioFields(row) {
  if (!row || !row.cover) return row;
  if (!detectAudioUrl(row.cover)) return row;
  return { ...row, audio_url: row.cover, cover: null };
}

module.exports = { detectAudioUrl, mapAudioFields };
