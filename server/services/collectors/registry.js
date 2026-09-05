// 适配器登记中心（F49）
// 适配器契约：
//   module.exports = {
//     type: 'bilibili',
//     match(url) {},            // 识别用户粘贴的链接 → false | {uid?, bvid?, ...}
//     async resolve(input) {},  // 解析出订阅源字段 {name, url, uid, avatar, extra?}
//     async fetch(source, ctx) {}, // 拉取内容 → {articles: [...], videos: [...]}
//     defaultIntervalMin: 60,
//   }
const adapters = new Map(); // type -> adapter
const order = [];           // 登记顺序 = detectByUrl 遍历顺序

function register(adapter) {
  if (!adapter || !adapter.type) throw new Error('适配器必须有 type 字段');
  adapters.set(adapter.type, adapter);
  order.push(adapter.type);
  return adapter;
}

function getAdapter(type) {
  return adapters.get(type) || null;
}

// 遍历各适配器 match，返回首个命中 {type, adapter, match}
function detectByUrl(url) {
  for (const type of order) {
    const adapter = adapters.get(type);
    if (!adapter || typeof adapter.match !== 'function') continue;
    try {
      const m = adapter.match(url);
      if (m) return { type, adapter, match: m };
    } catch { /* 单个适配器识别异常不影响其它 */ }
  }
  return null;
}

// 内置适配器登记位：wechat / bilibili / douyin / rss / x / hotlist(九期)
// douyin、x 属后续期，目录不存在时静默跳过；rss 兜底放最后登记
for (const name of ['bilibili', 'wechat', 'douyin', 'x', 'hotlist', 'rss']) {
  try {
    register(require('./' + name));
  } catch { /* 后续期适配器暂缺 */ }
}

// YouTube 源以独立 type='youtube' 存储（归入视频侧），抓取复用 rss 适配器（别名登记）
const rssAdapter = adapters.get('rss');
if (rssAdapter) register({ ...rssAdapter, type: 'youtube' });

module.exports = { register, getAdapter, detectByUrl };
