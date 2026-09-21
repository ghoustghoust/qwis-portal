#!/usr/bin/env node
// 数据归档工具 —— 将 >N 天的文章从 articles 主表迁移到 articles_archive
// 用法: TURSO_DATABASE_URL=xxx TURSO_AUTH_TOKEN=xxx node tools/archive-articles.js [--days=90] [--dry-run]
//
// 目的: 保持主表热数据 < 10 万条，Turso 查询性能可控
//
// B132 收编（2026-09-21）：
//   ① 删除/搬移谓词不再手写——豁免条件（未读/非稍后读/非精选）与时间列（COALESCE(published_at, created_at)）
//      全部来自 lib/retention.js 的同一份实现（白盒 W17 的管辖面；此前这里是第四份野生路径）
//   ② 归档表 DDL 从 lib/db.js 的 SCHEMA 取（createSqlOf），不再内嵌一份（旧版那份缺 translated_* 三列，
//      搬运会静默丢译文）
//   ③ 它是删除路径，必须先过删除闸（⑥b：磁盘转储或库里的转储凭证，二者有其一才放行）
'use strict';

const path = require('path');
const fs = require('fs');

// 手动加载 .env
const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
for (const line of envTxt.split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const DAYS = Number(process.argv.find(a => a.startsWith('--days='))?.split('=')[1]) || 90;
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 1000;

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function main() {
  const { TIME_COL, ARTICLE_DELETE_COND } = require('../lib/retention');
  const cd = require('../lib/content-dump');
  const { createSqlOf } = require('../lib/schema-columns');

  log(`=== 文章归档工具 (阈值: ${DAYS} 天${DRY_RUN ? ', DRY RUN' : ''}) ===`);

  const { createClient } = require('@libsql/client');
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  // 谓词与 lib/retention 同一份：时间列 COALESCE + 未读/非稍后读/非精选豁免
  const WHERE = `${TIME_COL.articles} < ? AND ${ARTICLE_DELETE_COND}`;
  const cutoff = new Date(Date.now() - DAYS * 86400e3).toISOString();
  log(`截止时间: ${cutoff}；谓词: ${WHERE}`);

  const countResult = await db.execute({ sql: `SELECT COUNT(*) c FROM articles WHERE ${WHERE}`, args: [cutoff] });
  const total = Number(Array.from(countResult.rows)[0].c);
  log(`待归档: ${total} 条`);

  if (total === 0) {
    log('无需归档。');
    db.close();
    return;
  }

  if (DRY_RUN) {
    log('[DRY RUN] 不执行写入。');
    db.close();
    return;
  }

  // ③ 删除闸：搬完就删主表 = 删除路径，先过闸（磁盘转储或库里的转储凭证，⑥b）
  const credRow = await db.execute({ sql: 'SELECT value FROM settings WHERE key=?', args: [cd.CREDENTIAL_KEY] })
    .catch(() => ({ rows: [] }));
  let cred = null;
  try { cred = credRow.rows[0] ? JSON.parse(credRow.rows[0].value) : null; } catch { cred = null; }
  const gate = cd.deleteGateAny(
    process.env.CONTENT_DUMP_DIR || path.join(__dirname, '..', 'data', 'content-dump', 'cloud'),
    cred, { maxAgeHours: cd.GATE_MAX_AGE_H });
  if (!gate.allowed) {
    log(`归档被删除闸挡下（一条都不搬）：${gate.reason}`);
    db.close();
    process.exitCode = 1;
    return;
  }
  log(`删除闸放行（${gate.via}）：${gate.reason}`);

  // ② 归档表 DDL 与建表源同一份（含 translated_*，不再内嵌第二份）
  const ddl = createSqlOf(path.join(__dirname, '..'), 'lib/db.js', 'articles_archive');
  if (!ddl) throw new Error('lib/db.js 的 SCHEMA 里没有 articles_archive（建表源头没了）');
  await db.execute(ddl);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_archive_published ON articles_archive(published_at)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_archive_source ON articles_archive(source_id)');

  // 列清单取两表交集（按主表列序）：源表有而归档表没有的列不搬，反之亦然；translated_* 自此不再被丢
  const mainCols = (await db.execute(`SELECT name FROM pragma_table_info('articles')`)).rows.map((r) => r.name);
  const archCols = new Set((await db.execute(`SELECT name FROM pragma_table_info('articles_archive')`)).rows.map((r) => r.name));
  const cols = mainCols.filter((c) => archCols.has(c));
  if (cols.length < 10) throw new Error(`两表列交集只有 ${cols.length} 列，形状可疑，拒绝搬移`);

  // 分批迁移
  let archived = 0;
  while (archived < total) {
    const batch = await db.execute({
      sql: `SELECT ${cols.join(', ')} FROM articles WHERE ${WHERE} ORDER BY ${TIME_COL.articles} LIMIT ?`,
      args: [cutoff, BATCH_SIZE],
    });
    const rows = Array.from(batch.rows);
    if (rows.length === 0) break;

    for (const row of rows) {
      try {
        await db.execute({
          sql: `INSERT OR IGNORE INTO articles_archive(${cols.join(', ')}) VALUES(${cols.map(() => '?').join(',')})`,
          args: cols.map((c) => row[c]),
        });
      } catch (err) {
        if (!err.message.includes('UNIQUE')) throw err;
      }
    }

    // 从主表删除已归档的（同一份谓词再压一遍，防搬运期间被用户标记的行被误删）
    const ids = rows.map(r => r.id);
    const del = await db.execute({
      sql: `DELETE FROM articles WHERE id IN (${ids.map(() => '?').join(',')}) AND ${ARTICLE_DELETE_COND}`,
      args: ids,
    });

    archived += rows.length;
    log(`  进度: ${archived}/${total}`);
    // 删除数为 0 而批次非空 = 这批行全被豁免条件拦下了（搬运期间被标记）——原地重查只会死循环
    if (Number(del.rowsAffected || 0) === 0) {
      log(`本批 ${rows.length} 行删除 0（全部在搬运期间被豁免），停止以防死循环；剩余 ${total - archived} 条下轮再议`);
      break;
    }
  }

  log(`归档完成: ${archived} 条已迁移到 articles_archive`);

  const mainCount = await db.execute('SELECT COUNT(*) c FROM articles');
  const archiveCount = await db.execute('SELECT COUNT(*) c FROM articles_archive');
  log(`主表: ${Number(Array.from(mainCount.rows)[0].c)} 条, 归档表: ${Number(Array.from(archiveCount.rows)[0].c)} 条`);

  db.close();
}

main().catch(err => {
  console.error(`归档失败: ${err.stack || err.message}`);
  process.exit(1);
});
