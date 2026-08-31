// 日报引擎云端版(十一期 M3):移植主系统 server/services/ai/daily.js 的关键词模式
// (栏目分类 focus 全收→关键词命中→fallback 兜底、F5 去重+同源限流、出库安检、破茧栏)
// AI 摘要跳过;读写 Turso daily_reports 表
const turso = require('./_turso');
const { titleTokens, jaccard } = require('./_data');
const events = require('./_events');

const DEFAULT_COLUMNS = [
  { id: 'c1', name: '培训课程发布', desc: '课程/训练营/社群招募/项目培训/技术培训发布或预告', keywords: ['课程', '训练营', '社群', '招募', '培训'] },
  { id: 'focus', name: '重点更新', special: 'focus' },
  { id: 'c2', name: 'AI技术', desc: 'Codex、Claude、豆包、Agent、模型、自动化、RAG、MCP 等动向', keywords: ['Codex', 'Claude', '豆包', 'Agent', '模型', '自动化', 'RAG', 'MCP'] },
  { id: 'fallback', name: '其它重要', special: 'fallback' },
];

const ARTICLE_SOURCE_TYPES = ['wechat', 'rss', 'x', 'wemp', 'hotlist'];
const VIDEO_SOURCE_TYPES = ['bilibili', 'douyin', 'youtube'];

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// 出库安检:乱码(UTF-8 被 GBK 误读特征)与风控错误页不得入报
function hasMojibake(text) {
  const s = String(text || '');
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x0400 && cp <= 0x04ff) n++;
    else if (cp >= 0x02b0 && cp <= 0x02ff) n++;
    else if (cp === 0xfffd) n += 2;
    else if (ch === '锟' || ch === '锛' || ch === '銆') n++;
  }
  return n >= 2;
}
function isErrorPageItem(item) {
  const t = String(item.title || '');
  return t.length < 30 && /参数错误|环境异常|访问过于频繁|操作频繁/.test(t);
}

async function getColumns() {
  const cols = await turso.getSetting('daily.columns', null);
  return Array.isArray(cols) && cols.length ? cols : DEFAULT_COLUMNS;
}

async function collectCandidates(windowHours) {
  const cutoff = new Date(Date.now() - windowHours * 3600e3).toISOString();
  const items = [];
  const aRows = await turso.dbAll(
    `SELECT a.id, a.source_id, a.title, a.cover, a.url, a.summary, a.content_html, a.published_at,
            s.name AS source_name, s.focus AS source_focus,
            json_extract(COALESCE(s.extra,'{}'),'$.aggregator') AS source_aggregator
     FROM articles a LEFT JOIN sources s ON s.id = a.source_id
     WHERE a.published_at >= ? AND s.enabled = 1
       AND s.type IN (${ARTICLE_SOURCE_TYPES.map(() => '?').join(',')})`,
    cutoff, ...ARTICLE_SOURCE_TYPES
  );
  for (const r of aRows) {
    items.push({
      kind: 'article', ref_id: r.id, source_id: r.source_id, title: r.title || '', cover: r.cover || '',
      source_name: r.source_name || '', url: r.url || '', published_at: r.published_at || '',
      focus: !!r.source_focus, aggregator: !!r.source_aggregator,
      text: `${r.title || ''} ${stripHtml(r.summary)} ${stripHtml(r.content_html).slice(0, 2000)}`,
    });
  }
  const vRows = await turso.dbAll(
    `SELECT v.id, v.source_id, v.title, v.cover, v.url, v.intro, v.published_at,
            s.name AS source_name, s.focus AS source_focus
     FROM videos v LEFT JOIN sources s ON s.id = v.source_id
     WHERE v.published_at >= ? AND s.enabled = 1
       AND s.type IN (${VIDEO_SOURCE_TYPES.map(() => '?').join(',')})`,
    cutoff, ...VIDEO_SOURCE_TYPES
  );
  for (const r of vRows) {
    items.push({
      kind: 'video', ref_id: r.id, source_id: r.source_id, title: r.title || '', cover: r.cover || '',
      source_name: r.source_name || '', url: r.url || '', published_at: r.published_at || '',
      focus: !!r.source_focus, aggregator: false,
      text: `${r.title || ''} ${stripHtml(r.intro)}`,
    });
  }
  return items;
}

