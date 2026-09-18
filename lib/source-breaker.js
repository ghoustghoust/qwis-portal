// 熔断阈值唯一实现（三端共用：server/services/collectors/store.js、api/collect.js、tools/collect-turso.js）
// 为什么单独成文件：同一份"连跪几次算熔断"的判据此前在两端各写一遍，
// 结果同一个 YouTube 源在本地 3 次就锁、在云端 10 次才锁（docs/ISSUES.md H14、坑 #35）。
// YouTube 对数据中心 IP 反爬会返回假 404/500（间歇性、按 IP 掷骰），阈值放宽到 10 防误杀；真死频道 10 连跪后照停。
const BREAKER_THRESHOLDS = { youtube: 10, default: 3 };

function breakerThreshold(sourceType) {
  return BREAKER_THRESHOLDS[String(sourceType || '').toLowerCase()] || BREAKER_THRESHOLDS.default;
}

// 是否应因连续失败而暂停该源
function shouldPauseOnFail(sourceType, failCount) {
  return Number(failCount || 0) >= breakerThreshold(sourceType);
}

module.exports = { BREAKER_THRESHOLDS, breakerThreshold, shouldPauseOnFail };
