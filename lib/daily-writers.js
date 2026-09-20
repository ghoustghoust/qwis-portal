// 日报写入点清单的**派生**实现（不是清单！）—— 白盒 W14 与负向探针 tools/_probe-w14-selftest.cjs 共用。
// 为什么单独成文件：坑 #58 的教训是"手工维护的清单必然漏"，而上一版的负向探针又把 5 个写入函数
// 硬编码了一遍 —— 判据与取证用了两套事实，等于门禁仍然靠人记。
//
// 第三轮对抗审查后重写的三点（每条都对应一次"看着绿其实是假的"）：
//  ① SQL 只在**字符串字面量**里找（原来在源码全文里找）→ 注释、log('TODO: applyDailyQualityGate(...)')
//     这类"文本里出现了这句"不再算接线；判定"是否接线"用的是等长的 masked 视图，偏移可直接对账。
//  ② 一个函数里有多条 INSERT 时**逐条**判（原来只看第一条前面的门槛调用，第二条前面把 items 换掉也判 OK）。
//  ③ 声明形状扩到赋值式/方法简写，且**动态表名**（INSERT INTO 变量）单独记一笔，
//     不再因为"落在任何已知函数体外"就静默消失 —— 看不见成员是制造绿灯的方向。
const fs = require('fs');
const path = require('path');
const { scan, innerSpan } = require('./src-spans');

// 排除：非运行代码（依赖/产物/归档）+ tests/（测试夹具是"造数据"，不是产品写入点）
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'data', 'archive', 'trash', '.next', 'coverage', 'tests']);
// 排除：判据自身与探针 —— 它们的字面量里就写着这些 token（自检探针必须排除自身，坑 #59）
const SKIP_FILE = new Set(['lib/daily-writers.js', 'tools/eval-whitebox.cjs', 'tools/_probe-w14-selftest.cjs']);

