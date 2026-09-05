// P2: 带时间戳分级日志；敏感字段（token/key/cookie/password/auth/bearer）打码
// 匹配模式:
//   1. URL 参数形式：?token=xxx& 或 &apikey=yyy
//   2. JSON 对象形式：{"token":"xxx"} 或 'key': 'yyy'
//   3. 行内键值对：token = xxx 或 auth: "bbb"
const SENSITIVE = /([?&](?:token|key|apikey|api_key|secret|password|pwd|auth|cookie)=)[^&\s]+|((?:token|key|apikey|api_key|secret|password|passwd|pwd|auth|cookie|sessdata|bili_jct|wid_update|__uuid)["'\s:=][^,}]+)|("?(?:token|key|apikey|api_key|secret|password|passwd|pwd|auth|bearer|sessdata|bili_jct|wid_update|__uuid)["]\s*:\s*["'][^"']+["'])/gi;

function mask(text) {
  return String(text).replace(SENSITIVE, (match, p1, p2, p3) => {
    // 优先使用第一个非空的捕获组（URL 参数 / JSON 键值 / 对象字面量）
    const prefix = p1 || p2 || p3 || '';
    // 保留前缀部分（如 ?token= 或 "key": "），将值替换为 ***
    const valueStart = match.indexOf(prefix) + prefix.length;
    const value = match.slice(valueStart);
    return match.slice(0, valueStart) + '***';
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
