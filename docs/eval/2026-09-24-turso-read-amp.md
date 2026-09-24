# 什么在大量读 Turso · 以及 170MB 到底是哪个体积（2026-09-24 只读探针）

> 生成时间：2026-09-24T15:18Z。用户点名题：「探索一下我们的什么内容在大量读取 Turso 的读取，这是老库达到上限的主要原因。新库现在已经用了 170m 了」。
> **全程只读**：六个探针脚本只跑 `SELECT / PRAGMA / EXPLAIN`，每条执行前有只读断言（写语句直接抛）。零生产写、零模型调用。
> 探针（`tools/_*.cjs` 按仓库约定 gitignore，一次性工具不落库）：
> `_probe-turso-read-amp.cjs`（体积归因 + 代表查询计划）· `_probe-turso-read-amp2.cjs`（页/空闲页/列字节/score 类型）· `_probe-turso-read-amp3.cjs`（videos·archive·pending + 日增）· `_probe-turso-read-amp4.cjs`（按源归因，用 `lib/noise` 同一实现切轴）· `_probe-daily-read-cost.cjs`（早报读取对照）· `_probe-retention-gate.cjs`（删除闸当前状态）· `_probe-reclaim-size.cjs`（放行一次能回收多少，谓词取 `lib/retention` 唯一实现）· `_probe-recurring-scans.cjs`（cron 驱动查询的计划）
> ⚠️ **探针自己的读放大也要记账**，见 §七。

## 一、先把"体积"这个词拆成四个不同的数（它们互不矛盾）

| 量 | 实测 | 谁在意这个数 |
|---|---|---|
| **逻辑库文件** = `page_count × page_size` = 281,918 × 4,096 | **1,101.2 MB** | 读路径按页取数，扫描型查询的成本单位是它 |
| 其中**空闲页** `freelist_count` | **453.1 MB** | 09-20 那次批量 DELETE 留下的洞；**不 VACUUM 就永远占着文件** |
| 已用页（1,101.2 − 453.1） | 648.1 MB | 真实存量 |
| **Turso 控制台**显示 | 用户报的 **170 MB** | 计费/配额展示位（推断：对象存储里的压缩帧，不是逻辑页 —— 本文不去证这个等式，因为配额维度另有其账，见 §四） |
| 全部文本列字节合计（`LENGTH(CAST(x AS BLOB))`） | ≈605 MB，其中 **`content_html` 587.0 MB = 97.0%** | —— |

> 为什么强调字节口径：`LENGTH(TEXT)` 返回**字符数**，中文正文按字符报会把体积低估约 3 倍。本项目所有正文测量一律用 `LENGTH(CAST(col AS BLOB))`。

现役 `articles` = **35,446 行**（两次探针之间涨 41 行），列字节：content_html 587.0 / summary 6.1 / url 2.6 / cover 2.3 / title 2.2 / translated_content 0.4 / reason 0.3 / tags+word_count ≈0.1 MB。`articles_archive` **0 行**（归档从未跑过，与 H26 一致）、`videos` 2,878 行、`daily_reports` 57 行 / sections 合计 1.5 MB。

## 二、谁产生体积：**推翻"腹泻源撑爆库"这个直觉**

近 24h 落库 **10,916 篇 / 正文 99.6 MB**（url 去重后仍是 10,916 —— 跨源重复确实为 0，与既有读数一致）。按**阅读器降噪轴**（`lib/noise.js` 同一实现，不是另写一份 WHERE）切：

| 轴 | 行数 | 正文字节 | 单行均值 |
|---|---|---|---|
| reader-visible（进阅读器、进早报池） | 6,194 | **98.2 MB（98.6%）** | **15.9 KB** |
| reader-excluded（热榜/聚合/AIHOT 这类） | 4,722 | 1.4 MB（1.4%） | **0.3 KB** |

正文体积 top 20 源（= 近 24h 正文的 34.1%）全是 RSS 正规源：中国新闻周刊 50 行 3.7 MB（**76 KB/行**）、每日经济新闻 71 行 2.7 MB、虎嗅 167 行 2.5 MB、券商中国 29 行 2.2 MB、果壳 13 行 2.2 MB……
而全表存量行数 top 15 里前排是 微博热搜 1,249 / 金十数据 1,223 / AIHOT 热榜 1,160 —— **它们多，但它们是"薄的"**。

⇒ **结论 1（可判定）**：砍热榜/AIHOT 这类腹泻源，省的是**行**（早报池覆盖、候选削减、扫描行数），**几乎省不到体积**；体积 100% 由"我们真正想读的那批全文源"产生。**"要不要取舍腹泻源"和"库为什么涨到上限"是两个问题，别用前者的答案去解后者。**

## 三、读放大台账：每调一次付多少

代价信号有三种，先分清：`SEARCH ... USING INDEX`（点查，最便宜）／`SCAN ... USING INDEX`（**有序索引扫**，带 `LIMIT` 能提前停）／`USE TEMP B-TREE FOR ORDER BY`（**排序器物化所有命中行**，`LIMIT` 救不了）。

