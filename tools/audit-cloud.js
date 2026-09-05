// 云端门户巡检:所有关键端点打一遍,和本地对账
// 用法: node tools/audit-cloud.js
const BASE = 'https://qwis-portal.vercel.app';
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0' };

const results = [];
async function probe(name, url, check) {
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + url, { headers: UA, signal: AbortSignal.timeout(20000) });
    const ms = Date.now() - t0;
    let body = null;
    try { body = await r.json(); } catch { /* 非 JSON */ }
    const verdict = check ? check(r, body) : r.ok;
    results.push({ name, url, status: r.status, ms, pass: !!verdict, note: typeof verdict === 'string' ? verdict : '' });
  } catch (e) {
    results.push({ name, url, status: 0, ms: Date.now() - t0, pass: false, note: e.message.slice(0, 80) });
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
  await probe('文章列表去重', '/api/articles?dedup=1', (r, b) => b && b.deduped === true ? true : 'deduped 标记缺失');
  await probe('游标翻页', '/api/articles?cursor=30', (r, b) => b && b.ok && b.items ? true : '翻页失败');
  await probe('文章详情', '/api/articles/1', (r, b) => b && (b.ok || r.status === 404) ? true : '详情异常');
  await probe('日报', '/api/daily', (r, b) => b && b.ok && b.report && b.report.sections ? true : '日报结构异常');
  await probe('事件榜', '/api/hot/events', (r, b) => b && b.ok && Array.isArray(b.events) ? true : '事件榜异常');
  await probe('AIHOT', '/api/hot', (r, b) => b && b.ok ? true : 'AIHOT 异常');
  await probe('源列表', '/api/sources', (r, b) => b && b.ok && (b.items || []).length > 100 ? true : '源列表异常');
  await probe('分组', '/api/groups?kind=article', (r, b) => b && b.ok ? true : '分组异常');
  await probe('视频', '/api/videos', (r, b) => b && b.ok ? true : '视频异常');
  await probe('admin 未授权拦截', '/api/admin/sources', (r) => r.status === 401 ? true : `应401实际${r.status}`);
  await probe('采集端点鉴权', '/api/collect?key=wrong', (r) => r.status === 401 ? true : `应401实际${r.status}`);
  // 静态快照兜底
  await probe('静态快照兜底', '/data/meta.json', (r) => r.ok);

  console.log('\n=== 云端巡检结果 ===');
  let pass = 0;
  for (const r of results) {
    console.log(`${r.pass ? '✅' : '❌'} ${r.name.padEnd(14)} ${String(r.status).padEnd(4)} ${r.ms}ms ${r.note}`);
    if (r.pass) pass++;
  }
  console.log(`\n通过 ${pass}/${results.length}`);
}
main();
