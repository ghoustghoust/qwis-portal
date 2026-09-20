// 保留与删除语义的唯一实现（spec43 D1/B102）。三端共用：本地 `server/services/datamgr.js`、
// GH runner `tools/collect-turso.js`、云端手动端点 `api/collect.js`。
//
// 为什么必须有这一份（09-20 只读实测，不是引用文档）：
//   `datamgr.CLEAN_TABLES` 含 articles+videos，`cleanup()` 是裸 `DELETE FROM <表> WHERE <时间列> < ?`
//   无任何豁免，而 `server/services/scheduler/jobs/maintenance.js:12` 由 `scheduler/index.js:141`
//   **每 24h 调一次** → 只要有人把本地服务起满 24 小时，就会删掉 39,458/43,214 篇文章（91%）与
//   1,161/1,161 条视频播客（全部，含 11 条已看/收藏）。这同时违反 2026-09-13 的用户决策
//   「视频/播客永不清理」和 AGENTS §1「采集语义三份实现必须同步」——三份里两份会删视频，一份连豁免都没有。
//
// 用户 09-20 口径：**本地端不删内容**。本地库的角色是"开发与灾备"（AGENTS §1），
// 一份会自我清空 91% 文章的副本起不到灾备作用，所以 `local` 作用域里 articles/videos 都是 skip。
//
// 还有一条不许顺手改的语义（保守优先）：云端今天的判据是 `read_at IS NULL`。这里曾有半句**已作废的前提**：
// 09-19 登记「线上另有 2.5 万行 `read_at` 是字面字符串 `'null'`」（`tools/migrate-to-turso.js` 旧版把 NULL
// 序列化成字符串），并据此要求"数据订正与内容级备份落地前不许把它们变成可删"。
// **09-21 实测推翻前半句**：`typeof` 分组数现役云端库 → `read_at` = 59,618 真 NULL + 214 有值 + 0 个字面 'null'；
// 污染留在了 09-20 被换掉的旧库里（新库是用修好根因的迁移脚本重建的）。读数与我自己在探针上造的两处假读数，
// 一并记在 `docs/eval/bl10-null-audit-20260921.md`。⇒ BL10 的那次性 `UPDATE` **不需要执行**。
// 但这条约束的另一半仍然有效、而且更紧了：`read_at IS NULL` 现在实打实命中 5.9 万行，保留清理一旦接回触发口
// 就是真删 —— 删除路径必须先过 `lib/content-dump.js#deleteGate`（B103 已交付），且待删量要按现役库重算，
// 不许沿用旧库那个 10,733。（旧库仍不许删：将来"从旧库回灌内容"会把 `'null'` 一起带回来，届时口径要重判。）
'use strict';

const TIME_COL = {
  articles: 'COALESCE(published_at, created_at)',
  pending_items: 'imported_at',
  daily_reports: 'generated_at',
};

// 「未读」——见文件头那条保守约定
const UNREAD_COND = 'read_at IS NULL';
const NOT_SAVED_COND = 'later = 0';
const NOT_FEATURED_COND = 'COALESCE(featured, 0) = 0';
// 普通文章的删除条件（与 runner/云端今天的行为逐字一致，收口不是改写）
const ARTICLE_DELETE_COND = `${UNREAD_COND} AND ${NOT_SAVED_COND} AND ${NOT_FEATURED_COND}`;
// 热榜分支今天少了 featured 判定；热榜源按设计不进精选（FEATURE_MATRIX §1.1），
// 所以补上 featured 判定对现存数据是等价的，换来的是"只有一份文章删除条件"
const HOTLIST_DELETE_COND = `${ARTICLE_DELETE_COND} AND source_id IN (SELECT id FROM sources WHERE type='hotlist')`;
const NORMAL_DELETE_COND = `${ARTICLE_DELETE_COND} AND source_id NOT IN (SELECT id FROM sources WHERE type='hotlist')`;