| 调用点 | 计划（实测 EXPLAIN） | 每次代价 | 频率锚点 |
|---|---|---|---|
| 阅读器·实时流（默认首屏）`api/[...slug].js:482` | `SCAN a USING INDEX idx_articles_published` | ≈31 行读，**便宜** | 每次开阅读器 |
| **阅读器·精选栏** `:482 tab=featured` | `SCAN a USING INDEX idx_articles_source_read + USE TEMP B-TREE FOR ORDER BY` | **≈35,446 行/次**（排序器全量）＋1.3 MB 正文 | 每次开精选 |
| **阅读器·搜索 `q=`** `:142 (title LIKE ? OR content_html LIKE ?)` | `SCAN a USING INDEX idx_articles_pubco` | 命中稀的词→**扫到全表**，且每行都要读 `content_html` → **最坏 587 MB/次** | 每次搜索 |
| **早报详情 `/api/daily`** `:828 SELECT * FROM daily_reports ORDER BY generated_at DESC LIMIT 20` | `SCAN daily_reports`（**这张表一个索引都没有**）＋ TEMP B-TREE | 57 行（小）但**传输 573 KB/次，实际只用 21 KB → 27× 放大** | 每次开早报 |
| 阅读足迹·近 7 天 `:995` | `SCAN daily_reports` | 同上量级（0.6→0.2 MB） | 每次 |
| 日报宽池读（级3，6000 行，不带正文） | `SCAN ... USING INDEX idx_articles_published` | 6,000 行 / 1.2 MB | 每日批 + 内联兜底 |
| 保留读数·两条 COUNT（collect 尾部） | `SEARCH USING INDEX idx_articles_later_sk` | 索引，**便宜** | **96 批/日** |
| 我的早报·已读/稍后读 COUNT、按源近 14 天 COUNT、按 id 取正文 | 全部 `SEARCH ... USING INDEX` | 便宜 | —— |

⇒ **结论 2（可判定）**：**自动化链路（cron 驱动的采集/清理/读数）不是读放大的来源** —— 逐条 EXPLAIN 全走索引。读放大集中在**三个人手点的 UI 入口**：精选栏、正文搜索、早报详情。它们的共同点不是"读得多"，而是**没有索引支撑它们想要的那个序**（`CAST(score)` 废掉 `idx_articles_score`；`daily_reports` 整表零索引；`content_html LIKE` 天生无索引可走）。

## 四、配额维度对上了：老库的死法是「行读」，而它的单价随表大小线性上涨

