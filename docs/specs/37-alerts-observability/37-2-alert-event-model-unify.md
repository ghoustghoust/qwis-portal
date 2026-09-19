# 37-2 · 事件模型统一：一份事件表驱动两端与前台 —— 小 Spec

> 总框架：`spec.md`（37，G2/G3）。状态：**待批准，未动工**。关联缺陷：**B45**（事件勾选不生效）、**B109**（幽灵事件键，本轮新查）。
> UI 呈现归 `docs/specs/38-admin-ia-refactor/38-g-monitor-alerts-console.md`，本文件只管数据与判据。
> 最后更新：2026-09-19（本轮实测复核）

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

1. 建 `lib/alert-events.js`，本地 `server/services/alerts.js` 的 `EVENT_TITLE` 与云端 `api/_alerts.js` 的 `DEFAULT_EVENTS` 改为从它派生（**删掉两份手写**，不是包一层留着）。
2. `api/[...slug].js:1575` 改为 `eventMeta: cfg.eventMeta || ALERT_EVENTS.meta()`；本地 `server/routes/alerts.js:16` 同源。
3. 前端 `EVENT_DESC` 删除，改为消费 `GET /api/alerts/config` 的 `eventMeta.desc`（一份事实一次传输）。
4. 落库补齐：首次读时若 `events` 缺新事件键，按 `defaultOn` 补齐并写回（**写回要有审计**，别静默改生产配置）。

## 判据与验收

- **AC1（白盒新判据，拟 W19）**：从字面量派生扫描"事件键集合"——若 `api/_alerts.js`、`server/services/alerts.js`、`lib/alert-events.js` 里出现 ≥2 份手写事件表即红并点名。判据纪律同坑 #58/#59/#63（剥注释、只认字符串字面量、排除自身）。
- **AC2（负向自证）**：往 `api/_alerts.js` 塞一个手写事件键 → W19 必须红；只在注释里写事件名 → 不许红（证明它看的是代码不是文本）。
- **AC3（回归锁，`tests/` 内，配 `坑 #NN` 标记同批）**：断言 `GET /api/alerts/config` 的 `eventMeta` 键集 == `lib/alert-events.js` 的键集（**行为锁**，不是文本比对）；并断言"落库改一个事件的开关 → 响应里跟着变"（这条在改前必红，因为现在被字面量覆盖）。
- **AC4（F2P）**：按 **B106** 的构造规则出改前红证据（基线缺本轮新建文件时不许判成"锁假了"）。
- **AC5（端到端）**：`npm run eval:e2e` 后台剧本里加一条：事件勾选框数量 == 事件表条数，且勾选后重启读层仍生效（P2P 集合）。

## 边界

- 不改渠道模型（37-1）、不改 payload 结构（37-3）、不动投递逻辑。
- `source_slow` 与 `slowThresholdMs`（本地独有）在合并时必须保留能力，不许"为了对齐"把本地独有的事件删掉——**对齐方向是取并集**，这也是取并集后云端要补 dispatch 的原因（属 37-4 覆盖面扩展）。
