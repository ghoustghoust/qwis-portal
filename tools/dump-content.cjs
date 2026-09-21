#!/usr/bin/env node
// 内容级转储 / 回放 / 校验（spec43 D3 · B103）。删除类改动的**前置闸**：没有这份底牌，
// 任何"执行删除"的验证一律不许跑（此前云端 articles/videos 根本不在任何备份里）。
//
//   node tools/dump-content.cjs --scope cloud --full            # 直连 Turso 全量转储
//   node tools/dump-content.cjs --scope cloud                   # 增量（只取 id > 清单 maxId）
//   node tools/dump-content.cjs --scope local --full            # 本地灾备库同口径转储
//   node tools/dump-content.cjs --scope cloud --verify          # 逐片核校验和/行数/id 区间
//   node tools/dump-content.cjs --scope cloud --gate            # 只回答"现在许不许删"
//   node tools/dump-content.cjs --scope cloud --restore --into data/rehearse.db
//
// 输出目录默认 data/content-dump/<scope>/（NDJSON + gzip + manifest.json）。
'use strict';

const fs = require('fs');
const path = require('path');
const cd = require('../lib/content-dump');

for (const line of (fs.existsSync(path.join(__dirname, '..', '.env'))
  ? fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8') : '').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const SCOPE = String(arg('scope', 'cloud'));
const ROOT = path.join(__dirname, '..');
const DIR_TAG = SCOPE === 'cloud' || SCOPE === 'local' ? SCOPE : 'custom';
const OUT_ARG = String(arg('out', path.join('data', 'content-dump', DIR_TAG)));
const OUT_DIR = path.isAbsolute(OUT_ARG) ? OUT_ARG : path.join(ROOT, OUT_ARG);
const CHUNK_ROWS = Number(arg('chunk-rows', 2000));
const FULL = !!arg('full', false);
const MAX_AGE_H = Number(arg('max-age-hours', 0));

function log(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }

// 数据源只给"读"，回放目标只给"写"——两边不共用一个连接，避免手滑把转储写成对生产的破坏
function openSource(want) {
  if (want === 'cloud') {
    if (!process.env.TURSO_DATABASE_URL) throw new Error('--scope cloud 需要 TURSO_DATABASE_URL');
    const { createClient } = require('@libsql/client');
    const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
    return {
      kind: 'turso',
      all: async (sql, args = []) => (await client.execute({ sql, args })).rows.map((r) => ({ ...r })),
      close: () => client.close(),
    };
  }
  // `--scope local` 是灾备主库；`--scope <绝对路径>.db` 让回归锁能拿真文件库跑同一条命令
  const file = want === 'local'
    ? path.join(ROOT, 'data', 'app.db')
    : (path.isAbsolute(want) ? want : path.join(ROOT, want));
  if (!/\.db$/.test(file)) throw new Error(`--scope 只接受 cloud / local / *.db 文件路径，收到 ${want}`);
  const Database = require('better-sqlite3');
  const db = new Database(file, { readonly: true });
  return {
    kind: 'sqlite',
    all: async (sql, args = []) => db.prepare(sql).all(...args),
    close: () => db.close(),
  };
}

async function columnsOf(src, table) {
  const rows = await src.all(`SELECT name FROM pragma_table_info(?) ORDER BY cid`, [table]);
  const cols = rows.map((r) => r.name);
  if (cols.length === 0) throw new Error(`${table} 在源库里没有列 —— 表不存在？`);
  return cols;
}

/** 连建表语句一起带进清单：回放场的意义是"和源库同形状"，而不是"迁就本地库的列"（B131） */
async function ddlOf(src, table) {
  const rows = await src.all(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`, [table]);
  return rows.length ? rows[0].sql : null;
}

async function runDump() {
  const src = openSource(SCOPE);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  let manifest;
  if (!FULL && fs.existsSync(cd.manifestPath(OUT_DIR))) {
    manifest = cd.readManifest(OUT_DIR);
    log(`增量：基于 ${SCOPE} 既有清单（updatedAt ${manifest.updatedAt}）`);
  } else {
    manifest = cd.buildManifest(SCOPE, src.kind, {}, startedAt);
  }
  if (manifest.sourceKind !== src.kind) throw new Error(`清单源类型 ${manifest.sourceKind} 与本次 ${src.kind} 不一致，拒绝混写`);

  for (const table of cd.DUMP_TABLES) {
    const columns = await columnsOf(src, table);
    const ddl = await ddlOf(src, table);
    const prev = manifest.tables[table] || cd.emptyTableState(columns);
    if (!FULL && manifest.tables[table] && String(manifest.tables[table].columns.join()) !== columns.join()) {
      throw new Error(`${table} 列清单变了（源 ${columns.length} 列 / 清单 ${prev.columns.length} 列）—— 先跑 --full，别把两种形状混在同一份转储里`);
    }
    const state = cd.emptyTableState(columns);
    state.ddl = ddl || prev.ddl || null;
    state.rows = FULL ? 0 : prev.rows;
    state.maxId = FULL ? 0 : prev.maxId;
    state.bytes = FULL ? 0 : prev.bytes;
    state.chunks = FULL ? [] : prev.chunks.slice();
    if (FULL) for (const rec of prev.chunks) fs.rmSync(path.join(OUT_DIR, rec.file), { force: true });

    let seq = state.chunks.length, guard = 0;
    for (;;) {
      const { sql, args } = cd.keysetSql(table, columns, state.maxId, CHUNK_ROWS);
      const rows = await src.all(sql, args);
      if (rows.length === 0) break;
      const rec = cd.writeChunk(OUT_DIR, table, ++seq, rows);
      state.chunks.push(rec);
      state.rows += rec.rows;
      state.maxId = rec.idMax;
      state.bytes += rec.bytes;
      log(`${table} 分片 ${rec.file} ${rec.rows} 行 / ${(rec.bytes / 1048576).toFixed(2)}MB / id≤${rec.idMax}`);
      if (++guard > 200000) throw new Error(`${table} 游标没推进，疑似死循环（maxId=${state.maxId}）`);
      if (rows.length < CHUNK_ROWS) break;
    }
    manifest.tables[table] = state;
    log(`${table} 合计 ${state.rows} 行 / ${(state.bytes / 1048576).toFixed(1)}MB / ${state.chunks.length} 片`);
  }
  manifest.updatedAt = new Date().toISOString();
  cd.writeManifest(OUT_DIR, manifest);
  src.close();

  const v = cd.verifyDump(OUT_DIR, { maxAgeHours: MAX_AGE_H });
  log(`校验：${v.ok ? '通过' : '不通过 ' + v.reasons.join('；')}`);
  if (!v.ok) process.exitCode = 1;
}

function runVerify() {
  const v = cd.verifyDump(OUT_DIR, { maxAgeHours: MAX_AGE_H });
  for (const [t, s] of Object.entries(v.stats)) log(`${t}: ${s.rows} 行 / ${s.chunks} 片 / ${(s.bytes / 1048576).toFixed(1)}MB / 坏片 ${s.badChunks}`);
  console.log(JSON.stringify(v, (k, val) => (k === 'manifest' ? undefined : val), 2));
  process.exitCode = v.ok ? 0 : 1;
}

function runGate() {
  const g = cd.deleteGate(OUT_DIR, { maxAgeHours: MAX_AGE_H });
  console.log(JSON.stringify({ scope: SCOPE, dir: path.relative(ROOT, OUT_DIR), allowed: g.allowed, reason: g.reason }, null, 2));
  process.exitCode = g.allowed ? 0 : 1;
}

async function runRestore() {
  const into = String(arg('into', ''));
  if (!into || into === true) throw new Error('--restore 必须带 --into <目标库文件>（回放演练场，不是生产库）');
  const target = path.isAbsolute(into) ? into : path.join(ROOT, into);
  if (/TURSO|turso/i.test(target)) throw new Error('回放目标只许是本地文件库');
  const v = cd.verifyDump(OUT_DIR, {});
  if (!v.ok) throw new Error(`转储校验未过，拒绝回放：${v.reasons.join('；')}`);
  const Database = require('better-sqlite3');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new Database(target);
  const manifest = cd.readManifest(OUT_DIR);
  for (const table of Object.keys(manifest.tables)) {
    const { columns, chunks, ddl } = manifest.tables[table];
    const hasTable = (t) => db.prepare(`SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name=?`).get(t).c > 0;
    if (arg('mktarget', false)) {
      if (!ddl) throw new Error(`${table} 的清单里没有建表语句 —— 重跑一次转储即可带上（B131 之后新增的字段）`);
      if (!hasTable(table)) db.exec(ddl);
    }
    const present = new Set(db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table).map((r) => r.name));
    const missing = columns.filter((c) => !present.has(c));
    if (present.size === 0) throw new Error(`目标库没有 ${table} 表 —— 先建表再回放（回放不是建库工具）`);
    if (missing.length) throw new Error(`目标库 ${table} 缺列：${missing.join(', ')}（缺列就插会把数据插错位置）`);
    const stmt = db.prepare(cd.restoreSql(table, columns));
    let n = 0;
    const t0 = Date.now();
    for (const rec of chunks) {
      const rows = cd.readChunk(OUT_DIR, rec);
      db.transaction((rs) => { for (const r of rs) stmt.run(columns.map((c) => r[c] ?? null)); })(rows);
      n += rows.length;
    }
    const live = db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;
    log(`回放 ${table}：${n} 行 / ${((Date.now() - t0) / 1000).toFixed(1)}s / 目标表现存 ${live} 行`);
    if (live < manifest.tables[table].rows) {
      throw new Error(`回放后 ${table} 只有 ${live} 行，少于转储清单的 ${manifest.tables[table].rows} 行`);
    }
  }
  db.close();
  log(`回放完成 → ${path.relative(ROOT, target)}（对照源库逐表核过行数下界）`);
}

(async () => {
  if (arg('verify', false)) runVerify();
  else if (arg('gate', false)) runGate();
  else if (arg('restore', false)) await runRestore();
  else await runDump();
})().catch((e) => { console.error(`转储失败: ${e.message}`); process.exit(1); });
