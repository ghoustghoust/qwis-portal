# 37-6 · 报警台视图（数据侧改动）与 38-G 的分工 —— 小 Spec

> 总框架：`spec.md`（37，G2）。状态：**待批准，未动工**。
> **分工**：界面结构/交互/视觉归 `docs/specs/38-admin-ia-refactor/38-g-monitor-alerts-console.md`；本文件只管"报警台要能问到什么数据"。两处不得重复描述同一要求。
> 最后更新：2026-09-19

## 现状（实测）

| 事实 | 证据 |
|---|---|
| 前端已存在并接了后端配置 | `web/src/components/AlertsTab.jsx`（`cfg = {channels, events, cooldownMin, recentLog, eventMeta}`，`:316`；`meta = cfg.eventMeta \|\| {}`，`:428`） |
| 但 `eventMeta` 是后端硬写的假值（见 37-2 #5）→ 报警台显示 4 个不存在的事件名，日志徽章落回原始 key | `api/[...slug].js:1575-1577` |
| 静默维度只有 `sourceId`（线上实读 `silence 条数 = 1`，形状 `{sourceId:777777,…}` 是测试污染残留，见 B44） | `settings.alerts` 只读实测 |
| 报警记录上限 50 条且无过滤（按事件/按源/按时间都翻不动） | `recentLog` 形状 |

## 本包只补三件事（都属数据契约，不重复 38-G）

1. **`GET /api/alerts/log` 支持过滤 + 分页**：`?event=&sourceId=&since=&limit=`，返回 `{items, nextCursor, total}`，数据源换成 37-3 的 `alert_events`（不是 50 条 `recentLog`）。
2. **静默维度扩展**：从"只有 sourceId"扩到 `event`（屏蔽某类事件）与 `group`（屏蔽某分组）；每次静默必须带过期时刻（无期限静默＝把报警关掉而忘记）。
3. **自愈联动字段**：列表项里带 `self_heal_state` 与一个可跳转的自愈记录标识（配合 35A），让"报警→系统已经做了什么"在同一行看得见。

## 判据与验收

- AC1 `GET /api/alerts/log?event=frozen_digest&since=…` 在服务端过滤后返回，前端不再"拉全量再本地筛"（否则 50 条上限会让筛选看起来失灵）。
- AC2 计数对账：报警台显示的条数 == 该过滤条件下 `alert_events` 的真实条数（DOM↔响应对账，走 `npm run eval:e2e` 路子）。
- AC3 静默带过期：写一条无 `until` 的静默必须 400；到期后事件自动恢复上报（回归锁 + F2P 按 B106 构造规则）。
- AC4 假值清除验证：接入 37-2 后，报警台事件列表里**不再出现** `fuse/stall/queue/error` 这四个不存在的名字（一条锁钉死）。

## 边界

- 不做图表/趋势（那是 38-B 首页与 38-G 的呈现决策）。
- 不在本包改渠道表单。
