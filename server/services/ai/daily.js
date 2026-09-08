// 日报引擎（T26，F13~F19）
// 流程：按统计窗口取候选 → [AI 增强：摘要+重要度] → 栏目规则 →
//       F5 去重+同源限流 → 写 daily_reports
// 排序模式：AI 启用时按重要度；否则按关键词命中数
const { db, getSetting } = require('../../db');
const { nowIso } = require('../../util/time');
const log = require('../../util/log');
const { htmlToText } = require('./summary');

// 默认四栏目（plan.md「栏目配置」，F15/F18）
const DEFAULT_COLUMNS = [
  {
    id: 'c1',
    name: '培训课程发布',
    desc: '课程/训练营/社群招募/项目培训/技术培训发布或预告',
    keywords: ['课程', '训练营', '社群', '招募', '培训'],
  },
  { id: 'focus', name: '重点更新', special: 'focus' },
  {
    id: 'c2',
    name: 'AI技术',
    desc: 'Codex、Claude、豆包、Agent、模型、自动化、RAG、MCP 等动向',
    keywords: ['Codex', 'Claude', '豆包', 'Agent', '模型', '自动化', 'RAG', 'MCP'],
  },
  { id: 'fallback', name: '其它重要', special: 'fallback' },
];

// wemp 已随 we-mp-rss 退役移除（2026-09-04）：公众号迁移为 type='rss'（wechat2rss）
const ARTICLE_SOURCE_TYPES = ['wechat', 'rss', 'x'];
const VIDEO_SOURCE_TYPES = ['bilibili', 'douyin', 'youtube'];

// 九期补丁:日报出库安检——乱码(西里尔/修饰字母/替换符/高频乱码字是 UTF-8 被 GBK 误读的特征)与风控错误页不得入报
function hasMojibake(text) {
  const s = String(text || '');
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x0400 && cp <= 0x04ff) n++; // 西里尔
    else if (cp >= 0x02b0 && cp <= 0x02ff) n++; // 修饰字母(ˢ 等)
    else if (cp === 0xfffd) n += 2; // 替换符
    else if (ch === '锟' || ch === '锛' || ch === '銆') n++; // 高频乱码碎片字
  }
  return n >= 2;
}
function isErrorPageItem(item) {
  const t = String(item.title || '');
  return t.length < 30 && /参数错误|环境异常|访问过于频繁|操作频繁/.test(t);
}

function getColumns() {
  const cols = getSetting('daily.columns', null);
  return Array.isArray(cols) && cols.length ? cols : DEFAULT_COLUMNS;
}

function dailyConfig() {
  const d = getSetting('daily', {});
  return {
    windowHours: Number(d.windowHours) || 48,
    time: d.time || '08:00',
    articleSourceIds: Array.isArray(d.articleSourceIds) ? d.articleSourceIds.map(Number) : null, // null=全选
    videoSourceIds: Array.isArray(d.videoSourceIds) ? d.videoSourceIds.map(Number) : null,
  };
}

