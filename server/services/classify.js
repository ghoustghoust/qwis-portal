// 自动分类服务：分类目录 / 关键词匹配 / OPML 层级解析 / 落组 / 单源自动分类 / 存量预览&执行
// 纯逻辑 + DB 操作，无 HTTP 依赖，可独立单测
const fs = require('fs');
const path = require('path');
const { db, getSetting, setSetting } = require('../db');
const log = require('../util/log');

// ── 视频类型集合（唯一定义点，sources.js 改引此处） ──
const VIDEO_TYPES = ['bilibili', 'douyin', 'youtube'];

function kindOfType(type) {
  return VIDEO_TYPES.includes(type) ? 'video' : 'article';
}

// ── 内置分类目录（数组顺序即优先级，前面的更具体优先命中） ──
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

// 破茧栏默认域内分组名（daily.js 复用）
const DEFAULT_FAMILIAR = ['AI', '科技', '科技热榜', '国际科技', 'AI 模型', 'AI 产品', '技巧观点', '行业动态', '公众号', '播客', 'YouTube'];

// ── 工具函数 ──
function normalizeName(s) {
  return String(s || '').trim().toLowerCase();
}

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

function categoryFromOpml(catName) {
  if (!catName) return null;
  const norm = normalizeName(catName);
  for (const cat of CATEGORY_CATALOG) {
    for (const alias of cat.aliases) {
      if (normalizeName(alias) === norm) return cat;
    }
  }
  return null;
}

// ── classifySource：纯函数，返回 {key, zh, reason} 或 null ──
function classifySource(source, opmlMap) {
  const { name, type, url, description } = source;
  // 1. OPML 原生分类（经 aliases 归一）
  if (opmlMap && url) {
    const opmlCat = opmlMap.get(url);
    if (opmlCat) {
      const cat = categoryFromOpml(opmlCat);
      if (cat) return { key: cat.key, zh: cat.zh, reason: 'opml' };
    }
  }
  // 2. 关键词匹配（name + description）
  const hit = matchByKeyword((name || '') + ' ' + (description || ''));
  if (hit) return { key: hit.key, zh: hit.zh, reason: 'keyword' };
  // 3. 均未命中 → 保持未分组
  return null;
}

// ── 落组：精确同名同 kind 复用，否则新建 ──
function getOrCreateGroupId(zh, kind) {
  const norm = normalizeName(zh);
  const existing = db.prepare('SELECT id, name FROM groups WHERE kind=? ORDER BY id').all(kind);
  for (const g of existing) {
    if (normalizeName(g.name) === norm) return g.id;
  }
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort),0) m FROM groups').get().m;
  const r = db.prepare('INSERT INTO groups(kind, name, sort) VALUES(?,?,?)').run(kind, zh, maxSort + 1);
  return r.lastInsertRowid;
}

// ── 破茧栏名单并入 ──
function mergeCocoonFamiliar(zh) {
  let arr;
  try {
    const raw = getSetting('daily.cocoonFamiliar');
    arr = raw ? JSON.parse(raw) : [...DEFAULT_FAMILIAR];
  } catch { arr = [...DEFAULT_FAMILIAR]; }
  if (!Array.isArray(arr)) arr = [...DEFAULT_FAMILIAR];
  if (!arr.includes(zh)) {
    arr.push(zh);
    setSetting('daily.cocoonFamiliar', JSON.stringify(arr));
  }
}

// ── OPML 层级解析：Map<xmlUrl, 分类原名> ──
let _opmlCache = null;
function buildOpmlCategoryMap() {
  if (_opmlCache) return _opmlCache;
  const map = new Map();
  const opmlDir = path.join(__dirname, '..', '..', 'opml');
  if (!fs.existsSync(opmlDir)) return map;
  const files = fs.readdirSync(opmlDir).filter((f) => f.endsWith('.opml'));
  for (const file of files) {
    const xml = fs.readFileSync(path.join(opmlDir, file), 'utf8');
    // 逐行解析 outline 标签，跟踪当前父分类
    const lines = xml.split(/\r?\n/);
    let currentCategory = null;
    for (const line of lines) {
      const hasXmlUrl = /xmlUrl\s*=/.test(line);
      const textMatch = line.match(/text\s*=\s*"([^"]*)"/);
      const xmlUrlMatch = line.match(/xmlUrl\s*=\s*"([^"]*)"/);
      if (hasXmlUrl && xmlUrlMatch) {
        // 有 xmlUrl → 叶子节点，继承当前分类
        if (currentCategory) {
          map.set(xmlUrlMatch[1], currentCategory);
        }
      } else if (textMatch && !hasXmlUrl) {
        // 无 xmlUrl → 分组节点，更新当前分类
        currentCategory = textMatch[1];
      }
    }
  }
  _opmlCache = map;
  return map;
}

