// 云端基址唯一实现（AGENTS §2.5 单一事实源；三端工具共用：tools/eval-preflight.cjs、tools/audit-cloud.js、tools/_test-api.cjs）
// 为什么单独成文件：同一个"线上在哪"的字面量此前散在 4 个工具里各写一遍，
// 其中 tools/audit-cloud.js 写的是 2026-09-11 就已下架的 qwis-portal.vercel.app
// —— 于是"云端巡检"连续 8 天全量 404 而无人察觉，而这支脚本存在的意义正是发现云端问题。
// 副本第二份必然漂移，见坑 #42（探针参数/域名不许凭印象）。
const CLOUD_SITE = process.env.CLOUD_SITE || 'https://qwis-intel.vercel.app';

// 出网代理同样要单一事实源（AGENTS §2.2 记的是本机 Clash 端口）。
// 为什么连 fetch 一起导出：坑——undici 的 ProxyAgent 只有配 **undici 自己的 fetch** 才生效，
// 用全局 fetch 传 dispatcher 会被静默忽略，症状是"全部端点 fetch failed"，
// 看起来像云端挂了，其实是脚本没走代理（2026-09-19 tools/audit-cloud.js 就中招：19/19 红）。
const CLOUD_PROXY = process.env.EVAL_PROXY === 'none' ? '' : (process.env.EVAL_PROXY || 'http://127.0.0.1:12000');

/** 打云端的统一出口：自动经代理；EVAL_PROXY=none 时直连。返回的是 undici Response（api 一致）。 */
async function cloudFetch(pathOrUrl, opts = {}) {
  const url = /^https?:/.test(pathOrUrl) ? pathOrUrl : CLOUD_SITE + pathOrUrl;
  const { signal, dispatcher: _ignored, ...rest } = opts;
  if (!CLOUD_PROXY) return fetch(url, { signal, ...rest });
  const { ProxyAgent, fetch: uFetch } = require('undici');
  return uFetch(url, { dispatcher: new ProxyAgent(CLOUD_PROXY), signal, ...rest });
}

module.exports = { CLOUD_SITE, CLOUD_PROXY, cloudFetch };
