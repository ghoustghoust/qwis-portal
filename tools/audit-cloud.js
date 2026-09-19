// 云端门户巡检:所有关键端点打一遍,和本地对账
// 用法: node tools/audit-cloud.js
const BASE = require('../lib/cloud-site').CLOUD_SITE;
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
    const r = await fetch(BASE + url, { headers: UA, signal: AbortSignal.timeout(20000), ...opts });
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
  // 退出码诚实：有失败=1；一条都没真验（全 SKIP / 空结果）=2（未评测），只有真有通过才 0
  process.exitCode = exitCodeOf(t);
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

module.exports = { verdictToResult, tally, exitCodeOf, BASE };