// ── 单源自动分类（供三个挂接点调用） ──
function autoClassifySourceId(id) {
  try {
    const source = db.prepare('SELECT * FROM sources WHERE id=?').get(id);
    if (!source) return false;
    const opmlMap = buildOpmlCategoryMap();
    const result = classifySource(source, opmlMap);
    if (!result) return false;
    const kind = kindOfType(source.type);
    const groupId = getOrCreateGroupId(result.zh, kind);
    db.prepare('UPDATE sources SET group_id=? WHERE id=?').run(groupId, id);
    mergeCocoonFamiliar(result.zh);
    return true;
  } catch (err) {
    log.warn(`自动分类失败(sourceId=${id}):`, err.message);
    return false;
  }
}

// ── 存量预览 ──
function previewReclassify({ includeLocked = false, showAll = false } = {}) {
  const opmlMap = buildOpmlCategoryMap();
  const sources = db.prepare('SELECT * FROM sources ORDER BY id').all();
  const items = [];
  let skippedLocked = 0;
  let noSuggestion = 0;
  for (const s of sources) {
    // 检查锁定
    let extra = {};
    try { extra = JSON.parse(s.extra || '{}'); } catch { /* ignore */ }
    if (extra.categoryLocked && !includeLocked) { skippedLocked++; continue; }
    const result = classifySource(s, opmlMap);
    const currentGroup = s.group_id ? db.prepare('SELECT id, name FROM groups WHERE id=?').get(s.group_id) : null;
    const currentGroupId = currentGroup ? currentGroup.id : null;
    const currentGroup_ = currentGroup ? currentGroup.name : null;
    const suggestedKey = result ? result.key : null;
    const suggested = result ? result.zh : null;
    const reason = result ? result.reason : null;
    const item = { id: s.id, name: s.name, currentGroupId, currentGroup: currentGroup_, suggestedKey, suggested, reason, locked: !!extra.categoryLocked };
    // P2-1 修复(2026-09-05 验收):无建议(suggested=null)的条目无法落组,apply 时必被跳过,
    // 若计入变更清单会让用户误以为「取消归组」将发生——默认模式下不计入,单独计数供前端展示
    if (!result) { noSuggestion++; if (!showAll) continue; }
    if (showAll) {
      items.push(item);
    } else {
      // 只返回「建议≠当前」的条目
      const currentName = currentGroup_ ? normalizeName(currentGroup_) : null;
      const suggestedName = suggested ? normalizeName(suggested) : null;
      if (currentName !== suggestedName) items.push(item);
    }
  }
  return { items, total: sources.length, changed: items.length, skippedLocked, noSuggestion };
}

// ── 存量执行 ──
function applyReclassify(ids) {
  const opmlMap = buildOpmlCategoryMap();
  let applied = 0, skippedLocked = 0;
  const groupsCreated = new Set();
  for (const id of ids) {
    const source = db.prepare('SELECT * FROM sources WHERE id=?').get(id);
    if (!source) continue;
    let extra = {};
    try { extra = JSON.parse(source.extra || '{}'); } catch { /* ignore */ }
    if (extra.categoryLocked) { skippedLocked++; continue; }
    const result = classifySource(source, opmlMap);
    if (!result) continue;
    const kind = kindOfType(source.type);
    const groupId = getOrCreateGroupId(result.zh, kind);
    db.prepare('UPDATE sources SET group_id=? WHERE id=?').run(groupId, id);
    mergeCocoonFamiliar(result.zh);
    groupsCreated.add(result.zh);
    applied++;
  }
  return { applied, skippedLocked, groupsCreated: [...groupsCreated] };
}

module.exports = {
  VIDEO_TYPES,
  kindOfType,
  CATEGORY_CATALOG,
  DEFAULT_FAMILIAR,
  normalizeName,
  matchByKeyword,
  categoryFromOpml,
  classifySource,
  getOrCreateGroupId,
  mergeCocoonFamiliar,
  buildOpmlCategoryMap,
  autoClassifySourceId,
  previewReclassify,
  applyReclassify,
};