function keywordHits(item, keywords) {
  const hay = item.text.toLowerCase();
  let hits = 0;
  for (const kw of keywords || []) {
    const k = String(kw).trim().toLowerCase();
    if (k && hay.includes(k)) hits++;
  }
  return hits;
}

function classify(items, columns) {
  const focusCol = columns.find((c) => c.special === 'focus');
  const fallbackCol = columns.find((c) => c.special === 'fallback');
  const kwCols = columns.filter((c) => !c.special);
  const buckets = new Map(columns.map((c) => [c.id, []]));
  for (const item of items) {
    if (item.focus && focusCol) { buckets.get(focusCol.id).push(item); continue; }
    let placed = false;
    for (const col of kwCols) {
      const hits = keywordHits(item, col.keywords);
      if (hits > 0) {
        item._hits = hits;
        buckets.get(col.id).push(item);
        placed = true;
        break;
      }
    }
    if (!placed && fallbackCol) buckets.get(fallbackCol.id).push(item);
  }
  return buckets;
}

// F5 去重(Jaccard≥0.5 同主题合并,一手源优先/同级取早) + 同源限流前 3
function dedupAndCap(items) {
  const groups = [];
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
      ? !item.aggregator
      : (item.published_at || '') < (cur.published_at || '');
    const winner = better ? item : cur;
    const loser = better ? cur : item;
    winner.related = [
      ...(winner.related || []),
      ...(loser.related || []),
      { kind: loser.kind, ref_id: loser.ref_id, source_name: loser.source_name },
    ];
    hit.primary = winner;
    for (const t of tokens) hit.tokens.add(t);
  }
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

// DeepSeek 逐条摘要 + 重要度(1-10);serverless 60s 预算:最多 10 条、并发 5、单条 20s
const AI_CAP = 10;
const AI_CONCURRENCY = 5;

async function aiAnnotate(item) {
  const { chat } = require('./_deepseek');
  const raw = await chat(
    [
      { role: 'system', content: '你是情报分析助手。阅读内容后输出 JSON:{"summary":"3~5句中文摘要","score":1到10的整数重要度}。只输出 JSON。' },
      { role: 'user', content: `标题:${item.title}\n\n内容:${item.text.slice(0, 6000)}` },
    ],
    { responseFormat: 'json_object', timeout: 20000 }
  );
  let summary = '';
  let score;
  try {
    const j = JSON.parse(raw);
    summary = String(j.summary || '').trim();
    const n = Number(j.score);
    if (Number.isFinite(n)) score = Math.max(1, Math.min(10, Math.round(n)));
  } catch {
    const m = raw.match(/"summary"\s*:\s*"([\s\S]*?)"\s*,\s*"score"\s*:\s*(\d+)/);
    if (m) {
      summary = m[1].trim();
      score = Math.max(1, Math.min(10, Number(m[2])));
    } else {
      summary = raw.trim().slice(0, 500);
    }
  }
  return { summary, score };
}

