// 标题分词 + 相似度纯函数（重构 Phase 1 提取）
// 职责：标题归一化、token 集合生成、Jaccard 相似度
// 从 daily.js 提取，消除 events.js → daily.js 的反向依赖
// 纯函数，无外部依赖

// 标题归一化（F5 去重用）：小写 → 去开头数字日期前缀 → 去标点符号
function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/^(\d{4}[-/年])?\d{1,2}[-/月]\d{1,2}[日号]?[\s:：,，.、-]*/, '')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// token 集合：拉丁/数字整词 + CJK 二元组（单字段取单字）
function titleTokens(title) {
  const t = normalizeTitle(title);
  const tokens = new Set();
  for (const m of t.matchAll(/[a-z0-9]+/g)) tokens.add(m[0]);
  for (const m of t.matchAll(/[一-鿿]+/g)) {
    const s = m[0];
    if (s.length === 1) tokens.add(s);
    else for (let i = 0; i < s.length - 1; i++) tokens.add(s.slice(i, i + 2));
  }
  return tokens;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

module.exports = { normalizeTitle, titleTokens, jaccard };
