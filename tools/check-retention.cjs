// 待删量读数（B101「先只接观测，不动触发口」的用户裁定 09-21）。
// 用法：npm run check:retention
// 只读：两条 COUNT + 一次 SELECT settings，不写库、不删数据、不碰触发口。
//
// 为什么需要它：待删量这个数在界面上没有出口，而它恰恰是**决定要不要让清理继续跑的那个数字**。
// 09-20T22:27Z 已经跑掉一轮 cleanup（心跳：热榜删 26,532 + 保留删 24,291 = 50,823 条），
// 与当时按同一谓词算出的待删量 50,636 对得上（多出的 187 条是"算完之后又过窗口"的新行 ——
// 谓词一致，差的是时间）。今天现算：6,356 条 / 全库 16,669 篇 = 38.1%。
// 谓词与天数取法见 `lib/retention#pendingPlan`；逐条读数记在
//  docs/eval/bl10-null-audit-20260921.md §三 与 docs/ISSUES.md B101 行。
//
// 两份数一起打，是有意的：
//   · `落库读数` = runner 每批次刷进 settings['retention.pending'] 的值（带 14 天历史，用来看趋势）；
//   · `现算`     = 本命令此刻用**同一份谓词**（lib/retention#pendingPlan）重算一遍。
// 只看其中一份都会被时间差骗：落库值可能是一小时前的，现算值看不出趋势。
'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
const { pendingPlan, HOTLIST_DAYS } = require('../lib/retention');

const ROOT = path.join(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
if (!process.env.TURSO_DATABASE_URL) {
  console.error('缺 TURSO_DATABASE_URL（本命令只读，但必须连到现役库才是"线上还有多少条待删"）');
  process.exit(2);
}

const KEY = 'retention.pending';
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, args = []) => Array.from((await db.execute({ sql, args })).rows);
const cutoffIso = (days) => new Date(Date.now() - days * 86400000).toISOString();

(async () => {
  const totalRow = await q('SELECT COUNT(*) c FROM articles');
  const dataRow = (await q("SELECT value FROM settings WHERE key='data'"))[0];
  let days = 7;
  try { days = Number(JSON.parse(dataRow.value).retentionDays ?? 7); } catch { /* 缺键 = 用默认 7 天 */ }
  const plan = pendingPlan('runner', days);

  const live = {};
  // "删了多少"不许靠猜：runner 的 cleanup 心跳里就带着每一轮的实删数
  const ccRaw = ((await q("SELECT value FROM settings WHERE key='cloud.collect'"))[0] || {}).value;
  let runs = [];
  try { runs = (JSON.parse(ccRaw).history || []).filter((e) => e.mode === 'cleanup'); } catch { /* 无心跳 */ }
  console.log(`\ncleanup 心跳：${runs.length
    ? runs.map((e) => `${String(e.at).slice(0, 16)} 热榜删 ${e.stats.deleted} + 保留删 ${e.stats.retentionDeleted}${e.stats.blocked ? `（本轮被闸挡下：${e.stats.blocked}）` : ''}`).join('  /  ')
    : '一次都没跑过 = 触发口是暗的（B101 缺环）'}`);
  for (const p of plan) live[p.key] = Number((((await q(p.sql, [p.cutoff]))[0]) || {}).c || 0);
  const liveTotal = Object.values(live).reduce((a, b) => a + b, 0);

  console.log(`现役库 articles 总数 ${Number(totalRow[0].c).toLocaleString()} 篇 ｜ 保留天数设置 ${days} 天（热榜轴固定 ${HOTLIST_DAYS} 天）`);
  console.log(`\n现算（与删除同一份 WHERE）：`);
  for (const p of plan) {
    console.log(`  ${p.key.padEnd(10)} ${String(live[p.key]).padStart(7)} 条  ← ${p.table} · ${p.days} 天前 · ${p.reason}`);
  }
  console.log(`  ${'合计'.padEnd(9)} ${String(liveTotal).padStart(7)} 条 = 全库的 ${((liveTotal / Number(totalRow[0].c)) * 100).toFixed(1)}%`);

  const stored = ((await q('SELECT value FROM settings WHERE key=?', [KEY]))[0] || {}).value;

  if (!stored) {
    console.log(`\n落库读数：无（settings['${KEY}'] 还没写过 = runner 的 retentionReadout 还没跑过任何批次）`);
  } else {
    const row = JSON.parse(stored);
    console.log(`\n落库读数：${row.at} 记 ${row.total} 条（${JSON.stringify(row.counts)}）｜与现算差 ${liveTotal - row.total} 条`);
    console.log(`删除闸（runner 视角）：${row.gate && row.gate.allowed ? '放行' : '挡下'} —— ${row.gate ? row.gate.reason : '（无 gate 字段，是旧形态读数）'}`);
    console.log(`以上都只是"下一轮会删多少"；"已经删了多少"看上面那条 cleanup 心跳。`);
    const h = Array.isArray(row.history) ? row.history : [];
    console.log(`\n历史（按天一条，最近 ${h.length} 天）：`);
    for (const e of h) {
      console.log(`  ${String(e.at).slice(0, 16)}  ${String(e.total).padStart(7)} 条  ${e.gateAllowed ? '闸开' : '闸挡'}  ${JSON.stringify(e.counts)}`);
    }
  }
  console.log('\n判据提示：要不要让下一轮自动删，看这条曲线是否已回落到稳态（每天入库量 ≈ 每天过窗口量）。');
  console.log('清理作业与触发口：.github/workflows/collect.yml 的 cleanup job；每一轮实删数看上面那条心跳。');
})().catch((e) => { console.error(`读数失败: ${e.message}`); process.exitCode = 1; });
