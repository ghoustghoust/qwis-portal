# 37-3 · 结构化报警 payload 与 `alert_events` 表 —— 小 Spec

> 总框架：`spec.md`（37，G2/G5）。状态：**待批准，未动工**。关联：B43/B44、spec 35A（自愈事件流）。
> 最后更新：2026-09-19（本轮实测复核）

## 现状（实测）

| 事实 | 证据 |
|---|---|
| 报警载荷只有"人话标题 + 120 字错误摘要" | `api/_alerts.js` `dispatch()` 载荷；`sourceAlert()` `:234`；`collectStalled()` `:258` |
| 投递记录只有 `{at,event,title,results:[{channel,ok,error}]}`，且**只留 50 条**在 `settings.alerts.recentLog` | 线上实读：`recentLog 条数 = 50`，最后一条 `2026-09-19T22:20:31` `frozen_digest`「熔断待处理清单（186 个源）」`results=[{channel:'TEST', ok:false, error:'fetch failed'}]` |
| **`alert_events` 表不存在** | `lib/db.js` / `server/db.js` DDL grep → 0 命中 |
| 没有源 id、没有触发参数、没有代码位置、没有建议动作、没有自愈状态 → 用户批注⑳要的"具体报错参数 + 解决方案 + 是哪里的代码"目前**一条都给不出** | 载荷形状比对 |
| 分类器与 `classifyError(errMsg, sourceType)`（含 `advice` 建议动作）**已经存在**，但只在采集失败路径用；`advice` 没进报警载荷 | `server/services/alerts.js:309+` 与 `api/_alerts.js` 同规则两份手写（三端同步义务写在注释里） |

## 目标

G2 每条报警可定位：**哪个源 / 哪次运行 / 哪个模式 / 错误类别 / 错误参数 / 哪段代码 / 建议做什么 / 系统是否已自动做过**。

## 改动点（批准后才写）

1. 新建 `alert_events` 表（`lib/db.js` + `server/db.js` **同一份 DDL**，两库都建）：
   `id, at, event, severity, source_id?, run_id?, mode?, err_kind?, err_param?, code_ref?, suggestion?, self_heal_state?, delivered_channels?, raw_digest?`
   —— `recentLog` 保留一个周期做兼容读，但**不再是唯一事实**。
2. `dispatch()` 统一入口写入 `alert_events`，字段来源固定：`err_kind/suggestion` 由 `classifyError` 出（分类器收进拟建的 `alert-error-class.js`（落在 `lib/` 下）一份，替换现在两端各写一遍的两份）。
3. `code_ref` 取值口径：**函数名 + 代码片段锚点**，不写 `file:行号`（坑 #62：手写行号每改必漂，第 6 次教训）。
4. `self_heal_state` 由 spec 35A 的自愈记录出（未重试 / 已重试 N 次 / 冷却中 / 已恢复），使"报警—自愈"成闭环而不是两本账。
5. 端点：`GET /api/alerts/log`（既有 `api/[...slug].js:1582` 附近）改为读 `alert_events`，支持 `event/sourceId/since` 过滤。

## 判据与验收

- AC1 真实样本可定位：任选一条 `source_paused`，`GET /api/alerts/log` 返回体里 8 个字段至少 6 个非空，且 `suggestion` 与 `err_kind` 对得上（**用真实事件，不许拿构造数据交差**）。
- AC2 分类器单实现：白盒判据（可与 37-2 的 W19 同批评估）——`classifyError` 的规则字面量在 `api/` 与 `server/` 出现两份即红。
- AC3 迁移不丢数：建表后 `recentLog` 的 50 条历史一次性回填进 `alert_events`，条数对账（±0）；未回填不许下线 `recentLog`。
- AC4 回归锁：断言"写 `alert_events` 与写 `recentLog` 同事务/同结果"，防止两本账漂移；配 F2P（按 B106 构造规则）。
- AC5 端到端：后台报警台剧本读到的条数 == `GET /api/alerts/log` 返回条数（DOM↔响应对账，`eval-e2e` 既有路子）。

## 边界

- 不引入外部监控栈（37 域 §边界）。
- 不做 oncall/分级排班；`severity` 先只用于筛选。
- 不自动执行需授权的修复动作（自愈只做重试与冷却）。

## 需要用户拍板

1. `alert_events` 的保留策略（建议按 `settings.data.retentionDays`，但**与文章保留分开算**——报警历史是排查证据，删不得那么快）。
2. 是否给 `daily_reports`/`weekly` 这类"产物级"事件同一张表（同表则一处可查全部；分表则产物线更干净）。
