// H41③：坏值回落必须"留痕"——只写日志不算留痕（生产日志你看不到）。
// 消费方读设置值时的统一动作是"钳制 → 回落 → 留痕"；留痕落 settings 的
// `settings.valueFallbacks`（追加式、上限 50 条、同一键 1 小时节流一次），
// 现读库即可判"哪些键正在吃缺省、从什么时候开始"——与 prescreen 配额计数同一判别思路。
// store 形状：{ getSetting(key, def), setSetting(key, val) | putSetting(key, val) }（sync/async 都行）。
const LIST_KEY = 'settings.valueFallbacks';
const MAX_ENTRIES = 50;
const THROTTLE_MS = 3600e3;

async function recordSettingFallback(store, key, raw, fallback, now = Date.now()) {
  const set = store && (store.setSetting || store.putSetting);
  const get = store && store.getSetting;
  if (typeof set !== 'function' || typeof get !== 'function') return false;
  const list = (await get(LIST_KEY, [])) || [];
  const arr = Array.isArray(list) ? list : [];
  const last = [...arr].reverse().find((e) => e && e.key === key);
  if (last && now - (Date.parse(last.at) || 0) < THROTTLE_MS) return false; // 同键 1 小时只记一次，防读路径刷库
  const entry = {
    key,
    at: new Date(now).toISOString(),
    raw: String(JSON.stringify(raw ?? null)).slice(0, 80),
    fallback: String(JSON.stringify(fallback ?? null)).slice(0, 40),
  };
  await set(LIST_KEY, [...arr, entry].slice(-MAX_ENTRIES));
  return true;
}

// 消费方在 fallback 分支里的即发即忘封装：留痕失败绝不阻断主流程（ADR-26 同族）
function recordSettingFallbackQuietly(store, key, raw, fallback) {
  try {
    Promise.resolve(recordSettingFallback(store, key, raw, fallback)).catch(() => { /* 留痕失败不打扰主流程 */ });
  } catch { /* 同上 */ }
}

module.exports = { recordSettingFallback, recordSettingFallbackQuietly, LIST_KEY };
