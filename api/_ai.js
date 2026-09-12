// AI 基础设施（16-ai-infra，2026-09-12）
// 全系统唯一 AI 调用通道：串行限流（Agnes 免费池实测 20 RPM）+ 429/5xx 退避重试
// + 翻译降级链（Agnes→Bing→Google）+ 双层术语库 + 两阶段初筛 + prompt 文件化 + 调用统计
// runner（tools/collect-turso.js）与 Vercel（api/[...slug].js）共用本模块。
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

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
  const content = (msg.content || msg.reasoning_content || '').trim();
  if (!content) throw new Error(`${p.name} 返回空内容(finish=${data?.choices?.[0]?.finish_reason || '?'})`);
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
  const gap = Number(await getSetting('ai.minIntervalMs', 4000));
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
async function _translateBing(text) {
  // 免 key 方案：抓 bing translator 页面取 IG/IID/token（脆弱，仅兜底）
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
    if (r.ok) return { ok: true, text: r.reply, provider: 'agnes' };
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
  const r = await aiChat([{ role: 'user', content: `${tpl}\n\n## 待评内容\n\n${input}` }], { kind: 'filter', maxTokens: 128, temperature: 0.2 });
  if (!r.ok) return { score: 50, ignore: false, reason: `初筛失败放行: ${r.error}` }; // 失败放行（宁多勿漏）
  const m = r.reply.match(/\{[\s\S]*\}/);
  try {
    const j = JSON.parse(m[0]);
    const score = Math.max(0, Math.min(100, Number(j.score) || 0));
    return { score, ignore: score < threshold || !!j.ignore, reason: String(j.reason || '').slice(0, 100) };
  } catch {
    return { score: 50, ignore: false, reason: '解析失败放行' };
  }
}

// ═══ prompt 加载（F5）：settings 覆盖 > repo 文件 > 内嵌兜底 ═══
const PROMPT_FILES = {
  translate: path.join(__dirname, '..', 'prompts', 'translate.md'),
  filter: path.join(__dirname, '..', 'prompts', 'filter.md'),
  'term-extract': path.join(__dirname, '..', 'prompts', 'term-extract.md'),
};
// Vercel 部署可能不含 prompts/ 文件 → 内嵌兜底（与 prompts/ 同步义务）
const EMBEDDED_PROMPTS = {
  translate: '你是资深科技翻译专家。只输出译文，保留 Markdown 结构，代码/产品名不译，中英文间加空格。术语对照（必须严格遵循）：\n{{glossary}}\n',
  filter: '你是初筛编辑。按 内容深度30/相关性30/写作质量20/实用创新20 打分，营销减分。严格输出 JSON：{"score":0-100,"ignore":bool,"reason":"30字内"}\n',
  'term-extract': '从中英对照文本提取专业术语对，置信度<0.7丢弃。严格输出 JSON 数组 [{"en","zh","domain","confidence"}]\n',
};
async function loadPrompt(name) {
  const custom = await getSetting(`prompt.${name}`, '');
  if (custom && String(custom).trim()) return String(custom);
  try {
    return fs.readFileSync(PROMPT_FILES[name], 'utf8');
  } catch {
    return EMBEDDED_PROMPTS[name] || '';
  }
}

module.exports = {
  aiChat, translateText, filterArticle, loadGlossary, growGlossary, loadPrompt, aiStats,
  _setProviderOverride, // tests only
};
