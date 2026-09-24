# 取证 · 级3 每源预配额（44 号 spec 步1）改前真值与交付证据

> 最后更新：2026-09-24
> 性质：一次性只读探针产物（AGENTS §3 第 7 条）。全部数字来自本文件「取法」列写明的方法，
> 零生产写、零 AI 消耗（除注明者）。**改后**的生产真值读数见文末「待补」，本文件记录的是改前基线。
> 复跑方式：探针脚本按注现写现跑（`NODE_PATH="D:/全网情报系统/node_modules" node <文件>`），不入库。

## 一、候选池真值（改前基线）

| 读数 | 值 | 取法 |
|---|---|---|
| 24h 窗口候选池 | **2,688 篇 / 469 个活跃源**（平均 5.7 篇/源） | 谓词逐字复刻 `runDailyAi`：`published_at ∈ [now-24h, now)` + `enabled=1` + `notNoiseSql(s)` |
| `LIMIT 500` 实际覆盖源数 | **94 源 = 20%** | 同一 SQL 取 500 行后 `COUNT(DISTINCT source_name)` |
| 池内第一大源 | Top stories - Google News 70 篇；其后 Reddit·Linux 70 / Phys.org 65 / **openclaw commits 60** | 同谓词按源计数 |
| 每源 cap 全池效果 | ≤1 → 469 ｜ **≤2 → 742** ｜ ≤3 → 937 | Σmin(该源篇数, cap) |
| cap=2 作用于当前 500 坑 | 剩 **148 篇，源覆盖仍是 94（一源不丢）** | JS 侧模拟 `applySourceQuota` |
| 24h 全库入库 | 7,879 篇 / 574 源（含热榜与聚合） | 按 `published_at` 计数，不加候选谓词 |
| 批次构成（24h 入库占比） | 09-20 tidings 3,289 ｜ 08-28 老批 2,754 ｜ 09-04 wechat2rss 1,571 | 按 `sources.created_at` 日期分组 |

## 二、被本轮推翻或修正的旧读数

| 旧说法（出处） | 实测 | 结论 |
|---|---|---|
| 「AIHOT 热榜躲过 `notNoiseSql`，独占 500 坑 18%」（交接文档 §3 P0-1） | id 25/26 的 `extra.aggregator=1` 命中噪声第②轴，**根本不在池内**；id 27「AIHOT 日报」`extra` 为空仍在池 | 前提失效。噪声判定源共 31 个 |
| 「≤2 = 570 篇，比现在还多，治不了截断」（交接文档 快照③） | 742 是「不设全局上限」的算法；cap 后保留 500 上限则**调用量不变、覆盖 94→约 450** | 口径错，已在交接文档更正 |
| 「两期耗时 8.1 / 8.5 分钟」（`stats.elapsedMin`） | 表达式 `Math.round(ms/600e2)/10` = 真值 ÷10 → 真实 **81 / 85 分钟**；反推自洽：filter 中位 3.3s + 4s 串行间隔 ≈ 每篇 7~12s × 筛 233/355 篇 ≈ 45min 闸门 | 单位 bug，已修两处（锁 P7） |
| 「失败放行 9 篇里一半是该剔的垃圾」 | 该剔 **5 篇**（commit 形 4 + V2EX 咖啡机 1）；The Verge「麦当劳 drive-thru 广告」是 **687 字真新闻报道**，非广告 | 结论修正 |
| 「openclaw commits 是未知源」 | 库里 id **974**，来自 `opml/tidings-ai.opml:29`（`tidings-engineering`/`tidings-all` 同样含），09-20T02:55Z 随 629 源批量导入；全库 `/commits/` **仅此 1 条**，但同批另有 11 条 `releases.atom`（id 978~988） | 已归因；releases 是有效信息，不得一并砍 |

## 三、语料与标签存量（决定步2 与「统计学习」路线可行性）

