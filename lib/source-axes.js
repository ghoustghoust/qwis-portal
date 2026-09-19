// 源四轴语义模型（27b-source-axes / specs/26 §2.5，2026-09-15 落地）
// 拆开 focus 一字段四职：
//   上架 enabled（既有列）        —— 是否被采集（采集层）
//   收录 reader_visible（新列=1） —— 内容是否进阅读器列表（L3 检索层）
//   订阅 subscription.ids（settings 键）—— 高分内容进「我的早报」（L1）
//   重点 spotlight（新列）        —— 进每日早报「重点更新」栏 + 阅读器 smart 排序 +3d 加权
//   屏蔽 muted（新列=0）          —— 从热点榜/阅读器排除（L2/L3）
// focus 列物理保留（备份兼容）但已退役：代码只允许在本模块迁移函数里读它一次。
//
// 依赖注入约定：deps = { qAll(sql,args), qRun(sql,args), getSetting(key,def), setSetting(key,val) }
// 全部 async。runner（collect-turso.js）/ Vercel（lib/db.js）/ 本地路由 三端共用。

const AXES_ALTERS = [
  'ALTER TABLE sources ADD COLUMN spotlight INTEGER DEFAULT 0',
  'ALTER TABLE sources ADD COLUMN muted INTEGER DEFAULT 0',
  'ALTER TABLE sources ADD COLUMN reader_visible INTEGER DEFAULT 1',
];

// 一次性迁移（幂等闸 = settings 'axes.migrated'）：
// ① focus=1 → spotlight=1；② subscription.ids 不存在时用 spotlight 集合初始化（行为兼容旧 focus 语义）
async function migrateAxes(deps) {
  const migrated = await deps.getSetting('axes.migrated', 0);
  if (migrated) return false;
  await deps.qRun('UPDATE sources SET spotlight=1 WHERE COALESCE(focus,0)=1 AND COALESCE(spotlight,0)=0');
  const cur = await deps.getSetting('subscription.ids', null);
  if (!Array.isArray(cur) || !cur.length) {
    const rows = await deps.qAll('SELECT id FROM sources WHERE COALESCE(spotlight,0)=1');
    await deps.setSetting('subscription.ids', rows.map((r) => r.id));
  }
  await deps.setSetting('axes.migrated', 1);
  return true;
}

// 订阅集合解析：subscription.ids（过滤 enabled）；键不存在或空数组时兜底 spotlight 集合
// 2026-09-17 修复：空数组 [] 也回退 spotlight（迁移可能写了空数组；用户也可能在后台取消全部订阅后又标了 ☆）
// 2026-09-19 B78：同一口径补上第二种落空形态——**声明的 id 全部指向不存在/已停用的源**。
//   典型成因：回归测试把 subscription.ids 写成自己建的 TEST 源，测后 after() 只删源行、
//   settings 里留下悬空 id（线上实测 `{"empty":"no-subscription"}`，整页退化成引导态）。
//   悬空集合与空数组对用户是同一件事，所以按同一条既定口径兜底，不再让一个坏 id 打死整个早报。
async function resolveSubscriptionIds(deps) {
  const spotlight = async () => {
    const rows = await deps.qAll('SELECT id FROM sources WHERE COALESCE(spotlight,0)=1 AND enabled=1');
    return rows.map((r) => r.id);
  };
  const ids = await deps.getSetting('subscription.ids', null);
  if (Array.isArray(ids) && ids.length) {
    const nums = ids.map(Number).filter(Number.isFinite);
    if (nums.length) {
      const rows = await deps.qAll(
        `SELECT id FROM sources WHERE enabled=1 AND id IN (${nums.map(() => '?').join(',')})`, nums);
      if (rows.length) return rows.map((r) => r.id);
    }
  }
  // 键缺失（迁移未跑）、空数组、或声明的 id 全部落空 → 兜底 spotlight 集合
  return spotlight();
}

// 订阅轴写入：合并/移出 subscription.ids（不改其它任何轴——四轴互不影响的回归锁）
async function setSubscribed(deps, sourceIds, on) {
  const cur = await deps.getSetting('subscription.ids', []);
  const set = new Set((Array.isArray(cur) ? cur : []).map(Number).filter(Number.isFinite));
  for (const id of sourceIds) {
    const n = Number(id);
    if (!Number.isFinite(n)) continue;
    if (on) set.add(n); else set.delete(n);
  }
  await deps.setSetting('subscription.ids', [...set]);
  return set.size;
}

// 列轴 action → [列名, 写入值]（per-id 循环与组级单条 SQL 共用同一张表，防双端漂移）
// focus/unfocus 为 2026-09-15 前旧前端的兼容别名，落 spotlight 列
const AXIS_COL_ACTIONS = {
  spotlight: ['spotlight', 1], unspotlight: ['spotlight', 0],
  focus: ['spotlight', 1], unfocus: ['spotlight', 0],
  mute: ['muted', 1], unmute: ['muted', 0],
  visible: ['reader_visible', 1], invisible: ['reader_visible', 0],
};

const AXIS_ALL_ACTIONS = [
  'enable', 'disable', 'move',
  ...Object.keys(AXIS_COL_ACTIONS),
  'subscribe', 'unsubscribe', 'interval', 'failover',
];

// 组级操作（groupScopeId）：全部折叠成单条 UPDATE，避免云端 serverless 逐行循环超时
// 返回 { sql, args }；subscribe/unsubscribe 返回 null（走 setSubscribed 读改写）
function groupAxisStmt(action, groupId, payload = {}) {
  if (action === 'enable') {
    return {
      sql: "UPDATE sources SET enabled=1, fail_count=0, status='ok', next_fetch_at=NULL, extra=json_remove(COALESCE(extra,'{}'),'$.lastError','$.lastErrorAt') WHERE group_id=?",
      args: [groupId],
    };
  }
  if (action === 'disable') {
    return { sql: 'UPDATE sources SET enabled=0 WHERE group_id=?', args: [groupId] };
  }
  if (action === 'interval') {
    if (payload.intervalMin === null || payload.intervalMin === undefined) {
      return { sql: "UPDATE sources SET extra=json_remove(COALESCE(extra,'{}'),'$.intervalMin') WHERE group_id=?", args: [groupId] };
    }
    const n = Number(payload.intervalMin);
    if (!Number.isFinite(n) || n <= 0) throw new Error('intervalMin 必须是正数分钟数或 null');
    return { sql: "UPDATE sources SET extra=json_set(COALESCE(extra,'{}'),'$.intervalMin', ?) WHERE group_id=?", args: [n, groupId] };
  }
  if (action === 'failover') {
    const g = String(payload.failoverGroup || '').trim();
    if (!g) {
      return { sql: "UPDATE sources SET extra=json_remove(COALESCE(extra,'{}'),'$.failoverGroup') WHERE group_id=?", args: [groupId] };
    }
    return { sql: "UPDATE sources SET extra=json_set(COALESCE(extra,'{}'),'$.failoverGroup', ?) WHERE group_id=?", args: [g, groupId] };
  }
  const hit = AXIS_COL_ACTIONS[action];
  if (hit) return { sql: `UPDATE sources SET ${hit[0]}=? WHERE group_id=?`, args: [hit[1], groupId] };
  return null;
}

module.exports = {
  AXES_ALTERS, migrateAxes, resolveSubscriptionIds, setSubscribed,
  AXIS_COL_ACTIONS, AXIS_ALL_ACTIONS, groupAxisStmt,
};
