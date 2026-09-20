// 热搜事件聚合引擎（纯函数版，2026-09-14 抽取共享）
// 消费方：① api/[...slug].js handleHotEvents（云端读层兜底内联聚合）
//         ② tools/collect-turso.js runHotEventsCache（runner 每 15min 预聚合写 settings['hot.eventsCache']——
//         内联聚合在 serverless 冷启动 30s 内跑不完会 504，主力路径必须是读预聚合结果）
// 规则：改本文件的聚类/热度/趋势口径即同时改两端，勿在调用方再写第三份。
const EVENTS_WINDOW_H = 72; // 采样窗口：近 3 天（热搜事件生命周期短，7 天窗口 SQL 过重导致 Turso 超时——2026-09-16 修复）
const EVENTS_HALF_LIFE_H = 24; // 热度半衰期
const EVENTS_SIM_THRESHOLD = 0.4; // Jaccard 聚类阈值（跨平台标题差异大，比日报去重 0.5 略宽）

const { cleanTranslatedTitle } = require('./text-clean');
// B107：JS 侧同一判定（簇内"自有源最高分"与簇外单条都排热榜/聚合）。本文件的行只带
// source_type、不带 extra，所以结果与原来逐字相同；收进一份是为了以后补轴不再漏。
// 注意：`i.source_type === 'hotlist' ? '热榜' : '其它'` 那三处是**分组名标签**，不是判定，故意不走这里。
const { isNoiseSource } = require('./noise');

const hasCJK = (s) => /[\u4e00-\u9fff]/.test(String(s || ''));
// 英文报道给中文摘要：摘要含 CJK 直接用；纯英文摘要且有译文摘要则换译文
function pickZhDigest(summary, zhDigest) {
  const s = String(summary || '').trim();
  if (s && hasCJK(s)) return s;
  const z = String(zhDigest || '').trim();
  return z || s;
}

function formatHeat(n) {
  if (n == null || !Number.isFinite(Number(n))) return '-';
  const v = Number(n);
  if (v >= 1e8) return `${Math.round(v / 1e8 * 10) / 10}亿`;
  if (v >= 1e4) return `${Math.round(v / 1e4 * 10) / 10}万`;
  return String(Math.round(v));
}

function titleTokens(title) {
  const set = new Set();
  const t = String(title || '').toLowerCase();
  // 中文：逐字 unigram + bigram
  const cjk = t.match(/[\u4e00-\u9fff]+/g) || [];
  for (const seg of cjk) {
    for (const ch of seg) { if (ch.trim()) set.add(ch); }
    for (let i = 0; i < seg.length - 1; i++) set.add(seg.slice(i, i + 2));
  }
  // 英文：按空格分词
  const eng = t.match(/[a-z0-9]+/g) || [];
  for (const w of eng) { if (w.length >= 2) set.add(w); }
  return set;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) { if (b.has(t)) inter++; }
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

