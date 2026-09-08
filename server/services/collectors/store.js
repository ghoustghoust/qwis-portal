// 源生命周期管理（重构 Phase 2 瘦身）
// 职责：抓取失败的熔断计数 + 自动暂停 + 解冻恢复（源错误状态机）
// 原 store.js 的 CRUD / 抓取编排 / 并发防护 / 间隔计算已分别提取到：
//   - repo.js（saveArticles / saveVideos）
//   - fetcher.js（fetchSource）
//   - _shared.js（withSourceLock / intervalMinFor / inFlight）
// 本文件保留兼容 re-export，所有现有 import 路径无需修改

const { db } = require('../../db');
const { nowIso } = require('../../util/time');
const log = require('../../util/log');

// ─── 兼容 re-export（保持所有 require('../collectors/store') 调用不变） ───────
const { saveArticles, saveVideos } = require('./repo');
const { fetchSource } = require('./fetcher');
const { intervalMinFor } = require('./_shared');

// ─── 源错误状态机 ─────────────────────────────────────────────────────────────
// T48 异常恢复：抓取失败记 status='error' 且 fail_count+1；连续失败 3 次自动暂停（enabled=0），
// 手动重新启用（toggle）时清零 fail_count 恢复。返回 {failCount, autoPaused}
// 九期补丁:失败原因写入 extra.lastError/lastErrorAt(健康度展示用);成功时由 fetchSource 清除
// opts.silent:批量刷新(refresh-all / opml / refresh)时置 true——逐源报警会打爆渠道限流,由调用方结尾汇总一次
function markSourceError(source, errMsg, opts = {}) {
  let extra = {};
  try { extra = JSON.parse(source.extra || '{}'); } catch { /* 非法 JSON 按无处理 */ }
  // ✅ 使用 log.mask() 脱敏敏感信息（Token/Cookie/API Key）
  extra.lastError = log.mask(String(errMsg || '未知错误')).slice(0, 300);
  extra.lastErrorAt = nowIso();
  db.prepare("UPDATE sources SET status='error', fail_count=COALESCE(fail_count,0)+1, extra=? WHERE id=?")
    .run(JSON.stringify(extra), source.id);
  const row = db.prepare('SELECT fail_count, enabled FROM sources WHERE id=?').get(source.id);
  const failCount = row ? row.fail_count : 1;
  let autoPaused = false;
  if (failCount >= 3 && row.enabled !== 0) {
    db.prepare('UPDATE sources SET enabled=0 WHERE id=?').run(source.id);
    autoPaused = true;
  }
  // 九期:报警触发(异步,不阻塞调度;失败只记日志);批量路径(opts.silent)跳过,由调用方汇总
  if (!opts.silent && failCount >= 2) {
    setImmediate(() => {
      require('../alerts').sourceError(source, failCount, errMsg).catch((e) => log.warn('[报警] 触发失败:', e.message));
    });
  }
  return { failCount, autoPaused };
}

// ─── 解冻（唯一入口） ─────────────────────────────────────────────────────────
// 解冻语义唯一实现（2026-09-04 收敛）:enabled=1 + fail_count=0 + status='ok' + 清 extra.lastError/lastErrorAt,
// 其余 extra 配置(intervalMin/etag 等)保留。所有解冻入口(sources toggle / health unfreeze(-all) /
// restore-all / scripts/restore-frozen-sources.js)必须走这里,防多套实现语义漂移
function unfreezeSource(id) {
  const row = db.prepare('SELECT extra FROM sources WHERE id=?').get(id);
  if (!row) return false;
  let extra = {};
  try { extra = JSON.parse(row.extra || '{}'); } catch { /* 非法 JSON 按无处理 */ }
  delete extra.lastError;
  delete extra.lastErrorAt;
  db.prepare("UPDATE sources SET enabled=1, fail_count=0, status='ok', extra=? WHERE id=?")
    .run(JSON.stringify(extra), id);
  return true;
}

module.exports = {
  // 源生命周期（本模块核心职责）
  markSourceError,
  unfreezeSource,
  // 兼容 re-export（下游 import 路径无需改动）
  saveArticles,
  saveVideos,
  fetchSource,
  intervalMinFor,
};