/**
 * 每张表在每一端的处置。**skip 也必须带 reason** —— 白盒 W17 要求"跳过"是一个可追溯的决定，
 * 而不是"漏接了"（否则三端一致性债会换个形态继续滚）。
 */
const POLICY = {
  local: [
    { key: 'articles', table: 'articles', action: 'skip', reason: '本地是灾备副本（AGENTS §1）；用户 09-20 决定本地不删内容' },
    { key: 'videos', table: 'videos', action: 'skip', reason: '2026-09-13 决策：视频/播客永不清理（两端同样适用）' },
    { key: 'pending_items', table: 'pending_items', action: 'delete', col: TIME_COL.pending_items, reason: '待解析队列，过期无价值' },
    { key: 'daily_reports', table: 'daily_reports', action: 'delete', col: TIME_COL.daily_reports, reason: '本地产物，可重生' },
  ],
  runner: [
    { key: 'hotlist', table: 'articles', action: 'delete', col: 'published_at', where: HOTLIST_DELETE_COND, reason: '热榜时效内容，固定 7 天' },
    { key: 'retention', table: 'articles', action: 'delete', col: 'published_at', where: NORMAL_DELETE_COND, reason: 'T4-1 Q4 保留天数清理，豁免已读/稍后读/精选' },
    { key: 'videos', table: 'videos', action: 'skip', reason: '视频/播客永不清理' },
  ],
  cloudManual: [
    { key: 'hotlist', table: 'articles', action: 'delete', col: 'published_at', where: HOTLIST_DELETE_COND, reason: '与 runner 同语义的手动备份端点' },
  ],
};

function scope(name) {
  const s = POLICY[name];
  if (!s) throw new Error(`未知保留作用域：${name}（可用：${Object.keys(POLICY).join(', ')}）`);
  return s;
}

function cutoffIso(days) {
  const d = Number(days);
  if (!Number.isFinite(d) || d < 1) throw new Error(`保留天数必须是 >=1 的数，收到 ${days}（0 或负数不许当成"全删"）`);
  return new Date(Date.now() - d * 86400000).toISOString();
}

/** 生成一条删除/计数 SQL 的 WHERE 片段；skip 的表返回 null（调用方必须跳过，不许自己拼） */
function whereFor(name, key) {
  const rule = scope(name).find((r) => r.key === key);
  if (!rule || rule.action !== 'delete') return null;
  return rule.where ? `${rule.col} < ? AND ${rule.where}` : `${rule.col} < ?`;
}

function deleteSql(name, key) {
  const where = whereFor(name, key);
  return where ? `DELETE FROM ${scope(name).find((r) => r.key === key).table} WHERE ${where}` : null;
}

function countSql(name, key) {
  const where = whereFor(name, key);
  return where ? `SELECT COUNT(*) c FROM ${scope(name).find((r) => r.key === key).table} WHERE ${where}` : null;
}

/** 本作用域里"会被动的表"与"被跳过的表 + 理由"，供 preview/日志/白盒对账用 */
function plan(name) {
  return scope(name).map((r) => ({
    key: r.key, table: r.table, action: r.action, reason: r.reason || '',
  }));
}

// ───────────────────────── W17 派生扫描：删除谓词三端只许这一份 ─────────────────────────
// 与白盒 W17、回归锁 `tests/regression-retention.test.js` R4 **共用这一份判据**
// （坑 #58/#59：判据与自证各写一套，等于没有判据）。
const fs = require('fs');
const path = require('path');

