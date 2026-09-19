// 云端实测（只读）：B90「今日新增」与 B99「日期筛选」按北京日界对账
// 运行：node tools/_evidence-b90-b99-cloud.cjs
// 判据两侧都要有一手读数：左边是**线上端点返回的值**，右边是**同一刻直查 Turso 按北京日界算的值**。
// 只看左边是否"看起来合理"等于没测（坑 #41）。
'use strict';
// .env 读取沿用 smoke-test.js 的做法（本仓没有 dotenv 依赖，也不许为一次性脚本引依赖）
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require('@libsql/client');
const { beijingDayStartIso, beijingDayRangeIso, beijingDateStr } = require('../lib/time-window');

const PROXY = process.env.HTTPS_PROXY || process.env.http_proxy || 'http://127.0.0.1:12000';
const SITE = require('../lib/cloud-site').CLOUD_SITE;

async function main() {
  const undici = require('undici');
  const { ProxyAgent, setGlobalDispatcher } = undici;
  setGlobalDispatcher(new ProxyAgent(PROXY));
  const now = Date.now();
  const dayStart = beijingDayStartIso(now);
  const noise = "(s.type='hotlist' OR COALESCE(json_extract(COALESCE(s.extra,'{}'),'$.aggregator'),0)=1)";

  const res = await fetch(`${SITE}/api/status`, { signal: AbortSignal.timeout(60000) });
  const j = await res.json();
  const apiToday = j?.overview?.todayNew;

  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const q = async (sql, args) => (await db.execute({ sql, args })).rows;
  const mine = await q(
    `SELECT COUNT(*) c FROM articles a JOIN sources s ON s.id=a.source_id
      WHERE a.created_at >= ? AND NOT ${noise}`, [dayStart]);
  // B99：from=to=北京今天，端点返回的 published_at 必须全部落在这个北京日区间内
  const today = beijingDateStr(now);
  const { startIso, endIso } = beijingDayRangeIso(today);
  const list = await (await fetch(`${SITE}/api/articles?from=${today}&to=${today}&limit=3`,
    { signal: AbortSignal.timeout(60000) })).json();
  const items = (list.items || list.articles || []).map((a) => a.published_at || a.created_at);
  const outside = items.filter((t) => t && (t < startIso || t > endIso));

  console.log(JSON.stringify({
    检查时间_UTC: new Date(now).toISOString(),
    北京今日: today,
    B90: {
      '线上/api/status.todayNew': apiToday,
      '同刻按北京日界直查': Number(mine[0]?.c || 0),
      一致: Number(apiToday) === Number(mine[0]?.c || 0),
    },
    B99: {
      请求: `from=${today}&to=${today}`,
      北京日区间: [startIso, endIso],
      返回条数: items.length,
      越界条数: outside.length,
      样例: items.slice(0, 3),
      通过: items.length > 0 && outside.length === 0,
    },
  }, null, 1));
  await db.close();
  process.exitCode = (Number(apiToday) === Number(mine[0]?.c || 0) && items.length > 0 && outside.length === 0) ? 0 : 1;
}
main().catch((e) => { console.log('FAIL', e.message); process.exitCode = 2; });
