# `cloud/` — 第三方云队列的部署件与状态

B 站 / 抖音 / 微信公众号三条队列的**远端 PHP 端点源码 + 队列状态文件**。本地与云端不直连，靠这组 HTTP 端点做 push/pull 中转。

## 内容

| 内容 | 说明 |
|---|---|
| `_queue_lib.php` | 三条队列共用的读写与鉴权库（被下面三个端点 require） |
| `bilibili-video-queue.php` | B 站视频队列端点 |
| `douyin-video-queue.php` | 抖音视频队列端点 |
| `wechat-rss-queue.php` | 公众号 RSS 队列端点 |
| `bilibili-queue.json` `douyin-queue.json` `wechat-queue.json` | 队列状态文件，**被 git 跟踪** → 意味着每次队列状态变化都会产生一次提交差异。这是设计缺陷（运行态不该进版本库），但现状如此，改动前先确认没有工具靠读 git 历史取状态 |
| `token.json` | 队列访问凭据，48 位 token。**未被 git 跟踪**（`git ls-files cloud` 里没有它）→ 凭据只存本地，符合 AGENTS.md §2.6 的三处同步口径。**别把它加进版本库** |

## 谁在用它

`server/services/queue/poller.js`（本地轮询）、`api/[...slug].js`（云端读层）、`tools/http-shortcuts-template.json`（安卓提交链路模板）三处都引用这组端点。

## 当前实况

`settings.queue.enabled = false`、`intervalMin = 10` —— **通道代码活着但开关关着**，轮询 job 不会注册（`server/services/scheduler/index.js:128`）。所以这个目录现在处于"随时可启用"而不是"已废弃"。基址 `https://api.qianmeng.news` 存在 `settings.queue.baseUrl`，不在本目录硬编码。

**不放什么**：新的凭据（进 `.env` 或三处同步体系）；运行态以外的缓存数据。

**状态**：active（当前停用）
