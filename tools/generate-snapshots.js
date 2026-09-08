#!/usr/bin/env node
// 静态快照生成工具 —— 从 Turso 导出数据为 JSON 文件
// 供前端「打开即有内容」使用（毫秒级首屏），同时由 Serverless API 动态刷新
//
// 用法: TURSO_DATABASE_URL=xxx TURSO_AUTH_TOKEN=xxx node tools/generate-snapshots.js
// 输出: public/data/articles.json, videos.json, hot.json, daily.json, sources.json, groups.json, meta.json
//
// 也可本地运行（不设 TURSO_DATABASE_URL 则读本地 SQLite）

const path = require('path');
const fs = require('fs');

// 手动加载 .env
const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
for (const line of envTxt.split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const OUT_DIR = path.join(__dirname, '..', 'public', 'data');
const VERCEL_DIR = path.join(__dirname, '..', 'static-data');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
if (!fs.existsSync(VERCEL_DIR)) fs.mkdirSync(VERCEL_DIR, { recursive: true });

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// ─── 数据库连接 ───
const IS_CLOUD = !!process.env.TURSO_DATABASE_URL;
let db = null;
let cloud = null;

function getDb() {
  if (IS_CLOUD) {
    if (!cloud) {
      const { createClient } = require('@libsql/client');
      cloud = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
      });
    }
    return {
      async all(sql, args = []) {
        const r = await cloud.execute({ sql, args });
        return Array.from(r.rows);
      },
      async one(sql, args = []) {
        const rows = await this.all(sql, args);
        return rows[0];
      },
    };
  }
  // 本地 SQLite
  if (!db) {
    const Database = require('better-sqlite3');
    const DATA_DIR = process.env.APP_DATA_DIR || path.join(__dirname, '..', 'data');
    db = new Database(path.join(DATA_DIR, 'app.db'), { readonly: true });
  }
  return {
    all(sql, args = []) { return db.prepare(sql).all(...args); },
    one(sql, args = []) { return db.prepare(sql).get(...args); },
  };
}

// ─── 生成各快照 ───
async function genArticles(d) {
  const rows = await d.all(
    `SELECT a.id, a.source_id, a.title, a.url, a.author, a.cover, a.summary,
     a.published_at, a.read_at, a.later, a.created_at, a.score, a.tags, a.word_count,
     s.name AS source_name, s.focus AS source_focus
     FROM articles a JOIN sources s ON s.id=a.source_id
     WHERE s.type != 'hotlist'
       AND COALESCE(json_extract(COALESCE(s.extra,'{}'),'$.aggregator'),0) != 1
     ORDER BY COALESCE(a.published_at, a.created_at) DESC LIMIT 200`
  );
  write('articles.json', { items: rows, generated_at: new Date().toISOString() });
  log(`articles: ${rows.length} 条`);
}

async function genVideos(d) {
  const rows = await d.all(
    `SELECT v.id, v.source_id, v.platform, v.title, v.url, v.vid, v.cover,
     v.duration, v.author, v.published_at, s.name AS source_name
     FROM videos v JOIN sources s ON s.id=v.source_id
     ORDER BY COALESCE(v.published_at, v.created_at) DESC LIMIT 100`
  );
  write('videos.json', { items: rows, generated_at: new Date().toISOString() });
  log(`videos: ${rows.length} 条`);
}

async function genHot(d) {
  const rows = await d.all(
    `SELECT a.id, a.title, a.url, a.author, a.cover, a.summary, a.score,
     a.published_at, a.category, s.name AS source_name
     FROM articles a JOIN sources s ON s.id=a.source_id
     WHERE s.type='hotlist' AND a.published_at >= datetime('now', '-3 days')
     ORDER BY a.score DESC NULLS LAST, a.published_at DESC LIMIT 200`
  );
  write('hot.json', { items: rows, generated_at: new Date().toISOString() });
  log(`hot: ${rows.length} 条`);
}

async function genDaily(d) {
  const row = await d.one('SELECT * FROM daily_reports ORDER BY generated_at DESC LIMIT 1');
  const report = row ? {
    id: row.id,
    generated_at: row.generated_at,
    window_hours: row.window_hours,
    sections: safeJson(row.sections, []),
    stats: safeJson(row.stats, {}),
  } : null;
  write('daily.json', { report, generated_at: new Date().toISOString() });
  log(`daily: ${report ? '有' : '无'}日报`);
}

async function genSources(d) {
  const rows = await d.all(
    `SELECT id, type, name, url, avatar, group_id, focus, enabled, status, fail_count
     FROM sources WHERE enabled=1 ORDER BY name`
  );
  write('sources.json', { sources: rows, generated_at: new Date().toISOString() });
  log(`sources: ${rows.length} 个活跃源`);
}

async function genGroups(d) {
  const rows = await d.all(
    `SELECT g.id, g.kind, g.name, g.sort, COUNT(s.id) AS source_count
     FROM groups g LEFT JOIN sources s ON s.group_id=g.id AND s.enabled=1
     GROUP BY g.id ORDER BY g.sort, g.id`
  );
  write('groups.json', { groups: rows, generated_at: new Date().toISOString() });
  log(`groups: ${rows.length} 个分组`);
}

async function genMeta(d) {
  const articleCount = (await d.one('SELECT COUNT(*) c FROM articles')).c;
  const videoCount = (await d.one('SELECT COUNT(*) c FROM videos')).c;
  const sourceCount = (await d.one('SELECT COUNT(*) c FROM sources WHERE enabled=1')).c;
  const latestDaily = await d.one('SELECT generated_at FROM daily_reports ORDER BY generated_at DESC LIMIT 1');
  write('meta.json', {
    articleCount, videoCount, sourceCount,
    latestDailyAt: latestDaily ? latestDaily.generated_at : null,
    generated_at: new Date().toISOString(),
  });
  log(`meta: ${articleCount} 文章 / ${videoCount} 视频 / ${sourceCount} 源`);
}

// ─── 工具函数 ───
function safeJson(str, def) {
  try { return JSON.parse(str || 'null') || def; } catch { return def; }
}

function write(filename, data) {
  const content = JSON.stringify(data, null, 2);
  fs.writeFileSync(path.join(OUT_DIR, filename), content, 'utf-8');
  fs.writeFileSync(path.join(VERCEL_DIR, filename), content, 'utf-8');
}

// ─── 主流程 ───
async function main() {
  log('=== 静态快照生成 ===');
  const d = getDb();

  await genArticles(d);
  await genVideos(d);
  await genHot(d);
  await genDaily(d);
  await genSources(d);
  await genGroups(d);
  await genMeta(d);

  log('=== 完成 ===');

  // 关闭连接
  if (cloud) cloud.close();
  if (db) db.close();
}

main().catch(err => {
  console.error(`快照生成失败: ${err.message}`);
  process.exit(1);
});
