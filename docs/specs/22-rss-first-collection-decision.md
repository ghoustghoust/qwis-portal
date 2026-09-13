# 决策：采集路线 = RSS 优先，拒绝自建爬虫（2026-09-13 用户拍板）

> 状态：**已确定**。取代早期"平台扫码拿 Cookie 自建采集"的探索方向。
> 背景：抖音/B站/YouTube/X 早期方案都是"管理者扫码获取 Cookie → 自建爬虫"，实践证明登录态不稳定、风控成本高。

## 决策内容

1. **任何平台的内容获取，第一步永远找现成稳定的 RSS 源**（官方 feed、wechat2rss/xgo.ing/rsshub 等桥接、第三方聚合）。
2. **RSS 故障的处理路径 = 网上寻找替代 RSS 源，不是自己写爬虫**。替换成本：改 sources 表一行 URL。
3. 自建采集仅保留两个存量例外：**抖音（Playwright 登录态，永不云端化）** 与 **B站 wbi 直连**（纯 crypto 已稳定，作为 B站 RSS 不可用时的兜底）。
4. 源健康度由熔断+报警体系兜底；源死了换源，不为单源修管线。

## 各平台现状对照（2026-09-13）

| 平台 | 现行方案 | RSS 来源 | 备注 |
|---|---|---|---|
| 公众号 | wechat2rss 托管 RSS ✅ | wechat2rss.bestblogs.dev / xlab.app | 单点依赖已知情接受 |
| X | xgo.ing 桥接 RSS ✅（219 推主） | api.xgo.ing/rss/user/* | 可用性观察中（T3-5） |
| YouTube | 官方 channel feed ✅ | youtube.com/feeds/videos.xml | 反爬假 404 见坑 #29 |
| B站 | wbi 直连（系统适配器）✅ | space.bilibili.com/{uid} 直接入 type=bilibili 源，**无需 RSS** | 匿名降级 ~85%；txt 新增 AI-GitHub 已建源 |
| 播客 | 官方/托管 feed ✅ | ximalaya/xyzfm/wavpub/acast/gcores | 小宇宙无官方 RSS（见未决） |
| 抖音 | Playwright 登录态（仅本地） | 永不 RSS 化（架构决策） | |

## 未决（T4 调研项）

- **小宇宙节目无官方 RSS**：HuggingFace 论文速递、跨国串门儿两个节目暂缺（节目页 HTML 不可解析）→ 找第三方桥或放弃。
- **jintiankansha（今天看啥）**：6 个公众号（苍何/程序员鱼皮/数字生命卡兹克/小林coding/36氪/硅星人Pro——恰为已退役 wemp 源）需 POST /column/{id}/pub 订阅激活后才出 feed，脚本化脆弱 → 人工浏览器订阅一次拿 feed URL 后入库。
- 乱翻书等 Apple Podcasts 页面无直接 RSS：用 iTunes Lookup API（`itunes.apple.com/lookup?id={id}` → feedUrl）转换，已验证可用。
