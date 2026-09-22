// B18：六维评分回写的唯一实现（文章 → articles.score；'v'+id 前缀的视频条目 → videos.score）。
// 此前 `persistScores` 只认 number id —— 视频条目整批被跳过 = 深析打了分却永远不落库（B18 本体）。
'use strict';

async function persistScores(analyzed, qRun) {
  const rows = (analyzed || []).filter((a) => typeof a.id === 'number' && Number.isFinite(a.totalScore));
  for (const a of rows) {
    await qRun('UPDATE articles SET score=?, reason=? WHERE id=?', [Math.round(a.totalScore), a.reason || null, a.id]);
  }
  const vids = (analyzed || []).filter((a) => typeof a.id === 'string' && a.id.startsWith('v') && Number.isFinite(a.totalScore));
  for (const a of vids) {
    await qRun('UPDATE videos SET score=? WHERE id=?', [Math.round(a.totalScore), Number(a.id.slice(1))]);
  }
  return rows.length + vids.length;
}

module.exports = { persistScores };
