// 「可能被写成字面串 'null' 的文本列」的**派生**实现（白盒 W15 与其负向探针共用）。
// 为什么必须派生（坑 #58/#59）：上一版 W15 里写着 `POLLUTED = ['last_fetched_at']`，
// 那是一张手写清单 —— 换一列被污染（`MAX(tags)` / `MAX(watched_at)`）判据就看不见，
// 而且它自己不会报错，只会一直绿。
//
// 事实来源是 **DDL**：库里 TEXT 列的取值就是字符串（SQLite 动态类型），
// `MAX(<TEXT 列>)` 遇到一行字面串 `'null'` 就会被毒（文本序 `'null' > '2026-…'`，
// B93 线上实测：后台「最后同步」自上线起恒显示"从未同步"）。
// 所以判据的范围 = 「TEXT 列 ∩ 真的被 MAX()/ORDER BY DESC 取过」，两端都从代码与 DDL 现读，不写死列名。
// 一份 DDL 都不在库里时（新环境/改名）判据会**拒绝通过**而不是静默空扫 —— 空清单是最危险的绿灯。
const fs = require('fs');
const path = require('path');
const { scan } = require('./src-spans');

const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'data', 'archive', 'trash', '.next', 'coverage']);
const DDL_SOURCES = ['lib/db.js', 'server/db.js'];   // 两份建表语句（云端/本地各自 CREATE TABLE）
const CREATE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(([\s\S]*?)\)\s*(?:COMMENT|;|$)/gi;
const TEXT_COL_RE = /^\s*[`"]?(\w+)[`"]?\s+TEXT\b/i;

// → Map<列名, 出现它的表名[]>；列名按 SQL 用法本来就是不分表的（MAX(last_fetched_at) 不带前缀）
function textColumns(root) {
  const cols = new Map();
  for (const rel of DDL_SOURCES) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    const sqlChunks = scan(fs.readFileSync(p, 'utf8')).strings.map((s) => s.s);
    for (const sql of sqlChunks) {
      for (const m of sql.matchAll(CREATE_RE)) {
        for (const line of m[2].split('\n')) {
          const c = TEXT_COL_RE.exec(line);
          if (!c) continue;
          const name = c[1];
          if (/^(rowid|_rowid_)$/i.test(name)) continue;
          if (!cols.has(name)) cols.set(name, []);
          if (!cols.get(name).includes(m[1])) cols.get(name).push(m[1]);
        }
      }
    }
  }
  return cols;
}

const walk = (dir, out = []) => {
  const abs = path.join(dir);
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name)) continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(js|cjs|mjs)$/.test(e.name)) out.push(rel);
  }
  return out;
};

// → { columns:Map, sites:[{file,line,fn,agg,expr,ok}], derivedFrom }
//   sites 只收「聚合函数作用在 DDL 里的 TEXT 列上」这一种形状；ok = 同一表达式里有 NULLIF/TRIM 守卫。
function findTextAggregates(root, { dirs = ['server', 'api', 'tools', 'lib'], selfSkip = new Set() } = {}) {
  const columns = textColumns(root);
  const names = [...columns.keys()];
  if (!names.length) return { columns, sites: [], derivedFrom: [] };
  // MAX/MIN 与 "ORDER BY <TEXT 列> DESC LIMIT 1" 都算取值点：文本序 `'null' > '2026-…'`，
// 两者都会把"最后同步时间"读成那行脏数据。MIN 不要求守卫（'null' 抢不到最小值），
// 但**必须出现在清单里**——否则"改成 MIN"就是绕过判据的门。
const AGG = new RegExp(`\\b(MIN|MAX)\\s*\\(([^)]*\\b(?:${names.join('|')})\\b[^)]*)\\)`, 'gi');
const ORDER_DESC = new RegExp(`\\bORDER\\s+BY\\s+([^,)]*\\b(?:${names.join('|')})\\b[^,)]*)\\s+DESC\\s+LIMIT\\s+1\\b`, 'gi');
  const sites = [];
  for (const d of dirs) {
    const base = path.join(root, d);
    if (!fs.existsSync(base)) continue;
    for (const f of walk(base)) {
      const rel = path.relative(root, f).replace(/\\/g, '/');
      if (selfSkip.has(rel) || /^tools\/_/.test(rel)) continue;
      const src = fs.readFileSync(f, 'utf8');
      const { strings } = scan(src);
      // 只在**字符串字面量**里找 SQL（注释里写一句 MAX(x) 不算调用点；判据看代码不看说明，坑 #59）
      for (const s of strings) {
        for (const m of s.s.matchAll(AGG)) {
          sites.push({
            file: rel,
            line: src.slice(0, s.from).split('\n').length,
            agg: m[1].toUpperCase(),
            expr: m[2].trim().slice(0, 60),
            ok: /NULLIF\s*\(|TRIM\s*\(/i.test(m[2]),
          });
        }
      }
    }
  }
  return { columns, sites, derivedFrom: DDL_SOURCES.filter((f) => fs.existsSync(path.join(root, f))) };
}

module.exports = { textColumns, findTextAggregates, DDL_SOURCES };
