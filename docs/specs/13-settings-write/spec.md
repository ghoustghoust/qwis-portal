# 设置写 API 上云（13-settings-write）Spec

## 背景

云端（Vercel + Turso）目前 settings 只有精简只读 GET，导致管理后台「保存视图 / 日报设置 / 队列配置 / 数据保留天数 / 热榜开关 / OPML 配置」等 Tab 的保存按钮全部失效（404）。本地 Express 已有成熟实现（分区合并写、敏感字段留空不覆盖、先校验后写入、views 整体替换校验）。

2026-09-11 事故：Turso `settings.ai` 残留污染 apiBase 覆盖 env 导致云端 AI 401。用户已拍板：**云端 AI 配置锁定 env-only，禁止经 API 写入**。

## 目标

- 云端管理后台涉及设置的各 Tab 全部可保存并真实生效
- 写语义与本地双端一致（同一请求打到任一端产生相同最终状态）
- 敏感系统键永不可经 API 读写

## 功能需求

- **F1**：`PUT /api/settings` 分区合并写，支持区：`intervals` / `opml` / `queue` / `daily` / `hot` / `data` / `views` / `bilibili.cookie`（写 credentials 表）。语义与本地一致：对象区读-改-写合并、敏感键（queue.token 等）留空不覆盖、views 整体替换并校验（数组 ≤20、name 非空 ≤20 字、filter 为对象）、data.retentionDays 限 1-90 整数
- **F2**：`GET/PUT /api/settings/daily`：窗口 / 生成时间 / 来源勾选 / focus 源 / columns 栏目管理，校验与本地一致（time 须 HH:MM、windowHours 正数）
- **F3**：敏感系统键黑名单（`auth.secret` / `admin.passwordHash` / `backup.latest` / `cloud.collect` 等）不可经本 API 读写；携带黑名单键的请求视为非法
- **F4**：AI 区云端锁定：PUT 携带 `ai` 区时返回 400 并提示「云端 AI 配置锁定为环境变量」；GET 只返回 env 派生状态
- **F5**：每次成功写入记录审计日志（action 形如 `settings.update`，detail 记录写入了哪些区）
- **F6**：全部校验先于任何写入（防部分写入）

## 非功能需求

- N1：全部为单键值 upsert，serverless 10s 限制内轻松完成
- N2：需 Bearer JWT 鉴权（复用现有中间件与公开白名单机制，无需改动）
- N3：双端一致性——同一请求打本地或云端，最终 settings 状态一致
- N4：并发安全——单键粒度读-改-写；不同键互不影响；允许并发写不同区

## 不做的事

- 不改任何前端组件（现有调用天然适配）
- 不做 settings 版本历史 / 回滚
- 不做本地调度器 reschedule 联动（云端无调度器；intervals 变更由 runner 下轮自然生效）
- 报警渠道写（属 15-cloud-alerts）
- B站 Cookie 虽写库，但云端暂不采集 B站（属 19-bilibili-runner）

## 验收标准

- AC1：线上 `PUT /api/settings {views:[...]}` 后 GET 能读回；非法 views 返回 400 且任何区都未被写入
- AC2：线上 `PUT /api/settings/daily` 改 time/windowHours 后 GET 读回生效；runner 次日日报按新窗口生成
- AC3：PUT 携带黑名单键返回 400 且不产生任何写入
- AC4：PUT 携带 `ai` 区返回 400 且提示锁定原因
- AC5：`PUT {queue:{token:''}}` 后 GET 仍显示 `tokenConfigured: true`（留空不覆盖）
- AC6：成功写入后 `GET /api/audit` 可见对应审计记录
- AC7：回归测试通过（真实路由 HTTP 驱动）