// 把相邻的字面量段拼回"一条 SQL"：`'INSERT INTO daily_' + 'reports'` 与模板的多个静态段都算一条；
// 中间只允许引号与加号（`' + '`），出现变量/插值就不拼（那是动态表名，另记）。
function sqlChunks(src) {
  const list = scan(src).strings.slice().sort((a, b) => a.from - b.from);
  const out = [];
  let cur = null;
  for (const s of list) {
    if (cur && /^['"]?\s*\+\s*['"]?$/.test(src.slice(cur.to, s.from))) {
      cur.sql += s.s; cur.to = s.to; // 加号拼接：同一条语句
      continue;
    }
    if (cur) out.push(cur);
    cur = { sql: s.s, from: s.from, to: s.to };
  }
  if (cur) out.push(cur);
  return out;
}

const INSERT_MARK = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+`?daily_reports`?\b/i;
// 动态表名：`INSERT INTO ` 后面直接接变量/插值（静态读不出表名），必须显式记账而不是漏掉
const INSERT_DYNAMIC = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s*$/i;
// "接上了"= 门槛结果被赋回变量；只写一句调用扔掉返回值不算接
const GATE_USE = /=\s*[\w.]*applyDailyQualityGate\s*\(/;
// 真的执行了写库（只 prepare 不 run 等于没写）
const EXEC = /(?:\bqRun\b|\bdbRun\b|\bexecute\b|\.run\s*\(|\.exec\s*\(|\.all\s*\(|\.get\s*\()/;

// ── B112：档位字段（schemaVersion）的派生判据，与 W14 共用同一份写入点清单 ──
// 三条都是"代码 + 语句"两个视图上的形状，不靠人记清单：
//   carried     —— 这一处有没有真的写档位字段（必须走 lib/brief-guards 的常量）
//   bare        —— 写了裸数字 `schemaVersion: 2`：值对但**不是同一份事实**，改档位时会漏改这一处
//   stringTyped —— SQL 里用 json_set(..., '$.schemaVersion', '1') 把数字写成了 JSON 字符串
//                  （runner 降级分支原本就是这样，实测库里多出 1 行字符串 "1"）
const SCHEMA_CARRIED = /DAILY_SCHEMA_VERSION\s*\.\s*(KEYWORD|AI)/;
const SCHEMA_BARE = /schemaVersion\s*:\s*\d/;
const SCHEMA_STRING_IN_SQL = /'\$\.schemaVersion'\s*,\s*'[^']*'/;

// 执行入口在**所在函数**里出现过才算写进了库（只 prepare 不 run 等于没写）。
// 为什么按函数而不是按语句：语句边界要处理"参数是跨行模板字面量"的情况，静态判容易把
// 执行词切在窗口外（实测 4 个合法写入点被误判成"没执行"）。
// 函数级判据粗糙但方向安全：宁可多报一条待看，不会把"真的没执行"放成绿。

// → { file, fn, ok, dynamic, executed, line }
//   ok=false 即"这一处写入点前面没有门槛调用"；executed=false 即"备了语句却没执行"
function findDailyReportWriters(root) {
  const found = [];
  (function sweep(dir) {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (SKIP_DIR.has(e.name)) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) { sweep(rel); continue; }
      if (!/\.(js|cjs|mjs)$/.test(e.name) || SKIP_FILE.has(rel)) continue;
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      const chunks = sqlChunks(src);
      if (!chunks.some((c) => INSERT_MARK.test(c.sql) || INSERT_DYNAMIC.test(c.sql))) continue;
      const { masked } = scan(src);
      const lastAt = new Map(); // 同一宿主里上一条 INSERT 的位置：门槛必须**逐条**在各自之前
      for (const c of chunks) {
        const dynamic = INSERT_DYNAMIC.test(c.sql);
        if (!dynamic && !INSERT_MARK.test(c.sql)) continue;
        const own = innerSpan(src, c.from);
        const ownStart = own ? own.start : 0;
        const from = Math.max(ownStart, lastAt.get(ownStart) || 0);
        lastAt.set(ownStart, c.to);
        const before = masked.slice(from, c.from);
        const scope = own ? masked.slice(own.start, own.end) : masked;
        found.push({
          file: rel,
          fn: own ? own.name : '<模块顶层>',
          dynamic,
          ok: GATE_USE.test(before),
          executed: dynamic || EXEC.test(scope),
          line: masked.slice(0, c.from).split('\n').length,
          // 动态表名那一类是**整行复制**（备份恢复 / 迁移），stats 原样搬过来，
          // 要求它"写档位"没有意义 —— 记 null，判据只看生成类写入点。
          schema: dynamic ? null : {
            carried: SCHEMA_CARRIED.test(scope),
            bare: SCHEMA_BARE.test(scope),
            stringTyped: SCHEMA_STRING_IN_SQL.test(c.sql),
          },
        });
      }
    }
  })('');
  return found;
}

// 档位字段的**类型**判据（B112 的另一半）：runner 降级分支原来用
//   `json_set(stats, '$.schemaVersion', '1')` —— 带引号的第三个实参 = 写成 JSON 字符串，
// 而那条 UPDATE 不在任何 INSERT 的宿主函数里（它在调用方做善后），所以光靠写入点清单看不见它。
// 于是单独扫一遍所有语句字面量：只要出现"`$.schemaVersion` 后面跟一个带引号的值"就是类型漂移。
// 绑定参数（`?`）与裸数字都不命中 —— 反向样本由 tests/regression-daily-schema-version.test.js 钉。
const SCHEMA_SET_STRING = /\$\.schemaVersion'\s*,\s*'[^']*'/;
function findStatsSchemaTypeViolations(root) {
  const bad = [];
  (function sweep(dir) {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (SKIP_DIR.has(e.name)) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) { sweep(rel); continue; }
      if (!/\.(js|cjs|mjs)$/.test(e.name) || SKIP_FILE.has(rel)) continue;
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      for (const s of scan(src).strings) {
        if (SCHEMA_SET_STRING.test(s.s)) {
          bad.push({ file: rel, line: src.slice(0, s.from).split('\n').length, sql: s.s.trim().slice(0, 90) });
        }
      }
    }
  })('');
  return bad;
}

module.exports = { findDailyReportWriters, findStatsSchemaTypeViolations, sqlChunks, INSERT_MARK, INSERT_DYNAMIC, GATE_USE, EXEC, SCHEMA_CARRIED, SCHEMA_BARE, SCHEMA_STRING_IN_SQL, SCHEMA_SET_STRING };