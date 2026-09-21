// B131：两份建表源（`lib/db.js` = 云端/runner 读层，`server/db.js` = 本地端）的「可建列集」不许分叉。
// 事故原型：lib/db.js 的 SCHEMA 少 translated_* 三列（生产靠 runner 自愈 ALTER 补上），
// 新机按 ensureSchema() 建库后 AI 译文写入即抛 no such column。
// 判据两条腿（都从 DDL 字符串现读，不写死列名）：
//   ① server 端可建列集 ⊆ lib 端可建列集（同名表）——本地端是全功能端，它的列集是完整参照
//   ② lib 的 ALTERS 补的列必须已在 SCHEMA 本体里（否则 fresh-create 与迁移后形状不同）
// 空读数拒绝通过：一份 DDL 都解析不出 = 判据被架空，按违规处理（坑 #41：不许静默空扫）。
'use strict';
const fs = require('fs');
const path = require('path');
const { scan } = require('./src-spans');

const CREATE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(([\s\S]*?)\)\s*(?:COMMENT|;|$)/gi;
const ALTER_RE = /ALTER\s+TABLE\s+[`"]?(\w+)[`"]?\s+ADD\s+COLUMN\s+[`"]?(\w+)/gi;
const COL_RE = /^\s*[`"]?(\w+)[`"]?\s+(?:TEXT|INTEGER|REAL|BLOB|NUMERIC)\b/i;

// 从一份 db 源文件解析「可建列集」：Map<table, Set<col>>，并单独返回 ALTER 补的列
function parseDbFile(root, rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return null;
  const chunks = scan(fs.readFileSync(p, 'utf8')).strings.map((s) => s.s);
  const tables = new Map();
  const alterOnly = [];
  for (const sql of chunks) {
    for (const m of sql.matchAll(CREATE_RE)) {
      const cols = tables.get(m[1]) || new Set();
      for (const line of m[2].split('\n')) {
        const c = COL_RE.exec(line);
        if (c && !/^(rowid|_rowid_)$/i.test(c[1])) cols.add(c[1]);
      }
      tables.set(m[1], cols);
    }
    for (const m of sql.matchAll(ALTER_RE)) {
      const cols = tables.get(m[1]) || new Set();
      if (!cols.has(m[2])) alterOnly.push({ table: m[1], column: m[2], inCreate: tables.has(m[1]) && tables.get(m[1]).has(m[2]) });
      cols.add(m[2]);
      tables.set(m[1], cols);
    }
  }
  return { tables, alterOnly };
}

function findSchemaGaps(root) {
  const lib = parseDbFile(root, 'lib/db.js');
  const srv = parseDbFile(root, 'server/db.js');
  const violations = [];
  if (!lib || lib.tables.size === 0) violations.push('lib/db.js 一份 DDL 都没解析到（判据被架空）');
  if (!srv || srv.tables.size === 0) violations.push('server/db.js 一份 DDL 都没解析到（判据被架空）');
  if (violations.length) return { violations, tables: 0 };

  // ① server 可建列必须都能由 lib 建出（同名表）
  let tables = 0;
  for (const [t, cols] of srv.tables) {
    if (!lib.tables.has(t)) continue; // 端独有的表不判（本地灾备面可以有私表）
    tables++;
    const missing = [...cols].filter((c) => !lib.tables.get(t).has(c));
    for (const c of missing) violations.push(`${t}.${c}：server/db.js 可建而 lib/db.js 建不出（B131 同族：新机建库即缺列）`);
  }
  // ② lib 的 ALTERS 补的列必须已在 SCHEMA 本体（CREATE）里——否则 fresh-create 与迁移后形状不同
  for (const a of lib.alterOnly) {
    if (a.inCreate === false) violations.push(`${a.table}.${a.column}：只在 ALTERS 里补、没并进 SCHEMA 本体（fresh-create 与迁移后形状不同）`);
  }
  return { violations, tables };
}

module.exports = { findSchemaGaps, parseDbFile };
