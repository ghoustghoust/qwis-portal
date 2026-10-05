// H27②：AI 批的触发门——"时间窗 + 当期产物 + 认领键"三判据（用户 10-03 拍板方案②，
// 10-04 按同一方案推广到周刊档）。为什么：GH 会把定时事件挂错 cron 串（10-02 周刊整档丢失的活例），
// "事件里的串等于本 job 声明的串"这条门本身会开错门。修法：搭在被证明稳定的手动触发通道上
// （cron-job.org 每 15min dispatch），步骤内按时间窗判"该不该跑"、按库里当期有没有产物判"要不要跑"，
// 跑前写认领键挡重；schedule cron 保留为第二路径，两条路共用同一份判定（本文件）。
const { BJ_OFFSET_MS, beijingDateStr, beijingNow, beijingDayStartIso, beijingDayStartMs } = require('./time-window');
const { DAILY_SCHEMA_VERSION } = require('./brief-guards');

const CLAIM_KEY = 'ai.eveningBatch.claim';
// 北京 21:25 起 open——cron 的 21:30 前后各一轮 dispatch 都能覆盖到；午夜后是"新的一天"，由产物判据接管
const WINDOW_START_MIN = 21 * 60 + 25;
// 'started' 认领超过作业硬上限（330min）视为死轮，允许重跑
const STALE_MS = 330 * 60e3;

// ── 周刊档（H27② 推广，10-04）──
// 一周只有一根 cron（周五 18:03），丢一次即断更一周且心跳无痕——所以周刊是这套判据收益最大的档。
const WEEKLY_CLAIM_KEY = 'ai.weeklyBatch.claim';
// 与 collect.yml 的 weekly timeout-minutes 同源：'started' 认领超过它视为死轮
const WEEKLY_STALE_MS = 90 * 60e3;

// 生成窗口：北京周五 18:00 起（对齐 cron 的 18:03，前后的 dispatch 轮都能覆盖）到周日全天。
// 周五 cron 丢轮 → 15 分钟后的 dispatch 轮补上；极端整周五六日全挂才真断更。
function weeklyWindowOpen(nowMs = Date.now(), force = false) {
  if (force) return true;
  const bj = beijingNow(nowMs);
  const dow = bj.getUTCDay(); // 0=周日 5=周五
  if (dow === 5) return bj.getUTCHours() * 60 + bj.getUTCMinutes() >= 18 * 60;
  return dow === 6 || dow === 0;
}

// 本生成周期的锚点：最近的那个"北京周五 18:00"。
// 周五 18:00 前 → 本周五 18:00（未来值：窗口未开时产物/认领判据根本不会被调到；窗口开启后
// latest 里上一期必早于它，恰好表达"本期未生成"）；周五 18:00 后 / 周六 / 周日 → 本周五 18:00。
// 产物与认领两判据都拿它当"本期"的起点。
function weeklyCycleStartMs(nowMs = Date.now()) {
  const bj = beijingNow(nowMs);
  const dow = bj.getUTCDay();
  const backDays = dow === 5 ? 0 : dow === 6 ? 1 : dow === 0 ? 2 : (dow + 2) % 7;
  const anchorDayUtc = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate()) - backDays * 86400e3;
  return anchorDayUtc + 18 * 3600e3 - BJ_OFFSET_MS;
}

// "本期已发布过没有"：weekly.latest.generatedAt 落在本周期锚点之后。
// 条数不足放弃发布时 latest 不更新 → 判"没发布"，但那次认领（status=ok）会把后续轮挡到周期结束，
// 不至于每 15 分钟重烧一遍 AI 预算。
async function hasWeeklyProductInCycle(qOne, nowMs = Date.now()) {
  const row = await qOne("SELECT value FROM settings WHERE key = 'weekly.latest'");
  if (!row || !row.value) return false;
  let v;
  try { v = JSON.parse(row.value); } catch { return false; }
  const t = Date.parse(v && v.generatedAt);
  if (!Number.isFinite(t)) return false;
  return t >= weeklyCycleStartMs(nowMs);
}

