#!/usr/bin/env node
// 数据归档工具 —— 将 >N 天的文章从 articles 主表迁移到 articles_archive
// 用法: TURSO_DATABASE_URL=xxx TURSO_AUTH_TOKEN=xxx node tools/archive-articles.js [--days=90] [--dry-run]
//
// 目的: 保持主表热数据 < 10 万条，Turso 查询性能可控

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
  log(`=== 文章归档工具 (阈值: ${DAYS} 天${DRY_RUN ? ', DRY RUN' : ''}) ===`);

  const { createClient } = require('@libsql/client');
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  const cutoff = new Date(Date.now() - DAYS * 86400e3).toISOString();
  log(`截止时间: ${cutoff}`);

  // 统计待归档数量
  const countResult = await db.execute({
    sql: 'SELECT COUNT(*) c FROM articles WHERE published_at < ? AND read_at IS NULL AND later=0',
    args: [cutoff],
  });
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

  // 确保归档表存在
  await db.execute(`
    CREATE TABLE IF NOT EXISTS articles_archive (
      id INTEGER PRIMARY KEY,
      source_id INTEGER, title TEXT, url TEXT, author TEXT, cover TEXT,
      summary TEXT, content_html TEXT, published_at TEXT, read_at TEXT,
      later INTEGER DEFAULT 0, created_at TEXT, score INTEGER, reason TEXT,
      tags TEXT, featured INTEGER DEFAULT 0, original_html TEXT, original_url TEXT,
      category TEXT, word_count INTEGER
    )
  `);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_archive_published ON articles_archive(published_at)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_archive_source ON articles_archive(source_id)');

  // 分批迁移
  let archived = 0;
  while (archived < total) {
    // 复制到归档表
    const batch = await db.execute({
      sql: `SELECT * FROM articles WHERE published_at < ? AND read_at IS NULL AND later=0 LIMIT ?`,
      args: [cutoff, BATCH_SIZE],
    });
    const rows = Array.from(batch.rows);
    if (rows.length === 0) break;

    for (const row of rows) {
      try {
        await db.execute({
          sql: `INSERT OR IGNORE INTO articles_archive(id, source_id, title, url, author, cover, summary, content_html, published_at, read_at, later, created_at, score, reason, tags, featured, original_html, original_url, category, word_count)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            row.id, row.source_id, row.title, row.url, row.author, row.cover,
            row.summary, row.content_html, row.published_at, row.read_at, row.later,
            row.created_at, row.score, row.reason, row.tags, row.featured,
            row.original_html, row.original_url, row.category, row.word_count,
          ],
        });
      } catch (err) {
        if (!err.message.includes('UNIQUE')) throw err;
      }
    }

    // 从主表删除已归档的
    const ids = rows.map(r => r.id);
    await db.execute({
      sql: `DELETE FROM articles WHERE id IN (${ids.map(() => '?').join(',')}) AND read_at IS NULL AND later=0`,
      args: ids,
    });

    archived += rows.length;
    log(`  进度: ${archived}/${total}`);
  }

  log(`归档完成: ${archived} 条已迁移到 articles_archive`);

  // 统计最终状态
  const mainCount = await db.execute('SELECT COUNT(*) c FROM articles');
  const archiveCount = await db.execute('SELECT COUNT(*) c FROM articles_archive');
  log(`主表: ${Number(Array.from(mainCount.rows)[0].c)} 条, 归档表: ${Number(Array.from(archiveCount.rows)[0].c)} 条`);

  db.close();
}

main().catch(err => {
  console.error(`归档失败: ${err.message}`);
  process.exit(1);
});
