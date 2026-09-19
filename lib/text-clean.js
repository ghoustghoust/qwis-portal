// 译文标题清洗（2026-09-14）：翻译管线产出的 translated_title 偶带「标题：」/「# 」前缀
// （模型把首行当标题时的标注残留），读层/写层统一剥掉，保持展示干净。
function cleanTranslatedTitle(t) {
  return String(t || '')
    .replace(/^\s*#{1,6}\s+/, '')        // markdown 标题符
    .replace(/^标题\s*[:：]\s*/, '')       // 「标题：」前缀
    .replace(/^\*\*(.+)\*\*$/, '$1')       // 整行加粗包裹
    .trim();
}

// XML/HTML 实体解码（B94，2026-09-20）：全库唯一实现。
// 只解码**一次**：库里确有两行是上游双重转义（`Oragekk&amp;apos;s Blog`），
// 解两次会把"字面写着 &amp;apos; 的标题"也改掉——那是数据订正该做的事（生产写，等授权），不是采集层的活。
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  mdash: '—', ndash: '–', hellip: '…', middot: '·', bull: '•',
};

// 输入任意值（null/数字都安全）；数字实体支持十进制 &#39; 与十六进制 &#x27;。
function decodeXmlEntities(s) {
  if (s === null || s === undefined) return s;
  return String(s).replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]{2,6})|([a-zA-Z]{2,8}));/g, (m, dec, hex, name) => {
    if (dec) { const cp = Number(dec); return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m; }
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    const k = name.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED, k) ? NAMED[k] : m; // 不认识的实体原样留着，别猜
  });
}

// 采集侧的标题/源名统一清洗（B94）：解码实体再去空白。
// 只做标题类字段是有意的：summary/content_html 里 `&lt;b&gt;` 这类"被转义的标签"是内容本身，
// 解码后会被前端 RichText 的"像不像 HTML"判据误判成 HTML 分支（等于把转义文本当标签解析）。
function cleanTitle(t) {
  return String(decodeXmlEntities(t) ?? '').trim(); // decodeXmlEntities 对 null 原样返回，这里必须兜住（否则变字符串 'null'）
}

module.exports = { cleanTranslatedTitle, decodeXmlEntities, cleanTitle };
