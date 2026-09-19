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

// ─── 默认栏目配置（B10：唯一实现收进 lib/daily-columns.js，本地/runner/云端三端共用） ───
const { DEFAULT_COLUMNS, ARTICLE_SOURCE_TYPES } = require('../lib/daily-columns');

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

  // 采集窗口：北京昨日 00:00 → 北京今日 06:00（B90：口径与 api/[...slug].js、runner 共用 lib/time-window，
  // 原来这里手搓一遍"+8h 后 setUTCHours(0,0,0,0) 再减回 8h"，三处写法迟早不一致）
  const { startIso: cutoff, endIso: cutoffEnd } = require('../lib/time-window').dailyReportWindowIso();
  const columns = await getSetting('daily.columns', null) || DEFAULT_COLUMNS;
  const selectedIds = Array.isArray(cfg.articleSourceIds) ? cfg.articleSourceIds.map(Number) : null;

  // 取候选文章
  let sql = `SELECT a.*, s.name AS source_name, s.spotlight AS source_spotlight
             FROM articles a LEFT JOIN sources s ON s.id = a.source_id
             WHERE a.published_at >= ? AND a.published_at <= ? AND s.enabled = 1
               AND s.type IN (${ARTICLE_SOURCE_TYPES.map(() => '?').join(',')})`;
  const args = [cutoff, cutoffEnd, ...ARTICLE_SOURCE_TYPES];
  if (selectedIds && selectedIds.length) {
    sql += ` AND a.source_id IN (${selectedIds.map(() => '?').join(',')})`;
    args.push(...selectedIds);
  }
  // 排除热榜/聚合源
  sql += " AND s.type != 'hotlist' AND COALESCE(json_extract(COALESCE(s.extra,'{}'),'$.aggregator'),0) != 1";
  sql += ' ORDER BY a.published_at DESC LIMIT 500';

  const candidates = await qAll(sql, args);

  // 过滤安检
  let valid = candidates.filter(a => !hasMojibake(a.title) && !isErrorPageItem(a));

  // B20（2026-09-19 独立对抗审查查出，本轮实测坐实）：分析后质量门槛此前**只接在 runner 那一份**
  // （tools/collect-turso.js:1128），本文件与本地 server/services/ai/daily.js 都没有 →
  // 线上最新一期 id=103 实测仍有 2 条低于 30 分入报（29 分「Claude Code now reads AG…」/22 分）。
  // 门槛口径与 runner 完全一致（同一 lib/brief-guards 实现 + 同一个 ai.dailyMinScore 设置），
  // 未评分条目一律不误杀（降级关键词版要能出报）。
  let gateDropped = 0; // stats.candidates 统一口径 = 进门槛前的候选数（五份写入器一致，见 CLOUD_PIPELINE_GUIDE §12）
  try {
    const guards = require('../lib/brief-guards');
    const aiCfg = await getSetting('ai', {}) || {};
    const g = guards.applyDailyQualityGate(valid, aiCfg.dailyMinScore, (m) => console.log(m));
    valid = g.kept; gateDropped = g.dropped;
  } catch (e) { console.log('门槛检查失败（不阻断出报，但本期等于无门槛）:', e.message); }

  // 栏目分配
  const sections = [];
  const used = new Set();

  for (const col of columns) {
    const items = [];

    if (col.special === 'spotlight' || col.special === 'focus') {
      // 重点源（spotlight=1）的全部候选
      for (const a of valid) {
        if (used.has(a.id)) continue;
        if (a.source_spotlight) {
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
    candidates: valid.length + gateDropped,
    gateDropped,
    articles: valid.length,
    sections: sections.length,
    totalItems: sections.reduce((n, s) => n + s.items.length, 0),
  };

  // 计算窗口小时数（供记录）
  const windowH = Math.round((Date.parse(cutoffEnd) - Date.parse(cutoff)) / 3600e3);

  // 写入 daily_reports
  const result = await qRun(
    'INSERT INTO daily_reports(generated_at, window_hours, stats, sections) VALUES(?, ?, ?, ?)',
    [nowIso(), windowH, JSON.stringify(stats), JSON.stringify(sections)]
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
