// 自动分类（14-sources-write，serverless 移植自 server/services/classify.js）
// 差异：去掉 OPML 层级解析（云端无 OPML 文件上下文），仅关键词路径；DB 走 Turso
// ⚠️ 与本地 classify.js 是双实现，改分类目录/关键词必须两边同步（三端同步规则）
const { createClient } = require('@libsql/client');

let _db = null;
function getDb() {
  if (!_db) {
    _db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return _db;
}
async function qAll(sql, args = []) { return Array.from((await getDb().execute({ sql, args })).rows); }
async function qOne(sql, args = []) { return (await qAll(sql, args))[0]; }

const VIDEO_TYPES = ['bilibili', 'douyin', 'youtube'];
function kindOfType(type) { return VIDEO_TYPES.includes(type) ? 'video' : 'article'; }

// ── 内置分类目录（数组顺序即优先级——与本地 classify.js 逐字对齐） ──
const CATEGORY_CATALOG = [
  { key: 'programming', zh: '编程技术', aliases: ['Programming & Technology', '编程技术'],
    keywords: ['技术', '开发', '编程', '前端', '后端', '开源', 'dev', 'engineer', 'github'] },
  { key: 'ai', zh: '人工智能', aliases: ['Artificial Intelligence', '人工智能', 'AI'],
    keywords: ['ai', '人工智能', '大模型', 'llm', 'gpt', '深度学习', '机器学习', '智能'] },
  { key: 'business', zh: '商业科技', aliases: ['Business & Technology', '商业科技 Business & Tech', '商业访谈'],
    keywords: ['商业', '创业', '科技', '创投', '融资', '财经', '公司'] },
  { key: 'finance', zh: '金融经济', aliases: ['Finance & Economy', '金融经济'],
    keywords: ['金融', '经济', '投资', '股票', '基金', 'macro'] },
  { key: 'product', zh: '产品', aliases: ['Product Development', '产品'],
    keywords: ['产品', '产品经理', '设计', 'ux', '交互'] },
  { key: 'growth', zh: '效率成长', aliases: ['Productivity & Growth', '个人成长', '效率成长'],
    keywords: ['效率', '成长', '学习', '阅读', '写作', '自律'] },
  { key: 'news', zh: '新闻媒体', aliases: ['News & Media', '新闻媒体'],
    keywords: ['新闻', '资讯', '日报', '早报', '晚报', '媒体'] },
  { key: 'life', zh: '生活方式与文化', aliases: ['Lifestyle & Culture', '生活方式与文化'],
    keywords: ['生活', '文化', '艺术', '旅行', '美食', '书'] },
];

const DEFAULT_FAMILIAR = ['AI', '科技', '科技热榜', '国际科技', 'AI 模型', 'AI 产品', '技巧观点', '行业动态', '公众号', '播客', 'YouTube'];

function normalizeName(s) { return String(s || '').trim().toLowerCase(); }

function matchByKeyword(text) {
  const t = normalizeName(text);
  if (!t) return null;
  for (const cat of CATEGORY_CATALOG) {
    for (const kw of cat.keywords) {
      if (t.includes(kw.toLowerCase())) return cat;
    }
  }
  return null;
}

// 纯函数：返回 {key, zh, reason} 或 null
function classifySource(source) {
  const { name, description } = source;
  const hit = matchByKeyword((name || '') + ' ' + (description || ''));
  if (hit) return { key: hit.key, zh: hit.zh, reason: 'keyword' };
  return null;
}

async function getSetting(key, def = null) {
  const row = await qOne('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return def;
  try { return JSON.parse(row.value); } catch { return row.value ?? def; }
}
async function setSetting(key, val) {
  await getDb().execute({
    sql: 'INSERT OR REPLACE INTO settings(key, value) VALUES(?, ?)',
    args: [key, typeof val === 'string' ? val : JSON.stringify(val)],
  });
}

// 落组：精确同名同 kind 复用，否则新建
async function getOrCreateGroupId(zh, kind) {
  const norm = normalizeName(zh);
  const existing = await qAll('SELECT id, name FROM groups WHERE kind=? ORDER BY id', [kind]);
  for (const g of existing) {
    if (normalizeName(g.name) === norm) return g.id;
  }
  const maxSort = (await qOne('SELECT COALESCE(MAX(sort),0) m FROM groups')).m;
  const r = await getDb().execute({
    sql: 'INSERT INTO groups(kind, name, sort) VALUES(?,?,?)', args: [kind, zh, maxSort + 1],
  });
  return Number(r.lastInsertRowid);
}

// 破茧栏名单并入
async function mergeCocoonFamiliar(zh) {
  let arr = await getSetting('daily.cocoonFamiliar', null);
  if (!Array.isArray(arr)) arr = [...DEFAULT_FAMILIAR];
  if (!arr.includes(zh)) {
    arr.push(zh);
    await setSetting('daily.cocoonFamiliar', arr);
  }
}

// 单源自动分类（新源挂接点，失败降级不阻断）
async function autoClassifySourceId(id) {
  try {
    const source = await qOne('SELECT * FROM sources WHERE id=?', [id]);
    if (!source) return false;
    const result = classifySource(source);
    if (!result) return false;
    const kind = kindOfType(source.type);
    const groupId = await getOrCreateGroupId(result.zh, kind);
    await getDb().execute({ sql: 'UPDATE sources SET group_id=? WHERE id=?', args: [groupId, id] });
    await mergeCocoonFamiliar(result.zh);
    return true;
  } catch (err) {
    console.log(`[classify] 自动分类失败(sourceId=${id}): ${err.message}`);
    return false;
  }
}

// 存量预览（不落库）。分组一次性预载，避免 638 源 × 逐次查库的 N+1 网络往返（Vercel 10s 限制）
async function previewReclassify({ includeLocked = false, showAll = false } = {}) {
  const sources = await qAll('SELECT * FROM sources ORDER BY id');
  const groupRows = await qAll('SELECT id, name FROM groups');
  const groupMap = new Map(groupRows.map((g) => [g.id, g]));
  const items = [];
  let skippedLocked = 0;
  let noSuggestion = 0;
  for (const s of sources) {
    let extra = {};
    try { extra = JSON.parse(s.extra || '{}'); } catch { /* ignore */ }
    if (extra.categoryLocked && !includeLocked) { skippedLocked++; continue; }
    const result = classifySource(s);
    const currentGroup = s.group_id ? groupMap.get(s.group_id) : null;
    const item = {
      id: s.id, name: s.name,
      currentGroupId: currentGroup ? currentGroup.id : null,
      currentGroup: currentGroup ? currentGroup.name : null,
      suggestedKey: result ? result.key : null,
      suggested: result ? result.zh : null,
      reason: result ? result.reason : null,
      locked: !!extra.categoryLocked,
    };
    if (!result) { noSuggestion++; if (!showAll) continue; }
    if (showAll) {
      items.push(item);
    } else {
      const currentName = currentGroup ? normalizeName(currentGroup.name) : null;
      const suggestedName = result ? normalizeName(result.zh) : null;
      if (currentName !== suggestedName) items.push(item);
    }
  }
  return { items, total: sources.length, changed: items.length, skippedLocked, noSuggestion };
}

// 存量执行（跳过锁定源）
async function applyReclassify(ids) {
  let applied = 0, skippedLocked = 0;
  const groupsCreated = new Set();
  for (const id of ids) {
    const source = await qOne('SELECT * FROM sources WHERE id=?', [id]);
    if (!source) continue;
    let extra = {};
    try { extra = JSON.parse(source.extra || '{}'); } catch { /* ignore */ }
    if (extra.categoryLocked) { skippedLocked++; continue; }
    const result = classifySource(source);
    if (!result) continue;
    const kind = kindOfType(source.type);
    const groupId = await getOrCreateGroupId(result.zh, kind);
    await getDb().execute({ sql: 'UPDATE sources SET group_id=? WHERE id=?', args: [groupId, id] });
    await mergeCocoonFamiliar(result.zh);
    groupsCreated.add(result.zh);
    applied++;
  }
  return { applied, skippedLocked, groupsCreated: [...groupsCreated] };
}

module.exports = {
  VIDEO_TYPES, kindOfType, CATEGORY_CATALOG, normalizeName, matchByKeyword,
  classifySource, getOrCreateGroupId, autoClassifySourceId, previewReclassify, applyReclassify,
};
