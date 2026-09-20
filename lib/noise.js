//
// 「噪声源」判定的唯一实现（B107 / spec 36-7 G7a，2026-09-21）。
//
// 为什么单独成文件：同一条 SQL 判定此前在**三端手写 25 处**（`api/` 8、`server/` 9、`tools/` 6、
// 其中 `api/[...slug].js` 一个文件里 7 份）。手写副本之间各有增减，实测已经漂移过一次：
//   · `handleArticlesReadAll`（云端 :1272）那份**只有两轴**（热榜/聚合），列表那两份是四轴
//     （还排 muted / reader_visible=0）→ "全部标已读"会标掉列表里根本看不见的条目；
//   · `tools/generate-snapshots.js` 与 `server/routes/articles.js` 各写了一份四轴版，
//     轴顺序还不一样 —— 改一处忘另一处是时间问题。
// 这与 W10 抓过的「播客判定抄 6 份、4 份漏 .opus」同族：**判据散落 = 三端必然漂移**（AGENTS §1）。
//
// 三条轴各自是什么、为什么这么写：
//   ① `type='hotlist'` 热榜聚合源（知乎/微博…）：一次抓取几十条、永远读不完，归宿是热点榜页；
//   ② `extra.aggregator=1` 聚合器源（AIHOT 这类二手 feed）：条目在别人站上，阅读器里是重复噪音；
//   ③④ `muted` / `reader_visible=0`：27b（2026-09-15）加的四轴口径，只在"进不进阅读器"时才算。
// 所以 `reader:true` 这个开关就是"要不要带上 ③④"，不是可选装饰 —— 用它区分两种语义。
//
// 三种 SQL 形态（NOT EXISTS / NOT(...) / 直接查 sources）不是三份实现：**轴表达式只有这里会生成**，
// 形态差异来自各调用点的连接方式不同。注意 NOT(...) 与 NOT EXISTS 对"源行已不存在"的孤儿条目
// 结论相反（前者丢、后者留），所以哪个调用点用哪种是**语义选择**，改动要看那页该不该显示孤儿。
//
// 本文件同时是白盒 W18 的判据（与 tests/regression-noise.test.js 共用，坑 #58/#59：
// 判据与自证各写一套 = 没有判据）。扫描只看**字符串字面量**里的 SQL —— 噪声口径的漂移
// 全部发生在拼 SQL 的地方；JS 里的 `source_type === 'hotlist'` 两处排除点由回归锁直接
// 比对是否改走 `isNoiseSource`（那里还有三处是"分组名"标签，不是判定，故意不收成同一函数）。
'use strict';

const fs = require('fs');
const path = require('path');
const { scan } = require('./src-spans');

const HOTLIST_TYPE = 'hotlist';
const AGG_KEY = '$.aggregator';
const col = (alias, name) => (alias ? `${alias}.${name}` : name);

// ── 轴 ①：热榜源 ──
function hotlistCondSql(alias = 's') {
  return `${col(alias, 'type')}='${HOTLIST_TYPE}'`;
}
// 只用轴①的地方（AI 精选要"非热榜"、热点榜的 hotlist 子视图要"是热榜"）。
// 括号是给的，不是凑字数：`NOT s.type = 'hotlist' AND x>=60` 读起来要靠 SQLite 的优先级表才对，
// 显式括号让"这一条轴"在 SQL 文本里也是个整体。
function notHotlistSql(alias = 's') {
  return `NOT (${hotlistCondSql(alias)})`;
}
// ── 轴 ②：聚合器标志。COALESCE 两层是必须的：extra 列可为 NULL，'{}' 里也常没有 aggregator 键 ──
function aggregatorFlagSql(alias = 's') {
  return `COALESCE(json_extract(COALESCE(${col(alias, 'extra')},'{}'),'${AGG_KEY}'),0)`;
}
// want=1 → "是聚合器"；want=0 → "不是"。历史上的 `IS NOT 1` 与无 COALESCE 的 `=1` 两种写法
// 在这里都归一到同一形态（NULL!=1 与 NULL IS NOT 1 同为真，NULL=1 与 COALESCE(...,0)=1 同为假）。
function aggregatorCondSql(alias = 's', want = 1) {
  return `${aggregatorFlagSql(alias)}${want ? '=1' : '!=1'}`;
}
// ── 轴 ③④：阅读器可见性 ──
function mutedCondSql(alias = 's') { return `COALESCE(${col(alias, 'muted')},0)=1`; }
function hiddenCondSql(alias = 's') { return `COALESCE(${col(alias, 'reader_visible')},1)=0`; }

