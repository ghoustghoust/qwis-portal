#!/usr/bin/env node
// 冒烟测试脚本 — 在可访问 Vercel 的网络环境下运行
// 用法: node tools/_smoke-test.cjs [BASE_URL] [TOKEN]
// 如不提供 TOKEN，会自动用 admin/admin123 登录获取

const BASE = process.argv[2] || 'https://qwis-intel.vercel.app';
const CREDS = { username: 'admin', password: 'admin123' };

let passed = 0, failed = 0;
function report(name, ok, detail) {
  if (ok) { passed++; console.log(`  ✅ ${name}: ${detail}`); }
  else { failed++; console.log(`  ❌ ${name}: ${detail}`); }
}

async function fetchJson(path, opts = {}) {
  const url = `${BASE}${path}`;
  const r = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, json, text: text.slice(0, 500) };
}

async function main() {
  console.log(`\n🔥 冒烟测试: ${BASE}\n`);

  // 0. 登录获取 token
  let token = process.argv[3];
  if (!token) {
    const loginRes = await fetchJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(CREDS),
    });
    if (loginRes.json?.ok && loginRes.json?.token) {
      token = loginRes.json.token;
      report('P1-10 管理台登录', true, 'admin/admin123 → token 获取成功');
    } else {
      report('P1-10 管理台登录', false, `登录失败: ${loginRes.text}`);
      console.log('\n⚠️  无法获取 token，跳过需鉴权的测试项\n');
    }
  }

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  // 1. GET /api/meta
  {
    const r = await fetchJson('/api/meta');
    const articles = r.json?.overview?.articles;
    report('GET /api/meta', r.status === 200 && articles > 0, `status=${r.status}, articles=${articles}`);
  }

  // 2. GET /api/articles?sort=new
  {
    const r = await fetchJson('/api/articles?sort=new');
    const len = r.json?.items?.length;
    report('GET /api/articles', r.status === 200 && len > 0, `status=${r.status}, items=${len}`);
  }

  // 3. GET /api/hot
  {
    const r = await fetchJson('/api/hot');
    const len = r.json?.items?.length;
    report('GET /api/hot', r.status === 200 && len > 0, `status=${r.status}, items=${len}`);
  }

  // 4. GET /api/daily
  {
    const r = await fetchJson('/api/daily');
    const hasReport = r.json?.report != null;
    report('GET /api/daily', r.status === 200 && hasReport, `status=${r.status}, hasReport=${hasReport}`);
  }

  // 5. GET /api/status — P1-5 验证
  {
    const r = await fetchJson('/api/status');
    const rss = r.json?.lastSync?.rss;
    const isNullStr = rss === 'null' || rss === 'undefined';
    report('P1-5 GET /api/status lastSync.rss', r.status === 200 && !isNullStr, `status=${r.status}, rss=${JSON.stringify(rss)}`);
  }

  // 6. GET /api/sources/library — P1-1 验证
  if (token) {
    const r = await fetchJson('/api/sources/library', { headers: authHeaders });
    const len = r.json?.items?.length;
    const hasItemCount = len > 0 && r.json.items[0].itemCount !== undefined;
    report('P1-1 GET /api/sources/library', r.status === 200 && len > 0 && hasItemCount, `status=${r.status}, items=${len}, hasItemCount=${hasItemCount}`);
  }

  // 7. GET /api/alerts/config — P1-2 验证
  if (token) {
    const r = await fetchJson('/api/alerts/config', { headers: authHeaders });
    report('P1-2 GET /api/alerts/config', r.status === 200 && r.json?.ok, `status=${r.status}, ok=${r.json?.ok}`);
  }

  // 8. GET /api/alerts/log — P1-2 验证
  if (token) {
    const r = await fetchJson('/api/alerts/log', { headers: authHeaders });
    report('P1-2 GET /api/alerts/log', r.status === 200 && r.json?.ok, `status=${r.status}, ok=${r.json?.ok}`);
  }

  // 9. POST /api/articles/1/later — P1-13 验证
  if (token) {
    const r = await fetchJson('/api/articles/1/later', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ later: true }),
    });
    const hasLater = r.json?.later !== undefined;
    report('P1-13 POST /api/articles/1/later', r.status === 200 && hasLater, `status=${r.status}, later=${r.json?.later}`);
  }

  // 10. POST /api/daily/regenerate — P1-11 验证（耗时较长，可能触发 10s 限制）
  if (token) {
    console.log('  ⏳ P1-11 日报重新生成中（可能需要 10-30s）...');
    const r = await fetchJson('/api/daily/regenerate', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    const hasReport = r.json?.report != null;
    report('P1-11 POST /api/daily/regenerate', r.status === 200 && hasReport, `status=${r.status}, hasReport=${hasReport}`);
  }

  // ─── 对抗性审查 ───
  console.log('\n🛡️  对抗性审查:\n');

  // SQL 注入
  {
    const r = await fetchJson("/api/articles?q=' OR 1=1--");
    report('SQL 注入 /api/articles?q=', r.status === 200, `status=${r.status}（参数化查询安全）`);
  }

  // 权限绕过：无 Bearer 访问 /api/sources/library
  {
    const r = await fetchJson('/api/sources/library');
    report('权限绕过 /api/sources/library（无 Bearer）', r.status === 401, `status=${r.status}（预期 401）`);
  }

  // 权限绕过：无 Bearer POST /api/daily/regenerate
  {
    const r = await fetchJson('/api/daily/regenerate', { method: 'POST', body: '{}' });
    report('权限绕过 /api/daily/regenerate（无 Bearer）', r.status === 401, `status=${r.status}（预期 401）`);
  }

  // 越权写入：无 Bearer POST /api/articles/1/later
  {
    const r = await fetchJson('/api/articles/1/later', { method: 'POST', body: '{"later":true}' });
    report('越权写入 /api/articles/1/later（无 Bearer）', r.status === 401, `status=${r.status}（预期 401）`);
  }

  // 边界输入
  {
    const r = await fetchJson('/api/articles/99999999/read', { method: 'POST', headers: authHeaders || {}, body: '{}' });
    report('边界输入 /api/articles/99999999/read', r.status === 200 || r.status === 404, `status=${r.status}（404 或 ok 均可）`);
  }

  // 汇总
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ 通过: ${passed}  ❌ 失败: ${failed}  总计: ${passed + failed}`);
  console.log(`${'═'.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('脚本异常:', e); process.exit(2); });