| 读数 | 值 |
|---|---|
| 全库文章 / 有 `score` | 30,132 / **8,506（28.2%）**，其中 **5,203 条恰好等于 0**（`api/_ai.js:365` `Number(j.totalScore) \|\| 0` 把"模型没给分"静默记成 0 分 → "打了 0 分"与"没打分"同形） |
| 真实行为标签 | `read_at` **246** ｜ `later` **3** ｜ 逐条动作端点只有 read / later / favorite / translate，**无 dislike / "这条不该上"** → 无负反馈出口 |
| 跨源同链接 | 原样相同 url 被 ≥2 源发过 = **0 组**（`articles.url` UNIQUE + `INSERT OR IGNORE` 在入库层销毁）；去参数后 28 组，最大一组 `mp.weixin.qq.com/s` 394 源属截断伪信号 |
| 标题近重复（Jaccard≥0.6） | 24h 池内 ≥3 篇且 ≥3 源的通稿簇 **14 个 / 66 篇 = 1.9%**；**单源独占 2,966 / 3,396 = 87%** |
| AI 相关性词表面 | 用现成 `lib/ai-relevance.js` 判 cap 后 146 篇：仅 **26 篇命中**（Al Jazeera / Phys.org / HN 全被判"不相关"）→ 词表不可当预筛闸 |
| AI 调用耗时（`ai.stats` 滚动 500） | filter 111 调用 / 6 败 / 中位 3.3s / p90 7.0s ｜ analyze 105 / 8 / 4.7s ｜ translate 231 / 42 / 4.6s ｜ term-extract 53 / **31 败（58%）** / 3.6s |
| 节流间隔 | `lib/ai-throttle.js:4` `DEFAULT_GAP_MS=4000`，生产 `settings['ai.minIntervalMs']` **未设置** → 每篇墙钟的 40~55% 是间隔不是模型 |

## 四、宽池 IO 代价（清我自己引入的账）

直读生产 Turso，每档 3 次取中位：

| 形状 | 往返 | 载荷 |
|---|---|---|
| 2000 行（轻量列，交付后的形状） | **388ms** | 1,042KB |
| 500 行（轻量列） | 215ms | 247KB |
| 500 行（旧写法 `SELECT a.*` 含 `content_html`） | 170ms | **3,433KB** |

结论：抬 4 倍行数只多 ~173ms，远在 Vercel 读层 30s / `daily-generate` 60s 预算内；
**真正省的是收窄列**——同 500 行载荷 3.4MB → 247KB（约 1/14）。runner 侧深析改为按 id 单取正文，
只有过了初筛的幸存者才付这份字节（同 `runWeekly` 的两步走）。

## 五、交付证据（09-24）

| 项 | 读数 |
|---|---|
| `npm test` | **621 / 621**，EXIT=0（步1 前基线 609） |
| push-CI（`ci.yml`） | `6c40812` `test` conclusion=**success**；`d2eefda` `test` conclusion=**success** |
| `collect.yml` 最近批次 | schedule 轮 `completed/success`；dispatch 轮各 AI job 按 `if` 正确 `skipped` |
| Vercel 部署 | deployments 最新一条 state=**success**（含 `6c40812`+`d2eefda` 的 `dc57332`） |
| `node smoke-test.js` | 通过 **20** / 失败 **0** |
| `npm run lint:docs` | **0 错** 3 警（唯一实质警 = 步2 拟新增 `lib/filter-rules.js` 尚未创建） |
| 执行锁 E1~E3 | 真 `spawn` 生产模式：E2 同样 12 个坑、不配额覆盖 **3 源** → cap=2 覆盖 **9 源**；E3 深析请求含正文标记、初筛请求不含 |

## 六、待补（本文件留口，下轮回填）

1. **改后生产真值**：run `35964421731`（`daily-ai-evening`，06:25:34Z 起，`in_progress`）跑完后直读
   `daily_reports.stats.prescreen` —— 预期 `keptSources` 从 ~94 显著抬升；
   **`truncated` 预计仍为 true**（合格数 742 > 上限 500，调用量不变），预算/gap 议题按用户裁定暂缓。
2. **读层 HTTP 实测**（`/api/meta` commit == origin/main、`/api/daily` 出报形状）：
   09-24 06:25Z 起本机代理不可用（`127.0.0.1:12000` 拒连，7890/7897/10809/8118 亦不通；
   `*.vercel.app` 直连不通而 `api.github.com` 通），**待代理恢复后补测**——这一步没做就是没做，不许用 CI 绿替代。
