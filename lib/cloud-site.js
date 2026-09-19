// 云端基址唯一实现（AGENTS §2.5 单一事实源；三端工具共用：tools/eval-preflight.cjs、tools/audit-cloud.js、tools/_test-api.cjs）
// 为什么单独成文件：同一个"线上在哪"的字面量此前散在 4 个工具里各写一遍，
// 其中 tools/audit-cloud.js 写的是 2026-09-11 就已下架的 qwis-portal.vercel.app
// —— 于是"云端巡检"连续 8 天全量 404 而无人察觉，而这支脚本存在的意义正是发现云端问题。
// 副本第二份必然漂移，见坑 #42（探针参数/域名不许凭印象）。
const CLOUD_SITE = process.env.CLOUD_SITE || 'https://qwis-intel.vercel.app';

module.exports = { CLOUD_SITE };
