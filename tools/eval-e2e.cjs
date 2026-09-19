#!/usr/bin/env node
/**
 * 41-2 端到端评测引擎（要求正文 docs/EVAL_GUIDE.md §3，父 spec docs/specs/41-e2e-whitebox-eval/spec.md）
 *
 * 它回答的问题和白盒不同：**页面真的对用户生效了吗**。本项目反复出现过这类缺陷——
 * 接口 200、字段齐、白盒全绿，页面上却仍是旧口径或直接空：
 *   · B52 云端缺 /api/videos/:id 时详情页恒「加载中…」；
 *   · B60 「我的阅读」type 口径四处漂移（列表与计数各算各的，肉眼看不出）；
 *   · B71 后台入口没挂 i18n Provider → 登录按钮直接显示裸 key `login.submit`（本引擎首轮实测抓到）。
 * 所以核心方法只有一句：**DOM 与页面自己发出的那次 API 响应对账**。只断言"元素存在"等于没测（§3.3）。
 *
 * 三条硬规矩（踩过之后写死的）：
 *   1. 对账数据取**页面真实发出的请求**（page.on('response') 拦截），剧本不另发探针替页面决定参数；
 *      每个参数出处都要登记在 QUERY_SRC，未登记路径带参数即被 F7 判红（type= 猜成 tab= 真发生过）；
 *   2. 每条剧本集齐渲染/接口/数据三类断言（§3.3），缺类如实进 summary.uncoveredKinds，
 *      不用"点开了就算过"充数（F3 判空断言）；
 *   3. 环境不通（浏览器起不来 / 代理不通 / 站点打不开 / 线上不是 origin/main）判 fail_env 退 2，
 *      不折算成产品失败，也不许跳过。
 * 已知缺口用 KNOWN_GAPS 显式登记（带 ISSUES 编号）并从门禁摘出——**禁止用删剧本的方式逃过门禁**。
 *
 * 用法：
 *   npm run eval:e2e                                   打线上，每剧本连跑 3 次（§3.4 flaky 口径）
 *   npm run eval:e2e -- --fast                         只跑 1 次（改剧本时的开发模式，不算验收）
 *   npm run eval:e2e -- --only E1,E5                   只跑指定剧本
 *   npm run eval:e2e -- --target http://127.0.0.1:3000 打本地 Express
 *   npm run eval:e2e -- --self-test                    自检：分类/退出码/对账判据"坏样本必须被抓到"
 * 退出码：0 全过 / 1 fail_product（含过程层不诚实）/ 2 fail_env 或 flaky（本轮不算通过，也不算产品失败）
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { CLOUD_SITE } = require('../lib/cloud-site');
const { CHECKS } = require('./eval-process-checks.cjs');

const ROOT = path.join(__dirname, '..');
const EVID = 'docs/eval/e2e';
const PROXY = process.env.E2E_PROXY || 'http://127.0.0.1:12000';
const VIEWPORT = { width: 1440, height: 1000 };
const NAV = 60000;           // 单次导航上限（预发部署期实例冷启实测约 10~15s）
const RENDER = 45000;        // 等首屏内容出现（列表接口 P95 可达 15s，B31 已登记）
const SETTLE = 2500;         // 渲染后静置：CSR 首屏先出骨架再回填真实条数
const DEFAULT_REPEAT = 3;
const API_BUDGET_MS = Number(process.env.E2E_API_BUDGET || 8000);

// ── 参数出处表：一律抄自被检代码，禁止凭印象（F7 逐条查 source 形如 file:line）──
const SRC = {
  hotTab: 'api/[...slug].js:384',        // tab: all | featured(:397) | hotlist(:402)
  readingTab: 'api/[...slug].js:1023',   // ['all','favorited','read']
  readingType: 'api/[...slug].js:1024',  // ['all','article','video','podcast']
  articlesTab: 'api/[...slug].js:127',
  articlesSort: 'api/[...slug].js:128',
  videosTab: 'api/[...slug].js:261',
  // 分页大小是接口里写死的 PAGE_SIZE（本系统没有 limit 参数，传了也没人读）。对账"满一页 vs 不满一页"
  // 必须知道这个常量，否则会把"接口一共只给了 4 条"当成前端漏渲染。
  pageSizeArticles: 'api/[...slug].js:126',
  pageSizeVideos: 'api/[...slug].js:260',
  pageSizeReading: 'api/[...slug].js:1026',
  feArticles: 'web/src/components/ArticleList.jsx:89',
  feVideos: 'web/src/components/VideoGrid.jsx:57',
  feReading: 'web/src/pages/MyReadingPage.jsx:93',
  feHot: 'web/src/pages/HotPage.jsx:217',
  feHotGroups: 'web/src/pages/HotPage.jsx:171',
  feHotSources: 'web/src/pages/HotPage.jsx:183',
  feHotEvents: 'web/src/pages/HotPage.jsx:200',
  feDaily: 'web/src/pages/DailyPage.jsx:69',
  feMybrief: 'web/src/pages/MyBriefPage.jsx:38',
  feWeekly: 'web/src/pages/WeeklyPage.jsx:32',
  feCommon: 'web/src/store.jsx:24',
  feRealtime: 'web/src/hooks/useRealtime.js:32',
  feImg: 'web/src/util.js:9',
  feGroups: 'web/src/components/Sidebar.jsx:27',
  feSources: 'web/src/components/Sidebar.jsx:28',
  feSourcesLibrary: 'web/src/components/AdminRefCard.jsx:44',
  feSettingsDaily: 'web/src/components/DailySettingsTab.jsx:22',
  feHotEventsDomain: 'web/src/components/HotEvents.jsx:192',
  railNav: 'web/src/main.jsx:72',
};
// 页面自己发出的请求：出处 = 前端构造该 query 的那一行。未登记路径一旦带参数，F7 直接判红——
// 这是故意的：逼着"新增剧本先补出处"，而不是把参数名当常识。
const QUERY_SRC = {
  '/api/articles': SRC.feArticles,
  '/api/articles/since': SRC.feRealtime,
  '/api/videos': SRC.feVideos,
  '/api/reading': SRC.feReading,
  '/api/hot': SRC.feHot,
  '/api/hot/groups': SRC.feHotGroups,
  '/api/hot/sources': SRC.feHotSources,
  '/api/hot/events': SRC.feHotEvents,
  '/api/daily': SRC.feDaily,
  '/api/mybrief': SRC.feMybrief,
  '/api/weekly': SRC.feWeekly,
  '/api/settings': SRC.feCommon,
  '/api/status': SRC.feCommon,
  '/api/img': SRC.feImg,
  '/api/groups': SRC.feGroups,
  '/api/sources': SRC.feSources,
  '/api/sources/library': SRC.feSourcesLibrary,
  '/api/settings/daily': SRC.feSettingsDaily,
  '/api/hot/events': SRC.feHotEventsDomain,
};

// 选择器与响应形状全部来自 2026-09-19 对线上真实 DOM/JSON 的测量（tools/_probe-dom*.cjs）
// 注意：/reader/ 的文章行是 `card.card-lift.p-3.cursor-pointer.relative`（实测 30 行 ↔ API 30 条）。
// 早先用的 `div.cursor-pointer.flex.gap-2` 命中的其实是**侧栏源列表 34 项**，不是文章行——
// 那 4 行的"容差"完全是选错元素造成的假象，已改成精确选择器 + 零容差思路。
const SEL = {
  readerRow: 'div.card.card-lift.p-3.cursor-pointer.relative',              // /reader/ 文章行 30 ↔ API 30
  sidebarRow: 'aside div.cursor-pointer',                                   // 侧栏源行（用来验证没选错）
  videoCard: 'div.card.card-lift.cursor-pointer.group.overflow-hidden',      // /reader/ 点「视频」后 ×28
  dailyRow: 'div.cursor-pointer.flex.gap-3',                                 // /daily/ 行 ×37
  hotCard: 'article.card.card-lift.cursor-pointer.p-4',                       // /hot/ featured·all 卡 ×24
  hotEventRow: 'div.flex.items-center.gap-2',                                          // /hot/ 热搜事件行 ×184
  readingCard: 'div.card.card-lift.flex.gap-3.items-start.p-3',              // /reading/ 卡 ×30
  mybriefCard: 'article.card.card-lift.cursor-pointer.overflow-hidden',      // /mybrief/ 卡 ×30（三组各 10）
  weeklyRow: 'div.flex.gap-4.p-3',                                           // /weekly/ 条目行 ×20
  railBtn: 'a.rail-btn',
};
const EMPTY_READING = '暂无阅读沉淀';   // /reading/ 空态实测文案（合法空态，不算占位）

// ───────────── 纯函数层（--self-test 直打这里；每条判据都要"坏样本必须被抓到"）─────────────

// 各列表接口写死的一页条数（出处见 SRC.pageSize*）：判"满一页"用的分母
const PAGE_SIZE = { articles: 30, videos: 30, reading: 30 };

/** 列表接口分页 + 自动刷新会有 ±1~2 抖动；差 ≥3 行才是口径真不一致。两侧都 0 是合法一致。*/
function countMatches(dom, apiN, tol = 3) { return Math.abs(dom - apiN) <= tol; }
/** 小列表（早报/周刊这类产物页，实测总共就 2~4 张卡）必须严格相等：默认 ±3 会放过"只渲染出 1 条"。*/
function countMatchesTight(dom, apiN) { return dom === apiN; }
/** 分页列表：接口给满一页时 DOM 允许少几条（懒加载/合并），不满一页则接口一共就这么多，必须严格相等。*/
function countMatchesPage(dom, apiN, pageSize) {
  return apiN >= pageSize ? countMatches(dom, apiN, 3) : dom === apiN;
}
/** "渲染的行是否真出自这次响应"：行文本里出现该条目的 title **或 translated_title** 前缀即算命中。
 *  阅读器列表卡按界面语言显示译文标题（实测：卡片显示「SDCC – 小型设备 C 编译器」而 title 是英文），
 *  只比 title 会把正常的翻译渲染判成缺陷。 */
function renderedInResponse(domTexts, items, keep = 12) {
  const joined = (domTexts || []).join('\n');
  const miss = [];
  for (const x of items || []) {
    const cands = [x && x.title, x && x.translated_title].map((t) => String(t || '').replace(/\s+/g, ' ').trim()).filter((t) => t.length > 3);
    if (!cands.some((t) => joined.includes(t.slice(0, keep)))) miss.push(cands[0] || '(无标题)');
  }
  return { n: (items || []).length, miss };
}

/** 同一条剧本连跑 N 次后的四分类（§3.4：3 次全过才算 pass；偶发失败是 flaky，不得当通过）*/
function classify(runs) {
  const list = runs.filter(Boolean);
  if (!list.length) return 'fail_env';
  const product = list.filter((r) => r === 'fail_product').length;
  const env = list.filter((r) => r === 'fail_env').length;
  if (!product) return env ? 'fail_env' : 'pass';
  if (env) return 'fail_env';                 // 分不清就保守判环境层，绝不把 flaky 冤枉成产品缺陷
  return product === list.length ? 'fail_product' : 'fail_flaky';
}

/** 退出码：产品缺陷优先 1；环境 / flaky / 空跑退 2；全过 0。known_gap 不参与。*/
function exitCodeOf(s) {
  if (s.failProduct > 0) return 1;
  if (s.failEnv > 0 || s.failFlaky > 0 || s.total === 0) return 2;
  return 0;
}

/** 只有「全剧本 × ≥3 轮 × 真实云端」才算验收轮；否则这轮绿了也不许当交付证据（reviewer #2）。
 *  纯函数，自检里逐条反着验（少一条剧本/少一轮/本地站，都必须 ok=false）。*/
function acceptanceOf(nCases, nAll, repeat, isRemote) {
  const reasons = [];
  if (nCases !== nAll) reasons.push(`只跑了 ${nCases}/${nAll} 条剧本`);
  if (!(repeat >= 3)) reasons.push(`每剧本 ${repeat} 轮（<3，flaky 判不出来）`);
  if (!isRemote) reasons.push('目标不是真实云端站点');
  return { ok: reasons.length === 0, reasons, nCases, nAll, repeat, remote: !!isRemote };
}

/** 未翻译 key 泄漏：只认字典里真实存在的键，避免把 "v1.2.3" 这类正常文本误判（B71 就这么定位的）*/
function rawKeyHits(text, dictKeys) {
  const set = new Set(dictKeys);
  const hits = new Set();
  for (const m of String(text).matchAll(/\b([a-z][a-z0-9]*\.[a-z][a-zA-Z0-9]*)\b/g)) if (set.has(m[1])) hits.add(m[1]);
  return [...hits];
}