Turso 官方口径（[Usage & Billing](https://docs.turso.tech/help/usage-and-billing)、[Pricing](https://turso.tech/pricing)，2026-09-24 取）：计量维度是 **rows read / rows written / storage**；免费档 = **5 亿行读/月、1,000 万行写/月、5 GB 存储**（Developer 档 25 亿/2,500 万/9 GB）；超限的行为是 **`BLOCKED`，查询直接失败**。
⚠️ **本仓实际在哪一档无法程序化确认**（没有 Turso 平台 API token，B119 ④ 那条限制没变）——下面的"能撑多少次"按**免费档**算，是保守下界；若实际是 Developer 档，同样这些次数要 ×5。
本项目 09-20 那次事故文案正是 `BLOCKED: SQL read operations are forbidden`（B118 / RUNBOOK §10.9）—— **被禁的是"读"**，所以先撞的是**行读**配额，不是存储。

把 §三 的单价乘起来就能算出"多久撞一次墙"：

- 全表 35,446 行 → 一次精选栏/一次稀词搜索 = **35,446 行读** → 5 亿 ÷ 35,446 ≈ **14,100 次/月（≈470 次/日）**就打完配额。
- 而**表在按 ~100 MB / ~11k 行/日 增长**（§二），所以这个"每次的单价"每天涨 30%：同样 470 次/日，一个月前是省余额，一个月后是超配额。
- 增速为什么压不住 → §五。

## 五、真正的闸门：**删除闸从 09-22 起一直挡着，一条都没删**

`settings['retention.pending']`（runner 每批刷新的当前值，只读回读）：

```
读数时间=2026-09-24T15:02:56Z  retentionDays=7  待删合计=9,462  分类={hotlist:0, retention:9,462}
删除闸 allowed=false  via=credential  原因：转储凭证已过期：70.2h > 上限 48h
历史：09-21 闸=true(total 0) / 09-22 true(6) / 09-23 false(8,562) / 09-24 false(9,462)
```

机制（不是猜测，逐字读代码得出）：`lib/content-dump.js#deleteGateAny` 两条腿 —— ①runner 本地盘的转储目录（GH runner 是临时盘，**这条腿结构性不可能有**）②库内凭证 `settings['retention.dumpCredential']`，由本地 `npm run dump:content -- --scope cloud` 写入，**TTL 48h**（`GATE_MAX_AGE_H`）。09-21 那一轮转储（FEATURE_MATRIX §1.5：云端 59,832 文章 + 1,291 视频 = 161.6 MB/154 片）留下的凭证到 09-23 就过期，此后 `cleanup` 每天照跑、**每天一条都不删**，并如实记 `闸=false`。

⇒ 这是**设计正确的安全阀**（宁可挡住也不裸删），但它的**续期是人工本地动作，且没有任何报警** —— 于是 48h 之后系统必然进入"只涨不删"状态。这正是 AGENTS §2「配额是墙钟事件」的另一面：**这次不是 provider 挡我们，是我们自己的安全阀把自己锁死，且无人出声。**

放行一次能回收多少（谓词逐字用 `lib/retention` 的唯一实现算的，不是另写一份）：

| 项 | 值 |
|---|---|
| 待删（retention 轴，7 天前未读未标记非热榜） | **9,472 行 / 正文 235.2 MB** |
| 待删（hotlist 轴） | 0 行（7 天内的热榜行都还新） |
| 7 天前存量合计 | 10,304 行 / 244.2 MB |
| 其中被豁免（已读 213 / 稍后读 3 / 精选 629） | 仅 8.9 MB |
| **回收比例** | **占全表正文 41.6%** |
| 空闲页（另需 VACUUM 才真还给文件） | 453.1 MB |

## 六、可判定动作（本轮**只登记，不做**；删除与 VACUUM 都是破坏性/长事务，须用户点头）

1. **让"删除闸挡住 > 24h"出声**（接现成的云端报警引擎，15-cloud-alerts 那条链已在跑）——这条是纯增益、无副作用，且直接对上 B118 的教训"挂了几小时没人知"。
2. **续期路径二选一**（要用户选）：(a) 把 `dump:content --scope cloud` 变成本机定时任务（本机不总开 → 仍会漏）；(b) 承认"转储腿"在 runner 上永不成立，改成**runner 自己按天写一份可核验的小清单凭证**（manifest 摘要+行数+id 区间进 `settings`，正文留在原地），把 TTL 绑到"最近一次成功采集"而不是人工动作。
3. **削掉三个 UI 读放大**（各自独立、都可回退、都不动数据）：
   - 精选栏 `ORDER BY CAST(a.score AS REAL)` → 实测 `typeof(score)` 只有 `null=24,371 / integer=11,034`，**CAST 无必要**；去掉后 `idx_articles_score` 才可被吃到（现在的计划根本没用它）。
   - 正文搜索：要么去掉 `content_html LIKE` 那一半（只搜 title+summary，摘要只有 6.1 MB），要么真做 FTS5 —— 但 FTS5 要先测 libsql/Turso 是否支持，属独立议题。
   - `/api/daily`：573 KB → 21 KB。`daily_reports` **零索引** 且 `SELECT *` 拿 20 份只为挑 1 份；补 `generated_at` 索引或改按档位取（与 H25/契约那条"读层按 schemaVersion 优先"是同一条线）。
4. **VACUUM 单独评估**（453 MB 空闲页 = 文件的 41%；能不能在 Turso 上跑、跑多久、要不要停机，都没实测过 → 不许当"顺手就能省"报给用户）。
5. **不动刀**：`articles_archive` 0 行不等于归档功能坏了要马上修（H26 已记：归档窗口只覆盖 7.8% 正文，它不是主因）；**也不许**为了省空间去砍全文源——§二 已证那批源才是"我们想要的东西"。

## 七、探针自身的读放大（诚实记账）

- #1/#2/#4/#_reclaim 各含**至少一趟 articles 全扫**（含 `content_html` 列）→ 本轮诊断自身读走约 **4 × 587 MB ≈ 2.3 GB 逻辑正文**，另加 #5/#7 的早报表 20 行×多次（约 1.7 MB/次）。**一次性诊断，可接受但必须写明**：如果这类探针变成天天跑，它自己就会变成 §四 的那个配额杀手。
- **两处判据/口径自我修正**（都改在本文，脚本已就地修）：① #1 第③节第一版把 `SCAN ... USING INDEX` 也标成"⚠️ 全扫" —— 有序索引扫被误判成全表；现按 `TEMP B-TREE` / 裸 `SCAN` 两级信号判定。② #5 本机跑 `/api/daily` 那条查询要 9~12 s，**但那是本机的链路吞吐**（573 KB ÷ ≈62 KB/s，代理在墙外），换成对照列/对照索引一条都没变快；同一查询在云端 Vercel 侧的端到端是 **2.36/2.75/2.99 s**，而 `/api/meta`（187 B）在同一链路上就是 2.26 s —— 所以**早报详情的真实网络增量约 0.1~0.7 s**。别拿本机秒数当线上秒数（同 §三 的"传输字节"结论互不矛盾：贵的是字节数，不是我的链路）。
- 未做：部署面查询未逐条 EXPLAIN（本轮 14 条），其余要全量核需专门一轮审计；配额维度只引用官方文档口径，**本仓仍无 Turso 平台 token，配额本身不可程序化观测**（B119 ④ 不变）。
