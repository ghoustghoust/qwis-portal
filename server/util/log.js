// P2: 带时间戳分级日志；敏感字段（token/key/cookie/password/auth/bearer）打码
// 匹配模式:
//   1. URL 参数形式：?token=xxx& 或 &apikey=yyy
//   2. JSON 对象形式：{"token":"xxx"} 或 'key': 'yyy'
//   3. 行内键值对：token = xxx 或 auth: "bbb"
const SENSITIVE = /([?&](?:token|key|apikey|api_key|secret|password|pwd|auth|cookie)=)[^&\s]+|((?:token|key|apikey|api_key|secret|password|passwd|pwd|auth|cookie|sessdata|bili_jct|wid_update|__uuid)["'\s:=][^,}]+)|("?(?:token|key|apikey|api_key|secret|password|passwd|pwd|auth|bearer|sessdata|bili_jct|wid_update|__uuid)["]\s*:\s*["'][^"']+["'])/gi;

function mask(text) {
  return String(text).replace(SENSITIVE, (match, p1, p2, p3) => {
    // 2026-09-05b 修复：旧实现对 p2/p3（行内键值/JSON 形式）把整个捕获组当前缀，
    // 导致 valueStart=match 长度、敏感值原样保留仅尾部追加 ***（打码失效）
    if (p1) return p1 + '***'; // URL 参数形式：?token= → ?token=***
    if (p2) {
      // 行内键值：token=abc123 / cookie: xxx → 只保留「键+分隔符」
      const m = p2.match(/^([a-zA-Z_]+["'\s:=])/);
      return (m ? m[1] : '') + '***';
    }
    if (p3) {
      // JSON 形式："token":"abc123" → "token":"***"
      const m = p3.match(/^(.*?["']\s*:\s*["'])/);
      return (m ? m[1] : '') + '***' + (p3.endsWith('"') || p3.endsWith("'") ? p3.slice(-1) : '');
    }
    return '***';
  });
}

function line(level, args) {
  const ts = new Date().toISOString();
  const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  return `[${ts}] [${level}] ${mask(msg)}`;
}

const log = {
  info: (...args) => console.log(line('INFO', args)),
  warn: (...args) => console.warn(line('WARN', args)),
  error: (...args) => console.error(line('ERROR', args)),
  mask,
};

// ✅ P0 修复：追加导出 mask 函数供外部模块调用（保持对象身份不变，兼容 require 缓存与既有 log.* 用法）
module.exports = log;
