// AI 基础设施（16-ai-infra，2026-09-12）
// 全系统唯一 AI 调用通道：串行限流（Agnes 免费池实测 20 RPM）+ 429/5xx 退避重试
// + 翻译降级链（Agnes→Bing→Google）+ 双层术语库 + 两阶段初筛 + prompt 文件化 + 调用统计
// runner（tools/collect-turso.js）与 Vercel（api/[...slug].js）共用本模块。
const { createClient } = require('@libsql/client');
const { gapMs, DEFAULT_GAP_MS } = require('../lib/ai-throttle');
const { promptText, settingKey: promptSettingKey } = require('../lib/ai-prompts');

let _db = null;
function getDb() {
  if (!_db) {
    _db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return _db;
}
async function qOne(sql, args = []) { return Array.from((await getDb().execute({ sql, args })).rows)[0]; }
function nowIso() { return new Date().toISOString(); }

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

// ═══ 统计（F6） ═══
const STATS_MAX = 500;
async function recordStat(entry) {
  try {
    const stats = (await getSetting('ai.stats', { calls: [] })) || { calls: [] };
    stats.calls = [entry, ...(stats.calls || [])].slice(0, STATS_MAX);
    await setSetting('ai.stats', stats);
  } catch { /* 统计失败不阻断 */ }
}
async function aiStats() {
  const stats = (await getSetting('ai.stats', { calls: [] })) || { calls: [] };
  const day = Date.now() - 86400e3;
  const recent = (stats.calls || []).filter((c) => Date.parse(c.at) >= day);
  const ok = recent.filter((c) => c.ok);
  return {
    calls24h: recent.length,
    failed24h: recent.length - ok.length,
    avgMs: ok.length ? Math.round(ok.reduce((n, c) => n + (c.ms || 0), 0) / ok.length) : 0,
    byProvider: recent.reduce((m, c) => { m[c.provider] = (m[c.provider] || 0) + 1; return m; }, {}),
  };
}

// ═══ 统一通道（F1） ═══
let _queue = Promise.resolve();
let _lastCallAt = 0;
let _consecFail = 0;
// 测试可注入桩
let _providerOverride = null;
function _setProviderOverride(fn) { _providerOverride = fn; } // tests only

async function _rawChat(p, messages, opts) {
  if (_providerOverride) return _providerOverride(p, messages, opts);
  const resp = await fetch(`${p.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
    body: JSON.stringify({
      model: opts.model || p.model, messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens || 512, // 推理模型必须给足（reasoning 烧 token）
    }),
    signal: AbortSignal.timeout(opts.timeoutMs || 30000),
  });
  if (!resp.ok) {
    const err = new Error(`${p.name} HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  const msg = data?.choices?.[0]?.message || {};
  const content = String(msg.content || '').trim();
  if (!content) {
    // 旧写法把正文与 reasoning_content 用「或」串联返回：推理模型偶尔只吐思考不吐正文时，
    // 思维链会被当成"AI 的回答"交给下游——generateTheme 收到「我需要找到贯穿这些文章的核心主线。」
    // 和大纲碎片、generateWeeklyMagazine 收到 "The user wants me to organize 20 items…"（线上日志实锤）。
    // 那属于调用失败，必须抛错让 aiChat 记 ok:false，而不是让清洗器在下游捞。
    const reasoning = String(msg.reasoning_content || '').trim();
    const finish = data?.choices?.[0]?.finish_reason || '?';
    throw new Error(`${p.name} 仅含 reasoning 无 content(finish=${finish}${reasoning ? `, head=${reasoning.slice(0, 60)}` : ''})`);
  }
  return content;
}

function _providerChain(cfg) {
  const norm = (b) => String(b || '').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  const chain = [];
  if (cfg.apiKey || process.env.AGNES_API_KEY) {
    chain.push({
      name: 'agnes',
      key: cfg.apiKey || process.env.AGNES_API_KEY,
      base: norm(cfg.apiBase || process.env.AGNES_API_BASE || 'https://apihub.agnes-ai.com/v1'),
      model: cfg.model || process.env.AGNES_MODEL || 'agnes-2.5-flash',
    });
  }
  if (process.env.DEEPSEEK_API_KEY) {
    chain.push({ name: 'deepseek', key: process.env.DEEPSEEK_API_KEY, base: 'https://api.deepseek.com', model: process.env.DEEPSEEK_MODEL || 'deepseek-chat' });
  }
  return chain;
}

async function _aiChatInner(messages, opts = {}) {
  const cfg = (await getSetting('ai', {})) || {};
  const chain = _providerChain(cfg);
  if (!chain.length) throw new Error('未配置 AI API Key');
  let lastErr = null;
  for (const p of chain) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1))); // 1s→2s
      try {
        const t0 = Date.now();
        const out = await _rawChat(p, messages, opts);
        await recordStat({ at: nowIso(), kind: opts.kind || 'chat', ok: true, ms: Date.now() - t0, provider: p.name });
        _consecFail = 0;
        return { ok: true, reply: out, provider: p.name, model: opts.model || p.model };
      } catch (err) {
        lastErr = err;
        // 仅 429/5xx 重试，4xx 直接换供应商
        if (!(err.status === 429 || (err.status >= 500)) ) break;
      }
    }
  }
  _consecFail++;
  await recordStat({ at: nowIso(), kind: opts.kind || 'chat', ok: false, ms: 0, provider: chain[0].name, error: String(lastErr && lastErr.message).slice(0, 100) });
  if (_consecFail >= 3) {
    try { await require('./_alerts').aiFailed(`AI 连续 ${_consecFail} 次调用失败：${lastErr && lastErr.message}`); } catch { /* 隔离 */ }
  }
  return { ok: false, error: String(lastErr && lastErr.message || '未知错误') };
}