// 取窗口内候选：published_at >= 截止时间，来源在勾选范围内
function collectCandidates(windowHours, cfg) {
  const cutoff = new Date(Date.now() - windowHours * 3600e3).toISOString();
  const items = [];

  let aSql = `SELECT a.*, s.name AS source_name, s.focus AS source_focus,
                     json_extract(COALESCE(s.extra,'{}'),'$.aggregator') AS source_aggregator
              FROM articles a LEFT JOIN sources s ON s.id = a.source_id
              WHERE a.published_at >= ? AND s.enabled = 1
                AND s.type IN (${ARTICLE_SOURCE_TYPES.map(() => '?').join(',')})`;
  const aArgs = [cutoff, ...ARTICLE_SOURCE_TYPES];
  if (cfg.articleSourceIds) {
    aSql += ` AND a.source_id IN (${cfg.articleSourceIds.map(() => '?').join(',') || 'NULL'})`;
    aArgs.push(...cfg.articleSourceIds);
  }
  for (const r of db.prepare(aSql).all(...aArgs)) {
    items.push({
      kind: 'article', ref_id: r.id, source_id: r.source_id,
      title: r.translated_title || r.title || '', cover: r.cover || '',
      source_name: r.source_name || '', url: r.url || '', published_at: r.published_at || '',
      focus: !!r.source_focus, aggregator: !!r.source_aggregator,
      // 2026-09-05 视觉精修：透传 AI 评分/标签，供日报条目卡展示（纯增量字段）
      score: r.score ?? null, tags: r.tags || '',
      // 翻译内容优先用于关键词匹配和摘要
      text: `${r.translated_title || r.title || ''} ${htmlToText(r.summary)} ${htmlToText(r.translated_content || r.content_html).slice(0, 2000)}`,
    });
  }

  let vSql = `SELECT v.*, s.name AS source_name, s.focus AS source_focus,
                     json_extract(COALESCE(s.extra,'{}'),'$.aggregator') AS source_aggregator
              FROM videos v LEFT JOIN sources s ON s.id = v.source_id
              WHERE v.published_at >= ? AND s.enabled = 1
                AND s.type IN (${VIDEO_SOURCE_TYPES.map(() => '?').join(',')})`;
  const vArgs = [cutoff, ...VIDEO_SOURCE_TYPES];
  if (cfg.videoSourceIds) {
    vSql += ` AND v.source_id IN (${cfg.videoSourceIds.map(() => '?').join(',') || 'NULL'})`;
    vArgs.push(...cfg.videoSourceIds);
  }
  for (const r of db.prepare(vSql).all(...vArgs)) {
    items.push({
      kind: 'video', ref_id: r.id, source_id: r.source_id, title: r.title || '', cover: r.cover || '',
      source_name: r.source_name || '', url: r.url || '', published_at: r.published_at || '',
      focus: !!r.source_focus, aggregator: !!r.source_aggregator,
      // 2026-09-05 视觉精修：视频表暂无评分/标签列，字段占位对齐文章条目
      score: r.score ?? null, tags: r.tags || '',
      text: `${r.title || ''} ${htmlToText(r.intro)}`,
    });
  }
  return items;
}

// 关键词命中数（大小写不敏感子串匹配）
// 3.3 增强：支持 AND 组合 —— keywords 内每项可以是字符串（OR）或字符串数组（AND，全部命中才算 1 hit）
function keywordHits(item, keywords) {
  const hay = item.text.toLowerCase();
  let hits = 0;
  for (const kw of keywords || []) {
    if (Array.isArray(kw)) {
      // AND 组合：数组内所有关键词都必须命中
      const allMatch = kw.every((k) => {
        const k2 = String(k).trim().toLowerCase();
        return k2 && hay.includes(k2);
      });
      if (allMatch) hits++;
    } else {
      const k = String(kw).trim().toLowerCase();
      if (k && hay.includes(k)) hits++;
    }
  }
  return hits;
}

// 栏目规则引擎：focus 源全收（时间倒序）→ 关键词命中（命中多栏时归配置顺序最先命中的栏目）→ fallback 兜底
function classify(items, columns) {
  const focusCol = columns.find((c) => c.special === 'focus');
  const fallbackCol = columns.find((c) => c.special === 'fallback');
  const kwCols = columns.filter((c) => !c.special);
  const buckets = new Map(columns.map((c) => [c.id, []]));

  for (const item of items) {
    if (item.focus && focusCol) {
      buckets.get(focusCol.id).push(item);
      continue;
    }
    let placed = false;
    for (const col of kwCols) {
      const hits = keywordHits(item, col.keywords);
      if (hits > 0) {
        item._hits = hits; // 关键词模式排序用
        buckets.get(col.id).push(item);
        placed = true;
        break; // 同一内容命中多个栏目 → 只进配置顺序最先命中的那个
      }
    }
    if (!placed && fallbackCol) buckets.get(fallbackCol.id).push(item);
    // 无 fallback 栏目时未命中内容不收录
  }
  return buckets;
}

// 标题分词 + 相似度：提取到独立纯函数模块（重构 Phase 1），消除 events.js → daily.js 反向依赖
const { normalizeTitle, titleTokens, jaccard } = require('./_tokens');

