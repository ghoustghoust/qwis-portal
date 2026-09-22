// B17 周刊初筛预筛（唯一实现，纯函数便于锁定）：
// 病根——初筛预算（BUDGET×40%）只够 ~360 次 AI 调用，而 7 天候选可达 2000 篇，
// 按 published_at DESC 顺序跑 = 周刊只策展了「最新几小时」的前缀，根本不是全周内容。
// 拍板（09-21）：预筛降量（六维分门槛），不抬配额。
// 规则：
//   ① 已评分 ≥ minScore 的全部保收（六维分门槛——全周的高分内容一个都不因时间序被挤掉）
//   ② kind='video' 全收（视频候选本身已是 LIMIT 预筛过的十几条）
//   ③ 其余槽位按时间倒序补满 maxFilter（maxFilter 由预算与限流间隔推出）
// 返回 { scoped, keptCount, droppedCount }——dropped 的全是「低分且非最新」，裁掉不心疼。
'use strict';

const MIN_SCORE = 60;

function prefilterWeekly(valid, { maxFilter, minScore = MIN_SCORE } = {}) {
  const cap = Math.max(1, Number(maxFilter) || 1);
  const keep = (valid || []).filter((a) => a.kind === 'video' || Number(a.score) >= minScore);
  const rest = (valid || []).filter((a) => !(a.kind === 'video' || Number(a.score) >= minScore));
  const scoped = [...keep, ...rest].slice(0, Math.max(cap, keep.length));
  return { scoped, keptCount: keep.length, droppedCount: (valid || []).length - scoped.length };
}

module.exports = { prefilterWeekly, MIN_SCORE };
