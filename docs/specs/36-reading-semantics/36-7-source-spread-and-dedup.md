# 36-7 · 同源打散与噪声口径（含 H7 云端 dedup）—— 小 Spec

> 总框架：`spec.md`（36，G1/G5）。状态：**部分交付 —— G7a（噪声口径单实现）+ G7c（足迹排噪声 + 开关）已随 B107 于 2026-09-21 落地；G7b（打散/事件折叠）未动工**。
> 最后更新：2026-09-21
>
> **09-21 交付读数（改前红→改后绿的证据在 `tests/regression-noise.test.js` 与 `npm run eval:whitebox`）**：
> `lib/noise.js` 建成，W18 判据实测**收口前 50 处命中 / 收口后 0**（`scanned=197`、14 个消费点全接上）。
> 现库口径重算（旧库那组 25,142/71% 已随 09-20 换库失效）：文章 60,309、源 1,325、噪声源 31、足迹 214 条其中噪声 107（**50%**）。
> 性能（云端只读探针，改前后同轮量）：足迹计数走 `NOT EXISTS` 后 90~99ms（现役快路径 93ms，同量级）；
> 首屏两段式 stage1 95→154ms。前提：**"无用户筛选"必须在挂噪声条件之前判**，否则 T3-3 快路径在默认态永不进入。
> 交付中新抓两条两端分叉登记为 **B134**（本地 5 个筛选组合恒空 / 云端筛选下稍后读重复两行），已一并修掉。
> **仍待拍板**：G7b 打散走"同源最小间隔"还是"事件折叠上云（H7）"，以及打散是否只对未开 spotlight 的普通视图生效。

## 现状（实测）

| 事实 | 证据 |
|---|---|
| 排序确实是时间（不是"按源块"） | `api/[...slug].js` smart 表达式 = 时间戳 + `spotlight×3d`，`ORDER BY … DESC, a.id DESC`；无 source 分组 |
| 相邻同源的真正来源 | ①同源成批发文；②时间戳并列后按 `id DESC` → 同一次抓取天然连号（实测单刻最多 **132 条**同 `04:00:00.000Z`，跨 12 源）；③spotlight 加权把 31 个源整体置顶（今日 3234 条里 468 条来自它们） |
| 云端 `/api/articles` **没有 dedup 分支** | 挂案 **H7**：重复事件不折叠（本地有） |
| **噪声口径被手写复制** | ✅ 09-21 收口：W18 判据实测**收口前 50 处命中 → 收口后 0**。收口前的分布：`api/[...slug].js` 7 份 + 精选/热搜两轴单用 2 份、`api/daily-generate.js` 1、`server/routes/{articles,status,reading}` 3、`server/services/{hot,aihot/enrich,aihot/backfill,scheduler/jobs/fulltext,ai/daily,collectors/fetcher}` 7、`tools/{collect-turso ×4,generate-snapshots ×2,seed-hotlist,fix-hotlist-times}` 8、`lib/retention.js` 2。副本之间实测少两轴的那份在云端 `handleArticlesReadAll`（→ "全部标已读"标掉列表里看不见的条目） |
| 「我的阅读」里 hotlist 占多数 | 旧库（09-19 实测）：`type=all` 的 25,142 条里 17,860（**71%**）来自 hotlist；**现役库 09-21 重算**：足迹 214 条里噪声 107（**50%**），且阅读路径当时仍**没套**噪声口径 → 现已两端默认排除 + `include_hot=1` |

## 目标

- G7a 「噪声」（热榜聚合源与 aggregator）判定**全库一份实现**，三端引用同一构造函数。
- G7b 阅读器"看起来同源扎堆"可解释、可调：给 smart 结果加"同源最小间隔"或事件折叠上云（H7）。
- G7c 「我的阅读」不再被热搜足迹淹没（是否排除噪声由用户拍板，见下）。

## 改动点（批准后才写）

1. ✅ **已做 09-21**：新建 `lib/noise.js`。落地时的三件套名字按实际调用点调整过 ——
   `isNoiseSql` / `notNoiseSql` / `notNoiseExistsSql` / `notNoiseJoinSql` / `isNoiseSource`（外加单轴
   `hotlistCondSql` / `notHotlistSql` / `aggregatorFlagSql` / `aggregatorCondSql`）；
   `api/`、`server/`、`tools/`、`lib/retention.js` 全部改为引用它，**删掉 25 处手写副本**（不是再加一层封装留着旧的）。
2. ✅ **已做 09-21**：白盒 **W18 实装**（判据就是 `lib/noise.js#findNoiseViolations`，与锁 N1~N4 同一份）。
3. ⬜ 未做 · 打散策略：默认窗口内同源 ≤1 条/间隔 K（K 可调），或直接上"事件折叠"（与 H7 合并）——两者都必须在同一份排序构造里实现，不许前端再排一次。

## 判据与验收

- ✅ AC1 `grep` 层面：噪声判定在 `api|server|tools` 里**只剩 `lib/noise.js` 一份**字面量（由 W18 机器判，不靠人眼）。实测 50 → 0。
- ✅ AC2 负向自证：N2 塞 6 种形态（AND 式/OR 式/NOT EXISTS 式/单轴/无别名）必红且点名文件行号；N4 摘掉唯一实现的引用 → `missingImport` 点名；N3 五个合法反例不误红。
- ◐ AC3 行为锁：「我的阅读」的同一份夹具已在本地与云端跑出**同一集合与同一顺序**（N8/N9 共用一张 11 组合期望表）；"同一秒 132 条同源"的打散阈值断言属未做的第 3 项，未写。
- ✅ AC4 「我的阅读」的计数与列表在噪声开关两种状态下都自洽：N8/N9 对 `tab=all&type=all` 两态断言 `counts.all == items.length`；type 口径仍走 `lib/reading-filters.js` 那一份。

## 需要用户拍板

1. ✅ **已拍板并已交付 09-21**：「我的阅读」排除 hotlist/aggregator + 「含热榜」开关（`include_hot=1`）。
   只排两轴，**不**顺手排 muted/未收录（批准说的是热搜淹没足迹，N8 把这条边界钉住）。
2. ⬜ 未拍 · 打散走**同源最小间隔**还是**事件折叠上云**（后者改动大，与 H7 一并做才划算）。
3. ⬜ 未拍 · 打散是否只对"未开 spotlight 加权"的普通视图生效（加权置顶与打散天然冲突）。
