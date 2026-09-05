// X（Twitter）适配器（T43，F48）：
// settings['x.rsshubTemplate'] 配置第三方 RSS 服务地址模板（含 {name} 占位，
// 如 https://rsshub.app/twitter/user/{name}），+ 用户名拼出 RSS 后委托 rss 适配器抓取。
const { getSetting } = require('../../../db');
const rssAdapter = require('../rss');

// 未配置模板时的报错文案（spec 原样）
const NO_TEMPLATE_MSG = 'X 依赖第三方 RSS 服务，请先配置 RSSHub 实例地址';

function match(input) {
  const s = String(input || '').trim();
  if (!s) return false;
  let m = s.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/?(?:\?.*)?$/i);
  if (m) return { name: m[1] };
  // 裸用户名直填：@name 或 name（排除纯数字，避免与 B站 uid 混淆——bilibili 登记在前会先命中，这里再兜底）
  m = s.match(/^@?([A-Za-z][A-Za-z0-9_]{0,14})$/);
  if (m) return { name: m[1] };
  return false;
}

function buildFeedUrl(name) {
  const template = getSetting('x.rsshubTemplate', null);
  if (!template || !String(template).includes('{name}')) throw new Error(NO_TEMPLATE_MSG);
  return String(template).replaceAll('{name}', encodeURIComponent(name));
}

async function resolve(input) {
  const m = match(input);
  if (!m) throw new Error('没有识别到 X 用户名，请粘贴 x.com/twitter.com 主页链接或直接填写用户名');
  const feedUrl = buildFeedUrl(m.name); // 未配置模板时抛 NO_TEMPLATE_MSG
  // 委托 rss 适配器解析 feed 元信息
  const info = await rssAdapter.resolve(feedUrl);
  return {
    name: info.name || `@${m.name}`,
    url: feedUrl, // sources.url 存拼好的 RSS 链接，fetch 直接委托 rss
    uid: m.name,
    avatar: info.avatar || null,
    extra: { ...(info.extra || {}), xName: m.name },
  };
}

async function fetch(source, ctx) {
  // 委托 rss 适配器抓取（推文 → articles）
  return rssAdapter.fetch(source, ctx);
}

module.exports = {
  type: 'x',
  defaultIntervalMin: 480, // 与 rss 一致（8h）
  NO_TEMPLATE_MSG,
  match,
  resolve,
  fetch,
  buildFeedUrl,
};