// F5 去重 + 限流（对单栏候选列表）：
//  1) 标题 token Jaccard ≥0.5 判同主题合并：主条目非 aggregator（一手源）优先，同级取发布时间早者；
//     其余并入主条目 related:[{kind,ref_id,source_name}]
//  2) 同源限流：每 source_id 最多保留 3 条（按关键词命中数 → 时间序）
function dedupAndCap(items) {
  const groups = []; // {primary, tokens}
  for (const item of items) {
    const tokens = titleTokens(item.title);
    let hit = null;
    for (const g of groups) {
      if (jaccard(tokens, g.tokens) >= 0.5) { hit = g; break; }
    }
    if (!hit) {
      item.related = item.related || [];
      groups.push({ primary: item, tokens });
      continue;
    }
    const cur = hit.primary;
    const better = (!!item.aggregator !== !!cur.aggregator)
      ? !item.aggregator // 一手源优先于聚合源
      : (item.published_at || '') < (cur.published_at || ''); // 同级取发布早者
    const winner = better ? item : cur;
    const loser = better ? cur : item;
    winner.related = [
      ...(winner.related || []),
      ...(loser.related || []),
      { kind: loser.kind, ref_id: loser.ref_id, source_name: loser.source_name },
    ];
    hit.primary = winner;
    for (const t of tokens) hit.tokens.add(t); // 合并 token，提高后续召回
  }
  // 同源限流：每 source_id 取前 3（命中数降序 → 时间降序）
  const byRank = groups
    .map((g) => g.primary)
    .sort((a, b) => (b._hits || 0) - (a._hits || 0) || (b.published_at || '').localeCompare(a.published_at || ''));
  const perSource = new Map();
  const out = [];
  for (const item of byRank) {
    const key = item.source_id ?? `${item.kind}:${item.source_name}`;
    const c = perSource.get(key) || 0;
    if (c >= 3) continue;
    perSource.set(key, c + 1);
    out.push(item);
  }
  return out;
}

// F3：今日是否还需生成日报——本地时间已过 daily.time（默认 08:00）且今日（本地日）无 daily_reports 记录
function needsGeneration() {
  const cfg = dailyConfig();
  const m = /^(\d{1,2}):(\d{2})$/.exec(cfg.time || '08:00');
  const now = new Date();
  const genAt = new Date(now);
  genAt.setHours(m ? Number(m[1]) : 8, m ? Number(m[2]) : 0, 0, 0);
  if (now < genAt) return false; // 今日生成时间未到
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const row = db.prepare('SELECT id FROM daily_reports WHERE generated_at >= ? LIMIT 1').get(dayStart.toISOString());
  return !row;
}

/**
 * generate(windowHours?)：生成一份日报并写 daily_reports，返回报告对象
 */