// dispatch 通道的轮次全天都会进来，只有过了北京 21:25 才轮到晚间批；force = 显式 mode 补跑，不看窗
function windowOpen(nowMs = Date.now(), force = false) {
  if (force) return true;
  const bj = beijingNow(nowMs);
  return bj.getUTCHours() * 60 + bj.getUTCMinutes() >= WINDOW_START_MIN;
}

// 三判据合一。slot 区分晚间主批（rolling24）/ 备跑（自然日闭合）/ 周刊——认领键按档分开，
// "当期"的分母也按档分开：daily 档的周期起点是北京 0 点（cycleStartMs 传 beijingDayStartMs），
// 周刊档传 weeklyCycleStartMs——认领与产物都以"本生成周期"计，不跨周期挡。
// 产物判据是主判：本期已有产物就不重跑；认领键只防"正在生成时的并发重跑"。
function claimDecision(claim, { slot = 'evening', cycleStartMs = beijingDayStartMs(), hasProductToday = false, productWhy = '', nowMs = Date.now(), force = false } = {}) {
  const today = beijingDateStr(nowMs);
  if (force) return { run: true };
  if (hasProductToday) return { run: false, why: productWhy || (slot === 'evening' ? `今晚主批产物已出（北京 ${today}）` : `主批昨晚已出档，备跑让路（北京 ${today}）`) };
  if (claim && claim.slot === slot && (Date.parse(claim.at) || 0) >= cycleStartMs) {
    const stale = slot === 'weekly' ? WEEKLY_STALE_MS : STALE_MS;
    if (claim.status === 'started' && nowMs - (Date.parse(claim.at) || 0) < stale) {
      return { run: false, why: '另一轮正在生成（认领未过期）' };
    }
    if (claim.status === 'ok') {
      return { run: false, why: slot === 'weekly'
        ? '本周期已认领且完成（含条数不足放弃发布的那次，本周不再重试）'
        : '本档今天已认领且完成（产物可能刚被删，复核后再动）' };
    }
    // failed / started 过期 → 允许重跑
  }
  return { run: true };
}

// "本期已有 AI 档产物"的判定口径——H54（用户 10-05 拍板：夜间主批为正，备跑让路）按档分边界：
//   evening（主批，21:25 后跑）：判「今天北京 21:25 之后落的产物」——备跑凌晨 00:32~08:13 落的
//     产物在 21:25 之前，不再压制主批（旧判据"本北京日 0 点后有产物"曾让主批结构性恒跳过）。
//   backup（备跑，凌晨 00:32 跑）：让路=只兜底"主批没出档"——判「昨天 21:25 之后落的产物」：
//     昨晚主批成功 → 备跑跳过（不再每天双跑烧配额）；主批失败/丢轮 → 备跑凌晨补昨天的档
//     （它的生成窗口恰是北京自然日闭合，语义对齐）。
// qOne 由调用方注入（runner 的 Turso 句柄），本文件不持连接。
async function hasAiProduct(qOne, slot = 'evening', nowMs = Date.now()) {
  const dayStart = beijingDayStartMs(nowMs);
  const windowStartMs = dayStart + WINDOW_START_MIN * 60e3; // 今天北京 21:25
  const sinceIso = new Date(slot === 'evening' ? windowStartMs : windowStartMs - 86400e3).toISOString();
  const r = await qOne(
    "SELECT COUNT(*) c FROM daily_reports WHERE generated_at >= ? AND COALESCE(json_extract(COALESCE(stats,'{}'),'$.schemaVersion'), 0) >= ?",
    [sinceIso, DAILY_SCHEMA_VERSION.AI]
  );
  return Number((r && r.c) || 0) > 0;
}

module.exports = {
  CLAIM_KEY, WEEKLY_CLAIM_KEY, WINDOW_START_MIN, STALE_MS, WEEKLY_STALE_MS,
  windowOpen, weeklyWindowOpen, weeklyCycleStartMs,
  claimDecision, hasAiProduct, hasWeeklyProductInCycle,
};