// 噪声轴清单：一份轴，多种拼法都从这里长出来
function noiseParts(alias = 's', { reader = false } = {}) {
  const parts = [hotlistCondSql(alias), aggregatorCondSql(alias, 1)];
  if (reader) parts.push(mutedCondSql(alias), hiddenCondSql(alias));
  return parts;
}
// 「这个源是噪声」
function isNoiseSql(alias = 's', opts = {}) { return `(${noiseParts(alias, opts).join(' OR ')})`; }
// 「这个源不是噪声」——拼进 WHERE 用
function notNoiseSql(alias = 's', opts = {}) { return `NOT ${isNoiseSql(alias, opts)}`; }
// 「这条内容的源不是噪声」，且不要求外层 join sources（我的阅读、计数侧用这条：
// 孤儿条目【源已被删】会**保留**，因为足迹是历史事实，不该因为源没了就凭空消失）
function notNoiseExistsSql({ item = 'a', alias = 's', reader = false } = {}) {
  return `NOT EXISTS (SELECT 1 FROM sources ${alias} WHERE ${col(alias, 'id')}=${col(item, 'source_id')} AND ${isNoiseSql(alias, { reader })})`;
}
// 「从 articles 侧连到非噪声源」的正连接前缀（status 三条计数共用，见坑 B26：NOT IN 巨型字面量列表 12.8s）
function notNoiseJoinSql({ item = 'a', alias = 's', reader = false } = {}) {
  return `JOIN sources ${alias} ON ${col(alias, 'id')}=${col(item, 'source_id')} WHERE ${notNoiseSql(alias, { reader })}`;
}

// JS 侧同一判定（行对象来自 `SELECT s.type AS source_type, s.extra` 之类）。
// 缺字段就当"不是那条轴"：热榜榜的簇内条目历史上只带 source_type，补轴不许改变它们的结果。
function isNoiseSource(row, { reader = false } = {}) {
  if (!row) return false;
  const type = row.type !== undefined ? row.type : row.source_type;
  if (String(type) === HOTLIST_TYPE) return true;
  let extra = row.extra !== undefined ? row.extra : row.source_extra;
  if (typeof extra === 'string') { try { extra = JSON.parse(extra); } catch { extra = null; } }
  if (extra && Number(extra.aggregator) === 1) return true;
  if (reader) {
    if (Number(row.muted == null ? 0 : row.muted) === 1) return true;
    if (Number(row.reader_visible == null ? 1 : row.reader_visible) === 0) return true;
  }
  return false;
}

// ── 白盒 W18 判据 ────────────────────────────────────────────────
const SCAN_DIRS = ['server', 'api', 'web/src', 'lib', 'tools'];
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'data', 'archive', 'trash', '.next', 'coverage', 'tests']);
const SCAN_EXT = /\.(js|cjs|mjs|jsx)$/;
// 唯一实现自己当然写着这两条轴；`tools/_*`（一次性探针/取证脚本）不参与产品扫描 —— 与 W10 同一口径
const ALLOWED = new Map([['lib/noise.js', '噪声轴唯一实现']]);
const SKIP_TOOL = /^tools\/(?:eval-|_|doc-lint)/;
const BANNED = [
  { re: /(?:^|[^\w$])(?:[\w$]+\s*\.\s*)?(?:source_)?type\s*(?:!=|<>|==|=)\s*'hotlist'/, label: "手写热榜比较 type='hotlist'（噪声轴①）" },
  { re: /'?\$\.aggregator/, label: '手写 extra.aggregator 提取（噪声轴②）' },
];
// 「唯一实现」不能是空话：这些消费点必须真的引用本文件
const MUST_IMPORT = [
  'api/[...slug].js', 'api/daily-generate.js',
  'server/routes/articles.js', 'server/routes/status.js', 'server/routes/reading.js',
  'server/services/hot.js', 'server/services/aihot/enrich.js', 'server/services/aihot/backfill.js',
  'server/services/scheduler/jobs/fulltext.js', 'server/services/ai/daily.js',
  'server/services/collectors/fetcher.js',
  'tools/collect-turso.js', 'tools/generate-snapshots.js', 'lib/hot-events.js',
];
const IMPORT_RE = /require\(\s*'\.\.?\/(?:.*\/)?(?:lib\/)?noise'\s*\)/;

function walk(root, dir, out) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name)) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) walk(root, rel, out);
    else if (SCAN_EXT.test(e.name)) out.push(rel);
  }
  return out;
}

// → { violations:[{file,line,label,code}], missingImport:[], scanned, allowed }
function findNoiseViolations(root) {
  const files = [];
  for (const top of SCAN_DIRS) {
    if (fs.existsSync(path.join(root, top))) walk(root, top, files);
  }
  const targets = files.filter((rel) => !ALLOWED.has(rel) && !SKIP_TOOL.test(rel));
  const violations = [];
  for (const rel of targets) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const s of scan(src).strings) {
      for (const b of BANNED) {
        if (!b.re.test(s.s)) continue;
        violations.push({
          file: rel,
          line: src.slice(0, s.from).split('\n').length,
          label: b.label,
          code: s.s.trim().slice(0, 70),
        });
      }
    }
  }
  const missingImport = MUST_IMPORT.filter((f) => {
    const p = path.join(root, f);
    return !fs.existsSync(p) || !IMPORT_RE.test(fs.readFileSync(p, 'utf8'));
  });
  return {
    violations,
    missingImport,
    consumed: MUST_IMPORT.length - missingImport.length,
    scanned: targets.length,
    allowed: [...ALLOWED.entries()].map(([f, why]) => `${f}（${why}）`),
  };
}

module.exports = {
  HOTLIST_TYPE, AGG_KEY,
  hotlistCondSql, notHotlistSql, aggregatorFlagSql, aggregatorCondSql, mutedCondSql, hiddenCondSql,
  noiseParts, isNoiseSql, notNoiseSql, notNoiseExistsSql, notNoiseJoinSql, isNoiseSource,
  findNoiseViolations, BANNED, ALLOWED, MUST_IMPORT,
};
