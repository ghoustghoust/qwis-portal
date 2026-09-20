# 37-2 · 事件模型统一：一份事件表驱动两端与前台 —— 小 Spec

> 总框架：`spec.md`（37，G2/G3）。状态：**部分交付（09-21）—— G2a 一份表、G2b 假开关消灭、G2c 幽灵键不外露（改法与原文不同，见下）、AC1(W19)/AC2/AC3 已落；改动点第 4 条（缺键写回落库 + 审计）与 AC5（后台剧本加"开关数==表条数"）未做**。关联缺陷：**B45**（✅ 同批拔掉硬根因）、**B109**（✅）。
> UI 呈现归 `docs/specs/38-admin-ia-refactor/38-g-monitor-alerts-console.md`，本文件只管数据与判据。
> 最后更新：2026-09-21
>
> **09-21 交付读数**：W19 判据实测**收口前 19 处手写事件表成员 → 收口后 0**（`scanned=198`，4 个消费点全接上）；
> 收口前副本形状 = 云端 7 键 / 本地 5 键 / **健康摘要第三份 3 键（本 spec 原来没数到它）** / 前端说明第 4 份。
> **G2c 的改法偏离原文并说明理由**：原文写"要么恢复事件、要么从配置里删（属配置写，需点头）"——
> 实际改成**读时按表收敛**（`eventsState`），假开关同样消失而**零配置写**：根因是"列表由落库键集派生"，
> 把派生源换成表就够了；`UPDATE settings` 收益相同但不可逆，故不做。落库里那两键仍在（不碍事）。

## 现状（2026-09-19 夜实测：读两端 settings + 读四处代码，未做任何写）

| # | 事实 | 证据 |
|---|---|---|
| 1 | **事件表有两份代码实现，键集互不相同** | 云端 `api/_alerts.js:40-44 DEFAULT_EVENTS`（7）= `source_error, source_paused, daily_failed, collect_stalled, ai_failed, frozen_digest, mybrief`<br>本地 `server/services/alerts.js:301-306 EVENT_TITLE`（5）= 多 **`source_slow`**（开关在 `:11`，dispatch 在 `:360`），缺 `ai_failed / frozen_digest / mybrief` |
| 2 | runner 与 Vercel 共用云端那份（`tools/collect-turso.js:650` `require('../api/_alerts')`）→ "三端"实际是**两份代码 + 两份落库** | grep 实测 |
| 3 | **线上 `settings.alerts.events`** = 7 键，与云端代码一致；**本地 `settings.alerts.events`** = 7 键，但集合不同：`… , wemp_down, wemp_cookie_expired` | 只读 `SELECT value FROM settings WHERE key='alerts'` 两端各跑一次 |
| 4 | 本地 settings 里这两个键**对应的事件已于 2026-09-04 随 we-mp-rss 退役从代码删除**（`server/services/alerts.js:14` 注释自陈），配置没跟着清 → 管理台会渲染出两个**根本不存在**的开关（B109） | 代码注释 + 落库键集比对 |
| 5 | **B45 的真根因比原记述更硬**：云端 `GET /api/alerts/config` 的响应里 `eventMeta` 是**字面量硬写** `{fuse:'源熔断', stall:'采集停滞', queue:'队列异常', error:'系统错误'}`（`api/[...slug].js:1575-1577`），**根本不读 `cfg.eventMeta`** | 读码实测 |
| 6 | 后果：`eventMeta` 永远不落库也有值（假值），落库了也**读不到**（被字面量覆盖）；前端 `AlertsTab.jsx:138-143` 又自带第 4 份 `EVENT_DESC`（只覆盖 3 个事件）→ 事件名/标题/说明共**四处副本**，且四个键名 `fuse/stall/queue/error` 在任何事件表里都不存在 | 前端与后端比对 |

## 目标

G2a 事件枚举**全库一份**：`lib/alert-events.js`（拟建）导出 `{key: {title, desc, defaultOn, ends}}`，本地/云端/runner/前端四个消费点都从它派生。
G2b 假开关消灭：`eventMeta` 必须**读落库值**，默认值来自事件表而不是响应里的字面量。
G2c 幽灵键清理：本地 `settings.alerts.events` 里的 `wemp_down/wemp_cookie_expired` 要么恢复事件（若 we-mp-rss 仍在用），要么从配置里删（B109，属配置写，需点头）。

## 改动点（批准后才写）

1. ✅ **已做 09-21**：建 `lib/alert-events.js`，本地 `server/services/alerts.js` 的 `EVENT_TITLE` 与云端 `api/_alerts.js` 的 `DEFAULT_EVENTS` 改为从它派生（**两份手写表都删了**）。交付时多收了第三份：`server/routes/health.js` 的健康摘要自带 3 个键 + 自己一份默认值，同样改为 `eventsState()`。
2. ✅ **已做 09-21**：`api/[...slug].js` 的 `eventMeta` 字面量（`fuse/stall/queue/error`）删除 → `eventMeta: eventMetaTable(cfg.eventMeta)`，**键集恒等于表、落库有覆盖值才优先**；本地 `server/routes/alerts.js` 同源（`alerts.eventMeta()`）。
3. ✅ **已做 09-21**：前端 `EVENT_DESC` 删除，改消费 `GET /api/alerts/config` 的 `eventMeta[key].desc`（一份事实一次传输；`eventMeta` 的值从字符串升成 `{title, desc}`，日志徽章那处兼容两种形状）。
4. ⬜ **未做（有意）**：落库补齐（缺键按 `defaultOn` 写回 + 审计）。原因：`eventsState()` 已在**读时**补默认值，对用户等价，而写回是一次生产配置写；它与 37-4（云端补 `source_slow` 的 dispatch）同批做更划算。

## 判据与验收

- ✅ **AC1（白盒 W19 已实装）**：判据 `lib/alert-events.js#findAlertEventCopies`，白盒与锁共用同一份。收口前 19 处手写成员 → 0。
- ✅ **AC2（负向自证）**：V2 塞一份相邻成组的手写表 → 必红且点名 `file:line`；注释/字符串里的事件键不许红。
- ✅ **AC3（回归锁 `tests/regression-alert-events.test.js` V1~V7）**：V3 是本批新加的反向锁 —— **分散在两处的单键不许算成第二份表**（判据第一版按整文件计数，把 `api/[...slug].js` 两处 settings 命名空间的 `mybrief:` 拼成假表，假红 2 处）；V6 是行为锁：同一份"最坏落库"（真事件只关一个 + 两个幽灵键 + 一个自定义标题）分别喂本地路由与云端 handler，两端 `eventMeta`/`events` 键集必须相同且等于表（**改前必红**：改前云端返回四个硬写的假键）；V7 断言 `dispatch` 真读开关。
- ◐ **AC4（F2P）**：本轮排期未跑，下批补（基线缺本轮新建文件时不许判成"锁假了"）。
- ⬜ **AC5（端到端）**：后台剧本"事件勾选框数量 == 事件表条数，且勾选后重启仍生效"未加。

## 边界

- 不改渠道模型（37-1）、不改 payload 结构（37-3）、不动投递逻辑。
- `source_slow` 与 `slowThresholdMs`（本地独有）在合并时必须保留能力，不许"为了对齐"把本地独有的事件删掉——**对齐方向是取并集**，这也是取并集后云端要补 dispatch 的原因（属 37-4 覆盖面扩展）。
