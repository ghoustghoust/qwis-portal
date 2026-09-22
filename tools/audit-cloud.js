// 云端门户巡检:所有关键端点打一遍,和本地对账
// 用法: node tools/audit-cloud.js
const { CLOUD_SITE: BASE, cloudFetch } = require('../lib/cloud-site');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0' };

const results = [];
// 判据：check 只有**返回 true** 才算通过。返回字符串是"失败理由"，不是通过附注——
// 早先写成 `pass: !!verdict`，而非空字符串是 truthy，于是「应401实际405」「源列表异常」
// 这些失败理由全部被打成 ✅，一份云端巡检在报告自己发现的问题时永远显示满分（坑 #43）。
// 'SKIP:理由' 是第三种状态：判据本身无效时宁可明说"没验"，也不许长得像"验过了"（坑 #38 同族）。
function verdictToResult(verdict) {
  const s = typeof verdict === 'string' ? verdict : '';
  const skip = s.startsWith('SKIP:') ? s.slice(5) : '';
  return {
    pass: !skip && typeof verdict === 'boolean' && verdict === true,
    note: skip ? '' : s,
    skip,
  };
}

async function probe(name, url, check, opts = {}) {
  const t0 = Date.now();
  try {
    // 必须走 lib/cloud-site#cloudFetch：本机直连 vercel.app 不通，而全局 fetch 会静默忽略
    // undici 的 ProxyAgent → 症状是"19/19 fetch failed"，被读成云端挂了（实为脚本没走代理）。
    const r = await cloudFetch(/^https?:\/\//.test(url) ? url : BASE + url, { headers: UA, signal: AbortSignal.timeout(20000), ...opts });
    const ms = Date.now() - t0;
    let body = null;
    try { body = await r.json(); } catch { /* 非 JSON */ }
    const { pass, note, skip } = verdictToResult(check ? check(r, body) : r.ok);
    results.push({ name, url, status: r.status, ms, pass, note, skip });
  } catch (e) {
    results.push({ name, url, status: 0, ms: Date.now() - t0, pass: false, note: e.message.slice(0, 80), skip: '' });
  }
}

async function main() {
  await probe('首页', '/', (r) => r.ok);
  await probe('阅读器页', '/reader/', (r) => r.ok);
  await probe('日报页', '/daily/', (r) => r.ok);
  await probe('热点页', '/hot/', (r) => r.ok);
  await probe('管理页', '/admin/', (r) => r.ok);
  await probe('meta', '/api/meta', (r, b) => b && b.ok && b.articles > 0 ? true : 'articles 计数异常');
  // B87：B 站上游响应形状哨兵——上游字段漂移时它先红，而不是等采集静默失败
  //（regression-bilibili 搬迁后全仓没有任何自动化盯真实 B 站协议面）
  await probe('B站上游 nav 形状', 'https://api.bilibili.com/x/web-interface/nav', (r, b) => {
    if (!r.ok) return `上游 HTTP ${r.status}`;
    if (!b || typeof b.code !== 'number' || typeof b.data !== 'object' || b.data === null) {
      return `上游 nav 形状变了：keys=${b ? Object.keys(b).slice(0, 6) : '非 JSON'}`;
    }
    return true;
  });
  // B26：状态面拆成"轻投影 + 按需重统计"两端，两条都要长期盯——
  // 只验轻的那条会漏掉"拆分后重统计根本取不到"，只验重的会漏掉"首屏又被塞回 heavy 字段"。
  await probe('状态轻投影', '/api/status', (r, b) => {
    const o = (b && b.overview) || {};
    const nums = ['unreadArticles', 'todayNew', 'weekNew', 'enabledSources'];
    if (!nums.every((k) => typeof o[k] === 'number')) return '轻投影字段缺失或非数字：' + nums.filter((k) => typeof o[k] !== 'number').join(',');
    if ('dailyItemCount' in o || 'dailyTopSources' in o) return '重统计又回到首屏（B26 拆分被回退）';
    return true;
  });
  await probe('状态重统计(按需)', '/api/status/daily-sources', (r, b) => {
    if (r.status === 401) return '401：新端点漏进 PUBLIC_GET_PATHS（坑 #56）';
    const o = (b && b.overview) || {};
    return typeof o.dailyItemCount === 'number' && Array.isArray(o.dailyTopSources)
      ? true : 'dailyItemCount/dailyTopSources 形状不对';
  });
  await probe('文章列表', '/api/articles', (r, b) => b && b.ok && b.items && b.items.length > 0 ? true : 'items 为空');
  // 云端 /api/articles 从来没有 dedup 语义（`api/[...slug].js` 里只有日报内部 dailyDedup 与
  // POST /api/sources/dedupe，列表处理器不读该参数），原先断言的 `deduped` 字段是一个不存在的契约。
  await probe('文章列表去重', '/api/articles?dedup=1', () => 'SKIP:云端无 dedup 契约，参数被忽略（B66）');
  await probe('游标翻页', '/api/articles?cursor=30', (r, b) => b && b.ok && b.items ? true : '翻页失败');
  // 原判据 `b.ok || r.status === 404` 是永真式（404 也算通过）。实测 id=1 返回 200 且载荷键为 `item`
  await probe('文章详情', '/api/articles/1', (r, b) => r.status === 200 && b && b.ok && b.item ? true : `详情异常（${r.status}）`);
  await probe('日报', '/api/daily', (r, b) => b && b.ok && b.report && b.report.sections ? true : '日报结构异常');
  await probe('事件榜', '/api/hot/events', (r, b) => b && b.ok && Array.isArray(b.events) ? true : '事件榜异常');
  await probe('AIHOT', '/api/hot', (r, b) => b && b.ok ? true : 'AIHOT 异常');
  // 实测：/api/sources 的载荷键是 `sources`（不是 `items`），原判据读 b.items 恒为 undefined
  await probe('源列表', '/api/sources', (r, b) => b && b.ok && (b.sources || []).length > 100 ? true : `源列表异常（sources=${(b && b.sources || []).length}）`);
  await probe('分组', '/api/groups?kind=article', (r, b) => b && b.ok ? true : '分组异常');
  await probe('视频', '/api/videos', (r, b) => b && b.ok ? true : '视频异常');
  await probe('admin 未授权拦截', '/api/admin/sources', (r) => r.status === 401 ? true : `应401实际${r.status}`);
  // 实测：GET /api/collect 是 405（该端点只接 POST），拿 GET 断言 401 永远只能得到"应401实际405"。
  // 鉴权语义要用正确方法测：错误 key 的 POST → 403
  await probe('采集端点鉴权', '/api/collect?key=wrong', (r) => r.status === 403 ? true : `应403实际${r.status}`, { method: 'POST' });
  // 静态快照兜底
  await probe('静态快照兜底', '/data/meta.json', (r) => r.ok);

  console.log('\n=== 云端巡检结果 ===');
  const t = tally(results);
  for (const r of results) {
    const mark = r.skip ? '⏭ ' : r.pass ? '✅' : '❌';
    console.log(`${mark} ${r.name.padEnd(14)} ${String(r.status).padEnd(4)} ${r.ms}ms ${r.note || r.skip}`);
  }
  console.log(`\n通过 ${t.pass}、失败 ${t.fail}、未验收 ${t.skip}（共 ${t.total}）`);
  // 全部探针都拿不到 HTTP 响应（status=0）＝出网/代理问题，不是云端问题。
  // 不分开的话"代理没开"会被读成"云端 21 项全挂"——B26 本轮实测就差点这么误判（19/19 fetch failed）。
  if (isEnvOutage(t, results)) {
    console.log('⚠ 环境红：一条 HTTP 响应都没拿到（status 全 0），这是出网/代理故障，不是云端故障。');
    console.log(`  代理取值来自 lib/cloud-site#CLOUD_PROXY（当前 ${require('../lib/cloud-site').CLOUD_PROXY || '直连'}）；本机 Clash 端口见 AGENTS §2.2，或 EVAL_PROXY=none 走直连。`);
    process.exitCode = 2;
    return;
  }
  // 退出码诚实：有失败=1；一条都没真验（全 SKIP / 空结果）=2（未评测），只有真有通过才 0
  process.exitCode = exitCodeOf(t);
}
// 环境红判据：非 SKIP 的条目全失败，且失败原因全是"没拿到响应"（status 0）
function isEnvOutage(t, rows) {
  const real = (rows || []).filter((r) => !r.skip);
  if (!real.length || real.length !== t.fail) return false;
  return real.every((r) => Number(r.status) === 0);
}
// 计数与退出码单独成函数：B65-3 原来只 grep 源码字面量（等价重构即假红、字面量在而逻辑坏则假绿），
// 这里把它变成可测行为（对抗性审查 I8：全 SKIP 也不能退 0）
function tally(results) {
  let pass = 0, fail = 0, skip = 0;
  for (const r of results || []) { if (r.skip) skip++; else if (r.pass) pass++; else fail++; }
  return { pass, fail, skip, total: (results || []).length };
}
function exitCodeOf(t) { return t.fail ? 1 : (t.total === 0 || t.skip === t.total ? 2 : 0); }

// 被 require 时不许自动打云端（本轮在 eval-process-checks 上刚踩过同一形态：模块级副作用会污染测试进程）
if (require.main === module) main();

module.exports = { verdictToResult, tally, exitCodeOf, isEnvOutage, BASE };
