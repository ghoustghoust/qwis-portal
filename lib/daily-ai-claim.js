// H27②：AI 批的触发门——"时间窗 + 当日产物 + 认领键"三判据（用户 10-03 拍板方案②）。
// 为什么：GH 会把定时事件挂错 cron 串（10-02 周刊整档丢失的活例），"事件里的串等于本 job
// 声明的串"这条门本身会开错门。修法：搭在被证明稳定的手动触发通道上（cron-job.org 每
// 15min dispatch），步骤内按时间窗判"该不该跑"、按库里当天有没有 AI 档产物判"要不要跑"，
// 跑前写认领键挡重；schedule cron 保留为第二路径，两条路共用同一份判定（本文件）。
const { beijingDateStr, beijingNow, beijingDayStartIso } = require('./time-window');
const { DAILY_SCHEMA_VERSION } = require('./brief-guards');

const CLAIM_KEY = 'ai.eveningBatch.claim';
// 北京 21:25 起 open——cron 的 21:30 前后各一轮 dispatch 都能覆盖到；午夜后是"新的一天"，由产物判据接管
const WINDOW_START_MIN = 21 * 60 + 25;
// 'started' 认领超过作业硬上限（330min）视为死轮，允许重跑
const STALE_MS = 330 * 60e3;

// dispatch 通道的轮次全天都会进来，只有过了北京 21:25 才轮到晚间批；force = 显式 mode 补跑，不看窗
function windowOpen(nowMs = Date.now(), force = false) {
  if (force) return true;
  const bj = beijingNow(nowMs);
  return bj.getUTCHours() * 60 + bj.getUTCMinutes() >= WINDOW_START_MIN;
}

// 三判据合一。slot 区分晚间主批（rolling24）与备跑（自然日闭合）——认领键按档分开。
// 产物判据是主判：今天（北京日）已有 AI 档产物就不重跑；认领键只防"正在生成时的并发重跑"。
function claimDecision(claim, { slot = 'evening', hasProductToday = false, nowMs = Date.now(), force = false } = {}) {
  const today = beijingDateStr(nowMs);
  if (force) return { run: true };
  if (hasProductToday) return { run: false, why: `今天（北京 ${today}）已有 AI 档产物` };
  if (claim && claim.date === today && claim.slot === slot) {
    if (claim.status === 'started' && nowMs - (Date.parse(claim.at) || 0) < STALE_MS) {
      return { run: false, why: '另一轮正在生成（认领未过期）' };
    }
    if (claim.status === 'ok') return { run: false, why: '本档今天已认领且完成（产物可能刚被删，复核后再动）' };
    // failed / started 过期 → 允许重跑
  }
  return { run: true };
}

// "库里今天有没有 AI 档产物"的判定口径：generated_at 落在本北京日 + schemaVersion 达到 AI 档。
// qOne 由调用方注入（runner 的Turso 句柄），本文件不持连接。
async function hasAiProductToday(qOne, nowMs = Date.now()) {
  const r = await qOne(
    "SELECT COUNT(*) c FROM daily_reports WHERE generated_at >= ? AND COALESCE(json_extract(COALESCE(stats,'{}'),'$.schemaVersion'), 0) >= ?",
    [beijingDayStartIso(nowMs), DAILY_SCHEMA_VERSION.AI]
  );
  return Number((r && r.c) || 0) > 0;
}

module.exports = { CLAIM_KEY, WINDOW_START_MIN, STALE_MS, windowOpen, claimDecision, hasAiProductToday };
