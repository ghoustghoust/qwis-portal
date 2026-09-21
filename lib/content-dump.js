// 内容级转储的唯一实现（spec43 D3 / B103）。
//
// 为什么必须有这一份（09-19 只读实测，spec43 §二 N3）：云端 `POST /api/backup` 只导出
// `sources`/`groups`/`settings` 三张配置表，`handleBackupRestore` 也只 upsert 这三张 ——
// `articles`/`videos` **不在任何备份里**。保留清理一旦被点亮且删错，线上文章无处可回
// （上游 RSS 早已翻页，重采不回来）。所以任何"执行删除"的验证之前，先要有可核对的内容底牌。
//
// 本文件只放**纯逻辑**（分片编解码、校验和、清单、闸），真连接在 `tools/dump-content.cjs`：
// 判据和自证必须同源（坑 #58/#59），而"删错了能不能回"这件事只有拿真字节回放过才算数。
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

// 转储面 = 会丢就回不来的内容表。配置三表另有 `/api/backup`，不在这里重复一份事实源。
// articles_archive 同属「删了就回不来」的内容表（B132）；源库没有这张表时转储自动跳过（dump-content 按列清单为空跳过）
const DUMP_TABLES = ['articles', 'videos', 'articles_archive'];
const SCHEMA_VERSION = 1;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdent(name, what) {
  if (!IDENT.test(name)) throw new Error(`${what}不是合法标识符：${JSON.stringify(name)}`);
  return name;
}

function chunkFile(table, seq) {
  return `${assertIdent(table, '表名')}.${String(seq).padStart(4, '0')}.ndjson.gz`;
}

function manifestPath(dir) {
  return path.join(dir, 'manifest.json');
}

/** keyset 分页：只按 id 递增游标取，不用 OFFSET（OFFSET 在大表上是 O(n²) 且中途有写入会漏行） */
function keysetSql(table, columns, afterId, limit) {
  if (!Array.isArray(columns) || columns.length === 0) throw new Error(`${table} 的列清单为空，拒绝生成"SELECT *"式的隐式列序`);
  const cols = columns.map((c) => assertIdent(c, `${table} 列名`));
  const n = Number(limit);
  if (!Number.isInteger(n) || n < 1) throw new Error(`分片行数必须是 >=1 的整数，收到 ${limit}`);
  return {
    sql: `SELECT ${cols.join(', ')} FROM ${assertIdent(table, '表名')} WHERE id > ? ORDER BY id ASC LIMIT ${n}`,
    args: [Number(afterId) || 0],
  };
}

