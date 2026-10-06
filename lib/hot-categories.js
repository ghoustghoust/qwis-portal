// 热点榜六类与「六类 → AIHOT feed <category>」映射的唯一实现（B58，2026-09-19）
//
// 为什么又要抽一份：这个映射此前有三份——本地服务层的 DEFAULT_CATEGORY_MAP、
// 前端 HotSettings 的 DEFAULT_MAP、以及线上 settings['hot.categories']。
// 加上云端 GET /api/hot/categories 只返回 {categories:[...]} 把读到的映射丢了，
// 前端 `if (d?.map)` 永不成立 → 表格 6 行里 4 行显示的是过时的前端默认值，
// 而 .catch(() => {}) 让整件事完全静默。用户看到的"分类规则"是假的。
//
// 约定（AGENTS §1）：默认值与"如何由 settings 求出生效值"只在这里写一次，
// 本地服务层与云端读层都从这里取；前端不再自带默认表，只渲染接口回传的 map 并标明来源。
const CATEGORIES = ['模型', '产品', '行业', '论文', '教程', '观点'];

// 同时收录规则假定值与线上实际 feed 名（AIHOT 的 <category> 取值历史上不一致，
// 少收一个就等于那一类条目永远归不进类）。线上生效值以 settings['hot.categories'] 为准。
const DEFAULT_CATEGORY_MAP = {
  模型: ['模型发布', '评测/基准', 'AI 模型'],
  产品: ['产品更新', 'AI 产品'],
  行业: ['行业动态'],
  论文: ['论文', '论文/研究'],
  教程: ['教程/实践', '教程'],
  观点: ['大佬观点', '现象/趋势', '技巧观点'],
};

// settings 里可能是坏值（数组 / null / 字符串），一律退回默认并说明来源
function categoryMapOf(value) {
  const ok = value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length;
  return { map: ok ? value : DEFAULT_CATEGORY_MAP, source: ok ? 'settings' : 'default' };
}

// H49①（用户拍 G1）：分类→**过滤关键词**映射（匹配文章 标题/摘要/tags 的 LIKE 词组）。
// 注意它与上面 DEFAULT_CATEGORY_MAP 是两个维度：那份是"分类 → AIHOT feed <category> 名"（入库归类），
// 这份是"分类 → 文章关键词"（读层过滤）——此前云端 handleHot 里内联一份第三副本，settings 改不动它。
// 现在单一实现在此，settings['hot.categoryKeywords']（同名形状）可整表覆盖，坏值退默认并标来源。
const DEFAULT_FILTER_KWS = {
  '模型': ['模型'],
  '产品': ['产品'],
  '行业': ['行业', '现象/趋势', '产业', '市场'],
  '论文': ['论文', '研究', 'arXiv'],
  '教程': ['教程', '实战', '指南', '入门', '手把手'],
  '观点': ['观点', '思考', '评论', '观察'],
};

function filterKwsOf(value) {
  const ok = value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length;
  return { map: ok ? value : DEFAULT_FILTER_KWS, source: ok ? 'settings' : 'default' };
}

module.exports = { CATEGORIES, DEFAULT_CATEGORY_MAP, categoryMapOf, DEFAULT_FILTER_KWS, filterKwsOf };
