// Vercel Serverless Function: 日报生成触发器
// POST /api/daily-generate?key=COLLECT_KEY[&windowHours=48]
//
// 由 GitHub Actions 每日北京时间 8:00 调用
// 从 Turso 查询窗口内候选文章 → 按栏目规则分组 → 写入 daily_reports 表
//
// 日报引擎逻辑与 server/services/ai/daily.js 对齐（精简版）

const { createClient } = require('@libsql/client');

// ─── 数据库连接 ───
let _db = null;
function getDb() {
  if (!_db) {
    _db = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return _db;
}

async function qAll(sql, args = []) {
  const r = await getDb().execute({ sql, args });
  return Array.from(r.rows);
}
async function qOne(sql, args = []) {
  return (await qAll(sql, args))[0];
}
async function qRun(sql, args = []) {
  const r = await getDb().execute({ sql, args });
  return { changes: r.rowsAffected };
}

function nowIso() { return new Date().toISOString(); }

// Settings 读取
async function getSetting(key, def = null) {
  const row = await qOne('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return def;
  try { return JSON.parse(row.value); } catch { return def; }
}

// ─── 默认栏目配置 ───
const DEFAULT_COLUMNS = [
  { id: 'c1', name: '培训课程发布', desc: '课程/训练营/社群招募', keywords: ['课程', '训练营', '社群', '招募', '培训'] },
  { id: 'focus', name: '重点更新', special: 'focus' },
  { id: 'c2', name: 'AI技术', desc: 'Codex/Claude/Agent/模型等', keywords: ['Codex', 'Claude', '豆包', 'Agent', '模型', '自动化', 'RAG', 'MCP'] },
  { id: 'fallback', name: '其它重要', special: 'fallback' },
];

const ARTICLE_SOURCE_TYPES = ['wechat', 'rss', 'x'];

// ─── 出库安检 ───
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

// ─── 标题去重（Jaccard 相似度） ───
function titleTokens(title) {
  return String(title || '')
    .replace(/[^\w\u4e00-\u9fff]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

function jaccard(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

// ─── 日报生成核心 ───
async function generateDaily(windowHours) {
  const cfg = await getSetting('daily', {});
  const hours = windowHours || Number(cfg.windowHours) || 48;
  const cutoff = new Date(Date.now() - hours * 3600e3).toISOString();
  const columns = await getSetting('daily.columns', null) || DEFAULT_COLUMNS;
  const selectedIds = Array.isArray(cfg.articleSourceIds) ? cfg.articleSourceIds.map(Number) : null;

  // 取候选文章
  let sql = `SELECT a.*, s.name AS source_name, s.focus AS source_focus
             FROM articles a LEFT JOIN sources s ON s.id = a.source_id
             WHERE a.published_at >= ? AND s.enabled = 1
               AND s.type IN (${ARTICLE_SOURCE_TYPES.map(() => '?').join(',')})`;
  const args = [cutoff, ...ARTICLE_SOURCE_TYPES];
  if (selectedIds && selectedIds.length) {
    sql += ` AND a.source_id IN (${selectedIds.map(() => '?').join(',')})`;
    args.push(...selectedIds);
  }
  // 排除热榜/聚合源
  sql += " AND s.type != 'hotlist' AND COALESCE(json_extract(COALESCE(s.extra,'{}'),'$.aggregator'),0) != 1";
  sql += ' ORDER BY a.published_at DESC LIMIT 500';

  const candidates = await qAll(sql, args);

  // 过滤安检
  const valid = candidates.filter(a => !hasMojibake(a.title) && !isErrorPageItem(a));

  // 栏目分配
  const sections = [];
  const used = new Set();

  for (const col of columns) {
    const items = [];

    if (col.special === 'focus') {
      // 重点源（focus=1）的全部候选
      for (const a of valid) {
        if (used.has(a.id)) continue;
        if (a.source_focus) {
          items.push(formatItem(a));
          used.add(a.id);
        }
      }
    } else if (col.special === 'fallback') {
      // 兜底：未被任何栏目收录的候选（按 score/published_at 排序取 top）
      const remaining = valid
        .filter(a => !used.has(a.id))
        .sort((a, b) => (b.score || 0) - (a.score || 0) || new Date(b.published_at || 0) - new Date(a.published_at || 0))
        .slice(0, 10);
      for (const a of remaining) {
        items.push(formatItem(a));
        used.add(a.id);
      }
    } else if (col.keywords && col.keywords.length) {
      // 关键词匹配
      for (const a of valid) {
        if (used.has(a.id)) continue;
        const text = `${a.title} ${a.summary || ''}`;
        if (col.keywords.some(kw => text.includes(kw))) {
          items.push(formatItem(a));
          used.add(a.id);
        }
      }
    }

    // 栏目内去重（标题 Jaccard > 0.5 视为重复）
    const deduped = dedupItems(items);

    if (deduped.length > 0) {
      sections.push({
        column: col.name,
        desc: col.desc || '',
        items: deduped.slice(0, 15),
      });
    }
  }

  // 统计
  const stats = {
    candidates: valid.length,
    articles: valid.length,
    sections: sections.length,
    totalItems: sections.reduce((n, s) => n + s.items.length, 0),
  };

  // 写入 daily_reports
  const result = await qRun(
    'INSERT INTO daily_reports(generated_at, window_hours, stats, sections) VALUES(?, ?, ?, ?)',
    [nowIso(), hours, JSON.stringify(stats), JSON.stringify(sections)]
  );

  return { id: result.lastInsertRowid, generated_at: nowIso(), stats, sections };
}

function formatItem(a) {
  return {
    id: a.id,
    title: a.title,
    url: a.url,
    source: a.source_name,
    published_at: a.published_at,
    score: a.score,
    summary: (a.summary || '').slice(0, 200),
    cover: a.cover,
  };
}

function dedupItems(items) {
  const result = [];
  for (const item of items) {
    const tokens = titleTokens(item.title);
    let isDup = false;
    for (const existing of result) {
      if (jaccard(tokens, titleTokens(existing.title)) > 0.5) {
        isDup = true;
        break;
      }
    }
    if (!isDup) result.push(item);
  }
  return result;
}

// ─── Serverless 入口 ───
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const key = req.query.key || '';
  if (!process.env.COLLECT_KEY || key !== process.env.COLLECT_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const windowHours = Number(req.query.windowHours) || undefined;
    const report = await generateDaily(windowHours);
    console.log(`[daily] Generated: ${JSON.stringify(report.stats)}`);
    return res.status(200).json({ ok: true, report });
  } catch (err) {
    console.error(`[daily] Error: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