// rows 需要字段：id/title/translated_title/url/summary(≤300)/zh_digest(≤300)/cover/published_at/score/category/source_id/source_name/source_type/domain(分组名)
// 返回按显示热度严格降序的事件数组（rank 已编号）
function aggregateEventRows(rows, { nowMs = Date.now(), halfLifeH = EVENTS_HALF_LIFE_H, simThreshold = EVENTS_SIM_THRESHOLD } = {}) {
  const items = rows.filter((r) => (r.title || '').trim().length >= 6);
  const clusteredIds = new Set(); // 已入多源簇的条目

  // Jaccard 聚类
  const clusters = [];
  for (const item of items) {
    const tokens = titleTokens(item.title);
    if (!tokens.size) continue;
    let hit = null;
    for (const c of clusters) {
      if (jaccard(tokens, c.tokens) >= simThreshold) { hit = c; break; }
    }
    if (!hit) {
      clusters.push({ tokens, items: [item], sourceIds: new Set([item.source_id]) });
    } else {
      hit.items.push(item);
      hit.sourceIds.add(item.source_id);
      for (const t of tokens) hit.tokens.add(t);
    }
  }

  const events = [];
  for (const c of clusters) {
    if (c.items.length < 2) continue;
    const times = c.items.map((i) => Date.parse(String(i.published_at || ''))).filter((t) => Number.isFinite(t) && t > 0);
    const firstAt = times.length ? Math.min(...times) : nowMs;
    const latestAt = times.length ? Math.max(...times) : nowMs;
    // 领域归属：簇内条目的 domain/category 多数派
    const domainCount = new Map();
    for (const i of c.items) {
      const d = i.domain || i.category || '其它';
      domainCount.set(d, (domainCount.get(d) || 0) + 1);
    }
    const evDomain = [...domainCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
    // 热度：条目权重 × 半衰衰减，再乘信源多样性加成
    let heat = 0;
    for (const i of c.items) {
      const t = Date.parse(String(i.published_at || '')) || nowMs;
      const decay = Math.pow(0.5, Math.max(0, nowMs - t) / 3600e3 / halfLifeH);
      const scoreVal = Number(i.score);
      const w = 1 + Math.min(1, (Number.isFinite(scoreVal) ? scoreVal : 0) / 1e6);
      heat += w * decay;
    }
    heat *= Math.pow(1.5, c.sourceIds.size - 1);
    heat = Number.isFinite(heat) ? Math.round(heat * 10) / 10 : 0;
    // 状态：新(首发<6h) / 爆(信源≥5 且仍在更新) / 发酵中(首发>12h 且 最新<12h) / 收尾
    const ageH = (nowMs - firstAt) / 3600e3;
    const freshH = (nowMs - latestAt) / 3600e3;
    let status = '收尾';
    if (ageH < 6) status = '新';
    else if (c.sourceIds.size >= 5 && freshH < 3) status = '爆';
    else if (ageH > 12 && freshH < 12) status = '发酵中';

    const rep = c.items.slice().sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''))[0];
    for (const i of c.items) clusteredIds.add(i.id);
    // 展示标题优先译文（英文事件直接给中文标题）；聚类仍用原标题
    const repTitle = cleanTranslatedTitle(rep.translated_title) || rep.title;
    // 信源清单（事件卡展示「分组·信源名」，如 公众号·数字生命卡兹克 / 新闻媒体·澎湃新闻）
    const srcSeen = new Map();
    for (const i of c.items.slice().sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''))) {
      if (srcSeen.has(i.source_id)) continue;
      srcSeen.set(i.source_id, {
        name: i.source_name || '未知信源',
        group: i.domain || (i.source_type === 'hotlist' ? '热榜' : '其它'),
      });
    }
    // 热度趋势折线：firstAt→latestAt（跨度不足 6h 按 6h 计）24 桶报道计数；单篇/单时刻 → null
    let trend = null;
    const trendTimes = c.items.map((i) => Date.parse(String(i.published_at || ''))).filter((t) => Number.isFinite(t) && t > 0);
    if (trendTimes.length >= 2) {
      const span = Math.max(latestAt - firstAt, 6 * 3600e3);
      const t0 = latestAt - span;
      const buckets = new Array(24).fill(0);
      for (const t of trendTimes) {
        const idx = Math.min(23, Math.max(0, Math.floor(((t - t0) / span) * 24)));
        buckets[idx]++;
      }
      trend = buckets;
    }
    // 显示热度 = 簇热度 + 簇内自有源最高六维分（排序值=显示值，榜单严格降序，所见即所排）
    const selfMaxVal = Math.max(0, ...c.items.filter((i) => !isNoiseSource(i)).map((i) => Number(i.score) || 0));
    const displayHeat = Math.round((heat + selfMaxVal) * 10) / 10;
    events.push({
      title: repTitle,
      domain: evDomain,
      heat: displayHeat,
      heatFormatted: formatHeat(displayHeat),
      sourceCount: c.sourceIds.size,
      reportCount: c.items.length,
      sourceList: [...srcSeen.values()],
      trend,
      firstAt: new Date(firstAt).toISOString(),
      latestAt: new Date(latestAt).toISOString(),
      status,
      items: c.items
        .slice()
        .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''))
        .map((i) => ({
          id: i.id, title: cleanTranslatedTitle(i.translated_title) || i.title,
          original_title: i.translated_title ? i.title : undefined,
          url: i.url,
          summary: pickZhDigest(i.summary, i.zh_digest).slice(0, 200),
          cover: i.cover, published_at: i.published_at,
          score: i.score, scoreFormatted: formatHeat(i.score),
          source_name: i.source_name, source_type: i.source_type,
          source_group: i.domain || (i.source_type === 'hotlist' ? '热榜' : '其它'),
        })),
    });
  }

  // 未成簇的自有源高分条目 → 单条型事件并入（否则自有源内容因"不成簇"整体缺席本榜）
  const solo = items
    .filter((i) => !clusteredIds.has(i.id) && !isNoiseSource(i) && (Number(i.score) || 0) >= 55) // 评分覆盖初期降到 55，随积累提升可回 60
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
    .slice(0, 10);
  for (const i of solo) {
    const sc = Number(i.score) || 0;
    const soloGroup = i.domain || (i.source_type === 'hotlist' ? '热榜' : '其它');
    events.push({
      title: cleanTranslatedTitle(i.translated_title) || i.title,
      domain: i.domain || i.category || i.source_name || '其它',
      heat: sc,
      heatFormatted: `AI 评分 ${Math.round(sc)}/100`,
      sourceCount: 1,
      reportCount: 1,
      sourceList: [{ name: i.source_name || '未知信源', group: soloGroup }],
      trend: null, // 单篇无可比趋势
      firstAt: i.published_at,
      latestAt: i.published_at,
      status: '精选',
      items: [{ id: i.id, title: cleanTranslatedTitle(i.translated_title) || i.title, original_title: i.translated_title ? i.title : undefined, url: i.url, summary: pickZhDigest(i.summary, i.zh_digest).slice(0, 200), cover: i.cover, published_at: i.published_at, score: i.score, scoreFormatted: `${Math.round(sc)}/100`, source_name: i.source_name, source_type: i.source_type, source_group: soloGroup }],
    });
  }
  // 按显示热度严格降序
  events.sort((a, b) => b.heat - a.heat);
  events.forEach((ev, idx) => { ev.rank = idx + 1; });
  return events;
}

