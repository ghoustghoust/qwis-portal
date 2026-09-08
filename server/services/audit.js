// 3.1 操作审计日志服务
// 记录管理后台关键写操作：源增删改、日报设置变更、数据操作、报警配置等
// 存储：SQLite audit_log 表（at/user/action/target/detail/ip）
const { db } = require('../db');
const { nowIso } = require('../util/time');
const log = require('../util/log');

const insertAudit = db.prepare(`
  INSERT INTO audit_log(at, user, action, target, detail, ip)
  VALUES(@at, @user, @action, @target, @detail, @ip)
`);

const fetchRecent = db.prepare(`
  SELECT * FROM audit_log ORDER BY at DESC LIMIT ?
`);

const fetchByAction = db.prepare(`
  SELECT * FROM audit_log WHERE action = ? ORDER BY at DESC LIMIT ?
`);

const countAll = db.prepare(`SELECT COUNT(*) c FROM audit_log`);

/**
 * 记录一条审计日志
 * @param {string} action - 操作类型，如 'source.create' / 'source.delete' / 'daily.generate'
 * @param {object} opts
 * @param {string} opts.target - 操作对象标识（如源名称、快照文件名）
 * @param {object} opts.detail - 附加信息（JSON 可序列化）
 * @param {string} opts.user - 操作者（默认 'admin'）
 * @param {string} opts.ip - 请求 IP
 */
function record(action, opts = {}) {
  try {
    insertAudit.run({
      at: nowIso(),
      user: opts.user || 'admin',
      action,
      target: opts.target || null,
      detail: opts.detail ? JSON.stringify(opts.detail).slice(0, 2000) : null, // 限制 detail 体积
      ip: opts.ip || null,
    });
  } catch (err) {
    log.warn('[审计] 写入失败:', err.message);
  }
}

/**
 * 查询最近的审计日志
 * @param {number} limit - 返回条数（默认 50，上限 200）
 * @param {string} action - 可选：按 action 过滤
 */
function list(limit = 50, action) {
  const n = Math.min(Number(limit) || 50, 200);
  if (action) return fetchByAction.all(action, n);
  return fetchRecent.all(n);
}

/** 审计日志总数 */
function count() {
  return countAll.get().c;
}

/** 清理超过 maxDays 天的旧审计记录 */
function cleanup(maxDays = 30) {
  const cutoff = new Date(Date.now() - maxDays * 86400e3).toISOString();
  const r = db.prepare('DELETE FROM audit_log WHERE at < ?').run(cutoff);
  const n = r.changes || 0;
  if (n > 0) log.info(`[审计] 清理了 ${n} 条超过 ${maxDays} 天的旧记录`);
  return n;
}

module.exports = { record, list, count, cleanup };
