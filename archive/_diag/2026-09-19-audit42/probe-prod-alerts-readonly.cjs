// spec 42 取证：只读查生产 settings.alerts，判 regression-cloud-alerts 的污染守卫当前是否生效。
// 只打印 id/name/enabled/是否回环，绝不打印 url 全值与 token。
const fs = require('fs');
for (const l of fs.readFileSync(require('path').join(__dirname, '..', '..', '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

(async () => {
  const a = await db.execute("SELECT value FROM settings WHERE key='alerts'");
  if (!a.rows.length) { console.log('生产无 settings.alerts 键 → 守卫会因 channels 缺失而判污染'); return; }
  let cfg = {};
  try { cfg = JSON.parse(a.rows[0].value); } catch { console.log('settings.alerts 非 JSON → PROD_POLLUTED=true'); return; }
  const chs = Array.isArray(cfg.channels) ? cfg.channels : [];
  for (const c of chs) {
    const url = String((c.config || {}).url || c.url || '');
    console.log(`channel id=${c.id} name=${c.name} enabled=${c.enabled} 回环/哨兵=${/127\.0\.0\.1|localhost/i.test(url)}`);
  }
  const bad = chs.filter((c) => /^test-/i.test(String(c.id || '')) || /127\.0\.0\.1|localhost/i.test(String((c.config || {}).url || '')));
  const polluted = bad.length > 0 || chs.length === 0;
  console.log(`PROD_POLLUTED 判定 = ${polluted} → 写生产的用例 4/6/7 ${polluted ? '会被 skip（本次未写生产）' : '会真实执行（每次 npm test 都写生产）'}`);
})().catch((e) => console.log('查询失败:', e.message));
