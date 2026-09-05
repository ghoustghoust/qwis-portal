// wemp 适配器（T-wemp）：抓取转发 rss 适配器
// we-mp-rss 输出标准 atom，/feed/{id}.atom?limit=20 即全文源；源由 /api/wemp/sync 自动写入
const rssAdapter = require("../rss");

module.exports = {
  type: "wemp",
  match() {
    return false; // 不参与 URL 识别——wemp 源只经 /api/wemp/sync 从 we-mp-rss 同步产生
  },
  defaultIntervalMin: 120, // 源级默认间隔（分钟）：微信读书通道低频安全
  async fetch(source, ctx) {
    return rssAdapter.fetch(source, ctx);
  },
};