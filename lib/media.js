// 媒体识别（2026-09-14：播客音频支持）
// 背景：播客源（小宇宙等）的 RSS enclosure 是音频文件，采集端历史上把 enclosure.url 落进了 articles.cover，
// 导致播客单集以「封面=音频文件」的形态混在文章流里（封面破图、无法播放）。
// 口径：cover 命中音频特征 → audio_url=cover、cover=null（显示层用 source_avatar 源头像兜底，无头像再退首字块）。
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

const AUDIO_EXTS = ['m4a', 'mp3', 'aac', 'ogg', 'oga', 'flac', 'wav', 'opus'];
const AUDIO_HOSTS = ['xyzcdn.net', 'podcast.co', 'libsyn.com', 'megaphone.fm', 'simplecast.com',
  'buzzsprout.com', 'transistor.fm', 'captivate.fm', 'spreaker.com', 'podtrac.com', 'acast.com'];
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'];

// detectAudioUrl 的 SQL 镜像：给「按封面把播客单集筛出来」这类列表/计数过滤用（B60/播客口径）。
// 与 JS 版不可能逐字符等价（SQL LIKE 判断不了 hostname 结尾），所以有 tests/regression-20260919c
// 的 JS↔SQL 一致性锁：两边对同一批样本 URL 的判定必须一致，改了任一边就会红。
function audioCoverSql(col = 'cover') {
  const ext = AUDIO_EXTS.map((e) => `${col} LIKE '%.${e}%'`);
  const host = AUDIO_HOSTS.map((h) => `${col} LIKE '%://${h}%' OR ${col} LIKE '%.${h}%'`);
  const notImage = IMAGE_EXTS.map((e) => `${col} NOT LIKE '%.${e}'`);
  return `(${[...ext, `((${host.join(' OR ')}) AND ${notImage.join(' AND ')})`].join(' OR ')})`;
}

module.exports = { detectAudioUrl, mapAudioFields, audioCoverSql, AUDIO_EXTS, AUDIO_HOSTS };
