// 报警渠道"是否真有出口"的唯一判据（三端共用：tools/eval-preflight.cjs、健康自检、后台展示）
// 为什么单独成文件（坑 #43 的第三种形态，也是本轮最贵的一次发现）：
// 生产库 settings.alerts 现在只有 **一个** 渠道 `test-ch`，url = `http://127.0.0.1:1`；
// 而 preflight 的原判据是 `enabled && url.startsWith('http')` —— 于是 P0 阻塞项 BL7
// （报警链路无出口、系统正在哑火）在验收门禁里显示绿灯「1 个可用渠道」。
// 实际最后一条投递记录：2026-09-17T08:34 `channel:"TEST" ok:false error:"fetch failed"`。
// 检查器在"该红"的时候给绿，比没有检查器更糟：它提供虚假安全感。
const LOOPBACK_RE = /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;
const SENTINEL_ID_RE = /^(test|demo|sample|placeholder|example)[-_.]/i;
const BAD_HOSTS = new Set(['undefined', 'null', '', 'localhost']);

function isRealEndpointUrl(url) {
  const u = String(url == null ? '' : url).trim();
  if (!/^https?:\/\//i.test(u)) return false;
  if (LOOPBACK_RE.test(u)) return false;
  const host = u.replace(/^https?:\/\//i, '').split('/')[0];
  if (BAD_HOSTS.has(host.toLowerCase())) return false; // 本轮真发生过：url 被测试写坏成字符串 "undefined"
  const port = host.includes(':') ? Number(host.split(':').pop()) : NaN;
  if (Number.isFinite(port) && port < 1024) return false; // 哨兵端口（:1 这类必然失败）
  return true;
}

// 一个渠道算"有出口"= 启用 + id 不是测试哨兵 + 回调地址是真能通的公网 http(s)
function usableChannels(channels = []) {
  return (channels || []).filter((c) => c
    && c.enabled !== false
    && !SENTINEL_ID_RE.test(String(c.id || ''))
    && isRealEndpointUrl((c.config || {}).url || c.url));
}

// 最近投递是否**真的送达**：dispatched ≠ delivered（BL7 验收口径）。
// → { state:'ok'|'failing'|'unknown', detail }
function deliveryState(recentLog = [], lookbackMs = 7 * 864e5, now = Date.now()) {
  const recent = (recentLog || []).filter((e) => e && e.at && now - Date.parse(e.at) <= lookbackMs);
  if (!recent.length) return { state: 'unknown', detail: `近 ${Math.round(lookbackMs / 864e5)} 天无投递记录（未触发，无法自证有出口）` };
  const delivered = recent.filter((e) => (e.results || []).some((r) => r && r.ok === true));
  if (delivered.length) return { state: 'ok', detail: `近 ${recent.length} 条里 ${delivered.length} 条至少一个渠道送达` };
  const errs = [...new Set(recent.flatMap((e) => (e.results || []).map((r) => r && r.error).filter(Boolean)))];
  return { state: 'failing', detail: `近 ${recent.length} 条全部未送达（${errs.slice(0, 2).join('; ') || '无 results 明细'}）` };
}

module.exports = { isRealEndpointUrl, usableChannels, deliveryState, LOOPBACK_RE, SENTINEL_ID_RE };