const CONTENT_TABLES = ['articles', 'videos', 'pending_items', 'daily_reports'];
// **一条判据**就够：保留策略的形状必然是"时间列 与 占位符 比较"。按源级联（`source_id=?`）、
// 按 id 删（人工挑选）、同日区间重生成、测试夹具里的无条件清表 —— 都没有这个形状，自然不被算成
// 第二份保留谓词（坑 #58：排除项宁少勿多，多写一条排除就多一个洞）。
const RETENTION_SHAPE = /\b(published_at|created_at|imported_at|generated_at|watched_at|read_at|updated_at)\b[\s\S]{0,20}?<=?\s*\?/;
// 已记账、待收口的第二份保留谓词：`api/[...slug].js` 把条件放在 `ARTICLE_CLEAN_WHERE` 常量里
// （所以扫不到时间形状），而并行会话正在改那份文件 —— 这一轮去动它等于冒丢别人改动的风险。
// 登记在此而不是假装它不存在；随放行表 #4/#8 那批并入。豁免表本身由回归锁 R4 反向断言。
const PENDING_UNIFY = { 'api/[...slug].js': 'ARTICLE_CLEAN_WHERE（管理台"内容清理"的第二份谓词）；并行会话在改该文件，随 #4/#8 批次并入' };

function retentionSourceFiles(root) {
  const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'data', 'archive', 'trash', '.next', 'coverage', '.tmpchk', '验证截图']);
  const base = root || process.cwd();
  const out = [];
  (function sweep(dir) {
    for (const e of fs.readdirSync(path.join(base, dir), { withFileTypes: true })) {
      if (SKIP_DIR.has(e.name)) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) { sweep(rel); continue; }
      if (/\.(js|cjs|mjs|jsx)$/.test(e.name)) out.push(rel);
    }
  })('');
  return out;
}

/** 扫"对内容表的 DELETE"，报出没走本文件的那一份 */
function findRetentionViolations(root, readFn) {
  const { stripComments } = require('./src-spans');
  const read = readFn || ((rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n'));
  const files = retentionSourceFiles(root);
  const violations = [];
  const consumed = [];
  const exempt = [];
  const nonRetention = [];
  for (const rel of files) {
    let src;
    try { src = read(rel); } catch { continue; }
    const code = stripComments(src); // 注释里举的反例不许算删除点（坑 #63）
    const usesRetention = /require\(['"][^'"]*lib\/retention['"]\)/.test(code);
    if (usesRetention && rel !== 'lib/retention.js') consumed.push(rel);
    for (const m of code.matchAll(new RegExp(`DELETE FROM (${CONTENT_TABLES.join('|')})\\b([\\s\\S]{0,200})`, 'g'))) {
      const [, table, tail] = m;
      const line = code.slice(0, m.index).split('\n').length;
      const label = `${rel}:${line} ${table}`;
      if (rel === 'lib/retention.js') continue; // 唯一实现本体
      if (PENDING_UNIFY[rel]) { exempt.push(`${label} —— 已记账待收口：${PENDING_UNIFY[rel]}`); continue; }
      if (!RETENTION_SHAPE.test(tail)) { nonRetention.push(`${label} —— 不是保留策略形状（无"时间列 < ?"）`); continue; }
      if (usesRetention) continue; // 消费点：条件来自本文件
      violations.push({ file: rel, line, table, text: `DELETE FROM ${table}${tail}`.replace(/\s+/g, ' ').slice(0, 120) });
    }
  }
  // 视频/播客在**任何**作用域里都不许是 delete 动作（2026-09-13 决策，B102 的硬约束）
  const videosDeletable = Object.keys(POLICY).filter((s) =>
    scope(s).some((r) => r.table === 'videos' && r.action === 'delete'));
  return { scanned: files.length, violations, consumed, exempt, nonRetention, videosDeletable, pending: Object.keys(PENDING_UNIFY) };
}

module.exports = {
  TIME_COL, POLICY, CONTENT_TABLES, RETENTION_SHAPE, UNREAD_COND, NOT_SAVED_COND, NOT_FEATURED_COND, ARTICLE_DELETE_COND,
  scope, plan, cutoffIso, whereFor, deleteSql, countSql, findRetentionViolations, retentionSourceFiles, PENDING_UNIFY,
};