/** 三类断言覆盖（§3.3）：缺哪类如实报，不用别的类补数 */
function kindCoverage(assertions) {
  const need = ['render', 'api', 'data'];
  const got = new Set(assertions.map((a) => a.kind));
  return { kinds: need.filter((k) => got.has(k)), missing: need.filter((k) => !got.has(k)) };
}

/** 整屏占位（B52 恒「加载中…」）。空态文案不在这里——「暂无阅读沉淀」是真状态，不是假渲染。*/
const EMPTY_STATES = ['加载中…', '加载中...', '加载失败'];
function emptyStateHits(text) { return EMPTY_STATES.filter((p) => String(text).includes(p)); }

/** AI 产物污染串：模型把 Markdown 围栏 / undefined / NaN / [object Object] 原样吐进正文（正则用常量写，
 *  免得字面 ``` 混进单引号字符串里把解析器绕死——本轮真踩过）*/
const DIRTY_PRODS = /```|\bundefined\b|\bNaN\b|\[object Object\]/;

/** 覆盖率方向的对账：响应里前 N 条有多少出现在页面上（返回 miss 列表）。
 *  与 subsetConsistency 互为方向——行结构嵌套时用包含判据会误报，用覆盖判据才稳。*/
function responseCovered(pageText, items, keep = 10, sample = 30) {
  const joined = String(pageText || '');
  const head = (items || []).slice(0, sample);
  const miss = head.filter((x) => {
    const t = String((x && (x.title || x.name)) || '').replace(/\s+/g, ' ').trim();
    return t.length > 3 && !joined.includes(t.slice(0, keep));
  });
  return { n: head.length, miss: miss.map((x) => String(x.title || x.name).slice(0, 40)) };
}

/** pill 文本：「全部 25149」/「重点更新 15」→ {标签: 数字}，供与 API 计数逐个对账 */
function pillCounts(labels) {
  const out = {};
  for (const t of labels || []) {
    const m = /^(.+?)\s+([\d,]+)$/.exec(t);
    if (m) out[m[1].trim()] = Number(m[2].replace(/,/g, ''));
  }
  return out;
}

/** 递归收集产物里所有 title 字段：产物页的卡面文案是"标题 + 一堆装饰文字"拼的，
 *  不能拿整段 innerText 去 JSON 里做子串匹配（实测那样必然全红）。 */
function collectTitles(obj, out = []) {
  if (Array.isArray(obj)) { for (const v of obj) collectTitles(v, out); return out; }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'title' && typeof v === 'string' && v.trim()) out.push(v.trim());
      else collectTitles(v, out);
    }
  }
  return out;
}

/** 每张卡必须能在产物标题里找到归属（孤儿卡 = 渲染了页面上不该存在/上一批的内容）*/
function orphanCards(cardTexts, titles, keep = 10) {
  const t = (titles || []).map((x) => x.slice(0, keep));
  return (cardTexts || []).filter((txt) => txt && txt.trim() && !t.some((x) => txt.includes(x)));
}

// ───────────────── 断言收集 ─────────────────

function makeCase(id, title) {
  return { id, title, assertions: [], requests: [], events: [], renderedText: '', metrics: {}, status: null, why: '', knownGap: null };
}
function assert(c, kind, label, ok, detail) {
  if (!c || !Array.isArray(c.assertions)) throw new Error('assert 需要剧本集合（防静默假绿）');
  c.assertions.push({ kind, label, ok: ok === true, detail: detail === undefined ? '' : String(detail).slice(0, 220) });
  return ok === true;
}

// ───────────────── 浏览器工具 ─────────────────

/** 剧本自己发的探针 URL（api() 登记）。attachNet 同步读它给响应打 by 标记。
 *  为什么必须标：探针响应和页面响应进的是同一个 store，`net.length=0` 挡不住
 *  探针那条**晚到**的异步 push（res.text() 在 await 之后才 push），
 *  于是"页面自己发出的请求"对账里混进了脚本发的请求 = 自己证明自己（假绿）。 */
const scriptInflight = new Set();

/** 拦截页面自己发出的 /api/ 响应：这是"对账"的数据来源，不让剧本另发探针替页面决定参数 */
function attachNet(page, store) {
  page.on('response', async (res) => {
    let u;
    try { u = new URL(res.url()); } catch { return; }
    const self = u.pathname + u.search;
    // by 必须在 await 之前同步定下：晚 push 的记录若事后补标会把页面响应误标成脚本响应
    const by = scriptInflight.has(self) ? 'script' : 'page';
    // document 类响应单独记一条：E7 用"有没有再拉 HTML"判客户端路由是否真的没刷新
    if (res.request().resourceType() === 'document') {
      store.push({ url: u.pathname, kind: 'doc', by, status: res.status(), bytes: 0, json: null, params: {}, at: Date.now() });
      return;
    }
    if (!u.pathname.startsWith('/api/')) return;
    const params = {};
    let src = QUERY_SRC[u.pathname];
    if (!src) {
      // 详情类是 /api/articles/:id、/api/videos/:id——参数出处按路径前缀回落，
      // 否则剧本会被自己的 F7 判红（"没发探针"反而成了缺陷，这是判据写错了不是页面错了）
      const hit = Object.keys(QUERY_SRC).find((p) => p.endsWith('/') && u.pathname.startsWith(p));
      src = hit ? QUERY_SRC[hit] : null;
    }
    for (const [k, v] of u.searchParams.entries()) {
      params[k] = { value: v, source: src || '未登记：请在 QUERY_SRC 补 ' + u.pathname + ' 的构造行号' };
    }
    const rec = { url: u.pathname, fullUrl: u.pathname + u.search, by, status: res.status(), bytes: 0, json: null, params, ms: 0, at: Date.now() };
    store.pending = store.pending || {};
    store.pending[u.pathname] = (store.pending[u.pathname] || 0) + 1;
    const t0 = Date.now();
    try { const text = await res.text(); rec.bytes = text.length; try { rec.json = JSON.parse(text); } catch { /* 非 JSON 不参与对账 */ } }
    catch { }
    finally { rec.ms = Date.now() - t0; store.pending[u.pathname]--; store.push(rec); }
  });
}
/** 只看**页面自己**发出的记录：剧本探针的响应不参与对账（见 scriptInflight） */
const byPage = (r) => r.by !== 'script';
/** 把本轮某接口的所有响应**合并**成一张 id→item 表。
 *  列表页会自己追加请求（阅读器 12s 轮询 /api/articles/since、筛选切换重发…），
 *  只拿"某一条响应"对账必然出现 DOM 比它多/少的假红（实测 34↔30 就是两轮响应的并集）。*/
function collected(store, pathname) {
  const byId = new Map();
  for (const r of store.filter((x) => byPage(x) && x.url === pathname && x.json)) {
    for (const it of (r.json.items || r.json.articles || r.json.videos || r.json.events) || []) {
      if (it && (it.id !== undefined || it.rank !== undefined)) byId.set(`${it.kind || ''}:${it.id ?? it.rank}`, it);
    }
  }
  return byId;
}
/** 等本轮页面自己发出的某个接口返回，取**最后一条**：/api/daily 会先回 stale 再回新生成的，
 *  取第一条会让 DOM(新) 与 API(旧) 对不上，把正常的自动重生成误判成缺陷（本轮实测踩过）*/
async function waitForApi(store, pathname, timeout = RENDER) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    const hit = store.filter((r) => byPage(r) && r.url === pathname && r.json !== null).pop();
    if (hit) last = hit;
    if (last && !last.json.stale) return last;      // stale = 正在重生成，再等一轮拿新的
    await new Promise((r) => setTimeout(r, 400));
  }
  return last;
}
/** 按谓词等拦截记录（E9 的详情请求是 /api/articles/:id，用路径相等那条 helper 抓不到）*/
async function waitForApiWhere(store, pred, timeout = RENDER) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const hit = store.filter((r) => byPage(r) && pred(r)).pop();
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}
/** 剧本补的接口断言（参数出处必填，F7 逐条查）*/
async function api(page, c, p, paramsMeta = {}) {
  // 探针必须在**已有同源文档**的页面上发：新 page 停在 about:blank 时 fetch 会 1ms 内 status 0，
  // 而 status 0 长得像"接口挂了"——本轮差点据此把 type=all 误判成筛选失效（pitfalls #43 的评测器版本）
  const href = page.url();
  if (!/^https?:/.test(href)) throw new Error(`TOOL: 探针没有同源文档（当前页 ${href}）——剧本必须先 goto 再打接口`);
  // 登记给 attachNet 打 by:'script'：探针响应绝不能进"页面自己发出的请求"对账
  let key = '';
  try { const u = new URL(p, href); key = u.pathname + u.search; } catch { }
  const t0 = Date.now();
  if (key) scriptInflight.add(key);
  let res;
  try {
    res = await page.evaluate(async (u) => {
      try {
        const r = await fetch(u, { headers: { accept: 'application/json' } });
        const text = await r.text();
        let json = null; try { json = JSON.parse(text); } catch { }
        return { status: r.status, bytes: text.length, json, text: text.slice(0, 300) };
      } catch (e) { return { status: 0, bytes: 0, json: null, text: String(e.message || e) }; }
    }, p);
  } finally { if (key) scriptInflight.delete(key); }
  // status 0 = 请求根本没到服务端（网络层/代理不通），判产品红是冤枉它，判绿是自欺 → 环境红
  if (res.status === 0) throw new Error(`TOOL: 探针 ${p} status 0（fetch 抛错：${String(res.text).slice(0, 80)}）——网络/代理不通，属 fail_env`);
  c.requests.push({ url: p.split('?')[0], fullUrl: p, status: res.status, bytes: res.bytes, ms: Date.now() - t0, params: paramsMeta });
  return res;
}
async function goto(page, c, url, sel) {
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV });
  let appeared = true;
  try { await page.waitForSelector(sel, { timeout: RENDER }); } catch { appeared = false; }
  c.metrics.navigateMs = Date.now() - t0;
  await page.waitForTimeout(SETTLE);
  return appeared;
}
/** 等到某选择器有行且连续两次读数一致（CSR 首屏先出骨架，不等稳定值会对不上）*/
async function stableCount(page, sel, tries = 12, gap = 800) {
  let prev = -1, cur = 0;
  for (let i = 0; i < tries; i++) {
    cur = await page.$$eval(sel, (e) => e.length).catch(() => 0);
    if (cur > 0 && cur === prev) return cur;
    prev = cur;
    await page.waitForTimeout(gap);
  }
  return cur;
}
/** 计数 pill 的稳定态：连续两次读数完全一致才算。
 *  不等稳定态会把"首屏慢请求（type=all，实测 15s）比点击后的快请求晚到"这种竞态
 *  误读成评测器噪声——它既可能是真缺陷，也可能是加载瞬间的正常抖动，必须先看清是哪一种。*/
async function stablePills(page, labels, tries = 10, gap = 900) {
  let prev = null;
  let cur = {};
  for (let i = 0; i < tries; i++) {
    cur = pillCounts(await buttonsOf(page).then((bs) => bs.filter((b) => labels.some((l) => b === l || b.startsWith(l + ' ')))));
    if (prev && JSON.stringify(prev) === JSON.stringify(cur)) return cur;
    prev = cur;
    await page.waitForTimeout(gap);
  }
  return cur;
}
/** 有界轮询：等到条件成立（用于"响应已到、React 还要晚一帧才落到 DOM"这种正常滞后）。
 *  注意这只吸收**渲染帧差**，不吸收口径不一致：超时后按真红处理，绝不因为"多等会儿就好了"改判据。*/
async function waitUntil(fn, timeoutMs = 20000, gapMs = 1200) {
  const t0 = Date.now();
  let last = null;
  for (;;) {
    last = await fn();
    if (last === true || Date.now() - t0 > timeoutMs) return { ok: last === true, waitedMs: Date.now() - t0, last };
    await new Promise((r) => setTimeout(r, gapMs));
  }
}
/** 列表页普遍"只渲染前 N 条 / 客户端再选一批"（/hot/ 实测 24 行 ↔ 响应 200 条），
 *  所以判据是**包含关系**而不是位置前缀：渲染出来的每一条标题都必须能在本次响应里找到。
 *  返回 {domN, apiN, miss[]} —— miss 非空就是"页面上显示了接口没给的东西"（B60/B28 同族）。*/
function subsetConsistency(domTexts, apiItems, keep = 10) {
  const titles = (apiItems || []).map((x) => String(x.title || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const dom = (domTexts || []).map((t) => String(t).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const miss = dom.filter((row) => row && !titles.some((t) => t && row.includes(t.slice(0, keep))));
  return { domN: dom.length, apiN: titles.length, miss };
}
/** 等某个接口"安静下来"：连续 quietMs 内没有新响应落地才算。
 *  用在"点击切换筛选"之前——首屏那条慢请求（实测 15~30s）若还在飞，它晚到就会把新筛选的结果覆盖掉，
 *  此时判出来的红分不清是"筛选没接上"还是"上一型迟到"，等于判据不干净（本轮 E5 就卡过这一点）。*/
async function waitQuiet(store, pathname, quietMs = 8000, timeoutMs = 90000) {
  const t0 = Date.now();
  for (;;) {
    const seen = store.filter((r) => byPage(r) && r.url === pathname).map((r) => r.at || 0);
    const newest = seen.length ? Math.max(...seen) : 0;
    // 两条都得满足：① 至少等到一次响应 ② 没有在飞的响应（body 未读完的记录还没 push 进 store，
    // 只看已 push 的会把"26s 慢响应仍在读"当成已经静下来 = 假静）
    const inflight = (store.pending || {})[pathname] || 0;
    if (seen.length && !inflight && Date.now() - newest > quietMs) return { quiet: true, waitedMs: Date.now() - t0, responses: seen.length };
    if (Date.now() - t0 > timeoutMs) return { quiet: false, waitedMs: Date.now() - t0, responses: seen.length, inflight };
    await new Promise((r) => setTimeout(r, 500));
  }
}
/** 等到"页面渲染稳定"：连续两次 innerText 长度一致且超过 minChars，或超时。
 *  这是给所有"点击后/加载后再判"的剧本用的统一 settle 口径——**固定 sleep 是本轮 flaky 的全部来源**
 *  （E8 用 3s 定长等待，慢的那一轮 /hot/ 只渲染出 376 字就被判白屏）。
 *  判据本身不变，变的只是"什么时候读"。*/
async function waitRendered(page, { minChars = 500, timeoutMs = 30000, gapMs = 800 } = {}) {
  const t0 = Date.now();
  let prev = -1, cur = 0;
  for (;;) {
    cur = (await bodyText(page)).length;
    if (cur === prev && cur > minChars) return { settled: true, chars: cur, waitedMs: Date.now() - t0 };
    prev = cur;
    if (Date.now() - t0 > timeoutMs) return { settled: false, chars: cur, waitedMs: Date.now() - t0 };
    await new Promise((r) => setTimeout(r, gapMs));
  }
}
/** 先等到成立、**再复查它是否被翻掉**：B74 的症状正是"先对、随后被晚到的旧响应覆盖"。
 *  只做"首次相等即返回"的轮询等于看不见这个缺陷（对抗审查查出的真实漏判）。*/
async function assertStays(c, kind, label, probe, { firstTimeoutMs = 25000, recheckMs = 8000, rechecks = 2 } = {}) {
  const t0 = Date.now();
  let last = { ok: false, detail: '一次都没判到' };
  for (;;) {
    last = await probe();
    if (last.ok || Date.now() - t0 > firstTimeoutMs) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  const settledAt = Date.now();
  const flips = [];
  for (let i = 0; i < rechecks; i++) {
    await new Promise((r) => setTimeout(r, recheckMs));
    const again = await probe();
    if (!again.ok) flips.push(`第 ${i + 1} 次复查翻掉：${again.detail}`);
  }
  const ok = last.ok && !flips.length;
  assert(c, kind, label, ok, `${last.detail}（首判等 ${settledAt - t0}ms，复查 ${rechecks} 次${flips.length ? '，' + flips.join('；') : '无翻转'}）`);
  return ok;
}
/** 有界轮询判据：每轮重新读 DOM 再判，成立即绿、超时按真红。
 *  用在"点击之后才决定显示什么"的剧本上（E4 切视图、E5 切类型）——
 *  这些地方的 DOM 会晚于响应一帧；不轮询就会把慢接口/首帧抖动记成产品缺陷（本轮实测 3 次里红 1 次）。
 *  注意它**不放宽判据本身**：谓词与一次性的完全一样，只是给它一个收敛窗口。*/
async function untilAssert(c, kind, label, probe, timeoutMs = 25000, gapMs = 1500) {
  const t0 = Date.now();
  let last = { ok: false, detail: '一次都没判到' };
  for (;;) {
    last = await probe();
    if (last.ok || Date.now() - t0 > timeoutMs) break;
    await new Promise((r) => setTimeout(r, gapMs));
  }
  assert(c, kind, label, last.ok, `${last.detail}（窗口 ${Date.now() - t0}ms）`);
  return last.ok;
}
const rowsOf = (page, sel) => page.$$eval(sel, (els) => els.slice(0, 60).map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
const buttonsOf = (page) => page.$$eval('button', (els) => els.map((e) => e.innerText.trim().replace(/\s+/g, ' ')).filter(Boolean));
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const clickBtn = (page, name) => page.getByRole('button', { name: new RegExp('^' + name + '$') }).first().click({ timeout: 8000 }).then(() => true).catch(() => false);

// ───────────────── 剧本 ─────────────────
const SCENARIOS = [
  {
    id: 'E1', title: '阅读器今日流：渲染 ↔ 页面自己拿到的 /api/articles 对账',
    async run(page, c, target, net) {
      net.length = 0;
      const ok = await goto(page, c, target + '/reader/', SEL.readerRow);
      const resp = await waitForApi(net, '/api/articles');
      const items = [...collected(net, '/api/articles').values()];
      assert(c, 'api', '页面自身发出的 /api/articles 返回 200 且带 items', !!resp && resp.status === 200 && items.length > 0,
        resp ? `status=${resp.status} n=${items.length}` : '没拦到该请求');
      assert(c, 'api', '每条含 id + 非空 title（B27 类字段形状漂移在此红）',
        items.every((x) => x && x.id && String(x.title || '').trim().length > 1), `首条键=${items[0] ? Object.keys(items[0]).slice(0, 6).join(',') : '无'}`);
      const n = await stableCount(page, SEL.readerRow);
      assert(c, 'render', `列表渲染出行（${SEL.readerRow}）`, ok && n > 0, `rows=${n}`);
      // 选择器自检：本引擎第一版就是拿 `div.cursor-pointer.flex.gap-2` 数文章行，实际数到的是侧栏源行
      const inAside = await page.$$eval(SEL.readerRow, (els) => els.filter((e) => e.closest('aside')).length).catch(() => -1);
      assert(c, 'render', '文章行选择器没有落到侧栏（防"数错元素"式假对账）', inAside === 0, `侧栏内命中 ${inAside}`);
      const dom = await rowsOf(page, SEL.readerRow);
      c.renderedText = dom.slice(0, 12).join('\n');
      assert(c, 'render', '渲染文本不是占位文案', emptyStateHits(c.renderedText).length === 0 && dom.length > 0);
      assert(c, 'data', 'DOM 行数不超过响应条数（页面不得凭空多渲）', n > 0 && n <= items.length, `DOM=${n} API=${items.length}`);
      const ri = renderedInResponse(dom, items);
      // 列表页常有合并/懒加载（实测 34 行 ↔ 40 条、24 行 ↔ 200 条），所以按"响应条目有多少真上了屏"判，
      // 而不是拿两个数硬比：漏得多才是缺陷，少几条渲染是页面自己的展示策略
      assert(c, 'data', '响应条目渲染到列表（缺失 ≤20%）', ri.miss.length <= Math.max(2, Math.floor(ri.n * 0.2)),
        `缺 ${ri.miss.length}/${ri.n}${ri.miss.length ? '：' + ri.miss[0].slice(0, 46) : ''}`);
      const sub = subsetConsistency(dom, items);
      assert(c, 'data', '列表每一行都能在响应里找到（无孤儿行）', sub.miss.length === 0,
        `孤儿 ${sub.miss.length}/${sub.domN}${sub.miss.length ? '：' + sub.miss[0].slice(0, 46) : ''}`);
    },
  },
  {
    id: 'E2', title: '阅读器「视频」Tab：切过去渲染的是视频卡，文章行清零',
    async run(page, c, target, net) {
      net.length = 0;
      await goto(page, c, target + '/reader/', SEL.readerRow);
      assert(c, 'render', '切换前渲染的是文章流', (await rowsOf(page, SEL.readerRow)).length > 0);
      net.length = 0;
      assert(c, 'render', '点得到「视频」筛选', await clickBtn(page, '视频'));
      const resp = await waitForApi(net, '/api/videos');
      const items = [...collected(net, '/api/videos').values()];
      assert(c, 'api', '页面发出的 /api/videos 返回 200 且带 items', !!resp && resp.status === 200 && items.length > 0,
        resp ? `status=${resp.status} n=${items.length}` : '没拦到该请求');
      const n = await stableCount(page, SEL.videoCard);
      assert(c, 'data', '视频网格渲染出卡片（不是文章行）', n > 0, `${SEL.videoCard} ×${n}`);
      const dom = await rowsOf(page, SEL.videoCard);
      c.renderedText = dom.slice(0, 8).join('\n');
      assert(c, 'render', '视频卡文本不是占位文案', emptyStateHits(c.renderedText).length === 0);
      assert(c, 'data', '视频卡数 ↔ 页面响应 items 数（±3 分页）', countMatches(n, items.length), `DOM=${n} API=${items.length}`);
      assert(c, 'data', '切换后文章行已消失（两类列表没同时渲染）',
        (await page.$$eval(SEL.readerRow, (e) => e.length).catch(() => 0)) === 0);
    },
  },
  {
    id: 'E3', title: '每日早报：栏目 pill 条数逐列 ↔ 页面响应 report.sections[].column',
    async run(page, c, target, net) {
      net.length = 0;
      const ok = await goto(page, c, target + '/daily/', SEL.dailyRow);
      const resp = await waitForApi(net, '/api/daily');
      const rep = (resp && resp.json && resp.json.report) || {};
      const secs = rep.sections || [];
      assert(c, 'api', '页面发出的 /api/daily 返回 200 且 report.sections 非空', !!resp && resp.status === 200 && secs.length > 0,
        resp ? `status=${resp.status} sections=${secs.length}` : '没拦到该请求');
      assert(c, 'api', 'sections 形状是 {column, desc, items[]}（字段漂移会在这里红）',
        secs.every((s) => s && typeof s.column === 'string' && Array.isArray(s.items)));
      assert(c, 'api', 'report 带 schemaVersion（W2 读侧档位口径的前提字段）', rep.schemaVersion !== undefined);
      const n = await stableCount(page, SEL.dailyRow);
      assert(c, 'render', '日报列表渲染', ok && n > 0, SEL.dailyRow);
      c.renderedText = (await rowsOf(page, SEL.dailyRow)).slice(0, 10).join('\n');
      assert(c, 'render', '日报正文没有占位文案', emptyStateHits(c.renderedText).length === 0 && n > 5);
      const pills = pillCounts(await buttonsOf(page));
      const matched = secs.filter((s) => pills[s.column] !== undefined);
      assert(c, 'data', '≥3 个栏目 pill 在页面上带条数（档位分层可见，B39）',
        matched.length >= 3, `可见 ${matched.length}/${secs.length}：${secs.map((s) => `${s.column}=${pills[s.column]}`).join(' , ')}`);
      for (const s of matched) assert(c, 'data', `栏目「${s.column}」pill ↔ API items 数`, pills[s.column] === s.items.length, `DOM=${pills[s.column]} API=${s.items.length}`);
      // B85 回归（判据来自实测基线，不是拍脑袋）：修前该页最长行 594px——来源名不设界把标题列
      // 挤到 0 宽，而 0 宽下 line-clamp 不裁剪；修后实测 37 行最长 129px、标题列最小 160px。
      // 阈值 160 = 129 + 余量，仍远低于"一行占半屏"的故障形态。
      const rowGeo = await page.$$eval('div.card.card-lift.divide-y > div', (els) => els.map((e) => {
        const t = e.querySelector('span.line-clamp-2');
        return { h: Math.round(e.getBoundingClientRect().height), titleW: t ? Math.round(t.getBoundingClientRect().width) : -1 };
      })).catch(() => []);
      const maxH = rowGeo.length ? Math.max(...rowGeo.map((r) => r.h)) : 0;
      const withTitle = rowGeo.filter((r) => r.titleW >= 0);
      const minW = withTitle.length ? Math.min(...withTitle.map((r) => r.titleW)) : 0;
      c.metrics.dailyRowGeo = `rows=${rowGeo.length} maxH=${maxH} minTitleW=${minW}`;
      assert(c, 'render', '日报行高受限（B85 曾有行撑到 594px）', rowGeo.length > 0 && maxH <= 160, c.metrics.dailyRowGeo);
      assert(c, 'render', '标题列宽度有下限（B85 根因＝标题列被挤到 0 宽）',
        withTitle.length > 0 && minW >= 100, `${c.metrics.dailyRowGeo} 带标题行=${withTitle.length}`);
    },
  },
  {
    id: 'E4', title: '热点榜三视图：每个 tab 渲染的确实是该 tab 的数据（B28 列表↔计数同源）',
    async run(page, c, target, net) {
      net.length = 0;
      const ok = await goto(page, c, target + '/hot/', SEL.hotCard);
      assert(c, 'render', '热点榜默认视图渲染', ok, SEL.hotCard);
      // 三个视图的行 DOM 与数据源不同（实测）：featured/all 是文章卡，热搜事件是事件行 + /api/hot/events
      const tabs = [
        { label: 'AI 精选', tab: 'featured', sel: SEL.hotCard, path: '/api/hot' },
        { label: 'AI 信息实时流', tab: 'all', sel: SEL.hotCard, path: '/api/hot' },
        { label: '热搜事件', tab: 'hotlist', sel: SEL.hotEventRow, path: '/api/hot/events', mode: 'cover' },
      ];
      for (const t of tabs) {
        const q = t.path === '/api/hot' ? '?' + new URLSearchParams({ tab: t.tab }) : '';
        const probe = await api(page, c, t.path + q, t.path === '/api/hot' ? { tab: { value: t.tab, source: SRC.hotTab } } : {});
        const items = (probe.json && (probe.json.items || probe.json.events)) || [];
        assert(c, 'api', `${t.label}：${t.path}${q} 返回 200 且非空`, probe.status === 200 && items.length > 0, `status=${probe.status} n=${items.length}`);
        // **不在这里清 net**：SPA 首屏已经把该视图的数据取回来了（实测 `/hot/` 默认视图的
        // `/api/hot?tab=featured` 就在 first paint 那批里），清点之后再点同一个 tab 不会再发请求，
        // 于是"页面自己的请求"永远拦不到。09-19 之前这里是**假绿**：`waitForApi` 拿到的其实是
        // 上面那条探针自己的响应（当时还没打 by:'script' 标记）——脚本自己发、自己证明页面发过。
        assert(c, 'render', `点得到「${t.label}」`, await clickBtn(page, t.label));
        const own = await waitForApiWhere(net,
          (r) => r.url === t.path && (!q || ((r.params.tab || {}).value === t.tab)), 20000);
        await waitRendered(page, { minChars: 500, timeoutMs: 30000 });
        const ownItems = (own && own.json && (own.json.items || own.json.events)) || [];
        assert(c, 'api', `「${t.label}」页面自己的请求返回非空`, !!own && ownItems.length > 0,
          own ? `n=${ownItems.length}` : `没拦到（本轮页面只发过：${[...new Set(net.filter(byPage).map((r) => r.url + '?' + ((r.params.tab || {}).value || '')))].join(' , ') || '无'}）`);
        const dom = await stableCount(page, t.sel, 8, 800);
        const domRows = await rowsOf(page, t.sel);
        const txt = domRows.join(' ');
        // 判据是**包含关系**：渲染出来的每一行都得在这次响应里找得到。
        // （/hot/ 实测 24 行 ↔ 响应 200 条 —— 页面自己只铺第一段，所以不能按位置前缀判）
        if (t.mode === 'cover') {
          await untilAssert(c, 'data', `「${t.label}」响应里的事件渲染到页面（缺少数 ≤20%）`, async () => {
            const cov = responseCovered(await bodyText(page), ownItems, 10);
            return { ok: cov.n > 0 && cov.miss.length <= Math.floor(cov.n * 0.2),
              detail: `未出现 ${cov.miss.length}/${cov.n}${cov.miss.length ? '：' + cov.miss[0].slice(0, 40) : ''}` };
          });
        } else {
          await untilAssert(c, 'data', `「${t.label}」每一行都出自这次响应（无接口没给的内容）`, async () => {
            const sub = subsetConsistency(await rowsOf(page, t.sel), ownItems);
            return { ok: sub.miss.length === 0 && sub.domN > 0 && sub.domN <= sub.apiN,
              detail: `漏 ${sub.miss.length}/${sub.domN}（API=${sub.apiN}）${sub.miss.length ? '：' + sub.miss[0].slice(0, 46) : ''}` };
          });
        }
        if (t.tab === 'featured') c.renderedText = (await rowsOf(page, t.sel)).join(' ').slice(0, 400);
      }
    },
  },
  {
    id: 'E5', title: '我的阅读：type 筛选后 DOM 与 /api/reading 计数逐个同源（B60 四处口径）',
    async run(page, c, target, net) {
      net.length = 0;
      await goto(page, c, target + '/reading/', SEL.readingCard);
      assert(c, 'render', '我的阅读渲染出卡片', (await stableCount(page, SEL.readingCard)) > 0);
      // 探针必须在 goto 之后发：page 还停在 about:blank 时 fetch 直接 status 0（会被误读成"接口挂了"）
      const probe = (type) => api(page, c, '/api/reading?' + new URLSearchParams({ tab: 'all', type }),
        { tab: { value: 'all', source: SRC.readingTab }, type: { value: type, source: SRC.readingType } });
      let all = await probe('all');
      let art = await probe('article');
      const countsOf = (r) => (r && r.json && r.json.counts) || {};
      // 冷启动实测：验收轮第 1 轮 type=article 那条**根本没带 counts**（B73/B31 慢接口族），
      // 而上一版判据是 `Number(undefined) !== Number(25155)` → `NaN !== 数字` 恒真，
      // 等于把"没拿到数据"判成"口径生效"（坑 #50 的假绿版本）。现在：两侧必须是有限数，
      // 缺数据时有界重试（最多 90s）并把等待时长记进 metrics——慢是可见事实，不被等待吸收掉。
      const t0 = Date.now();
      while ((!Number.isFinite(Number(countsOf(all).all)) || !Number.isFinite(Number(countsOf(art).all))) && Date.now() - t0 < 90000) {
        await new Promise((rr) => setTimeout(rr, 5000));
        all = await probe('all'); art = await probe('article');
      }
      c.metrics.readingCountsWaitMs = Date.now() - t0;
      assert(c, 'api', '/api/reading 两种 type 均 200 且 counts.all 是有限数（有界重试后仍缺即红）',
        [all, art].every((r) => r.status === 200 && Number.isFinite(Number(countsOf(r).all))),
        `all=${JSON.stringify(countsOf(all)).slice(0, 90)} article=${JSON.stringify(countsOf(art)).slice(0, 90)} 已重试 ${c.metrics.readingCountsWaitMs}ms`);
      const artItems = (art.json || {}).items || [];
      // 不再断言"type=article 与 type=all 的 id 集合必须不同"：云端实测阅读沉淀里视频为 0，
      // 两个 type 的首屏 30 条**本来就可能完全相同**（判据来自猜而不是实测）。口径是否生效由下面的
      // counts 差异 + 计数 pill 对账来判。
      const cAll = Number(countsOf(all).all); const cArt = Number(countsOf(art).all);
      assert(c, 'api', 'type=article 的 counts.all 与 type=all 不同，且两侧都是数字（口径真的生效）',
        Number.isFinite(cAll) && Number.isFinite(cArt) && cArt !== cAll,
        `article=${cArt} all=${cAll}${Number.isFinite(cArt) && cArt === cAll ? ' ← 相同，说明 type 没进计数口径' : ''}（NaN/缺数一律算红，不再拿"没数据"当"不同"）`);
      // 先等首屏那条 type=all 落地再点（清空 store 之前等，否则 waitQuiet 看不到任何响应会白等满超时）
      const quiet1 = await waitQuiet(net, '/api/reading');
      c.metrics.quietBeforeArticle = quiet1;
      net.length = 0;
      assert(c, 'render', '点得到类型筛选「文章」', await clickBtn(page, '文章'));
      // 实测：点击后页面确实发了 type=article，但**这条响应可达 26s**（首屏那条 type=all 更慢）。
      // 所以必须等"参数对得上的那条响应"到达再读数，否则会把慢接口误判成筛选失效（判据来自猜）。
      const own = await waitForApiWhere(net, (r) => r.url === '/api/reading' && ((r.params.type || {}).value === 'article'), RENDER);
      const ownItems = (own && own.json && own.json.items) || [];
      const dom = await stableCount(page, SEL.readingCard);
      c.renderedText = (await rowsOf(page, SEL.readingCard)).slice(0, 8).join('\n');
      assert(c, 'render', '筛选后是真实标题而不是占位文案', dom > 0 && emptyStateHits(c.renderedText).length === 0);
      assert(c, 'api', '点击后页面确实按 type=article 重新请求（筛选接到了参数）', !!own,
        own ? `type=article 响应已达（counts=${JSON.stringify(own.json.counts)}）` : `等 ${RENDER / 1000}s 没等到 type=article 的响应`);
      const cnt = (own && own.json && own.json.counts) || {};
      assert(c, 'data', '筛选后行数 ↔ 该响应的 items 数', countMatchesPage(dom, ownItems.length, PAGE_SIZE.reading), `DOM=${dom} API=${ownItems.length}`);
      // 响应到 DOM 之间有一帧滞后（实测每轮都是"网络层先到、pill 晚一帧"），所以有界轮询后再判；
      // 超时即真红——吸收的是渲染帧差，**不吸收口径不一致**（B60 那类"各写一份"不会因多等而变一致）。
      let tabs = {};
      // 用 assertStays 而不是 waitUntil：B74 的症状是"先对、随后被晚到的旧响应覆盖回去"，
      // 首次相等就收工等于看不见它（对抗审查查出的漏判）。谓词一字未改，只是多了两次复查。
      const pillOk = await assertStays(c, 'data', '三个 tab 的计数 pill 与同一份响应对账且不被翻掉（B60/B74）', async () => {
        tabs = pillCounts(await buttonsOf(page));
        return {
          ok: tabs['全部'] === Number(cnt.all) && tabs['已收藏'] === Number(cnt.favorited) && tabs['已读'] === Number(cnt.read),
          detail: `DOM=${JSON.stringify(tabs)} API=${JSON.stringify(cnt)}`,
        };
      }, { firstTimeoutMs: 25000, recheckMs: 8000, rechecks: 2 });
      c.metrics.pillSettleOk = pillOk;
      const ri = renderedInResponse(await rowsOf(page, SEL.readingCard), ownItems);
      assert(c, 'data', '响应的首屏条目都渲染出来了（无漏行）', ri.miss.length <= 2, `缺 ${ri.miss.length}/${ri.n}${ri.miss.length ? '：' + ri.miss[0].slice(0, 40) : ''}`);
      // 视频筛选：先等页面"没有新请求在飞"（否则上一型的慢响应会后到并覆盖，红就说不清是谁的锅），
      // 再点、再等到"参数对得上的响应"、再给一帧窗口。云端实测收藏视频为 0 → 必须是显式空态而不是残留上一批
      c.metrics.readingResponses = net.filter((r) => r.url === '/api/reading').map((r) => ({ by: r.by, type: (r.params.type || {}).value, bytes: r.bytes, counts: (r.json || {}).counts }));
      const vid = await probe('video');
      const vidN = ((vid.json || {}).items || []).length;
      await waitQuiet(net, '/api/reading');
      net.length = 0;
      assert(c, 'render', '点得到类型筛选「视频」', await clickBtn(page, '视频'));
      const vidOwn = await waitForApiWhere(net, (r) => r.url === '/api/reading' && ((r.params.type || {}).value === 'video'), RENDER);
      const vidItems = (vidOwn && vidOwn.json && vidOwn.json.items) || [];
      assert(c, 'api', 'type=video 的接口口径与页面响应一致（探针↔页面同源）', vidN === vidItems.length, `探针=${vidN} 页面响应=${vidItems.length}`);
      // 同一条口径：这里也必须"复查不翻转"。首屏那条 type=all 慢响应（实测 15~30s）正是晚到后
      // 把空态覆盖回 30 行文章的，untilAssert 的首次命中看不见它（B74 的漏判版本）。
      await assertStays(c, 'data', '视频筛选的 DOM 条数与该响应一致且不被翻掉（0 则必须是显式空态）', async () => {
        const shown = await page.locator(SEL.readingCard).count();
        const t = await bodyText(page);
        return {
          ok: vidItems.length > 0 ? shown > 0 : (shown === 0 && t.includes(EMPTY_READING)),
          detail: `DOM=${shown} API=${vidItems.length}${vidOwn ? '' : '（没等到 type=video 响应）'}`,
        };
      }, { firstTimeoutMs: 25000, recheckMs: 8000, rechecks: 2 });
    },
  },
  {
    id: 'E6', title: '我的早报 + 精选周刊：产物页渲染、渲染内容出自产物、无污染串',
    async run(page, c, target, net) {
      net.length = 0;
      await goto(page, c, target + '/mybrief/', SEL.mybriefCard);
      const n1 = await stableCount(page, SEL.mybriefCard);
      assert(c, 'render', '我的早报渲染出内容卡', n1 > 0, `${SEL.mybriefCard} ×${n1}`);
      const mb = await waitForApi(net, '/api/mybrief', 20000);
      assert(c, 'api', '页面发出的 /api/mybrief 返回 200 且带 report', !!mb && mb.status === 200 && !!(mb.json && mb.json.report),
        mb ? `status=${mb.status}` : '没拦到该请求');
      const dom1 = await rowsOf(page, SEL.mybriefCard);
      // 三组卡（TOP1 大卡 / 视频卡 / 列表卡）实测共 30 张，总数随板块开关变化 →
      // 判据用"每张卡都能在这份产物的标题里找到归属"（孤儿卡 = 页面上渲染了产物里没有的东西）
      const titles = collectTitles((mb && mb.json) || {});
      const orphans = orphanCards(dom1, titles);
      assert(c, 'data', '我的早报每张卡都出自产物（无孤儿卡）', titles.length > 0 && orphans.length === 0,
        `产物标题 ${titles.length} 条，孤儿卡 ${orphans.length}/${dom1.length}${orphans.length ? '：' + orphans[0].slice(0, 40) : ''}`);
      // B84 回归：视频/播客卡左栏必须有真实图形（封面图 / 源头像 / 首字块 / 内联 SVG）。
      // 修前无封面的播客卡只有一枚 emoji 冒充图标（缺字库时字面"没有图标"），
      // 且生成端 lib/media.js 早就声明了"由源头像兜底"却没实现——这条钉住契约真的落到 DOM。
      const apiMedia = (((((mb && mb.json) || {}).report || {}).sections) || {}).media || [];
      const mediaGeo = await page.$$eval('article.card', (els) => els
        .filter((a) => [...a.querySelectorAll('span')].some((s) => ['视频', '播客'].includes(s.textContent.trim())))
        .map((a) => {
          const col = a.firstElementChild;
          return { art: !!col && !!col.querySelector('img, svg, .avatar-fallback'), emoji: /[🎧▶]/.test((col && col.textContent) || '') };
        }), []).catch(() => []);
      const pageTxt = await bodyText(page);
      c.metrics.mediaCards = `DOM=${mediaGeo.length} API=${apiMedia.length} art=${mediaGeo.filter((x) => x.art).length} emoji=${mediaGeo.filter((x) => x.emoji).length}`;
      assert(c, 'render', '视频/播客卡渲染条数 = 产物 media 条数', mediaGeo.length === apiMedia.length, c.metrics.mediaCards);
      assert(c, 'render', '每张视频/播客卡左栏都有真实图形（B84）',
        apiMedia.length === 0 || mediaGeo.every((x) => x.art), c.metrics.mediaCards);
      assert(c, 'render', '整页不再用 emoji 冒充播放/收听图标（B84；此条与数据无关，永远会红）',
        !/[🎧▶]/.test(pageTxt) && mediaGeo.every((x) => !x.emoji), c.metrics.mediaCards);
      net.length = 0;
      await goto(page, c, target + '/weekly/', 'h1,h2,h3');
      const heads = await page.$$eval('h1,h2,h3', (els) => els.map((e) => e.innerText.trim()).filter(Boolean));
      assert(c, 'render', '周刊渲染出标题层级', heads.length >= 3, heads.slice(0, 3).join(' / ').slice(0, 120));
      const wk = await waitForApi(net, '/api/weekly', 20000);
      const rep = (wk && wk.json && wk.json.report) || {};
      const picks = rep.items || [];
      const lines = rep.storylines || [];
      assert(c, 'api', '页面发出的 /api/weekly 返回 200 且 report.items/storylines 非空',
        !!wk && wk.status === 200 && picks.length > 0 && lines.length > 0, `items=${picks.length} storylines=${lines.length}`);
      const n2 = await stableCount(page, SEL.weeklyRow);
      const body = await bodyText(page);
      c.renderedText = (dom1.join('\n') + '\n' + body).slice(0, 1500);
      assert(c, 'data', '周刊条数 ↔ report.items 条数（±4）', countMatches(n2, picks.length, 4), `DOM=${n2} API=${picks.length}`);
      assert(c, 'data', '页面显示的期号 = API report.issue', body.includes(`第 ${rep.issue} 期`), `issue=${rep.issue}`);
      const hit = lines.slice(0, 6).filter((s) => body.includes(String(s.title || '').slice(0, 10))).length;
      assert(c, 'data', '周刊 storylines 出现在页面上（≥3 条）', hit >= 3, `前 6 条命中 ${hit}`);
      assert(c, 'render', 'AI 产物无污染串（围栏残留 / undefined / NaN / [object Object]）', !DIRTY_PRODS.test(body), (body.match(DIRTY_PRODS) || [''])[0]);
    },
  },
  {
    id: 'E7', title: '客户端路由与深链：点导航不整页刷新、刷新不丢位置（P0-5 / 38-3 前置）',
    async run(page, c, target, net) {
      net.length = 0;
      await goto(page, c, target + '/reader/', SEL.readerRow);
      // 判"没整页刷新"要一个**真会翻转**的观测量。早先用 performance navigation 计数，
      // 但整页导航后新 document 的计数同样是 1 → 两侧恒等，刷新与不刷新都成立 = 空判据（reviewer 指出，已删）。
      // 改为：在 window 上打标记，硬刷新必然清掉它；同时看网络层有没有再拉 document。
      await page.evaluate(() => { window.__e2eCtxAlive = 'alive'; });
      assert(c, 'render', '点得到左栏「每日早报」',
        await page.locator(`${SEL.railBtn}[href="/daily/"]`).first().click({ timeout: 8000 }).then(() => true).catch(() => false));
      await page.waitForTimeout(SETTLE);
      const rowsN = await stableCount(page, SEL.dailyRow, 6, 800);
      assert(c, 'render', 'URL 变 /daily/ 且日报行出现', page.url().includes('/daily/') && rowsN > 0, `${page.url()} rows=${rowsN}`);
      const alive = await page.evaluate(() => String(window.__e2eCtxAlive || ''));
      const docs = net.filter((r) => r.kind === 'doc' && byPage(r));
      assert(c, 'data', '点导航后 JS 上下文存活（window 标记还在 = 没有整页刷新）', alive === 'alive', `标记=${alive || '(被清了)'}`);
      assert(c, 'api', '点「每日早报」没重新拉 HTML（document 请求仍只有首屏那一次）', docs.length === 1,
        `document 响应 ${docs.length} 次：${docs.map((d) => d.url).join(',')}`);
      assert(c, 'api', '切页后页面自己重新取到 /api/daily', !!(await waitForApi(net, '/api/daily', 15000)));
      // 深链 + 刷新 = 一次**冷 document**：/api/hot 还没落地就数行，必然把"慢"读成"空壳"
      // （验收轮第 1 轮就是这么红的，而上一版这条判据连读数都没记 → 红了也说不清）。
      net.length = 0;
      await goto(page, c, target + '/hot/', SEL.hotCard);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV });
      const hotOwn = await waitForApi(net, '/api/hot', 45000);
      await waitRendered(page, { minChars: 500, timeoutMs: 30000 });
      const hotN = await stableCount(page, SEL.hotCard, 8, 800);
      assert(c, 'data', '深链 + 刷新仍停在热点榜（有内容不是空壳）', hotN > 0,
        `刷新后卡片 ${hotN} 张，/api/hot ${hotOwn ? `已到达(status=${hotOwn.status}, ${hotOwn.bytes}B)` : '45s 内没到达'}，整页 ${await bodyText(page).then((t) => t.length)} 字`);
      assert(c, 'api', '刷新后公共数据链路仍活着（/api/settings 由 store 拉取）', !!(await waitForApi(net, '/api/settings', 15000)));
      c.renderedText = (await bodyText(page)).slice(0, 300);
    },
  },
  {
    id: 'E8', title: '七个页面：无 JS pageerror、无裸 i18n key 泄漏、后台登录门本地化（B71）',
    async run(page, c, target, net, dict) {
      const list = ['/reader/', '/daily/', '/hot/', '/reading/', '/weekly/', '/mybrief/', '/admin/'];
      const leaks = []; const errs = []; const texts = {}; const settle = {}; const emptyPages = {};
      let adminBtn = '';
      // 每页"应当有内容"的前提是**它自己的数据请求已经落地**。上一版只等 30s 渲染稳定，
      // 于是 /api/weekly 冷启动慢的那一轮被读成"124 字的页面"——那是把"慢"判成"空壳"（坑 #48/#53 同源）。
      const PAGE_API = { '/reader/': '/api/articles', '/daily/': '/api/daily', '/hot/': '/api/hot',
        '/reading/': '/api/reading', '/weekly/': '/api/weekly', '/mybrief/': '/api/mybrief' };
      const arrived = {};
      for (const p of list) {
        page.once('pageerror', (e) => errs.push(`${p}: ${String(e.message).slice(0, 100)}`));
        net.length = 0;
        await page.goto(target + p, { waitUntil: 'domcontentloaded', timeout: NAV });
        await page.waitForSelector('body', { timeout: 20000 });
        if (PAGE_API[p]) {
          const own = await waitForApi(net, PAGE_API[p], 60000);
          arrived[p] = own ? { status: own.status, bytes: own.bytes, ms: own.ms } : null;
        }
        const st = await waitRendered(page, { minChars: p === '/admin/' ? 120 : 500, timeoutMs: 30000 });
        texts[p] = st.chars;
        settle[p] = st;
        const txt = await bodyText(page);
        texts[p] = txt.length;
        // 产物页有**第二种合法态**：显式空态。验收轮实测第 3 轮 `/mybrief/` 只有 218 字——
        // 那是 B76 归一后页面正常落到「今天订阅源没有新的精选内容」（runner 当批写出的是空态），
        // 不是白屏。所以判据写成"要么 >500 字内容，要么命中空态文案"：
        // 白屏/半空壳两条都不满足，仍然红——放行的是合法态，不是把门槛调低。
        const EMPTY_OK = ['今天订阅源没有新的精选内容', '我的早报需要你的订阅', EMPTY_READING,
          '首期精选周刊将在周五 18:00 生成'];
        const es = EMPTY_OK.filter((s) => txt.includes(s));
        if (es.length) emptyPages[p] = es[0];
        if (p === '/admin/') adminBtn = await page.$$eval('button', (els) => els.map((e) => e.innerText.trim()).filter(Boolean).join(' | ')).catch(() => '');
        leaks.push(...rawKeyHits(txt, dict).map((k) => `${p}→${k}`));
      }
      assert(c, 'render', '七个页面都没有未挂 Provider 造成的裸 key 泄漏', leaks.length === 0, leaks.slice(0, 6).join(' , '));
      assert(c, 'render', '七个页面均无 JS pageerror', errs.length === 0, errs.slice(0, 3).join(' , '));
      assert(c, 'render', '后台登录按钮是本地化文案（不是 `login.submit`）',
        /登录|Sign In/i.test(adminBtn) && !adminBtn.includes('login.'), adminBtn.slice(0, 120));
      c.metrics.emptyPages = emptyPages;
      c.metrics.settle = settle;
      c.metrics.pageApiArrived = arrived;
      const redPages = Object.entries(texts).filter(([p, v]) => p !== '/admin/' && v <= 500 && !(p in emptyPages));
      assert(c, 'data', '前台六页各有 >500 字内容或显式空态（白屏与半空壳仍算红）', redPages.length === 0,
        JSON.stringify(texts) + (Object.keys(emptyPages).length ? ` 空态页=${JSON.stringify(emptyPages)}` : '') +
        (redPages.length ? ` 红页读数=${redPages.map(([p]) => `${p}: 等API=${arrived[p] ? JSON.stringify(arrived[p]) : 'n/a'}/${settle[p] && settle[p].settled ? '渲染稳定' : '渲染未稳定'} @${settle[p] && settle[p].waitedMs}ms`).join(' ; ')}` : ''));
      // 后台未登录只有登录门（实测 190 字），"不白屏"要判的是**门在不在**而不是字数：
      // 必须有口令输入框 + 有可见文案，否则就是白屏或裸壳
      const hasPwd = await page.locator('input[type=password]').count();
      assert(c, 'data', '后台登录门未白屏：有口令输入框且文案非空（实测 190 字）', hasPwd > 0 && texts['/admin/'] > 100,
        `password 输入框 ${hasPwd} 个，/admin/ 文本 ${texts['/admin/']} 字`);
      const who = await api(page, c, '/api/auth/me');
      assert(c, 'api', '未登录时 /api/auth/me 返回 401/403（登录门是真门槛，不是只有前端遮罩）',
        who.status === 401 || who.status === 403, `status=${who.status}`);
      c.renderedText = adminBtn;
    },
  },
  {
    id: 'E9', title: '点开一篇文章：详情正文渲染（B52 类"接口 200 但页面空"）',
    async run(page, c, target, net, dict) {
      net.length = 0;
      await goto(page, c, target + '/reader/', SEL.readerRow);
      const list = await waitForApi(net, '/api/articles');
      const items0 = (list && list.json && list.json.items && list.json.items[0]) || null;
      const first = await rowsOf(page, SEL.readerRow);
      const head = String((items0 && items0.title) || first[0] || '').slice(0, 12);
      assert(c, 'render', '列表有可点的行', first.length > 0 && !!items0, head);
      const before = (await bodyText(page)).length;
      // 点的是"页面自己响应里的第 1 条"，不是"DOM 第 1 个"——两者不一致时后面所有对账都会错位
      const row = page.locator(SEL.readerRow).filter({ hasText: String(items0.title).slice(0, 20) }).first();
      assert(c, 'render', '点得到那篇文章所在的行', await row.click({ timeout: 8000 }).then(() => true).catch(() => false), head);
      const det = await waitForApiWhere(net, (r) => /^\/api\/articles\/\d+$/.test(r.url), 20000);
      const item = (det && det.json && (det.json.item || det.json)) || {};
      const rawHtml = String(item.content_html || item.content || '');
      // 面板默认渲染**译文**（ArticleView.jsx:244 的 showTranslated 分支），所以正文对账要跟
      // `translated_content` 比，不是跟英文原文比——验收轮 3/3 就是这么红的：
      // 切片取自原文「…ean account. I specifica…」，而屏上是中文译文。
      const shownHtml = String(item.translated_content || rawHtml || '');
      c.metrics.detailBodySource = item.translated_content ? 'translated_content' : 'content_html';
      c.metrics.detailOrigChars = String(item.content_html || '').replace(/<[^>]*>/g, ' ').length;
      // 判据是"非空"而不是"长度 >200"：实测今日流里就有正文只有 98 字的源（薄正文通道），
      // 拿一个拍出来的长度当门槛会把正常渲染判成缺陷；真正的 B52 症状是**根本没返回正文**。
      assert(c, 'api', '页面发出的详情请求返回 200 且带非空 content_html',
        !!det && det.status === 200 && rawHtml.length > 0,
        det ? `${det.fullUrl} status=${det.status} len=${rawHtml.length} 键=${Object.keys(item).slice(0, 6).join(',')}` : '没拦到详情请求');
      let after = before;
      for (let i = 0; i < 12; i++) {
        after = (await bodyText(page)).length;
        if (after > before + 200) break;
        await page.waitForTimeout(800);
      }
      const txt = await bodyText(page);
      c.renderedText = txt.slice(0, 800);
      // 只要求"显著增长"（实测薄正文条目整屏只多 400 字，>500 是我拍的门槛，会把正常渲染判成缺陷）；
      // 真判据在下面那条：详情面板自身必须出现 >300 字的正文
      assert(c, 'render', '详情展开后页面文本显著增长', after > before + 200, `文本 ${before}→${after}`);
      // 详情面板用组件自己的钩子（实测 ArticleView.jsx:241 打开时渲染 `article.max-w-[720px]`，
      // 未选文章时渲染 selectHint）。上一版按"含标题且 >300 字的最小容器"取面板，结果列表行的
      // 摘要 div（105 字，出现 12 次）就能满足判据 —— 等于全不渲染详情也能绿（对抗审查查出）。
      const hint = dict && dict['article.selectHint'] ? dict['article.selectHint'] : '从左侧选择文章';
      const pane = await page.evaluate(({ title, hintTxt }) => {
        const arts = [...document.querySelectorAll('article')].filter((e) => e.innerText && e.innerText.includes(title));
        if (!arts.length) return { found: false, len: 0, hintStill: document.body.innerText.includes(hintTxt), text: '' };
        arts.sort((a, b) => a.innerText.length - b.innerText.length);
        const t = arts[0].innerText;
        return { found: true, len: t.length, hintStill: document.body.innerText.includes(hintTxt), text: t.slice(0, 2000) };
      }, { title: String(items0 && items0.title || head), hintTxt: hint });
      // 判据不能是"面板 >300 字"：本轮实测今日流里就有 `content_html` 明文只有 112 字的薄正文条目，
      // 面板真实长度 297 字（标题+元信息+那 112 字）——绝对门槛等于把正常渲染判成缺陷，
      // 而且这正是本文件上面自己写过又犯过的错（"拿拍出来的长度当门槛"）。
      // 换成**相对判据**：面板长度必须至少接住正文明文的一半——只渲染标题不渲染正文会红，薄正文条目不会误红。
      const plain = shownHtml.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
      c.metrics.detailBodyChars = plain.length;
      assert(c, 'render', '详情面板（article 元素）出现、含被点标题，且长度接得住正文',
        pane.found && pane.len > 0 && pane.len >= Math.ceil(plain.length / 2),
        `面板=${pane.len}字 正文明文=${plain.length}字 found=${pane.found} 标题头=${head}`);
      assert(c, 'render', '未选文章的提示已消失（不是还停在空态）', !pane.hintStill, `selectHint 仍在=${pane.hintStill}`);
      assert(c, 'render', '面板内没有占位文案', emptyStateHits(pane.text).length === 0);
      // 正文对账只在接口确实给了长正文时判（薄正文条目面板本来就只有摘要长度）
      if (plain.length > 300) {
        const slice = plain.slice(Math.floor(plain.length / 3), Math.floor(plain.length / 3) + 30);
        const paneFlat = pane.text.replace(/\s+/g, ' ');
        assert(c, 'data', '接口给的正文出现在详情面板里（DOM↔详情响应对账，两侧都归一空白）', paneFlat.includes(slice),
          `来源=${c.metrics.detailBodySource} 正文=${plain.length}字 面板=${pane.len}字 | 切片「${slice.slice(0, 40)}」 | 面板头「${paneFlat.slice(0, 120)}」`);
      }
      assert(c, 'data', '详情标题与列表首条同源', pane.text.includes(String(items0 && items0.title || head).slice(0, 12)), head);
    },
  },
  {
    id: 'E10', title: '未知路径 /videos/：渲染可见 404 兜底，且不得静默渲染成阅读器（B72 已修）',
    async run(page, c, target, net) {
      await goto(page, c, target + '/videos/', '[data-e2e="notfound"]');
      const txt = await bodyText(page);
      c.renderedText = txt.slice(0, 200);
      const nBlocks = await page.locator('[data-e2e="notfound"]').count();
      assert(c, 'render', '未知路径出现 404 兜底块（且只有一块）', nBlocks === 1, `notfound 块数=${nBlocks}`);
      assert(c, 'render', '不再静默渲染成阅读器（页面不含「加载更多/稍后阅读」）',
        !/加载更多|稍后阅读/.test(txt), '兜底页文本：' + txt.slice(0, 60));
      // SPA catch-all 仍回 200 + index.html（vercel.json:11），服务端不会 404 ——
      // 这条判据钉的是「兜底责任在客户端」这个契约，不是"修好了就变 404"的错觉。
      const doc = net.filter((r) => r.kind === 'doc').pop();
      assert(c, 'data', 'document 仍是 200 HTML（服务端不 404，兜底由客户端负责）',
        !!doc && doc.status === 200, doc ? `document status=${doc.status}` : '没拦到 document 响应');
    },
  },
];
// known_gap：登记在册、报告与终端都显式印出，但不进门禁（防"为了绿而删剧本"）
// B72 已于 2026-09-19 修复（main.jsx NotFoundPage），E10 回归门禁位；下一条登记的缺口须来自实测红。
const KNOWN_GAPS = {};

// ───────────────────────── 运行器 ─────────────────────────

/** 从 web/src/i18n.jsx 抽字典键：E8 判裸 key 只认真实存在的键，避免误报。
 *  **读不到必须抛错**：原先 catch 返回 [] → E8 的"无裸 key"永远绿，
 *  一次文件改名就能把检查变成假门禁（reviewer #7）。抛错会被 runner 归成 fail_env。 */
function dictKeys() {
  const f = path.join(ROOT, 'web', 'src', 'i18n.jsx');
  if (!fs.existsSync(f)) throw new Error('TOOL: 字典文件不存在 ' + f + ' —— 裸 key 判据失去依据，本轮不算跑过');
  const src = fs.readFileSync(f, 'utf8');
  const keys = [...src.matchAll(/'([a-z][a-z0-9]*\.[a-zA-Z0-9]+)'\s*:/g)].map((m) => m[1]);
  if (keys.length < 50) throw new Error(`TOOL: 字典只解析出 ${keys.length} 个键（i18n.jsx 结构变了，E8 的判据要同步改）`);
  return keys;
}
/** known_gap 只准豁免**已登记在册**的缺口：编号必须真的出现在 docs/ISSUES.md，
 *  否则"标成 known_gap"就等于删剧本（§3.6 禁止的那件事）。 */
function gapIssues() {
  const f = path.join(ROOT, 'docs', 'ISSUES.md');
  const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  return Object.entries(KNOWN_GAPS).map(([id, ref]) => ({
    id, ref,
    ok: /^B\d+$/.test(ref) && new RegExp(`\\*\\*${ref}\\*\\*|\\|\\s*${ref}\\s*\\|`).test(text),
  }));
}
function gitRev(ref) { try { return execFileSync('git', ['rev-parse', ref], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } }
function arg(argv, name, dflt) { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; }

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();

  const repeat = argv.includes('--fast') ? 1 : Number(arg(argv, '--repeat', String(DEFAULT_REPEAT)));
  const target = (arg(argv, '--target', CLOUD_SITE)).replace(/\/+$/, '');
  const only = (arg(argv, '--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!Number.isFinite(repeat) || repeat < 1) { console.error('--repeat 必须是 ≥1 的整数'); return 2; }
  const cases = SCENARIOS.filter((s) => !only.length || only.includes(s.id));
  if (!cases.length) { console.error(`--only 没匹配到剧本（可用：${SCENARIOS.map((s) => s.id).join(',')}）`); return 2; }

  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) {
    console.error('fail_env：playwright 不可用（' + String(e.message).split('\n')[0] + '）'); return 2;
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  const dir = path.join(EVID, stamp);
  fs.mkdirSync(path.join(ROOT, dir, 'screens'), { recursive: true });
  const isRemote = !/127\.0\.0\.1|localhost/.test(target);
  let browser;
  try { browser = await chromium.launch(isRemote ? { proxy: { server: PROXY } } : {}); } catch (e) {
    console.error(`fail_env：chromium 起不来（${String(e.message).split('\n')[0]}）——先 npx playwright install chromium`); return 2;
  }
  const startedAt = new Date().toISOString();
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  const consoleErrs = [];
  page.on('pageerror', (e) => consoleErrs.push(String(e.message).slice(0, 160)));
  const net = [];
  attachNet(page, net);

  // 硬前置（§3.1）：线上必须是 origin/main 那份代码，否则端到端测的是旧页面，结果不能当本轮验收
  let liveSha = '';
  try {
    await page.goto(target + '/reader/', { waitUntil: 'domcontentloaded', timeout: NAV });
    const m = await api(page, makeCase('preflight', 'meta'), '/api/meta');
    liveSha = (m.json && (m.json.commit || m.json.sha)) || '';
  } catch (e) {
    await browser.close();
    console.error(`fail_env：目标站点打不开 ${target} —— ${String(e.message).split('\n')[0]}`);
    return 2;
  }
  const originSha = isRemote ? gitRev('origin/main') : '';
  // ── 验收轮判定（reviewer #2）：跑子集、只跑 1 轮、或打本地站，都**不构成验收**。
  //    不加这条，`--only E1 --fast` 绿了也会 exit 0，于是"我跑过端到端"可以拿一条探针来兑——
  //    正是本轮反复犯的那类错（把跑过 ≠ 验收过）。
  const acceptance = acceptanceOf(cases.length, SCENARIOS.length, repeat, isRemote);
  const gaps = gapIssues();
  const badGap = gaps.find((g) => !g.ok);
  if (badGap) { await browser.close(); console.error(`fail_env：known_gap ${badGap.id}→${badGap.ref} 没在 docs/ISSUES.md 登记 —— 未登记的豁免等于删剧本`); return 2; }
  fs.writeFileSync(path.join(ROOT, dir, 'env_lock.json'), JSON.stringify({
    startedAt, target, proxy: isRemote ? PROXY : '(local)', liveCommit: liveSha, originMain: originSha,
    node: process.version,
    playwright: (() => { try { return require('playwright/package.json').version; } catch { return '?'; } })(),
    viewport: VIEWPORT, repeat, scenarios: cases.map((s) => s.id), argv, acceptance, gaps,
  }, null, 2));
  if (isRemote) {
    if (!liveSha) { await browser.close(); console.error('fail_env：/api/meta 没回传 commit —— 线上构建未带 VERCEL_GIT_COMMIT_SHA（§3.1：等于改动没生效）'); return 2; }
    if (originSha && liveSha !== originSha) {
      await browser.close();
      console.error(`fail_env：线上 ${liveSha.slice(0, 7)} ≠ origin/main ${originSha.slice(0, 7)} —— 部署未完成或在测旧代码，端到端结果不作验收`);
      return 2;
    }
  }
  // 每轮剧本一个干净 page：前端 api.js 有 5s 内存缓存，共用 page 会让后一条剧本"页面根本没发请求"，
  // 对账拿不到数据（假红）。干净 page 同时让 E7 的"document 只拉过一次"可判。
  const ctx2 = await browser.newContext({ viewport: VIEWPORT });

  const results = [];
  const plan = cases.map((s) => s.id);
  for (const s of cases) {
    const statuses = [];
    let first = null;
    for (let i = 1; i <= repeat; i++) {
      const c = makeCase(s.id, s.title);
      const page2 = await ctx2.newPage();
      const net2 = [];
      attachNet(page2, net2);
      page2.on('pageerror', (e) => consoleErrs.push(`${s.id}: ${String(e.message).slice(0, 160)}`));
      try {
        await s.run(page2, c, target, net2, dictKeys());
        c.shot = path.join(dir, 'screens', `${s.id}-r${i}.png`).replace(/\\/g, '/');
        await page2.screenshot({ path: path.join(ROOT, c.shot) });
        const bytes = fs.statSync(path.join(ROOT, c.shot)).size;
        c.events = [{ type: 'screenshot', path: c.shot }];
        if (bytes < 10240) { c.status = 'fail_env'; c.why = `截图仅 ${bytes}B（<10KB ≈ 没渲染出东西）`; }
      } catch (e) {
        const msg = String(e.message || e);
        if (/^TOOL:|TOOL: /.test(msg)) {
          c.status = 'fail_env'; c.why = '评测器自身缺陷（不算产品红，也不许当通过）：' + msg.split('\n')[0].slice(0, 160);
        } else if (/net::|ECONNREFUSED|timeout|Target closed|browser has been closed|navigat/i.test(msg)) {
          c.status = 'fail_env'; c.why = '浏览器/网络不通：' + msg.split('\n')[0].slice(0, 140);
        } else { c.status = 'fail_product'; c.why = '剧本抛错：' + msg.split('\n')[0].slice(0, 200); }
        try {
          c.shot = path.join(dir, 'screens', `${s.id}-r${i}.png`).replace(/\\/g, '/');
          await page2.screenshot({ path: path.join(ROOT, c.shot) });
          c.events = [{ type: 'screenshot', path: c.shot }];
        } catch { c.events = []; }
      }
      const failed = c.assertions.filter((a) => !a.ok);
      if (!c.status) {
        if (!c.assertions.length) { c.status = 'fail_product'; c.why = '0 断言 = 空跑'; }
        else if (failed.length) { c.status = 'fail_product'; c.why = failed.map((a) => `${a.kind}:${a.label}〔${a.detail}〕`).join(' / '); }
        else c.status = 'pass';
      }
      c.observed = net2.map((r) => ({ url: r.url, status: r.status, bytes: r.bytes, ms: r.ms, params: r.params }));
      await page2.close().catch(() => { });
      statuses.push(c.status);
      if (i === 1) {
        const cov = kindCoverage(c.assertions);
        first = {
          id: s.id, title: s.title, status: null, why: c.why,
          assertions: c.assertions.length, assertionKinds: cov.kinds, uncoveredKinds: cov.missing,
          detail: c.assertions, renderedText: c.renderedText,
          // F4 要判的是**断言目标文本**里有没有占位串。喂整页 innerText 会让 F4 报「case[0] 命中」
          // 却不给用例号，且首屏噪声会掩盖真正被断言的那段文本（本轮实测踩过）。
          assertTargets: c.assertions.map((a) => `${a.label} ${a.detail}`).join('\n'),
          requests: c.requests, observedRequests: c.observed, events: c.events,
          evidence: [c.shot, `${dir}/report.json`].filter(Boolean), metrics: c.metrics, repeatStatuses: statuses,
          knownGap: c.knownGap || (KNOWN_GAPS[s.id] ? { ref: KNOWN_GAPS[s.id], why: '已登记缺口（不计入门禁，禁止删剧本）' } : null),
        };
        results.push(first);
      } else if (first) {
        first.repeatStatuses = statuses;
        if (c.status === 'fail_product') first.laterRoundFailures = (first.laterRoundFailures || []).concat({ round: i, why: c.why, evidence: c.shot });
      }
      console.log(`  · ${s.id} 第 ${i}/${repeat} 次 ${c.status}${c.status === 'pass' ? '' : ' — ' + String(c.why).slice(0, 110)}`);
    }
    first.status = classify(statuses);
    if (first.status === 'fail_flaky') first.why = `连跑 ${statuses.length} 次结果不一致：${statuses.join(',')}（§3.4：不得作为通过依据）`;
    first.screenshots = repeat;
  }
  await browser.close();

  const gated = results.filter((r) => !r.knownGap);
  const summary = {
    total: gated.length,
    pass: gated.filter((r) => r.status === 'pass').length,
    failProduct: gated.filter((r) => r.status === 'fail_product').length,
    failEnv: gated.filter((r) => r.status === 'fail_env').length,
    failFlaky: gated.filter((r) => r.status === 'fail_flaky').length,
    uncoveredKinds: gated.filter((r) => r.uncoveredKinds.length).map((r) => `${r.id}:${r.uncoveredKinds.join('+')}`),
    knownGaps: results.filter((r) => r.knownGap).map((r) => `${r.id}(${r.knownGap.ref})`),
    consoleErrors: consoleErrs.slice(0, 10),
  };
  const reportPath = path.join(dir, 'report.json').replace(/\\/g, '/');
  fs.writeFileSync(path.join(ROOT, reportPath), JSON.stringify({ target, startedAt, acceptance, summary, cases: results }, null, 2));

  console.log(`\n端到端评测（41-2）· 目标 ${target} · 线上 commit ${liveSha.slice(0, 7) || '-'} · 每剧本 ${repeat} 次`);
  for (const r of results) {
    const tag = r.knownGap ? `known_gap→${r.knownGap.ref}` : r.status;
    console.log(`  ${r.status === 'pass' ? '✓' : r.knownGap ? '○' : '✗'} ${r.id} ${r.title}  [${tag}] ${r.assertions} 断言${r.uncoveredKinds.length ? `（缺 ${r.uncoveredKinds.join('+')}）` : ''}`);
    if (r.status !== 'pass' && !r.knownGap) console.log(`      ${String(r.why).slice(0, 260)}`);
    if (r.knownGap) console.log(`      已知缺口：${r.knownGap.why}`);
  }
  console.log(`结论：${summary.pass}/${summary.total} 通过，产品红 ${summary.failProduct}，环境红 ${summary.failEnv}，flaky ${summary.failFlaky}` +
    (summary.knownGaps.length ? `；已知缺口 ${summary.knownGaps.join(', ')}` : '') +
    (summary.uncoveredKinds.length ? `；断言类别缺口 ${summary.uncoveredKinds.join(', ')}` : '') +
    (summary.consoleErrors.length ? `；pageerror ${summary.consoleErrors.length} 条` : ''));
  console.log(`证据：${dir}/report.json + ${dir}/env_lock.json + ${dir}/screens/`);

  // 过程层（§3.6）：产物自己必须经得起二值检查，否则这轮不算跑过
  const code = exitCodeOf(summary);
  const run = {
    startedAt,
    events: results.flatMap((r) => r.events || []),
    reportPath: path.join(ROOT, reportPath), plan,
    kindExemptions: results.filter((r) => r.knownGap && r.uncoveredKinds.length)
      .reduce((a, r) => { a[r.id] = r.uncoveredKinds; return a; }, {}),
    cases: results.map((r) => ({
      id: r.id, status: r.status, assertions: r.assertions, renderedText: r.assertTargets, detail: r.detail,
      requests: (r.observedRequests || []).concat(r.requests || []), evidence: r.evidence,
    })),
    commands: [{ cmd: `node tools/eval-e2e.cjs ${argv.join(' ')}`.trim(), exitCode: code, exitCodeSource: '本进程 return 值直接赋 process.exitCode，无管道' }],
    root: ROOT,
  };
  let procProduct = false, procEnv = false;
  for (const [name, fn] of Object.entries(CHECKS)) {
    const res = fn(run);
    if (!res.ok) {
      console.log(`  ✗ 过程检查 ${name} [${res.code}] — ${res.why}`);
      if (res.code === 'fail_env') procEnv = true; else procProduct = true;
    }
  }
  if (procProduct || procEnv) console.log(`过程层不过：${procProduct ? 'fail_product（评测产物不诚实）' : ''}${procEnv ? ' fail_env（本轮不算跑过）' : ''}`);
  let final = procProduct ? 1 : (code || (procEnv ? 2 : 0));
  // 非验收轮**永远不许 exit 0**（reviewer #2）：全绿但只跑了一条剧本，也不构成"端到端验过"
  if (!acceptance.ok && final === 0) final = 2;
  run.commands[0].exitCode = final;
  console.log(acceptance.ok
    ? '本轮为**验收轮**：全剧本 × ≥3 轮 × 真实云端，可作为交付证据。'
    : `NOT_ACCEPTANCE：${acceptance.reasons.join('；')} —— 只算探针跑，不得写进交付说明当端到端验收`);
  return final;
}

// ───────────────── 自检：坏样本必须被抓住（EVAL_GUIDE §4.1 负向验证）─────────────────
async function selfTest() {
  const probes = [];
  const P = (name, pass, detail) => probes.push({ name, pass: !!pass, detail });
  const SCRIPT_SRC = fs.readFileSync(__filename, 'utf8');

  P('classify: 3 次全过 = pass', classify(['pass', 'pass', 'pass']) === 'pass');
  P('classify: 偶发失败 = flaky（不得当通过）', classify(['pass', 'fail_product', 'pass']) === 'fail_flaky');
  P('classify: 每次都失败 = fail_product', classify(['fail_product', 'fail_product', 'fail_product']) === 'fail_product');
  P('classify: 全环境不通 = fail_env', classify(['fail_env', 'fail_env']) === 'fail_env');
  P('classify: 空运行 = fail_env（没跑不算绿）', classify([]) === 'fail_env');
  P('classify: 一轮环境不通不得记 pass', classify(['pass', 'fail_env', 'pass']) === 'fail_env');
  P('classify: 环境+产品混在一起时保守判 fail_env（不冤枉产品）', classify(['pass', 'fail_env', 'fail_product']) === 'fail_env');

  P('exitCode: 产品红优先 1', exitCodeOf({ failProduct: 1, failEnv: 1, failFlaky: 0, total: 3 }) === 1);
  P('exitCode: flaky 退 2 不退 0', exitCodeOf({ failProduct: 0, failEnv: 0, failFlaky: 1, total: 3 }) === 2);
  P('exitCode: 0 条剧本退 2（空跑不是通过）', exitCodeOf({ failProduct: 0, failEnv: 0, failFlaky: 0, total: 0 }) === 2);
  P('exitCode: 全过退 0', exitCodeOf({ failProduct: 0, failEnv: 0, failFlaky: 0, total: 3 }) === 0);

  const dict = ['login.submit', 'nav.reader', 'sidebar.article'];
  P('rawKeyHits: 抓到裸 key 泄漏', rawKeyHits('按钮 login.submit 和 nav.reader', dict).join() === 'login.submit,nav.reader');
  P('rawKeyHits: 正常文本不误报', rawKeyHits('IT之家 · 2026-09-18 v1.2.3 a.b', dict).length === 0);
  P('rawKeyHits: 字典外的 foo.bar 不算（只认字典真有的键）', rawKeyHits('foo.bar', dict).length === 0);

  P('emptyStateHits: 「加载中…」命中', emptyStateHits('标题 加载中…').length === 1);
  P('emptyStateHits: 正常标题不误报', emptyStateHits('三星海外机型将于 9 月 30 日起取消').length === 0);
  P('emptyStateHits: 合法空态（暂无阅读沉淀）不当占位', emptyStateHits(EMPTY_READING).length === 0);

  P('kindCoverage: 缺 data 类要报出来', kindCoverage([{ kind: 'render' }, { kind: 'api' }]).missing.join() === 'data');
  P('kindCoverage: 三类齐则无缺口', kindCoverage([{ kind: 'render' }, { kind: 'api' }, { kind: 'data' }]).missing.length === 0);

  P('countMatches: 超容差必须红', countMatches(30, 26) === false);
  P('countMatches: 容差内为绿', countMatches(28, 30) === true);
  P('countMatches: 两侧都 0 是合法一致（空集≠漏渲染）', countMatches(0, 0) === true);

  P('pillCounts: 按标签取数（不是取最后一个数字）', pillCounts(['全部 25149', '已收藏 1', '已读 7289'])['已读'] === 7289);
  P('pillCounts: 千分位可解析、无数字按钮不误取', pillCounts(['今日 3,079', '文章'])['今日'] === 3079 && !('文章' in pillCounts(['文章'])));
  P('pillCounts: 标签不存在返回 undefined（不许当 0）', pillCounts(['全部 10'])['不存在'] === undefined);

  const prod = { report: { sections: [{ items: [{ title: '对话华为轮值董事长汪涛' }, { title: 0 }, { name: '不是标题键' }] }], themes: [{ title: '巴菲特交棒' }] } };
  P('collectTitles: 递归收集 title（数组/嵌套都要走到）', collectTitles(prod).join('|') === '对话华为轮值董事长汪涛|巴菲特交棒');
  P('collectTitles: 非字符串 title 不收（防 [object Object] 混进判据）', collectTitles({ title: {} }).length === 0);
  P('orphanCards: 卡面含产物标题则无孤儿', orphanCards(['TOP 1 来自你的关注 第一财经 74 对话华为轮值董事长汪涛：支撑中国大模型'], collectTitles(prod)).length === 0);
  P('orphanCards: 渲染了产物外的内容必须抓出来', orphanCards(['一条产物里根本没有的旧标题aaaa'], collectTitles(prod)).length === 1);
  P('orphanCards: 空文本行不参与判定（不误报）', orphanCards(['', '  '], collectTitles(prod)).length === 0);

  const c = makeCase('x', 't');
  const apiItems = [{ title: 'AAA 甲题' }, { title: 'BBB 乙题' }, { title: 'CCC 丙题' }];
  P('subsetConsistency: 渲染行都能在响应里找到 → 无漏', subsetConsistency(['AAA 甲题 · 3 分钟前', 'BBB 乙题 · 5 分钟前'], apiItems).miss.length === 0);
  P('subsetConsistency: 渲染了响应外的内容必须抓出来（B60 类）', subsetConsistency(['完全不相干的一行'], apiItems).miss.length === 1);
  P('subsetConsistency: 只渲染前 N 条不算不一致（列表页普遍如此）', subsetConsistency(['AAA 甲题'], apiItems).miss.length === 0);
  P('subsetConsistency: 空响应 + 有渲染 = 全漏（不许当一致）', subsetConsistency(['AAA 甲题'], []).miss.length === 1);
  P('assert: 非 true 一律不认（防 truthiness 假绿）', assert(c, 'api', 'k', 'yes') === false && c.assertions[0].ok === false);
  P('assert: 记的是显式 kind 字段，不是标签正则猜的', c.assertions[0].kind === 'api');
  P('assert: 同标签两条都保留（不得按标签去重藏红）', (() => { const d = makeCase('y', 't'); assert(d, 'api', '同一个标签', true); assert(d, 'api', '同一个标签', false); return d.assertions.length === 2 && d.assertions[1].ok === false; })());
  P('assert: 传错集合时抛错而不是静默假绿', (() => { try { assert(null, 'api', 'k', true); return false; } catch { return true; } })());

  P('SRC 每条带行号（F7 口径）', Object.values(SRC).every((s) => /:[0-9]+$/.test(s)), Object.entries(SRC).filter(([, v]) => !/:[0-9]+$/.test(v)).map(([k]) => k).join(','));
  P('QUERY_SRC 每条带行号（页面自己发出的请求也要有出处）', Object.values(QUERY_SRC).every((s) => /:[0-9]+$/.test(s)));
  P('QUERY_SRC 的出处必须是前端构造行（不许指回后端白名单，那对不上真实请求）', Object.values(QUERY_SRC).every((s) => /^web\/src\//.test(s)));
  P('剧本表：id 唯一且每条有 run', new Set(SCENARIOS.map((s) => s.id)).size === SCENARIOS.length && SCENARIOS.every((s) => s.id && s.title && typeof s.run === 'function'));
  P('known_gap 必须指向真实剧本', Object.keys(KNOWN_GAPS).every((id) => SCENARIOS.some((s) => s.id === id)));
  P('known_gap 的编号必须真在 docs/ISSUES.md 登记（未登记的豁免=删剧本）', gapIssues().every((g) => g.ok),
    gapIssues().filter((g) => !g.ok).map((g) => `${g.id}→${g.ref}`).join(','));
  P('attachNet 确实注册了 response 监听', (() => { let got = null; attachNet({ on: (ev, fn) => { if (ev === 'response') got = fn; } }, []); return typeof got === 'function'; })());

  // ── #2 验收轮：绿 ≠ 验收过 ──
  P('验收轮：全剧本 ×3 轮 × 云端才算验收', acceptanceOf(SCENARIOS.length, SCENARIOS.length, 3, true).ok === true);
  P('验收轮：--only 跑一条全绿也不是验收（不得 exit 0）', acceptanceOf(1, SCENARIOS.length, 3, true).ok === false);
  P('验收轮：--fast 单轮不是验收', acceptanceOf(SCENARIOS.length, SCENARIOS.length, 1, true).ok === false);
  P('验收轮：打本地站不是验收（AGENTS §3 第 8 条只认云端）', acceptanceOf(SCENARIOS.length, SCENARIOS.length, 3, false).ok === false);

  // ── #3 探针响应必须排除在对账外（否则脚本自己发、自己证明页面发过）──
  {
    const s1 = [{ url: '/api/reading', by: 'script', json: { items: [{ id: 1 }] }, params: {}, at: 1, status: 200 }];
    P('collected: 脚本探针的响应不进对账', collected(s1, '/api/reading').size === 0);
    s1.push({ url: '/api/reading', by: 'page', json: { items: [{ id: 2 }] }, params: {}, at: 2, status: 200 });
    P('collected: 页面自己的响应照常进对账（排除别顺手做成全排除）', collected(s1, '/api/reading').size === 1);
    P('waitForApiWhere: 谓词命中脚本记录也不算数', (await waitForApiWhere(s1, (r) => r.by === 'script', 60)) === null);
    P('waitQuiet: 只有脚本发过时不得判"页面已静"', (await waitQuiet(s1.slice(0, 1), '/api/reading', 8000, 200)).quiet === false);
    P('waitQuiet: 页面发过且静下来才算静', (await waitQuiet(s1, '/api/reading', 200, 3000)).quiet === true);
  }
  {
    const store = [];
    let handler = null;
    attachNet({ on: (ev, fn) => { if (ev === 'response') handler = fn; } }, store);
    const mkRes = (u) => ({ url: () => u, request: () => ({ resourceType: () => 'fetch' }), status: () => 200, text: async () => '{"items":[]}' });
    scriptInflight.add('/api/reading?type=video');
    await handler(mkRes('https://h/api/reading?type=video'));
    scriptInflight.delete('/api/reading?type=video');
    P('attachNet: 探针在飞时该 URL 的响应标 script', store.length === 1 && store[0].by === 'script');
    await handler(mkRes('https://h/api/reading?type=video'));
    P('attachNet: 探针不在飞时同 URL 的响应算页面发出', store[1].by === 'page');
    P('attachNet: body 读完后 pending 归零（慢响应不算"还在飞"）', store.pending['/api/reading'] === 0);
    P('attachNet: 带 query 的 URL 用完整 pathname+search 比对（防只比路径把页面请求也屏蔽）',
      SCRIPT_SRC.includes('const self = u.pathname + u.search;'));
  }
  // ── #7 status 0 / 字典读不到 都不得被当成判据 ──
  {
    const c1 = makeCase('t', 't');
    let msg = '';
    try { await api({ url: () => 'https://h/reader/', evaluate: async () => ({ status: 0, bytes: 0, json: null, text: 'Failed to fetch' }) }, c1, '/api/reading?type=all'); } catch (e) { msg = String(e.message); }
    P('api: status 0 抛 TOOL（归 fail_env，不冤枉产品也不放过）', /^TOOL:/.test(msg), msg.slice(0, 60));
    let msg2 = '';
    try { await api({ url: () => 'about:blank', evaluate: async () => ({ status: 0 }) }, makeCase('t2', 't'), '/api/x'); } catch (e) { msg2 = String(e.message); }
    P('api: 无同源文档时仍先抛 TOOL（原 about:blank 坑）', /^TOOL:/.test(msg2));
    P('dictKeys: 解析真实 i18n 字典且不少于 50 键', dictKeys().length >= 50, `实际 ${dictKeys().length}`);
  }
  // ── #6 空判据：写死真的 assert 永远不会红，等于假门禁。
  //    只扫剧本表那一段（SCENARIOS 到 KNOWN_GAPS 之间）：扫全文会让本条自检的源码自己命中自己。
  const a0 = SCRIPT_SRC.indexOf('const SCENARIOS = ['), a1 = SCRIPT_SRC.indexOf('const KNOWN_GAPS');
  const TABLE_SRC = a0 >= 0 && a1 > a0 ? SCRIPT_SRC.slice(a0, a1) : '';
  P('能定位到剧本表区间（区间取不到则本条判据失效，必须红）', TABLE_SRC.length > 1000, `区间长度 ${TABLE_SRC.length}`);
  P('剧本里不许有写死真的判据（E10 那条 true 就是这么来的）',
    !/assert\(c,\s*'[a-z]+',\s*'[^']*',\s*true[,)]/.test(TABLE_SRC));
  P('剧本里不许有两侧同值的常数判据（E7 的 navigation 计数犯过）', !/=== nav|nav\d\s*===\s*nav\d/.test(TABLE_SRC));

  let bad = 0;
  for (const p of probes) if (!p.pass) { bad++; console.log(`  ✗ 自检 ${p.name}${p.detail ? ' — ' + p.detail : ''}`); }
  console.log(`自检：${probes.length - bad}/${probes.length} 通过`);
  return bad ? 1 : 0;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((e) => {
    console.error('fail_env：运行器异常 —— ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
    process.exitCode = 2;
  });
}

module.exports = {
  SCENARIOS, SEL, SRC, QUERY_SRC, KNOWN_GAPS, EMPTY_READING, scriptInflight,
  classify, exitCodeOf, acceptanceOf, rawKeyHits, kindCoverage, countMatches, emptyStateHits, pillCounts,
  collectTitles, orphanCards, subsetConsistency, assert, makeCase, dictKeys, gapIssues, byPage,
  collected, waitForApi, waitForApiWhere, waitQuiet, api, attachNet,
};
