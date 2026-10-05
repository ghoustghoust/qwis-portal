// 失败原因规则桶——api 聚类与 runner 自愈共用的唯一实现（10-05 从 api/[...slug].js 收编）。
// lastError 只有字符串无语义字段，读层规则桶（写入侧不动；将来要更准应在写侧加 errorKind）。
const ERROR_BUCKETS = [
  { key: 'http_404', label: '404 源没了/路径失效', match: (e) => /\b404\b/i.test(e) },
  { key: 'http_403', label: '403 被拒（多半是反爬/封 IP）', match: (e) => /\b403\b|forbidden/i.test(e) },
  { key: 'http_401', label: '401 登录态/Cookie 失效', match: (e) => /\b401\b|unauthorized|cookie.*(过期|失效)|SESSDATA/i.test(e) },
  { key: 'http_429', label: '429 触发限流', match: (e) => /\b429\b|rate.?limit/i.test(e) },
  { key: 'timeout', label: '超时', match: (e) => /timeout|timed? ?out|ETIMEDOUT|ECONNRESET|socket/i.test(e) },
  { key: 'parse', label: '解析失败（多半是返回的不是 RSS/页面变了）', match: (e) => /parse|XML|Invalid|Unexpected|non-XML|doctype|html/i.test(e) },
  { key: 'network', label: '网络层失败（DNS/连接/TLS）', match: (e) => /ENOTFOUND|ECONNREFUSED|fetch failed|certificate|CERT|TLS|SSL|EPROTO/i.test(e) },
];

function errorBucket(err) {
  const e = String(err || '');
  for (const b of ERROR_BUCKETS) { if (b.match(e)) return b; }
  return { key: 'other', label: '其他' };
}

// 系统性判据（与坑 #39 三闸门的"同源性"同思想）：同桶 ≥10 个且单一类型占比 ≥80%
// = 平台级问题（一种病一片），不是散源故障。
function isSystemic(count, byType) {
  if (count < 10) return null;
  const top = Object.entries(byType || {}).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] / count >= 0.8 ? top[0] : null;
}

module.exports = { ERROR_BUCKETS, errorBucket, isSystemic };
