// 热点榜服务层（六期 F6/F7）：聚合源（sources.extra.aggregator=1）文章查询 + 分类映射 + 英文原文抓取缓存
// N3：分类归类为确定性规则（category 精确映射 + 标题关键词兜底），不调 AI
const { db, getSetting } = require('../db');

const PAGE_SIZE = 30;

// 六类清单（精选胶囊顺序）
const CATEGORIES = ['模型', '产品', '行业', '论文', '教程', '观点'];

// 默认分类映射：六类 → AIHOT feed <category> 列表（settings['hot.categories'] 可覆盖）
// 注：同时收录 plan 假定值（模型发布/产品更新 等）与线上实际值（AI 模型/AI 产品/技巧观点 等）
const DEFAULT_CATEGORY_MAP = {
  '模型': ['模型发布', '评测/基准', 'AI 模型'],
  '产品': ['产品更新', 'AI 产品'],
  '行业': ['行业动态'],
  '论文': ['论文'],
  '教程': ['教程/实践', '教程'],
  '观点': ['大佬观点', '现象/趋势', '技巧观点'],
};

function categoryMap() {
  const m = getSetting('hot.categories', null);
  return m && typeof m === 'object' && !Array.isArray(m) ? m : DEFAULT_CATEGORY_MAP;
}

// 标题关键词兜底（category 缺失或未命中映射时；顺序即优先级，前类更具体）
const KEYWORD_RULES = [
  ['论文', ['论文', 'paper', '研究称', '研究发现', '研究表明', '研究显示', '新研究']],
  ['教程', ['教程', '指南', '实战', '上手', '入门', '如何使用', '手把手', 'tutorial']],
  ['观点', ['观点', '访谈', '对话', '思考', '为什么', '怎么看', '万字', '深度好文']],
  ['行业', ['融资', '收购', '裁员', '估值', '上市', '监管', '政策', '投资', '股价', '市值', '营收']],
  ['模型', ['模型', '大模型', '开源', '评测', '基准', 'benchmark', 'gpt', 'claude', 'gemini', 'llama', 'deepseek', 'qwen', 'grok', 'sora']],
  ['产品', ['上线', '推出', '发布', '更新', '新增', '功能', '插件', '助手', 'app']],
];

// AIHOT category 精确映射 → 标题关键词兜底 → null（仅「全部」可见）
function mapCategory(category, title) {
  const cat = String(category || '').trim();
  if (cat) {
    for (const [cls, list] of Object.entries(categoryMap())) {
      if ((list || []).some((c) => String(c).trim() === cat)) return cls;
    }
  }
  const t = String(title || '').toLowerCase();
  for (const [cls, kws] of KEYWORD_RULES) {
    for (const kw of kws) {
      if (t.includes(String(kw).toLowerCase())) return cls;
    }
  }
  return null;
}

// author 形如 "noreply@aihot.virxact.com (公众号：卡尔的AI沃茨)" → 取括号内信源名
function feedNameOf(author) {
  const s = String(author || '').trim();
  const m = s.match(/\(([^()]*)\)\s*$/);
  return m ? m[1].trim() : s;
}

// GET /api/hot 查询：聚合源文章；category 应用层过滤（mapCategory 结果比对）；q 标题/正文搜索；
// source 按 author 精确筛选（七期 F3 来源下拉）；排序键游标与文章列表一致（sort_key|id 复合，时间倒序）
// 七期 F3/F4：返回富字段 score/reason/tags/featured/original_url/has_original
function query({ category, q, source, cursor } = {}) {
  const conds = ["json_extract(COALESCE(s.extra,'{}'),'$.aggregator')=1"];
  const args = [];
  if (q) {
    conds.push('(a.title LIKE ? OR a.content_html LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }
  if (source) {
    conds.push('a.author = ?');
    args.push(source);
  }
  const keyExpr = 'COALESCE(a.published_at, a.created_at)';
  const rows = db.prepare(`
    SELECT a.id, a.title, a.url, a.author, a.cover, a.summary, a.category AS rawCategory,
           a.score, a.reason, a.tags, a.featured, a.original_url,
           (a.original_html IS NOT NULL AND a.original_html != '') AS has_original,
           a.published_at, a.created_at, s.name AS source_name, ${keyExpr} AS sort_key
    FROM articles a JOIN sources s ON s.id=a.source_id
    WHERE ${conds.join(' AND ')}
    ORDER BY ${keyExpr} DESC, a.id DESC
  `).all(...args);
  let list = rows.map((r) => {
    let tags = [];
    try { tags = r.tags ? JSON.parse(r.tags) : []; } catch { tags = []; }
    return {
      ...r,
      tags,
      feedName: feedNameOf(r.author),
      hotCategory: mapCategory(r.rawCategory, r.title),
    };
  });
  if (category) list = list.filter((r) => r.hotCategory === category);
  if (cursor) {
    const sep = String(cursor).lastIndexOf('|');
    if (sep > 0) {
      const key = cursor.slice(0, sep);
      const id = Number(cursor.slice(sep + 1));
      list = list.filter((r) => r.sort_key < key || (r.sort_key === key && r.id < id));
    }
  }
  const hasMore = list.length > PAGE_SIZE;
  const page = list.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  const items = page.map(({ sort_key, ...rest }) => rest);
  return { items, nextCursor: hasMore && last ? `${last.sort_key}|${last.id}` : null };
}

// F7 英文原文缓存：进程内 Map，TTL 6h，容量 100（FIFO 逐出最旧），不落库
const originalCache = new Map(); // articleId -> {html, sourceUrl, at}
const CACHE_TTL = 6 * 3600e3;
const CACHE_MAX = 100;

// 从 content_html 提取「🔗 阅读原文」href → fetchFulltext（rss 适配器复用，走全局代理）→ 缓存返回
async function originalHtml(articleId) {
  const id = Number(articleId);
  const hit = originalCache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL) return { html: hit.html, sourceUrl: hit.sourceUrl };
  const row = db.prepare('SELECT id, content_html FROM articles WHERE id=?').get(id);
  if (!row) throw new Error('文章不存在');
  const m = String(row.content_html || '').match(/🔗[\s\S]{0,300}?<a[^>]+href="([^"]+)"/);
  if (!m) throw new Error('未找到原文链接');
  const sourceUrl = m[1].replace(/&amp;/g, '&');
  const full = await require('./collectors/rss').fetchFulltext(sourceUrl);
  if (!full || !full.content) throw new Error('原文提取失败');
  originalCache.set(id, { html: full.content, sourceUrl, at: Date.now() });
  if (originalCache.size > CACHE_MAX) {
    originalCache.delete(originalCache.keys().next().value); // 逐出最旧一条
  }
  return { html: full.content, sourceUrl };
}

// 七期 F3：聚合源下 author 聚合计数（来源筛选下拉数据）
function sources() {
  const rows = db.prepare(`
    SELECT a.author, COUNT(*) AS count
    FROM articles a JOIN sources s ON s.id=a.source_id
    WHERE json_extract(COALESCE(s.extra,'{}'),'$.aggregator')=1
    GROUP BY a.author ORDER BY count DESC
  `).all();
  return rows.map((r) => ({ author: r.author, feedName: feedNameOf(r.author), count: r.count }));
}

module.exports = { CATEGORIES, DEFAULT_CATEGORY_MAP, categoryMap, mapCategory, feedNameOf, query, sources, originalHtml };
