// portal/api/img 代理的安全校验（与主系统 server/util/safeimg.js 同语义；portal 独立部署不能跨仓库引用）
// 防：IPv4-mapped IPv6、302 跳板到内网、chunked 绕过大小上限、域名解析到回环/内网
const dns = require('dns').promises;

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function isPrivateIp(ip) {
  let s = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  const m4 = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (m4) s = m4[1];
  else {
    const mh = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mh) {
      const n = (parseInt(mh[1], 16) << 16) + parseInt(mh[2], 16);
      s = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
    }
  }
  if (s === '::1' || s === '::' || s.startsWith('fe80:') || s.startsWith('fc') || s.startsWith('fd')) return true;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(s)) return false;
  const [a, b] = s.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 169 && b === 254) || a >= 224;
}

async function assertSafeUrl(u) {
  let host;
  try { host = new URL(u).hostname; } catch { throw new Error('bad url'); }
  host = host.replace(/^\[|\]$/g, '');
  if (isPrivateIp(host)) throw new Error('forbidden host');
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host) && !host.includes(':')) {
    let addrs;
    try {
      addrs = await dns.lookup(host, { all: true, verbatim: true });
    } catch (err) {
      throw new Error(`DNS 解析失败: ${err.code || err.message}`);
    }
    for (const a of addrs) {
      if (isPrivateIp(a.address)) throw new Error('forbidden host');
    }
  }
}

async function fetchImageSafe(url, headers = {}) {
  let u = String(url || '');
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!/^https?:\/\//i.test(u)) throw new Error('bad url');
    await assertSafeUrl(u);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let res;
    try {
      res = await fetch(u, { redirect: 'manual', headers, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      u = new URL(res.headers.get('location'), u).toString();
      continue;
    }
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) throw new Error('not an image');
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) {
        reader.cancel().catch(() => {});
        throw new Error('too large');
      }
      chunks.push(value);
    }
    return { contentType: ct, body: Buffer.concat(chunks) };
  }
  throw new Error('too many redirects');
}

module.exports = { fetchImageSafe, assertSafeUrl, isPrivateIp, MAX_BYTES };