// 串行 + 限速（Agnes 无并发能力；间隔默认 4s ≈ 15 RPM，留余量）
async function aiChat(messages, opts = {}) {
  const gap = gapMs(await getSetting('ai.minIntervalMs', DEFAULT_GAP_MS));
  const run = _queue.then(async () => {
    const wait = Math.max(0, gap - (Date.now() - _lastCallAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    _lastCallAt = Date.now();
    return _aiChatInner(messages, opts);
  });
  _queue = run.catch(() => {});
  return run;
}

// ═══ 翻译降级链（F4）：Agnes → Bing → Google ═══
async function _translateBing(text) {  // 免 key 方案：抓 bing translator 页面取 IG/IID/token（脆弱，仅兜底）
  const page = await (await fetch('https://www.bing.com/translator', { signal: AbortSignal.timeout(8000) })).text();
  const ig = page.match(/IG:"([0-9A-F]+)"/)?.[1];
  const tokenM = page.match(/params_AbusePreventionHelper\s*=\s*\[(\d+),"([^"]+)"/);
  if (!ig || !tokenM) throw new Error('Bing token 获取失败');
  const r = await fetch(`https://www.bing.com/ttranslatev3?isVertical=1&IG=${ig}&IID=translator.5026`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ fromLang: 'en', to: 'zh-Hans', text, token: tokenM[2], key: tokenM[1] }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await r.json();
  const out = data?.[0]?.translations?.[0]?.text;
  if (!out) throw new Error('Bing 返回无译文');
  return out;
}

async function _translateGoogle(text) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
  const data = await (await fetch(url, { signal: AbortSignal.timeout(10000) })).json();
  const out = (data?.[0] || []).map((seg) => seg[0]).join('');
  if (!out) throw new Error('Google 返回无译文');
  return out;
}

async function translateText(text, { kind = 'translate', glossaryNote = '' } = {}) {
  // L1 Agnes（带术语注入）
  try {
    const prompt = await renderTranslatePrompt(glossaryNote ? [glossaryNote] : null, text);
    const r = await aiChat([{ role: 'user', content: prompt }], { kind, maxTokens: 2048, timeoutMs: 60000 });
    if (r.ok) {
      // 思维链/纯分析输出不能当译文（2026-09-13 F3：实测「Here's a thinking process:」整段入库）
      // → 视为本次失败，落入 L2/L3 机翻保底；带「译文：」标记的由 sanitize 提取后放行
      const cleaned = sanitizeTranslationReply(r.reply, '');
      if (!isThinkingLikeReply(r.reply) && cleaned.trim() && !isThinkingLikeReply(cleaned)) {
        return { ok: true, text: cleaned, provider: 'agnes' };
      }
      throw new Error('agnes 输出为思维链/分析文本');
    }
    throw new Error(r.error);
  } catch (e) {
    await recordStat({ at: nowIso(), kind, ok: false, provider: 'agnes', error: String(e.message).slice(0, 100) });
  }
  // L2 Bing
  try {
    const t = await _translateBing(text);
    await recordStat({ at: nowIso(), kind, ok: true, provider: 'bing' });
    return { ok: true, text: t, provider: 'bing' };
  } catch { /* 继续降级 */ }
  // L3 Google
  try {
    const t = await _translateGoogle(text);
    await recordStat({ at: nowIso(), kind, ok: true, provider: 'google' });
    return { ok: true, text: t, provider: 'google' };
  } catch (e) {
    await recordStat({ at: nowIso(), kind, ok: false, provider: 'google', error: String(e.message).slice(0, 100) });
    return { ok: false, error: `三级翻译全部失败：${e.message}` };
  }
}

// ═══ 术语库（F2） ═══
function _normTerm(s) {
  return String(s || '').trim().toLowerCase().replace(/(es|s)$/, '');
}
async function loadGlossary() {
  const g = await getSetting('ai.glossary', []);
  return Array.isArray(g) ? g : [];
}
// 自动生长：归一化查重；locked（人工固化）不可覆盖；置信度 <0.7 丢弃
async function growGlossary(pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return { added: 0, updated: 0 };
  const g = await loadGlossary();
  const byNorm = new Map(g.map((t) => [_normTerm(t.en), t]));
  let added = 0, updated = 0;
  for (const p of pairs) {
    if (!p || !p.en || !p.zh) continue;
    if (Number(p.confidence ?? 1) < 0.7) continue;
    const key = _normTerm(p.en);
    const existing = byNorm.get(key);
    if (existing) {
      if (!existing.locked) {
        existing.occurrenceCount = (existing.occurrenceCount || 1) + 1;
        updated++;
      }
    } else {
      const item = { en: String(p.en), zh: String(p.zh), domain: p.domain || '', occurrenceCount: 1, locked: false, addedAt: nowIso() };
      g.push(item);
      byNorm.set(key, item);
      added++;
    }
  }
  if (added || updated) await setSetting('ai.glossary', g);
  return { added, updated };
}

async function renderTranslatePrompt(glossaryHits, text) {
  let tpl = await loadPrompt('translate');
  const glossary = (glossaryHits && glossaryHits.length)
    ? glossaryHits.join('\n')
    : (await loadGlossary()).map((t) => `${t.en} → ${t.zh}`).join('\n');
  return tpl.replace('{{glossary}}', glossary || '（无）') + `\n\n## 原文\n\n${text}`;
}

// ═══ 初筛器（F3，BestBlogs Issue #564 范式：不传全文） ═══
async function filterArticle(meta) {
  const threshold = Number(await getSetting('ai.filterThreshold', 30));
  const tpl = await loadPrompt('filter');
  const input = `标题：${meta.title || ''}\n来源：${meta.source || ''}\n分类：${meta.category || ''}\n摘要：${String(meta.summary || '').slice(0, 200)}`;
  // 2026-09-23（P0-2）：agnes 是推理模型，128 常全烧在思考上 → 无 content → 抛错 → 放行 50 分，
  // 初筛间歇性静默失效（剔除率 0%↔13.8% 随机跳，且"0 剔除"与"初筛没工作"数据同形不可判别）。
  // 512 对齐本文件 :69 的推理模型默认线；观察两期后若仍见 finish=length 再抬。
  const r = await aiChat([{ role: 'user', content: `${tpl}\n\n## 待评内容\n\n${input}` }], { kind: 'filter', maxTokens: 512, temperature: 0.2 });
  // failed 标记给调用方计数：失败此前不落任何数（stats 不记、报警不发），"今天筛没筛"在原理上算不出来
  if (!r.ok) return { score: 50, ignore: false, failed: true, reason: `初筛失败放行: ${r.error}` }; // 失败放行（宁多勿漏）
  const m = r.reply.match(/\{[\s\S]*\}/);
  try {
    const j = JSON.parse(m[0]);
    const score = Math.max(0, Math.min(100, Number(j.score) || 0));
    return { score, ignore: score < threshold || !!j.ignore, reason: String(j.reason || '').slice(0, 100) };
  } catch {
    // 模型答了但掏不出 JSON = 这次也没筛成，同样要可数
    return { score: 50, ignore: false, failed: true, reason: '解析失败放行' };
  }
}

// ═══ prompt 加载（F5）：优先级与兜底都在 lib/ai-prompts.js 一份（B111 / spec 39-6）═══
// 键名从 `prompt.<name>` 改读 `ai.prompt.<name>`：云端与本地两端 settings 里**今天一个 prompt 覆盖键都没有**
// （实测读数记在 docs/ISSUES.md B111 行），所以统一键名不需要迁移，也不改变任何现有行为。
async function loadPrompt(name) {
  const custom = await getSetting(promptSettingKey(name), '');
  return promptText(name, { override: custom });
}

// ═══ 多轮精翻（17-translate） ═══
// 译文输出清洗（2026-09-13 F3）：agnes-2.5-flash 是推理模型（坑 #24），会把思维链/指令复述/
// 四维分析混进输出。实测两种污染形态：①中文「用户提供了一篇…要求我从四个维度检查并改进译文…」
// ②英文「Here's a thinking process: 1. **Analyze User Input:** …」。
// 策略：先试「译文/最终稿」标记提取；思维链式回复拒收（轮2/3回退上一轮草稿，轮1触发机翻降级）。
const TRANSLATE_MARKER_RE = /(?:^|\n)\s*(?:#{1,3}\s*)?(?:最终译文|最终稿|译文|翻译如下|Translation)\s*[:：]\s*\n?/g;
// 思维链/分析性回复特征（只收"元任务"话术，避免误伤以"首先"等开头的正常译文）
// 2026-09-15 加固：agnes 在术语校对轮（薄正文输入）会复述任务指令起手——
// 「用户要求我作为术语校对专家…」「我已收到您的翻译请求…」曾作为 translated_title 入库（25 篇）
const THINKING_START_RE = /^(?:here'?s?(?:\s+a)?\s+thinking|thinking process|okay[,.]|alright[,.]|sure[,!]?\s+(?:here|below)|hmm+|let me|i need|i'll|the user|analyzing|reviewing|用户提供|用户要求|我已收到|我已完成|让我仔细|我检查了|我已检查|收到您|让我|我来|我需要|我将|好的[，,]下面|以下是我|分析如下|先分析)/i;
const THINKING_STRUCT_RE = /^\s*\d+\.\s*\*\*/m; // 「1. **Analyze User Input:**」编号加粗分析结构
const THINKING_FIELD_RE = /\*\*(?:Role|Task|Goal|Steps|Input|Output)\*\*/;
function isThinkingLikeReply(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const head = t.slice(0, 500);
  return THINKING_START_RE.test(t) || THINKING_STRUCT_RE.test(head) || THINKING_FIELD_RE.test(head);
}
function sanitizeTranslationReply(reply, draft) {
  const text = String(reply || '');
  if (!text.trim()) return draft || text;
  // 1) 有「译文」标记：取最后一个标记之后的正文（标记前的指令回显/分析全部丢弃）
  TRANSLATE_MARKER_RE.lastIndex = 0;
  let m, lastMarker = null;
  while ((m = TRANSLATE_MARKER_RE.exec(text)) !== null) lastMarker = m;
  if (lastMarker) {
    const body = text.slice(lastMarker.index + lastMarker[0].length).trim();
    if (body.length > 40) return body; // 提取出的正文太短视为无效，继续走拒绝分支
  }
  // 2) 思维链/纯分析且无标记：拒收，回退上一轮草稿（轮1由调用方触发机翻降级）
  if (isThinkingLikeReply(text)) return draft || text;
  return text;
}

// 轮 2：词库对照修正（glossary 非空才值得跑）
async function refineWithGlossary(original, draft) {
  const glossary = await loadGlossary();
  if (!glossary.length) return draft;
  const tpl = await loadPrompt('translate-refine');
  const glossaryText = glossary.map((t) => `${t.en} → ${t.zh}`).join('\n');
  const r = await aiChat([{ role: 'user', content: `${tpl.replace('{{glossary}}', glossaryText)}\n\n## 原文\n${original.slice(0, 6000)}\n\n## 初翻草稿\n${draft.slice(0, 6000)}` }], { kind: 'translate', maxTokens: 2048, timeoutMs: 60000 });
  return r.ok ? sanitizeTranslationReply(r.reply, draft) : draft; // 修正失败用初翻草稿
}

// 轮 3：精翻（长文专用）
async function refinePass(original, draft) {
  const tpl = await loadPrompt('translate-polish');
  const r = await aiChat([{ role: 'user', content: `${tpl}\n\n## 原文\n${original.slice(0, 6000)}\n\n## 译文草稿\n${draft.slice(0, 6000)}` }], { kind: 'translate', maxTokens: 2048, timeoutMs: 90000 });
  return r.ok ? sanitizeTranslationReply(r.reply, draft) : draft;
}

// ═══ 早报深析（18-daily-ai-v2） ═══
const DAILY_DIMS = ['选题', '内容', '深度', '实用', '创新', '表达'];

// 2026-09-15：薄正文（桥接源只有链接列表）深析时模型会产出占位金句——
// 「原文引用待提取」「（原文未提供正文内容，无法提取金句）」「待原文确认后补充」曾原样进我的早报
const QUOTE_PLACEHOLDER_RE = /待提取|待原文|待补充|未提供正文|未提供.*内容|暂无原文|无法提取|无法提供|原文缺失|未见正文/;

async function analyzeArticle(article) {
  const tpl = await loadPrompt('daily-analyze');
  const text = String(article.content_html || '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500);
  const input = `标题：${article.title || ''}\n来源：${article.source_name || article.author || ''}\n摘要：${String(article.summary || '').slice(0, 300)}\n正文：${text}`;
  const r = await aiChat([{ role: 'user', content: `${tpl}\n\n## 待评文章\n\n${input}` }], { kind: 'analyze', maxTokens: 768, timeoutMs: 60000 });
  if (!r.ok) return null;
  const m = r.reply.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const scores = {};
    for (const d of DAILY_DIMS) scores[d] = Math.max(0, Math.min(10, Number(j.scores?.[d]) || 0));
    // 占位金句/要点清洗：命中占位话术 → 置空（前端 quote 为空不渲染 blockquote）
    const quoteRaw = String(j.quote || '').slice(0, 200);
    const quote = QUOTE_PLACEHOLDER_RE.test(quoteRaw) ? '' : quoteRaw;
    const points = Array.isArray(j.points)
      ? j.points.slice(0, 3).map((p) => String(p).slice(0, 100)).filter((p) => p && !QUOTE_PLACEHOLDER_RE.test(p))
      : [];
    return {
      scores,
      totalScore: Math.max(0, Math.min(100, Number(j.totalScore) || 0)),
      reason: String(j.reason || '').slice(0, 100),
      summary: String(j.summary || '').slice(0, 300),
      quote,
      points,
      tags: Array.isArray(j.tags) ? j.tags.slice(0, 4).map((t) => String(t).slice(0, 20)) : [],
    };
  } catch { return null; }
}

// ═══ 周刊 AI 总结注脚（T3-1 R8，2026-09-13）═══
// 每期周刊页脚的本周主线/趋势判断（≤200 字）。推理模型污染用 generateTheme 同款分析行拒绝兜底。
async function generateWeeklySummary(items) {
  const list = items.slice(0, 20).map((it, i) => `${i + 1}. ${it.title}（${it.reason || it.summary || ''}）`).join('\n');
  const prompt = '你是科技媒体主编。基于本周精选内容写一段 150-200 字的本周总结：概括 2-3 条主线，给出一个趋势判断。只输出总结正文，不要标题、不要列表符号、不要解释。';
  const r = await aiChat([{ role: 'user', content: `${prompt}\n\n## 本周精选\n\n${list}` }], { kind: 'theme', maxTokens: 512, timeoutMs: 60000 });
  if (!r.ok) { console.warn(`[weekly] 本周总结放弃：AI 调用失败 ${r.error}`); return null; }
  const lines = String(r.reply || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const isMeta = (l) =>
    /^(用户|让我|我来|我需要|好的|以下|这是|#|\d+[.、]|[-*•])/.test(l) ||
    /^(Let me|The user|I need|Okay|Here|Sure|Based on|This week's)/i.test(l) ||
    l.length > 160;
  const body = lines.filter((l) => !isMeta(l)).join('');
  if (!body || body.length < 60) { // 全被拒或过短 → 不出注脚
    console.warn(`[weekly] 本周总结放弃：${lines.length} 行清洗后仅剩 ${body.length} 字（<60），判为全被元文本否决`);
    return null;
  }
  return body.slice(0, 300);
}

// ═══ 周刊 v2 杂志结构（specs/24，2026-09-14）═══
// 两次调用：①storylines JSON（封面主题词 + 3-5 条主线，每线标题/叙事≤100字/条目编号）
// ②编辑长综述（500-700 字递进叙述）。污染兜底：JSON 解析失败/越界编号丢弃 → 调用方回退旧版视图
async function generateWeeklyMagazine(items) {
  const list = items
    .map((it, i) => `${i + 1}. ${it.title}｜分类：${it.weeklyTheme || '其它'}｜来源：${it.source || ''}｜摘要：${String(it.summary || it.reason || '').slice(0, 120)}`)
    .join('\n');

  // 2026-09-18：本函数原先有 5 条 `return null` 全都不出声——线上周刊连续出现
  // storylines/coverTheme 整体为空却查不到是哪一条守卫拒的。每条放弃都记原因。
  const fail = (why) => { console.warn(`[weekly] 杂志结构放弃：${why}`); return null; };
  const r1 = await aiChat(
    [{ role: 'user', content: `你是科技周刊主编。把下面 ${items.length} 条本周精选组织成 3-5 条递进主线。只输出严格 JSON（不要解释）：\n{"coverTheme":"本期主题（4-12字完整可读短语，让读者一看就懂本周在讲什么，如：AI减速与全球震荡、可托付的智能）","storylines":[{"title":"主线标题（观点式，≤20字）","itemNumbers":[1,3,7],"narrative":"本线叙事（≤100字，说明这条线为什么重要、递进关系）"}]}\n\n每条 itemNumbers 至少 2 个、全部条目尽量被覆盖、编号不得越界。\n\n## 本周精选\n\n${list}` }],
    { kind: 'theme', maxTokens: 3200, timeoutMs: 90000 }
  );
  if (!r1.ok) return fail(`主线调用失败：${r1.error}`);
  let magazine = null;
  try {
    const m = String(r1.reply || '').match(/\{[\s\S]*\}/);
    if (!m) return fail(`回复里没有 JSON 对象（前 80 字：${String(r1.reply).slice(0, 80)}）`);
    const j = JSON.parse(m[0]);
    if (!j.coverTheme || !Array.isArray(j.storylines)) return fail(`字段缺失 coverTheme=${JSON.stringify(j.coverTheme)} storylines 是否数组=${Array.isArray(j.storylines)}`);
    const storylines = j.storylines
      .filter((sl) => sl && sl.title && Array.isArray(sl.itemNumbers))
      .map((sl) => {
        const nums = sl.itemNumbers.map(Number).filter((n) => n >= 1 && n <= items.length);
        return {
          title: String(sl.title).slice(0, 30),
          narrative: String(sl.narrative || '').slice(0, 200),
          items: nums.map((n) => items[n - 1]).filter(Boolean),
        };
      })
      .filter((sl) => sl.items.length >= 2)
      .slice(0, 5);
    if (!storylines.length) return fail(`模型给的 ${j.storylines.length} 条主线全部不合格（无标题/编号越界/不足 2 条）`);
    const covered = new Set(storylines.flatMap((sl) => sl.items.map((it) => it.id)));
    const missed = items.filter((it) => !covered.has(it.id)).length;
    if (missed) console.warn(`[weekly] 主线策展未覆盖 ${missed}/${items.length} 条（前端「其它精选」兜底显示，不丢内容）`);
    magazine = { coverTheme: String(j.coverTheme).slice(0, 20), storylines };
  } catch (e) { return fail(`JSON 解析异常：${e.message}`); }

  magazine.editorNote = await generateWeeklyEditorNote(items, magazine.storylines);
  return magazine;
}

// 编辑综述生成+清洗（specs/24 对抗案例 2026-09-14：模型把任务结构整段复述
// 「1. **Analyze User Input:** - **Role:** …」——逐行过滤不兜底，需整段结构化一票否决）
async function generateWeeklyEditorNote(items, storylines) {
  const list = items
    .map((it, i) => `${i + 1}. ${it.title}｜分类：${it.weeklyTheme || '其它'}｜来源：${it.source || ''}｜摘要：${String(it.summary || it.reason || '').slice(0, 120)}`)
    .join('\n');
  const r2 = await aiChat(
    [{ role: 'user', content: `你是科技周刊主笔。基于本周精选与下列主线划分，写 500-700 字的编辑综述：递进式叙述（不要小标题、不要列表、不要复述任务），把各主线串成一个连贯判断。只输出综述正文。\n\n## 本周精选\n\n${list.slice(0, 1200)}\n\n## 主线\n\n${storylines.map((sl) => `- ${sl.title}：${sl.narrative}`).join('\n')}` }],
    { kind: 'theme', maxTokens: 2600, timeoutMs: 90000 }
  );
  if (!r2.ok) return null;
  const raw = String(r2.reply || '').trim();
  // 整段思维链/任务结构判定（一票否决）
  const looksStructured = /^(```|\d+[.、]|\*\*|[-*•]\s)/.test(raw) ||
    /\*\*(?:Role|Task|Input|Output|Structure|Goal|Steps)\*\*/.test(raw.slice(0, 400));
  if (looksStructured) return null;
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const isMeta = (l) =>
    /^(用户|让我|我来|我需要|好的|以下|这是|#|\d+[.、]|[-*•])/.test(l) ||
    /^(Let me|The user|I need|Okay|Here|Sure|Based on|This week's|As the)/i.test(l) ||
    /\*\*(?:Role|Task|Input|Output|Structure)\*\*/.test(l);
  const body = lines.filter((l) => !isMeta(l)).join('\n\n');
  if (!body || body.length < 200) return null;
  return body.slice(0, 800); // 设计 500-700 字，硬上限 800
}

async function generateTheme(items) {  const tpl = await loadPrompt('daily-theme');
  const list = items.slice(0, 25).map((it, i) => `${i + 1}. ${it.title}（${it.reason || ''}）`).join('\n');
  const r = await aiChat([{ role: 'user', content: `${tpl}\n\n## 入选列表\n\n${list}` }], { kind: 'theme', maxTokens: 300, timeoutMs: 60000 });
  if (!r.ok) return null;
  // 推理模型会把思考过程混进输出：剥掉分析行，取最后一个像导语的句子
  const lines = r.reply.split('\n').map((l) => l.trim()).filter(Boolean);
  const isAnalysis = (l) =>
    /^(用户要求|让我|我来|分析|首先|然后|所以|这[几些]|###|\d+\.|[-*•])/.test(l) ||
    /^(Let me|The user|I need|First|Then|So |Looking|Analyzing|Reviewing|Summarizing|Now |Here|The dominant|Overall|These|Based on|As the|I should)/i.test(l) ||
    // 元任务话术：导语必须只谈内容，凡复述"角色/任务"的句子一律拒绝
    // （2026-09-13 二次实测污染："用户希望我作为科技媒体主编，从入选列表中提炼出一句话导语"）
    /(用户希望|用户要求|需要我|要求我|作为.{0,12}(主编|编辑|专家)|提炼|一句话导语|入选列表|概括(一|今日)|总结(一|今日|一下))/.test(l) ||
    // 第一人称开头 = 在陈述"我要怎么写"，不是在陈述本周内容（2026-09-18 周刊第 2 期
    // 把「我需要找到贯穿这些文章的核心主线。」当成主题词入库，并同步污染归档标签）。
    // 只按句首判，避免误杀「AI 行业的自我定位」这类含"我"的内容陈述。
    /^(我|我们|咱|本人)/.test(l) ||
    /[::：]\s*$/.test(l) || l.length > 120;
  const candidates = lines.filter((l) => !isAnalysis(l));
  // 2026-09-13：全部行都是分析文本时直接放弃（返回 null → 前端无导语展示），
  // 不得回退取分析行——实测曾把英文思维链整段当导语写入 mybrief
  if (!candidates.length) return null;
  // prompt 约定样式「从 X，到 Y，再到 Z，判断 W」（≤60 字）：优先取形状匹配的行
  const shaped = candidates.filter((l) => /^从/.test(l) && /[，,]/.test(l) && l.length <= 70);
  const picked = (shaped[shaped.length - 1] || candidates[candidates.length - 1])
    .replace(/^(导语应该是|导语|今日主题|主题导语|主题)[:：]?\s*/g, '')
    .replace(/^["'「『]+|["'」』。]+$/g, '').trim();
  // 第一人称/写作过程元文本一票否决（三轮实测污染：英文思维链句/角色复述/「我想到一个更好的方式来组织这个叙事」）
  if (!picked || picked.length > 90 || /我(想|觉得|认为|会|将|来|先|们|打算|想到|需要|必须|应该|要|强调)|叙事|让我|输出|写作|这个方式/.test(picked)) return null;
  return picked + '。';
}

module.exports = {
  aiChat, translateText, filterArticle, loadGlossary, growGlossary, loadPrompt, aiStats,
  refineWithGlossary, refinePass, analyzeArticle, generateTheme, generateWeeklySummary, generateWeeklyMagazine, generateWeeklyEditorNote, sanitizeTranslationReply, isThinkingLikeReply,
  _setProviderOverride, // tests only
};