// 采样 SQL（两端共用）：无窗口函数版（2026-09-16 修复——ROW_NUMBER PARTITION BY 在 Turso 上 54s→简单查询 0.4s）
// 策略：直接取近 72h 全部启用源文章（LIMIT 2000），每源条目数由聚合端 Jaccard 聚类自然控制
const EVENTS_SAMPLE_SQL = `SELECT a.id, a.title, a.translated_title, a.url, substr(a.summary,1,300) AS summary,
        CASE WHEN a.translated_content IS NOT NULL AND a.translated_content != '' THEN substr(a.translated_content,1,300) END AS zh_digest,
        a.cover, a.published_at, a.score,
        a.category, a.source_id, s.name AS source_name, s.type AS source_type, g.name AS domain
 FROM articles a
 JOIN sources s ON s.id = a.source_id AND s.enabled = 1 AND COALESCE(s.muted,0)=0
 LEFT JOIN groups g ON g.id = s.group_id
 WHERE a.published_at >= ?
 ORDER BY a.published_at DESC
 LIMIT 2000`;

module.exports = { aggregateEventRows, EVENTS_SAMPLE_SQL, EVENTS_WINDOW_H, EVENTS_HALF_LIFE_H, EVENTS_SIM_THRESHOLD, titleTokens, jaccard, pickZhDigest, hasCJK };