async function generate(windowHours) {
  const win = Number(windowHours) || 48;
  const columns = await getColumns();
  const candidates = await collectCandidates(win);
  const buckets = classify(candidates, columns);

  // AI 模式:配置了 daily.apiKey 且 aiEnabled 时对排名靠前的条目生成摘要+重要度
  let useAi = false;
  let aiError = null;
  try {
    const { aiConfig } = require('./_deepseek');
    const cfg = await aiConfig();
    useAi = cfg.aiEnabled && !!cfg.apiKey;
  } catch { /* 配置读取失败按关键词模式 */ }
  let aiBudget = AI_CAP;
  const aiQueue = []; // 收集待标注条目,分块并发

  const sections = [];
  let droppedBad = 0;
  for (const col of columns) {
    const list = dedupAndCap(buckets.get(col.id) || []);
    const outItems = [];
    for (const item of list) {
      if (hasMojibake(item.title) || isErrorPageItem(item)) { droppedBad++; continue; }
      const out = {
        kind: item.kind,
        ref_id: item.ref_id,
        title: item.title,
        summary: '',
        cover: item.cover,
        source_name: item.source_name,
        url: item.url,
        published_at: item.published_at,
        related: item.related || [],
        _item: item, // AI 标注用,出库前删除
      };
      if (useAi && aiBudget > 0) {
        aiBudget--;
        aiQueue.push(out);
      }
      outItems.push(out);
    }
    const hitsOf = new Map(list.map((i) => [`${i.kind}:${i.ref_id}`, i._hits || 0]));
    const byTime = (a, b) => (b.published_at || '').localeCompare(a.published_at || '');
    if (col.special === 'focus') outItems.sort(byTime);
    else outItems.sort((a, b) => (hitsOf.get(`${b.kind}:${b.ref_id}`) || 0) - (hitsOf.get(`${a.kind}:${a.ref_id}`) || 0) || byTime(a, b));
    const sec = { column: col.name, items: outItems };
    if (col.desc) sec.desc = col.desc;
    sections.push(sec);
  }

  // AI 标注:分块并发,单条失败降级为空摘要(不影响整份日报)
  if (aiQueue.length) {
    for (let i = 0; i < aiQueue.length; i += AI_CONCURRENCY) {
      await Promise.all(aiQueue.slice(i, i + AI_CONCURRENCY).map(async (out) => {
        try {
          const r = await aiAnnotate(out._item);
          out.summary = r.summary;
          if (r.score !== undefined) out.score = r.score;
        } catch (err) {
          if (!aiError) aiError = err.message;
        }
      }));
    }
    // AI 模式:各栏目按重要度降序(无分排后按时间)
    for (const sec of sections) {
      if (sec.column === '重点更新') continue; // focus 栏固定时间倒序
      sec.items.sort((a, b) => (b.score || 0) - (a.score || 0) || (b.published_at || '').localeCompare(a.published_at || ''));
    }
  }
  for (const sec of sections) for (const it of sec.items) delete it._item;

  const stats = {
    candidates: candidates.length,
    articles: candidates.filter((i) => i.kind === 'article').length,
    videos: candidates.filter((i) => i.kind === 'video').length,
    windowHours: win,
    sortMode: useAi ? 'ai' : 'keyword',
  };
  if (droppedBad) stats.droppedBadItems = droppedBad;
  if (aiError) stats.aiError = aiError;

  // 破茧栏:与常读领域交集最小的跨域热点事件 Top5
  try {
    const FAMILIAR = ['AI', '科技', '科技热榜', '国际科技', 'AI 模型', 'AI 产品', '技巧观点', '行业动态'];
    const outside = (await events.getEvents('all')).filter((e) => !FAMILIAR.includes(e.domain)).slice(0, 5);
    if (outside.length) {
      sections.push({
        column: '茧房外 · 你圈子之外的热点',
        desc: '跨平台事件聚合:与你常读领域交集最小的当日热点,主动打破信息茧房',
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
  } catch { /* 破茧栏失败不影响日报主体 */ }

  const generatedAt = turso.nowIso();
  const r = await turso.dbRun(
    'INSERT INTO daily_reports(generated_at, window_hours, stats, sections) VALUES(?,?,?,?)',
    generatedAt, win, JSON.stringify(stats), JSON.stringify(sections)
  );
  return { id: r.lastInsertRowid, generated_at: generatedAt, window_hours: win, stats, sections };
}

async function getLatest() {
  const row = await turso.dbGet('SELECT * FROM daily_reports ORDER BY id DESC LIMIT 1');
  if (!row) return null;
  let stats = {};
  let sections = [];
  try { stats = JSON.parse(row.stats || '{}'); } catch { /* ignore */ }
  try { sections = JSON.parse(row.sections || '[]'); } catch { /* ignore */ }
  return { id: row.id, generated_at: row.generated_at, window_hours: row.window_hours, stats, sections };
}

// 当天(UTC+8 日历日)是否已有报告
function isToday(iso) {
  if (!iso) return false;
  const day = new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 10);
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  return day === today;
}

// GET /api/daily 语义:有当天报告直接返回;没有则现场生成并存库
async function getOrGenerate() {
  const latest = await getLatest();
  if (latest && isToday(latest.generated_at)) return { report: latest, fresh: false };
  const report = await generate();
  return { report, fresh: true };
}

module.exports = { generate, getLatest, getOrGenerate };
