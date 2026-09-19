// 报警渠道"是否真有出口"的唯一判据（三端共用：tools/eval-preflight.cjs、健康自检、后台展示）
// 为什么单独成文件（坑 #43 的第三种形态，也是本轮最贵的一次发现）：
// 生产库 settings.alerts 现在只有 **一个** 渠道 `test-ch`，url = `http://127.0.0.1:1`；
// 而 preflight 的原判据是 `enabled && url.startsWith('http')` —— 于是 P0 阻塞项 BL7
// （报警链路无出口、系统正在哑火）在验收门禁里显示绿灯「1 个可用渠道」。
// 实际最后一条投递记录：2026-09-17T08:34 `channel:"TEST" ok:false error:"fetch failed"`。
// 检查器在"该红"的时候给绿，比没有检查器更糟：它提供虚假安全感。
const LOOPBACK_RE = /^(127\.|localhost|\[?::1\]?|\[?fe80:)/i;
// 内网/链路本地/元数据面一律不算"真出口"：这些地址在 Vercel 上必然连不通，
// 把它们算成可用渠道就是给 BL7 开绿灯（本轮对抗性审查实测：10.0.0.5 / 192.168.1.7 /
// 169.254.169.254 / metadata.google.internal / fd00:: 全部曾被判 true）
const PRIVATE_HOST_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|127\.|(::1|fe80:|fd[0-9a-f]{2}:|fc[0-9a-f]*:))/i;
const PRIVATE_TLD_RE = /\.(internal|local|localdomain|localhost)$/i;
const SENTINEL_ID_RE = /^(test|demo|sample|placeholder|example)[-_.]/i;
const BAD_HOSTS = new Set(['undefined', 'null', '', 'localhost']);

function isRealEndpointUrl(url) {
  let u;
  try {
    u = new URL(String(url == null ? '' : url).trim());
  } catch {
    return false;                       // 连 URL 都解析不了（'' / 'undefined' / 半截串）
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  // user:pass@host 形式的"凭据"不允许出现在回调地址里：掩码只到 host，
  // 但 userinfo 会进日志与报告 → 直接拒（真 webhook 从不用这种写法）
  if (u.username || u.password) return false;
  const host = (u.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');   // IPv6 的 hostname 带方括号，先剥掉再比
  if (BAD_HOSTS.has(host) || host === '::1') return false;
  if (LOOPBACK_RE.test(host) || PRIVATE_HOST_RE.test(host) || PRIVATE_TLD_RE.test(host)) return false;
  if (/^\d+$/.test(host.replace(/\./g, ''))) return false;   // 裸数字当主机名 = 坏配置
  const port = u.port ? Number(u.port) : NaN;
  if (Number.isFinite(port) && port < 1024) return false;   // 哨兵端口（:1 这类必然失败）
  return true;
}

// 只回显 scheme://host —— 用 URL 解析而不是正则截断，避免把 userinfo/query（token 常在里面）漏进报告
function maskEndpointUrl(url) {
  try {
    const u = new URL(String(url == null ? '' : url).trim());
    return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}/…`;
  } catch {
    return '(不可解析)';
  }
}

// 一个渠道算"有出口"= 启用 + id 不是测试哨兵 + 回调地址是真能通的公网 http(s)
function usableChannels(channels = []) {
  return (channels || []).filter((c) => c
    && c.enabled !== false
    && !SENTINEL_ID_RE.test(String(c.id || ''))
    && isRealEndpointUrl((c.config || {}).url || c.url));
}

// 最近投递是否**真的送达**：dispatched ≠ delivered（BL7 验收口径）。
// 判据取**最新一条**（而不是"7 天内有没有过一次成功"）——否则半年前那次成功会永远掩盖现在断掉的链路。
// → { state:'ok'|'failing'|'unknown'|'broken', detail }
function deliveryState(recentLog = [], lookbackMs = 7 * 864e5, now = Date.now()) {
  const all = (recentLog || []).filter((e) => e && e.at !== undefined && e.at !== null);
  const parsed = all.map((e) => ({ e, t: Date.parse(e.at) }));
  const bad = parsed.filter((p) => !Number.isFinite(p.t));
  const timed = parsed.filter((p) => Number.isFinite(p.t)).sort((a, b) => b.t - a.t);
  const future = timed.filter((p) => p.t > now + 60e3);
  const recent = timed.filter((p) => now - p.t <= lookbackMs && p.t <= now + 60e3);
  const anomaly = [];
  if (bad.length) anomaly.push(`${bad.length} 条时间戳不可解析`);
  if (future.length) anomaly.push(`${future.length} 条时间戳在未来（时钟或写入有问题）`);
  if (!recent.length) {
    return { state: anomaly.length ? 'broken' : 'unknown',
      detail: anomaly.length ? `近 ${Math.round(lookbackMs / 864e5)} 天没有可用投递记录，且${anomaly.join('、')}` : `近 ${Math.round(lookbackMs / 864e5)} 天无投递记录（未触发，无法自证有出口）` };
  }
  const latest = recent[0].e;
  const results = Array.isArray(latest.results) ? latest.results : [];
  const delivered = results.some((r) => r && r.ok === true);
  const errs = [...new Set(results.map((r) => r && r.error).filter(Boolean))];
  if (delivered) {
    return { state: 'ok', detail: `最新一条（${String(latest.at).slice(0, 16)}）已送达；近 ${recent.length} 条里 ${recent.filter((p) => (p.e.results || []).some((r) => r && r.ok === true)).length} 条有成功投递` };
  }
  return { state: 'failing', detail: `最新一条（${String(latest.at).slice(0, 16)}）未送达（${errs.slice(0, 2).join('; ') || '无 results 明细'}）；近 ${recent.length} 条仍无成功` };
}

module.exports = { isRealEndpointUrl, usableChannels, deliveryState, maskEndpointUrl, LOOPBACK_RE, SENTINEL_ID_RE };