async function generate(windowHours) {
  const cfg = dailyConfig();
  const win = Number(windowHours) || cfg.windowHours;
  const columns = getColumns();
  const candidates = collectCandidates(win, cfg);

  // AI 增强：为候选条目生成摘要+重要度（串行，限流保护）
  let aiResults = null;
  let aiEnabled = false;
  try {
    const dailyAi = require('./daily-ai');
    aiEnabled = dailyAi.isEnabled();
    if (aiEnabled && candidates.length > 0) {
      log.info(`[日报] AI 增强已启用，开始分析 ${candidates.length} 条候选...`);
      aiResults = await dailyAi.analyzeBatch(candidates, {
        onProgress: ({ done, total }) => {
          if (done % 5 === 0 || done === total) log.info(`[日报AI] 进度 ${done}/${total}`);
        },
      });
    }
  } catch (err) {
    log.warn(`[日报] AI 增强加载失败，降级为关键词模式: ${err.message}`);
  }

  const buckets = classify(candidates, columns);

  const sections = [];
  let droppedBad = 0;
  for (const col of columns) {
    const list = dedupAndCap(buckets.get(col.id) || []); // F5：同主题合并 + 同源限流前 3
    const outItems = [];
    for (const item of list) {
      // 出库安检:乱码标题/错误页整条剔除;乱码摘要清空(宁缺毋滥)
      if (hasMojibake(item.title) || isErrorPageItem(item)) { droppedBad++; continue; }
      // AI 分析结果查找
      const aiKey = `${item.kind}:${item.ref_id}`;
      const aiData = aiResults ? aiResults.get(aiKey) : null;
      outItems.push({
        kind: item.kind,
        ref_id: item.ref_id,
        title: item.title,
        summary: aiData ? aiData.summary : '',
        cover: item.cover,
        source_name: item.source_name,
        url: item.url,
        published_at: item.published_at,
        hits: item._hits || 0,
        // AI 增强字段：重要度评分 + AI 标签
        ...(aiData ? { importance: aiData.importance, aiTags: aiData.tags } : {}),
        ...(item.score != null ? { score: item.score } : {}),
        ...(item.tags ? { tags: item.tags } : {}),
        related: item.related || [],
      });
    }
    // 排序：focus 栏固定时间倒序；AI 模式按重要度降序；否则按关键词命中数→时间
    const hitsOf = new Map(list.map((i) => [`${i.kind}:${i.ref_id}`, i._hits || 0]));
    const byTime = (a, b) => (b.published_at || '').localeCompare(a.published_at || '');
    if (col.special === 'focus') {
      outItems.sort(byTime);
    } else if (aiEnabled && aiResults) {
      // AI 模式：按重要度降序 → 时间降序
      outItems.sort((a, b) => (b.importance || 0) - (a.importance || 0) || byTime(a, b));
    } else {
      outItems.sort(
        (a, b) =>
          (hitsOf.get(`${b.kind}:${b.ref_id}`) || 0) - (hitsOf.get(`${a.kind}:${a.ref_id}`) || 0) || byTime(a, b)
      );
    }
    const sec = { column: col.name, col_id: col.id, items: outItems }; // 2026-09-05b：col_id 供前端折叠态/关键词映射（栏目名可重复，id 稳定）
    if (col.desc) sec.desc = col.desc;
    sections.push(sec);
  }

  const stats = {
    candidates: candidates.length,
    articles: candidates.filter((i) => i.kind === 'article').length,
    videos: candidates.filter((i) => i.kind === 'video').length,
    windowHours: win,
    sortMode: (aiEnabled && aiResults) ? 'ai' : 'keyword',
  };
  if (aiEnabled && aiResults) stats.aiAnalyzed = aiResults.size;
  if (droppedBad) stats.droppedBadItems = droppedBad; // 出库安检剔除数(乱码/风控页)

  // 九期 M5:破茧栏——与常读领域(科技/AI 圈)交集最小的跨域热点事件 Top5
  // 数据来自事件聚合引擎(热榜+公众号+RSS 全域);无事件时跳过该栏
  try {
    const events = require('../events');
    // FAMILIAR = 用户订阅圈的分组名，从 settings 可配（自动分类落组时自动并入新组名）
    let FAMILIAR;
    try {
      const raw = getSetting('daily.cocoonFamiliar');
      FAMILIAR = raw ? JSON.parse(raw) : null;
    } catch { /* ignore */ }
    if (!Array.isArray(FAMILIAR)) FAMILIAR = require('../classify').DEFAULT_FAMILIAR;
    const outside = events.getEvents('all').filter((e) => !FAMILIAR.includes(e.domain)).slice(0, 5);
    if (outside.length) {
      sections.push({
        column: '茧房外 · 你圈子之外的热点',
        col_id: 'cocoon',
        desc: '跨平台事件聚合：与你常读领域交集最小的当日热点，主动打破信息茧房',
        items: outside.map((e) => ({
          kind: 'event',
          title: e.title,
          summary: `${e.sourceCount} 个信源报道 · ${e.domain} · 热度 ${e.heat}`,
          cover: '',
          source_name: `${e.sourceCount} 源`,
          url: '',
          published_at: e.latestAt,
          related: [],
        })),
      });
      stats.cocoonEvents = outside.length;
    }
  } catch (err) {
    log.warn('破茧栏生成失败(不影响日报主体):', err.message);
  }

  const generatedAt = nowIso();
  const r = db
    .prepare('INSERT INTO daily_reports(generated_at, window_hours, stats, sections) VALUES(?,?,?,?)')
    .run(generatedAt, win, JSON.stringify(stats), JSON.stringify(sections));
  log.info(
    `日报已生成 #${r.lastInsertRowid}：候选 ${stats.candidates}（文章 ${stats.articles}/视频 ${stats.videos}），` +
      `窗口 ${win}h，${stats.sortMode === 'ai' ? `AI 智能排序（分析 ${stats.aiAnalyzed} 条）` : '关键词规则排序'}`
  );
  return { id: r.lastInsertRowid, generated_at: generatedAt, window_hours: win, stats, sections };
}

// 最新一份日报（无则 null）
function getLatest() {
  const row = db.prepare('SELECT * FROM daily_reports ORDER BY id DESC LIMIT 1').get();
  if (!row) return null;
  let stats = {};
  let sections = [];
  try { stats = JSON.parse(row.stats || '{}'); } catch { /* ignore */ }
  try { sections = JSON.parse(row.sections || '[]'); } catch { /* ignore */ }
  return {
    id: row.id,
    generated_at: row.generated_at,
    window_hours: row.window_hours,
    stats,
    sections,
  };
}

module.exports = { generate, getLatest, getColumns, dailyConfig, needsGeneration, dedupAndCap, DEFAULT_COLUMNS, ARTICLE_SOURCE_TYPES, VIDEO_SOURCE_TYPES, classify, keywordHits, collectCandidates, normalizeTitle, titleTokens, jaccard };
