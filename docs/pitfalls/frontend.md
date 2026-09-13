# 坑 · 前端（frontend）

### #1 mmbiz.qpic.cn 图片防盗链
- 症状：公众号图片挂。
- 规则：`referrerpolicy="no-referrer"`；封面走 `/api/img` 代理（服务端无 Referer）。

### #2 微信文章懒加载
- 规则：`data-src` → `src` 转换（cleanContent 已处理，新解析链路别丢）。

### #16 正则从 HTML 属性取 URL 必须解 `&amp;` 实体
- 案例：firstImg 用正则取 `<img src>`，`&` 是 `&amp;` → wechat2rss img-proxy 收到 `amp;u` 错误参数，封面全挂；存量 3891 条坏封面清洗过。
- 规则：正则取属性值一律 decode `&amp;`；JSDOM 取的属性已自动解码。

### #F1 React hook 顺序铁律（2026-09-13）
- 症状：云端点文章整页白屏（React #310）。
- 根因：17-translate 的手动翻译轮询 useEffect 放在 `if(!articleId)` 早退 return 之后 → hook 数量跨渲染不一致 → 整树崩溃。
- 规则：**所有 hooks 必须在任何条件早退 return 之前**；代码评审见早退先查 hook。
