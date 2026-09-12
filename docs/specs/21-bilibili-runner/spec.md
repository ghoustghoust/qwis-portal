# B站采集移植 runner（21-bilibili-runner）Spec

## 背景

B站源云端从未更新：wbi 签名被误判为"serverless 不可做"。实测确认：wbi 签名是纯 crypto（MD5 + 固定混淆表），GH runner 完全可以跑。本地已有成熟三链路实现（wbi 主链 + 合集兜底 + 搜索兜底）。

需求澄清结论：**无开放问题**——本地 `server/services/collectors/bilibili/index.js`（335 行）语义即需求基准，移植为 Turso 版并接入 collect-turso.js。

## 目标

- B站源（UP 主）在云端 runner 自动采集更新，视频写入 videos 表，阅读器视频流更新

## 功能需求

- **F1**：`api/_bilibili.js` Turso 版采集器：Cookie 从 Turso credentials 表读（无则匿名 buvid spi 申请，缓存 1h）；wbi 密钥缓存 30min + -403/-799 强制刷新重试；三链路 fallback（wbi → 合集 → 搜索）
- **F2**：collect-turso.js 接入：bilibili 从 UNSUPPORTED_TYPES 移除；getAdapter 增加 bilibili 分支；新增 saveVideos（videos 表 INSERT OR IGNORE，按 vid 去重）
- **F3**：熔断语义一致：失败计入 fail_count（阈值 3，非 YouTube 类）；-101/-2012 Cookie 失效错误归类为"登录态失效"（报警文案分类器已有该类别）
- **F4**：管理台诊断端点 `GET /api/sources/bilibili-diagnose`：Cookie 配置状态 + wbi 密钥刷新 + 登录态检查（移植本地 _diagnose）

## 非功能需求

- N1：runner 海外 IP 直连 B站 API（实测可达性；B站不封海外 IP 的一般 API）
- N2：无 Cookie 时匿名 buvid 降级可用（合集/搜索链路免登录）
- N3：不动播放直链（getPlayUrl 依赖登录 Cookie，保持本地专属）
- N4：双端一致：采集字段与本地完全一致（title/url/vid/cover/duration/author/intro/published_at）

## 不做的事

- 播放直链解析（getPlayUrl，登录态依赖，本地专属）
- 抖音采集（永远本地）
- B站评论区/弹幕等扩展数据

## 验收标准

- AC1：runner 对测试 UP 主采集成功，videos 表出现新行（vid 唯一）
- AC2：重复采集不产生重复视频（INSERT OR IGNORE）
- AC3：wbi 主链被风控时自动走合集/搜索兜底（日志可见）
- AC4：诊断端点返回 Cookie/wbi/登录态三态
- AC5：回归测试全绿
