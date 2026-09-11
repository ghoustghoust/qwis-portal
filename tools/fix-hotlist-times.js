#!/usr/bin/env node
// 一次性回填（2026-09-11）：把热榜同源同刻的 published_at 按入库名次逐条递减 60s 排开
// 背景：newsnow 整个 feed 只给一个 updatedTime，同源 30 条同刻 → 前端时间序并列成块。
// 采集端已修复（新数据自动排开），本脚本只处理近 3 天（热点榜页窗口）的存量。
// 用法: node tools/fix-hotlist-times.js   （读 .env 的 TURSO_*）

const path = require('path');
const fs = require('fs');
try {
  const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  for (const line of envTxt.split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch { /* CI 环境 */ }

const { createClient } = require('@libsql/client');

(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

  const groups = Array.from((await db.execute(`
    SELECT a.source_id, a.published_at, COUNT(*) c
    FROM articles a JOIN sources s ON s.id = a.source_id
    WHERE s.type = 'hotlist' AND a.published_at IS NOT NULL
      AND a.published_at >= datetime('now', '-3 days')
    GROUP BY a.source_id, a.published_at HAVING c > 1
  `)).rows);

  console.log(`待排开分组: ${groups.length}`);
  let updated = 0;
  let batch = [];

  for (const g of groups) {
    const ids = Array.from((await db.execute({
      sql: 'SELECT id FROM articles WHERE source_id = ? AND published_at = ? ORDER BY id ASC',
      args: [g.source_id, g.published_at],
    })).rows);
    const base = Date.parse(g.published_at);
    // id 顺序 = feed 顺序 = 榜内名次；第 1 名保持原时间
    for (let i = 1; i < ids.length; i++) {
      batch.push({
        sql: 'UPDATE articles SET published_at = ? WHERE id = ?',
        args: [new Date(base - i * 60000).toISOString(), ids[i].id],
      });
      if (batch.length >= 400) {
        await db.batch(batch, 'write');
        updated += batch.length;
        batch = [];
        process.stdout.write(`\r已更新 ${updated}`);
      }
    }
  }
  if (batch.length) { await db.batch(batch, 'write'); updated += batch.length; }
  console.log(`\n完成: 共排开 ${updated} 条`);
  db.close();
  process.exitCode = 0;
})().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
