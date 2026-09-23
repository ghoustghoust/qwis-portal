// 早报初筛可观测（2026-09-23，P0-2 配套）：失败计数与报警判定只许这一份。
// 为什么存在：初筛失败此前只在内存的 reason 字符串里存活——stats 不落、报警不发，
// "0 剔除"与"初筛根本没工作"在数据上完全同形，用户无法分辨今天筛没筛（第 22 期实测同形）。
// 分工：AI 通道全挂已有 api/_ai.js 的 consecFail≥3 报警；这里管"失败但没全挂"的盲区。
// 用户裁定：异常信号发报警渠道给管理者（飞书），不上前台页面。
'use strict';

// 失败率报警线：免费推理模型有日常抖动，零星失败不值得叫；五分之一以上说明通道在出问题
const FILTER_FAIL_ALERT_RATE = 0.2;

// attempted = 实际发起初筛的篇数（不含被预算截断、根本没轮到的篇数——截断由 truncated 单独表达）
// 返回 { alert, rate, text }：text 给报警文案与日志共用，空串 = 无异常
function filterAlert({ attempted = 0, failed = 0, truncated = false } = {}) {
  const a = Number(attempted) || 0;
  const f = Number(failed) || 0;
  const rate = a > 0 ? f / a : 0;
  const reasons = [];
  if (a > 0 && rate >= FILTER_FAIL_ALERT_RATE) reasons.push(`失败 ${f}/${a}（${Math.round(rate * 100)}%）`);
  if (truncated) reasons.push('预算截断，部分候选没来得及筛');
  return { alert: reasons.length > 0, rate, text: reasons.join('；') };
}

module.exports = { FILTER_FAIL_ALERT_RATE, filterAlert };
