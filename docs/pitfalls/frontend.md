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

### #54 flex-1 列在收缩阶段永远抢不到宽度；0 宽下 line-clamp 不裁剪（2026-09-19，B85）
- 症状：日报某一行撑成 996×594 的空框，正文压在框底，看起来像"图片占位没渲染"。
- 根因（两件事叠加，缺一不红）：
  ① 同一 flex 行里所有兄弟列都是 `flex-none`（不可收缩），其中渲染 `source_name` 的那列
     `whitespace-nowrap` 且**不设上界**（线上实测 620px 的 SEO 拼接来源名）→ 兄弟基准宽之和 > 行宽；
  ② 标题列写的是 `flex-1`，展开即 `flex: 1 1 0%`——**基准 0 的项在负空间分配里权重为 0**，
     永远最后被压、且第一个被压到 0；再叠加 `min-w-0`（允许压到 0）就必崩。
- 反直觉点：宽度为 0 时 `-webkit-line-clamp: 2` **不再裁剪高度**（`scrollHeight` 仍是整段按字换行的 554px），
  所以"有 line-clamp 就封顶"是错的， clamp 不是行高的保险。
- 规则：
  ① 渲染**任意长度文本**（来源名/标题/理由）的 flex 兄弟列必须有 `max-w-[…]` 上界，且不可收缩项之和要留得下主列；
  ② 主内容列给 `min-w-[<非零>]` 下限，别只写 `min-w-0`；
  ③ 判断这类缺陷只读 JSX 不够，**必须抓真实 DOM 的 `getBoundingClientRect()` + `getComputedStyle()`**：
     量到的第一个数字（0 宽 / 594 高）会直接否决"固定高度"这类猜测。
- 锁：`tests/regression-20260919i.test.js` I1/I2（契约层）+ `tools/eval-e2e.cjs` E3（线上行高 ≤160、标题列 ≥100）。
