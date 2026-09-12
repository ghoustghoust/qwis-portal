# 变更记录：设置写 API 上云（13-settings-write）

> 日期：2026-09-11 ｜ 类型：功能移植（P0-1）｜ 流程：mew-spec 四件套全走完

## 改了什么

| 端点 | 说明 |
|---|---|
| `PUT /api/settings` | 分区合并写：intervals/opml/queue/daily/hot/data/views/bilibili.cookie |
| `GET/PUT /api/settings/daily` | 日报设置：窗口/时间/来源勾选/focus（两种写法）/栏目管理 |
| `GET /api/settings`（补齐） | 原只回 daily+intervals → 补全 12 分区（敏感字段只回 Configured，ai 区带 `locked:"env"`） |

## 关键决策（防再犯）

1. **云端 AI 配置锁定 env-only**：PUT 携带 `ai` 区直接 400。起因：Turso `settings.ai` 残留污染 apiBase（指向 deepseek 域名）覆盖 env，导致云端 AI 401 被误诊为"IP 绑定"。
2. **黑名单系统键**（auth.secret / admin.passwordHash / backup.latest / cloud.collect）携带即 400。
3. **先校验后写入**（零部分写入）；敏感键（queue.token）留空不覆盖。
4. **测试方式**：直接 mock req/res 打 serverless 真实 handler（tests/regression-cloud-settings.test.js，10 用例），不碰本地路由（本地本来就有，测了等于空转——坑#18）。

## 验收证据

- 回归测试 10/10 绿（真实 Turso）
- 线上实测：写入读回 / 黑名单 400 / AI 锁定 400 / 审计留痕 / ai/ping 无恙
- 存量回归 4 项失败经干净树对照实验证明与本次无关（P6-5 顺手修复对齐新文档结构；TQ-3/TQ-11/P6-3 taskQueue 重试语义已立项 P2-10）

## 影响面

- 管理后台「日报设置 / 视图保存 / 队列配置 / 数据保留天数 / 热榜开关 / OPML」Tab 云端全部可保存生效
- 无前端改动；本地端行为不变
