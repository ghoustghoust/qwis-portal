# 36-4 · 云端视频/播客观看足迹写回 —— 小 Spec

> 总框架：`spec.md`（36，G3）。状态：**待批准，未动工**（本文件只落现状与判据，未改任何代码）。
> 最后更新：2026-09-19

## 现状（实测）

| 事实 | 证据 |
|---|---|
| 云端读层**没有任何** `videos.watched_at` 写回 | `api/[...slug].js` 全文 grep `UPDATE videos SET watched_at` / `watched_at=` → **0 命中** |
| 本地有（唯一一份写回） | `server/routes/videos.js:81` |
| 后果 | 云端用户看过的视频/播客永不进「我的阅读·视频」；`lib/reading-filters.js:26` 的 `video` 分支只能靠 `videos` 表存在与否，无法区分"看过" |
| 关联缺陷 | **B18**：`videos` 表既无 `score` 也无 `translated_title` 列（线上列清单实测），所以视频侧目前不具备与文章同级的"足迹 + 评分 + 译文"能力 |

## 目标

T1 云端与本地同一份"看过"判定与写回（**一份实现**，放 `lib/`，两端 require；AGENTS §1 三端同步）。
T2 「我的阅读·视频」tab 的语义先定后做：它指的是**收藏**还是**看过**（当前实现两者都不完全等于，见 36-3 残留决策①）。

## 改动点（批准后才写）

1. 新增 `lib/video-watch.js`（或并入 `lib/reading-filters.js`）：`markWatched(db, videoId)` + `watchedCondSql()`，两端共用。
2. `api/[...slug].js` 的 `/api/videos/:id`（及 `/play`）路径接入写回，语义与本地一致（**幂等**：只在 `watched_at IS NULL` 时写，避免刷新覆盖首次时间）。
3. 是否给 `videos` 建 `watched_at` 之外的列（`score`/`translated_title`）→ 与 **B18 一起决策**，不在本包顺手建列。

## 判据与验收

- AC1 线上打开一个视频后，`GET /api/videos/:id` 返回体里 `watched_at` 非空，且该条目出现在「我的阅读·视频」；`npm run eval:e2e` 剧本要有这一条（目前无，属未覆盖面）。
- AC2 幂等性：连开两次，`watched_at` 保持第一次的时刻（回归锁断言"第二次不覆盖"）。
- AC3 **改前必红**（F2P）：基线上"云端打开视频后 watched_at 非空"必须红；注意按 B106 的教训——若该锁要读本轮新建的 `lib/video-watch.js`，改前构造必须用"回退修复点"而不是"文件不存在"，否则 F2P 判不出有效证据。
- AC4 三端一致性：白盒新增判据（**W22**，编号在 `docs/EVAL_GUIDE.md` §4.2 统一登记；本轮自查发现我此前在此处误占了 W18，与 `36-7` 的噪声判据撞号，已改）——同一份 SQL 谓词/写回不许在 `api/` 与 `server/` 各写一遍。

## 边界

- 不做无头浏览器、不做播放进度上报（那是 36-5 的"读完"语义）。
- 不在本包解决视频卡片的评分/译文（B18 另案）。
