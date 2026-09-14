// 译文标题清洗（2026-09-14）：翻译管线产出的 translated_title 偶带「标题：」/「# 」前缀
// （模型把首行当标题时的标注残留），读层/写层统一剥掉，保持展示干净。
function cleanTranslatedTitle(t) {
  return String(t || '')
    .replace(/^\s*#{1,6}\s+/, '')        // markdown 标题符
    .replace(/^标题\s*[:：]\s*/, '')       // 「标题：」前缀
    .replace(/^\*\*(.+)\*\*$/, '$1')       // 整行加粗包裹
    .trim();
}

module.exports = { cleanTranslatedTitle };
