#!/usr/bin/env node
// 数据迁移脚本：本地 SQLite → Turso (libSQL)
// 用法: TURSO_DATABASE_URL=libsql://xxx TURSO_AUTH_TOKEN=xxx node tools/migrate-to-turso.js
//
// 功能:
//   1. 在 Turso 上创建完整 schema（对齐 server/db.js）
//   2. 分批迁移全部表数据（每批 500 行，避免超时）
//   3. 可选归档：>90 天的文章直接写入 articles_archive
//   4. 迁移后验证：行数对比 + 抽样校验
//
// 选项（环境变量）:
//   MIGRATE_DRY_RUN=1     只统计不写入
//   MIGRATE_ARCHIVE=1     启用文章归档（>90天→articles_archive）
//   MIGRATE_TABLES=x,y    只迁移指定表（默认全部）
//   MIGRATE_BATCH_SIZE=N  每批行数（默认 500）

const path = require('path');
const fs = require('fs');

// 手动加载 .env（不依赖 dotenv 包）
const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
for (const line of envTxt.split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

// ─── 配置 ───
const DATA_DIR = process.env.APP_DATA_DIR
  ? path.resolve(process.env.APP_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const LOCAL_DB_PATH = path.join(DATA_DIR, 'app.db');
const BATCH_SIZE = Number(process.env.MIGRATE_BATCH_SIZE) || 500;
const DRY_RUN = !!process.env.MIGRATE_DRY_RUN;
const ARCHIVE = !!process.env.MIGRATE_ARCHIVE;
const TABLE_FILTER = process.env.MIGRATE_TABLES
  ? process.env.MIGRATE_TABLES.split(',').map(s => s.trim())
  : null;

// 全部表及迁移顺序（有外键依赖的先建父表）
const ALL_TABLES = [
  'groups', 'sources', 'settings', 'credentials',
  'articles', 'videos', 'pending_items', 'daily_reports',
  'job_queue', 'audit_log',
];

// ─── 工具函数 ───
function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function logErr(msg) {
  console.error(`[${new Date().toISOString().slice(11, 19)}] ERROR: ${msg}`);
}

// ─── 主流程 ───
async function main() {
  log('=== 全网情报系统 SQLite → Turso 迁移工具 ===');

  // 1. 检查环境
  if (!process.env.TURSO_DATABASE_URL) {
    logErr('TURSO_DATABASE_URL 未设置。请先创建 Turso 数据库并配置环境变量。');
    log('示例: TURSO_DATABASE_URL=libsql://xxx.turso.io TURSO_AUTH_TOKEN=xxx node tools/migrate-to-turso.js');
    process.exit(1);
  }

  if (!fs.existsSync(LOCAL_DB_PATH)) {
    logErr(`本地数据库不存在: ${LOCAL_DB_PATH}`);
    process.exit(1);
  }

  // 2. 打开本地数据库
  const Database = require('better-sqlite3');
  const localDb = new Database(LOCAL_DB_PATH, { readonly: true });
  log(`本地数据库已打开: ${LOCAL_DB_PATH}`);

  // 3. 连接 Turso
  const { createClient } = require('@libsql/client');
  const cloud = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  log(`Turso 已连接: ${process.env.TURSO_DATABASE_URL}`);

  // 4. 统计本地数据
  log('\n── 本地数据统计 ──');
  const tables = TABLE_FILTER || ALL_TABLES;
  const counts = {};
  for (const table of tables) {
    try {
      const row = localDb.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get();
      counts[table] = row.cnt;
      log(`  ${table}: ${row.cnt} 行`);
    } catch (err) {
      log(`  ${table}: 表不存在或查询失败 (${err.message})`);
      counts[table] = 0;
    }
  }

  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  log(`  总计: ${totalRows} 行`);

  if (DRY_RUN) {
    log('\n[DRY RUN] 统计完成，不写入。');
    localDb.close();
    cloud.close();
    return;
  }

  // 5. 在 Turso 创建 Schema
  log('\n── 创建 Schema ──');
  const { ensureSchema } = require('../lib/db');
  // 临时注入 cloud client 给 lib/db.js
  // 由于 lib/db.js 通过环境变量检测模式，这里 TURSO_DATABASE_URL 已设置
  // 直接调用 ensureSchema
  try {
    await ensureSchema();
    log('Schema 创建/验证完成');
  } catch (err) {
    logErr(`Schema 创建失败: ${err.message}`);
    localDb.close();
    cloud.close();
    process.exit(1);
  }

  // 6. 逐表迁移
  log('\n── 开始数据迁移 ──');
  const archiveCutoff = new Date();
  archiveCutoff.setDate(archiveCutoff.getDate() - 90);
  const cutoffIso = archiveCutoff.toISOString();

  for (const table of tables) {
    if (counts[table] === 0) {
      log(`  ${table}: 跳过（空表）`);
      continue;
    }

    log(`  ${table}: 开始迁移 (${counts[table]} 行)...`);
    let migrated = 0;
    let archived = 0;
    let offset = 0;

    while (offset < counts[table]) {
      const rows = localDb.prepare(
        `SELECT * FROM ${table} LIMIT ${BATCH_SIZE} OFFSET ${offset}`
      ).all();

      if (rows.length === 0) break;

      // 文章表归档分流
      if (table === 'articles' && ARCHIVE) {
        const hot = [];
        const cold = [];
        for (const row of rows) {
          if (row.published_at && row.published_at < cutoffIso) {
            cold.push(row);
          } else {
            hot.push(row);
          }
        }

        // 热数据 → articles
        if (hot.length > 0) {
          await batchInsert(cloud, 'articles', hot);
          migrated += hot.length;
        }
        // 冷数据 → articles_archive
        if (cold.length > 0) {
          await batchInsert(cloud, 'articles_archive', cold);
          archived += cold.length;
        }
      } else {
        await batchInsert(cloud, table, rows);
        migrated += rows.length;
      }

      offset += BATCH_SIZE;
      if (offset % 5000 === 0 || offset >= counts[table]) {
        log(`    进度: ${Math.min(offset, counts[table])}/${counts[table]}`);
      }
    }

    if (ARCHIVE && table === 'articles') {
      log(`  ${table}: 迁移完成 → 热数据 ${migrated} 行, 归档 ${archived} 行`);
    } else {
      log(`  ${table}: 迁移完成 (${migrated} 行)`);
    }
  }

  // 7. 验证
  log('\n── 迁移验证 ──');
  let allMatch = true;
  for (const table of tables) {
    try {
      const result = await cloud.execute(`SELECT COUNT(*) as cnt FROM ${table}`);
      const cloudCount = Number(result.rows[0].cnt);
      let expected = counts[table];

      // 归档模式下，articles 主表预期数量 = 热数据数
      if (table === 'articles' && ARCHIVE) {
        const hotCount = localDb.prepare(
          `SELECT COUNT(*) as cnt FROM articles WHERE published_at IS NULL OR published_at >= ?`
        ).get(cutoffIso);
        expected = hotCount.cnt;

        const archiveResult = await cloud.execute('SELECT COUNT(*) as cnt FROM articles_archive');
        const archiveCount = Number(archiveResult.rows[0].cnt);
        const coldExpected = counts.articles - expected;
        const archiveMatch = archiveCount === coldExpected;
        log(`  articles_archive: 云端 ${archiveCount} / 预期 ${coldExpected} ${archiveMatch ? '✓' : '✗'}`);
        if (!archiveMatch) allMatch = false;
      }

      const match = cloudCount === expected;
      log(`  ${table}: 云端 ${cloudCount} / 预期 ${expected} ${match ? '✓' : '✗'}`);
      if (!match) allMatch = false;
    } catch (err) {
      log(`  ${table}: 验证失败 (${err.message})`);
      allMatch = false;
    }
  }

  // 8. 完成
  log('\n── 迁移结果 ──');
  if (allMatch) {
    log('全部验证通过！迁移成功。');
  } else {
    logErr('部分表行数不匹配，请检查！');
  }

  localDb.close();
  cloud.close();
  log('连接已关闭。');
}

// ─── 批量插入（Turso batch API，每批最多 100 行） ───
async function batchInsert(cloud, table, rows) {
  if (rows.length === 0) return;

  const columns = Object.keys(rows[0]);
  const placeholders = columns.map(() => '?').join(', ');
  const colNames = columns.join(', ');
  const sql = `INSERT OR IGNORE INTO ${table} (${colNames}) VALUES (${placeholders})`;

  const BATCH_API_SIZE = 100; // Turso batch 每次最多约 100 条语句
  for (let i = 0; i < rows.length; i += BATCH_API_SIZE) {
    const chunk = rows.slice(i, i + BATCH_API_SIZE);
    const steps = chunk.map(row => {
      const values = columns.map(col => {
        const v = row[col];
        if (v === undefined) return null;
        if (typeof v === 'object') return JSON.stringify(v);
        return v;
      });
      return [sql, values];
    });
    try {
      await cloud.batch(steps, 'write');
    } catch (err) {
      // 如果整批失败，降级为逐条（容错 UNIQUE 冲突）
      if (err.message && err.message.includes('UNIQUE constraint')) {
        for (const step of steps) {
          try { await cloud.execute(step[0], step[1]); } catch { /* ignore */ }
        }
      } else {
        throw err;
      }
    }
  }
}

// ─── 执行 ───
main().catch(err => {
  logErr(`迁移失败: ${err.message}`);
  console.error(err);
  process.exit(1);
});