function encodeNdjson(rows) {
  return Buffer.from(rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

function decodeNdjson(buf) {
  return buf.toString('utf8').split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l));
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** 落一个分片：先写 .part 再 rename，避免中途崩溃留下"看起来完整"的半个文件 */
function writeChunk(dir, table, seq, rows) {
  const plain = encodeNdjson(rows);
  const gz = zlib.gzipSync(plain);
  const file = chunkFile(table, seq);
  const tmp = path.join(dir, file + '.part');
  fs.writeFileSync(tmp, gz);
  fs.renameSync(tmp, path.join(dir, file));
  const ids = rows.map((r) => Number(r.id)).filter((x) => Number.isFinite(x));
  return {
    file,
    rows: rows.length,
    bytes: gz.length,
    rawBytes: plain.length,
    sha256: sha256Hex(gz),
    idMin: ids.length ? Math.min(...ids) : null,
    idMax: ids.length ? Math.max(...ids) : null,
  };
}

/** 读回一个分片并校验字节；校验不过就抛错，绝不"跳过坏片继续" */
function readChunk(dir, rec) {
  const gz = fs.readFileSync(path.join(dir, rec.file));
  const got = sha256Hex(gz);
  if (got !== rec.sha256) throw new Error(`分片校验和不符：${rec.file} 期望 ${rec.sha256} 实得 ${got}`);
  const rows = decodeNdjson(zlib.gunzipSync(gz));
  if (rows.length !== rec.rows) throw new Error(`分片行数不符：${rec.file} 清单写 ${rec.rows} 实得 ${rows.length}`);
  return rows;
}

function emptyTableState(columns) {
  return { columns: columns.slice(), rows: 0, maxId: 0, bytes: 0, chunks: [] };
}

function buildManifest(scope, sourceKind, tables, startedAt) {
  return {
    schemaVersion: SCHEMA_VERSION,
    scope,
    sourceKind,
    createdAt: startedAt,
    updatedAt: startedAt,
    tables,
  };
}

function writeManifest(dir, manifest) {
  const tmp = manifestPath(dir) + '.part';
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  fs.renameSync(tmp, manifestPath(dir));
}

function readManifest(dir) {
  const m = JSON.parse(fs.readFileSync(manifestPath(dir), 'utf8'));
  if (m.schemaVersion !== SCHEMA_VERSION) throw new Error(`清单 schemaVersion=${m.schemaVersion}，本实现只认 ${SCHEMA_VERSION}`);
  return m;
}

/**
 * 校验一份转储"真的能拿来回放"，而不是"目录里有文件"。
 * 逐片核校验和 + 行数 + id 区间递增 + 清单计数与分片求和一致 + 新鲜度。
 * 任何一条不过 → ok:false 并给出**全部**原因（一次看全，不许挤牙膏式报错）。
 */
function verifyDump(dir, opts = {}) {
  const maxAgeHours = Number.isFinite(opts.maxAgeHours) ? opts.maxAgeHours : 0;
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const reasons = [];
  let manifest = null;
  const stats = {};
  try {
    manifest = readManifest(dir);
  } catch (e) {
    return { ok: false, reasons: [`清单读不到或形态不对：${e.message}`], manifest: null, stats };
  }
  for (const table of Object.keys(manifest.tables)) {
    if (!DUMP_TABLES.includes(table)) { reasons.push(`${table} 不在转储表白名单里`); continue; }
    const t = manifest.tables[table];
    if (!Array.isArray(t.columns) || t.columns.length === 0) reasons.push(`${table} 清单没有列清单`);
    if (!Array.isArray(t.chunks) || t.chunks.length === 0) {
      // rows=0 的空表没有可备份内容（dump 侧会跳过），不算坏；rows>0 却没分片才是「没备上」
      if (t.rows > 0) reasons.push(`${table} 有 ${t.rows} 行却没有任何分片（没备上）`);
    }
    let sum = 0, lastId = 0, sumBytes = 0, badChunks = 0;
    for (const rec of t.chunks || []) {
      sum += rec.rows;
      sumBytes += rec.bytes;
      try {
        if (!fs.existsSync(path.join(dir, rec.file))) throw new Error('文件不存在');
        const rows = readChunk(dir, rec);
        const min = rows.length ? Number(rows[0].id) : null;
        const max = rows.length ? Number(rows[rows.length - 1].id) : null;
        if (min !== rec.idMin || max !== rec.idMax) throw new Error(`id 区间不符 清单[${rec.idMin},${rec.idMax}] 实得[${min},${max}]`);
        if (min <= lastId) throw new Error(`id 区间不递增：${min} 落在上一片 ${lastId} 之内或之前`);
        lastId = max;
      } catch (e) {
        badChunks++;
        reasons.push(`${table} 分片 ${rec.file} 校验失败：${e.message}`);
      }
    }
    if (sum !== t.rows) reasons.push(`${table} 清单行数 ${t.rows} ≠ 分片求和 ${sum}`);
    if (lastId !== t.maxId) reasons.push(`${table} 清单 maxId ${t.maxId} ≠ 分片末位 ${lastId}`);
    stats[table] = { rows: sum, maxId: lastId, bytes: sumBytes, chunks: (t.chunks || []).length, badChunks };
  }
  const ageHours = (now - Date.parse(manifest.updatedAt)) / 3600000;
  if (maxAgeHours > 0 && !(ageHours >= 0) ) reasons.push(`updatedAt 不可解析或在未来：${manifest.updatedAt}`);
  else if (maxAgeHours > 0 && ageHours > maxAgeHours) reasons.push(`转储已过期：${ageHours.toFixed(1)}h > 上限 ${maxAgeHours}h`);
  return { ok: reasons.length === 0, reasons, manifest, stats, ageHours };
}

/**
 * 删除闸（D3 的强制形态）：**先验转储，再谈删除**。
 * 返回 {allowed, reason}，调用方拿到 false 必须跳过删除并出声，而不是"警告后照删"。
 */
function deleteGate(dir, opts = {}) {
  if (!fs.existsSync(manifestPath(dir))) {
    return { allowed: false, reason: `没有内容级转储（缺 ${manifestPath(dir)}）—— 按 spec43 D3，转储之前不许执行删除` };
  }
  const v = verifyDump(dir, opts);
  if (!v.ok) return { allowed: false, reason: `内容级转储校验未过：${v.reasons.join('；')}`, verify: v };
  const rows = Object.values(v.stats).reduce((a, s) => a + s.rows, 0);
  if (rows === 0) return { allowed: false, reason: '转储校验过了但一行内容都没有', verify: v };
  return { allowed: true, reason: `转储可用：${rows} 行 / ${(Object.values(v.stats).reduce((a, s) => a + s.bytes, 0) / 1048576).toFixed(1)}MB / ${v.ageHours.toFixed(1)}h 前`, verify: v };
}

// ── ⑥b 转储凭证（2026-09-21）──────────────────────────────────────────────
// 盘面：磁盘校验（deleteGate）只在"有本地盘"的地方成立；GH runner 与 Vercel 都没有那份目录，
// 闸在那两端恒挡 = 定时清理永远跑不了。所以转储跑完且校验全过后，把凭证写进库（settings），
// 那两端改判凭证。凭证只证明"某时刻存在一份校验全过的转储"，不替代磁盘校验——本地仍走磁盘。
const CREDENTIAL_KEY = 'retention.dumpCredential';
const GATE_MAX_AGE_H = 48;

/** 从清单生成可入库的凭证：摘要 + 行数 + maxId + 清单指纹（不塞逐片校验和全文） */
function credentialFromManifest(manifest) {
  const tables = {};
  for (const [t, st] of Object.entries(manifest.tables || {})) {
    tables[t] = { rows: st.rows || 0, maxId: st.maxId || 0, bytes: st.bytes || 0, chunks: (st.chunks || []).length };
  }
  return {
    at: manifest.updatedAt, scope: manifest.scope,
    tables, manifestSha256: sha256Hex(JSON.stringify(manifest)),
  };
}

/** 凭证闸：判库里的凭证（新鲜度 + 非空 + 带指纹）。不读盘，runner/云端可用 */
function credentialGate(cred, opts = {}) {
  const maxAgeHours = Number.isFinite(opts.maxAgeHours) ? opts.maxAgeHours : GATE_MAX_AGE_H;
  if (!cred || typeof cred !== 'object') {
    return { allowed: false, reason: `库里没有转储凭证（settings['${CREDENTIAL_KEY}']）——先跑一次 npm run dump:content -- --scope cloud` };
  }
  const at = Date.parse(cred.at || '');
  if (!Number.isFinite(at)) return { allowed: false, reason: `凭证时间不可解析：${cred.at}` };
  const ageHours = (Date.now() - at) / 3600000;
  if (ageHours < 0) return { allowed: false, reason: `凭证时间在未来：${cred.at}` };
  if (maxAgeHours > 0 && ageHours > maxAgeHours) return { allowed: false, reason: `转储凭证已过期：${ageHours.toFixed(1)}h > 上限 ${maxAgeHours}h`, ageHours };
  const rows = Object.values(cred.tables || {}).reduce((a, t) => a + (Number(t.rows) || 0), 0);
  if (!(rows > 0)) return { allowed: false, reason: '凭证里一行内容都没有' };
  if (!cred.manifestSha256) return { allowed: false, reason: '凭证缺 manifest 指纹' };
  return { allowed: true, reason: `转储凭证可用：${rows} 行 / ${ageHours.toFixed(1)}h 前（manifest ${String(cred.manifestSha256).slice(0, 12)}…）`, ageHours };
}

/** 删除闸总入口：磁盘有清单走全量校验（更强），没有（runner/Vercel）读库里的凭证 */
function deleteGateAny(dir, cred, opts = {}) {
  if (fs.existsSync(manifestPath(dir))) return { ...deleteGate(dir, opts), via: 'disk' };
  return { ...credentialGate(cred, opts), via: 'credential' };
}

/** 回放用语句：列序显式写出，不用 `INSERT INTO t VALUES(...)`（列序一变就静默错位） */
function restoreSql(table, columns) {
  const cols = columns.map((c) => assertIdent(c, `${table} 列名`));
  const t = assertIdent(table, '表名');
  return `INSERT OR REPLACE INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
}

module.exports = {
  DUMP_TABLES, SCHEMA_VERSION, chunkFile, manifestPath, keysetSql,
  encodeNdjson, decodeNdjson, sha256Hex, writeChunk, readChunk,
  emptyTableState, buildManifest, writeManifest, readManifest,
  verifyDump, deleteGate, restoreSql,
  CREDENTIAL_KEY, GATE_MAX_AGE_H, credentialFromManifest, credentialGate, deleteGateAny,
};
