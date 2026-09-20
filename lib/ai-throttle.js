// AI 调用间隔的唯一算法（BL8）。
// 存在的全部理由：`Number(缺键)` 是 0，而"0 毫秒间隔"在 15 RPM 的免费池上等于无节流硬打；
// 所以"取设置值"这一步必须带下限，且只能有一份（坑 #59：同一算术写两遍必然分叉）。
const DEFAULT_GAP_MS = 4000; // ≈15 RPM 留余量
const MIN_GAP_MS = 1000;

function gapMs(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= MIN_GAP_MS ? n : DEFAULT_GAP_MS;
}

module.exports = { gapMs, DEFAULT_GAP_MS, MIN_GAP_MS };
