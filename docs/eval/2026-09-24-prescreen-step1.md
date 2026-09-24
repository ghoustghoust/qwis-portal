# 取证 · 级3 每源预配额（44 号 spec 步1）改前真值与交付证据

> 最后更新：2026-09-24
> 性质：一次性只读探针产物（AGENTS §3 第 7 条）。全部数字来自本文件「取法」列写明的方法，
> 零生产写、零 AI 消耗（除注明者）。§一~§七 = **改前**基线；§八 = **改后**第一期生产真值（id=68），
> §九 = 这一期把本文件 §一/§六 的两处预估证伪了（原文保留，不改口）。
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
| `collect.yml` 最近批次 | 12 次（05:01Z~06:45Z）**非 success = 0**；其中 06:30Z/06:45Z 两批已跑在改过的 `tools/collect-turso.js` 上（`dc57332`）→ 该文件在 runner 里能正常装载执行，只是未走 daily-ai 分支 |
| Vercel 部署 | `ed96b46`（审查修复）与 `58d4b40`（spec 遗留）两条 Production deployment 均 **state=success**；此前 `6c40812`/`d2eefda`/`dc57332` 同样 success |
| `node smoke-test.js` | 通过 **20** / 失败 **0** / EXIT=0 —— **在审查修复之后重跑过**（第一次跑在 `ed96b46` 之前，那个数不作数） |
| `npm run lint:docs` | **0 错** 3 警（唯一实质警 = 步2 拟新增 `lib/filter-rules.js` 尚未创建） |
| 执行锁 E1~E3 | 真 `spawn` 生产模式：E2 同样 12 个坑、不配额覆盖 **3 源** → cap=2 覆盖 **9 源**；E3 深析请求含正文标记、初筛请求不含 |
| 对抗审查（独立 reviewer） | 无阻断缺陷，五条该修**全部已修并推送 `ed96b46`**：runDaily 改「先安检再配额」+ 补落 `prescreen`；深析缺正文计数 `analyzeNoBody` 落库；`prescreenCapOf` 真出声（此前只是注释承诺）；P6 改按**函数**计调用次数（原判据删掉一份接线仍会绿）+ 用掩码视图；P8 改判调用形状与两常量关系（原判据 grep 的字面量已被模板串取代而变哑）；E3 改 `every` + 独占测量。修后 `npm test` **621/621** 复跑绿 |

## 六、发现但**故意不在步1 修**

- **H23**：`runDaily`（裸报告）从不写 `gateDropped`、`candidates` 是门槛后口径 —— 破不变量 12。
  改动前一版（`git show 6c40812^`）即如此，非本轮引入。生产指纹：id 67/62/59/56 键集为
  `schemaVersion,candidates,articles,sections,totalItems`（candidates 473/497/494/493），
  同期 AI 行 id 66/65/61 恒 500 且带 `gateDropped=46/60/139`。
  **不在步1 修的理由**：它会让裸报告 `candidates` 跳变，与级3 的效果混在一批就归因不清。

## 七、改前生产基线（级3 上线前的最后 7 行，直读 `daily_reports`）

| id | gen(UTC) | 档 | candidates | 筛过 | 深析 | 失败 | truncated | elapsedMin（÷10 前的显示值） | 入报 | prescreen |
|---|---|---|---|---|---|---|---|---|---|---|
| 61 | 09-22 21:18 | 2 | 500 | 500 | 215 | 未记 | 未记 | 9 | 46 | 无 |
| 62 | 09-23 05:41 | 1 | 497 | — | — | — | — | 无此字段 | 40 | 无 |
| 63 | 09-23 14:17 | 2 | 500 | 173 | 117 | 29 | **true** | 8.1（真 81min） | 45 | 无 |
| 64 | 09-23 15:51 | 2 | 500 | 225 | 134 | 24 | **true** | 8.5（真 85min） | 46 | 无 |
| 65 | 09-23 19:18 | 2 | 500 | 274 | 167 | 49 | **true** | 8.3 | 46 | 无 |
| 66 | 09-23 21:06 | 2 | 500 | 318 | 165 | **136 = 43%** | **true** | 8.2 | 46 | 无 |
| 67 | 09-24 05:57 | 1 | 473 | — | — | — | — | 无此字段 | 40 | 无 |

**这张表说出的三件事（回填改后读数时必须拿来对照）**：
1. 级3 前**四期连排 `truncated=true`**，`candidates` 恒 500 —— 截断是稳态不是偶发，与交接文档一致。
2. **初筛失败率在四期内 6.8% → 12.4% → 18.7% → 43%**（id66 是 136/318）。P0-2 的报警线是 20%，
   所以 65、66 两期都该报警了 —— 免费池的抖动幅度比"预算"这个议题更值得先看一眼。
3. id 62/67（sv=1 裸报告）**既无 `gateDropped` 也无 `elapsedMin`** → 就是 H23 的现场；
   且 `candidates` 497 / 473 明显是门槛后值（AI 行恒 500），口径不一致由此坐实。

## 八、改后生产真值（级3 上线第一期：`daily_reports.id=68`，run `35964421731`）

取法：只读探针 `SELECT id,generated_at,window_hours,LENGTH(sections),stats FROM daily_reports ORDER BY id DESC LIMIT 1`
（生产 Turso，零写、零 AI 消耗）。落库 `generated_at=2026-09-24T07:53:19Z`；批次 06:25:34Z 起跑，墙钟 **87.75min**。

| 字段 | 改前基线（id 63~66 四期） | 改后 id=68 | 判读 |
|---|---|---|---|
| `prescreen` | 无此字段 | `{cap:2, pool:2000, poolSources:202, kept:337, keptSources:202}` | 级3 真在跑；`cap` 走的是**代码默认**（见下「配置真值」） |
| `candidates`（=深析上限） | 恒 **500** | **337** | 调用量 **−32.6%**，不是"不变" |
| 源覆盖 | **94** 源 | **202** 源 | **2.15×**，不是 §一 预估的 4.8× |
| `filterStats.truncated` | 四连 true | **true** | 依旧截断，但**原因换了**（见下方证伪 ②） |
| `passed`/`failed` | 173~318 / 29~136 | 229 / **70** | 尝试 299 次 → 337 篇里 **38 篇没轮到**；失败率 **23.4% > 20%** 报警线 |
| `elapsedMin` | 8.1~8.5（÷10 坏量具） | **87.4** | B137 修复生效：87.4 是真实分钟，与墙钟 87.75min 对得上 |
| `gateDropped`/`totalItems` | 26~60 / 45~46 | 34 / **46** | 入报体量没变 |
| `analyzeNoBody` | — | **缺键** | **不是 bug**：该 run 的检出 sha `dc57332` 含 `prescreenRead`/`CANDIDATE_POOL_READ` 但**不含** `analyzeNoBody`（计数由 `ed96b46` 引入，晚于那次 snapshot 提交）——已按 sha 逐字取回 `tools/collect-turso.js` 正文验过 |

**配置真值**（同批只读探针）：`settings` 里**没有** `prescreen.perSourceCap` 行 → 执行的是代码默认 2；
`daily.articleSourceIds=[]` → 源白名单不收窄候选池。

## 九、这一期把两处预估证伪了（留字，不许改口）

**① 预估「AI 调用量不变、覆盖 4.8×」——实测「调用量 −32.6%、覆盖 2.15×」。**
根因：**`CANDIDATE_POOL_READ=2000` 这个宽池读自己被吃满了**（`pool=2000` 恰等于上限，说明真实池比 2000 更大），
而 2000 行里只出现 **202** 个源 —— §一 的「2,688 篇 / 469 源」是**全量窗口真值**，不是"读得到的池"。
202 源 × cap 2 = 404 上限，实得 337 → **500 个坑里 163 个空着**。
推论：要把覆盖真做到 ~469 源，必须先抬宽池读（或把限量下推进 SQL），否则 cap 是在"被 2000 截断的池"上做配额。

**② 预估「级3 治不了 truncated」——结论对，理由错。**
候选从 500 降到 337 之后照样 `truncated:true`：约束根本不是候选量，而是**单篇耗时**。
初筛分到的预算是 `BUDGET_MS*0.5 = 45min`（`tools/collect-turso.js:1130,1168`），本期 299 次尝试 = **9.0 s/篇**；
对照 id66 同预算下 454 次 = **5.9 s/篇**。→ 免费池抖动一次，45 分钟就少筛 1/3 的篇数。
这条读数直接喂给被暂缓的预算/gap 议题：**即便候选只有 337，45 分钟也只筛得完 300 上下**。

## 十、读层 HTTP 实测（08:22~08:24Z 代理恢复后补做，本条取代 §十-1 的"待补"）

| 端点 | 读数 | 判读 |
|---|---|---|
| `GET /api/meta` | `commit=930272e42dd…`、`commitRef=main`、`articles=32433 videos=2873 sources=1131 lastUpdated=08:16:02Z` | **线上 commit == origin/main**（AGENTS §3 第 5 条的入口判据），且 `lastUpdated` 是 5 分钟内 → 采集心跳正常 |
| `GET /api/daily` | HTTP 200 / 36,976 B，`report.id=68`、`generated_at=2026-09-24T07:53:19Z`、`sections=5`、`items=46`、`stale=false`；栏目名 `培训课程发布/重点更新/AI技术/其它重要/视频与播客`（字段是 `column`，不是 `name`） | 级3 那一期**就是用户早上打开的那一版**；出报形状没被步1 打坏 |
| 同响应里的 `stats` | `candidates=337 elapsedMin=87.4 gateDropped=34 prescreen={cap:2,pool:2000,poolSources:202,kept:337,keptSources:202} filterStats={candidates:337,passed:229,analyzed:137,failed:70,truncated:true}` | 与 §八 直读库的**逐字段一致** → 读层没有另算一套，也没有把新字段吞掉 |

**已核销的一条（09-24 09:5xZ 查代码定性，先前那句"疑缓存键未带 query"是我猜错的）**：
`GET /api/articles?limit=2` 与 `?limit=5` 都返回 30 条 —— **不是缓存，也不是 bug**：
`handleArticles`（`api/[...slug].js:124`）是**游标分页**，页大小写死 `PAGE_SIZE = 30`，SQL 取 `LIMIT PAGE_SIZE + 1`（多取一条算 `hasMore`），
**根本没有 `limit` 这个参数**；我 grep 到的 `Number(req.query.limit)` 属于别的 handler（`handleQueueFailed` / `handleAuditList`）。
留下的是一个产品口径问题而不是缺陷：这个端点不提供页大小旋钮，前端要改每页条数只能改常数或新增参数。

## 十二、抬池 + 读层生成器活体实测（09:10~09:18Z，用户授权）

| 动作 | 读数 | 取法 |
|---|---|---|
| 抬宽池读（`e468b3b`） | 2000 → **6000**，单一取值写进 `lib/prescreen.js#CANDIDATE_POOL_READ`，runner + 两份 api 同取此数 | 代码 + 锁 P9 |
| 抬池前的只读取数 | 24h 全量 **3,645 篇 / 327 源**；30h **4,361 / 387 源**；轻量列（title+summary+url）合计 **928 KB** | 谓词逐字复刻候选查询 |
| Vercel 部署跟上 | `GET /api/meta` → `commit=e468b3b`（推送后 33 秒） | 真端点 |
| **`POST /api/daily-generate?key=…`** | **HTTP 200 / 33.08 s**，返回 `{ok:true, report:{generated_at:2026-09-24T09:12:23Z…}}` | 用户 09-24 授权这一次 |
| 新行 `daily_reports.id=69` | `prescreen={cap:2, pool:3806, poolSources:448, kept:500, keptSources:313}`、`candidates=500`、`gateDropped=13`、`sections=4`、`totalItems=41`、`win=30h`、`schemaVersion=1` | 只读探针 |

**三条判读**：
1. `pool=3806` —— 不再是旧行那种**恰好顶格的 2000**，宽池读已从天花板降级为余量（6000 > 3,806），级3 现在真在**全池**上做配额。
2. `kept=500 / keptSources=313` —— 500 个坑**重新填满**，覆盖 202 → **313 源（+55%）**；与抬池前算的 `Σmin(n,2)=530 > 500` 完全一致。
   额度这一侧回到设计原意：**换的是覆盖，不是省调用**（第一期的"省 33%"其实是池被截断的副作用，不是收益）。
3. 这一行同时是 **H25 的核销证据**。另顺手澄清一份归属：`schemaVersion=1` 且**带** `gateDropped=13`
   → 读层这份 `api/daily-generate.js` 的 stats 口径是对的，H23 那份"裸报告缺 `gateDropped`"专指 runner 的 `runDaily`。

**更正我自己上一轮的话**：授权前我说这次 POST 要"真烧约 337 次初筛调用"——**错了**。
`api/daily-generate.js` 是**零模型**生成器（读候选 → 门槛 → 分栏 → 落库，所以 `maxDuration:60` 装得下），
60 秒预算里根本不做逐篇打分；实际耗时 33 s、模型调用 **0 次**。

**副作用边界（下一次再打之前要知道）**：这次 POST 往 `daily_reports` 多加了一行（`id=69`，关键词版），
但**没有改变读者所见** —— `GET /api/daily` 仍返回 `id=68` 那份 AI 早报（5 栏 46 条，`schemaVersion=2`），
即"今日有 AI 版时，关键词版不会顶掉它"。代价只落在历史/归档里多了一条 09:12Z 的记录。

## 十三、本节的边界（别读成"两份读层生成器都验过"）

第二份生成器 `api/[...slug].js#generateDailyInline` **仍未活体打到**。它有两个入口：
`GET /api/daily` 的兜底分支（只在"今日无报告"且北京 hour≥1 时走），以及 `POST /api/daily/regenerate`；
后者会先 `DELETE FROM daily_reports WHERE generated_at ∈ [北京今日]` 再重建 —— 也就是**会抹掉今早那份 AI 早报（id=68）**，
这超出"授权一次 `POST /api/daily-generate`"的范围，没有单独点头就不按。现状＝该函数只有静态锁（P6/P8/P9 计它一份接线）。
>
> **09-24 09:29Z 更新：这一份现在有活体执行证据了，但不是在 Vercel 运行时里**。新增执行锁
> `tests/regression-inline-exec.test.js` **I1~I3**：用 mock `req/res` 把整个 catch-all handler 跑在 `file:` 临时库上，
> 走 `GET /api/daily` 的兜底分支真调 `generateDailyInline()` —— 真路由、真 SQL、真级3、**零生产写**。
> I1 读数 `pool=2300 / poolSources=406 / kept=500` 且 `gateDropped` 落库；I2 是同数据下的因果对照
> （cap=2 的覆盖 ≫ 不限量臂）；I3 锁住"驱动必须绑 `file:` + 真 fetch 打死 + 文本里不许出现云端点"。
> 仍然缺的那一半：**Vercel 运行时里的那一遍** —— 要它就得授权 `/api/daily/regenerate`（会删今日报告行）。

## 十四、仍待补

1. **`analyzeNoBody` 的生产读数**：要等下一次 `daily-ai` 批次（代码已在 `ed96b46` 起入库，本期 sha `dc57332` 早于它）。
2. **`prescreen.perSourceCap` 调档实测**：目前只有"默认 2"一期样本；改 cap 后需看 `kept`/`keptSources` 是否按 §九① 的推论走。
3. ~~上一条 `/api/articles` limit 读数定性~~ → **已核销，见 §十：游标分页固定 30/页，该端点无 `limit` 参数，非缺陷**。
4. ~~读层 HTTP 实测~~ → **08:22Z 已做完，见 §十**（代理恢复；此前记的"待补"与次级 GitHub 侧证据一并作废为本节实测）。
5. **读层两份生成器没有活体实测**（本节实测的边界，别把 §十 读成"读层全部验过"）：本轮改了
   `api/daily-generate.js` 与 `api/[...slug].js#generateDailyInline`，但 `GET /api/daily` 只读已存在的报告，
   走不到这两份。活体验证只有一次 `POST /api/daily-generate` = 一次 `POST /api/daily-generate`（**09-24 09:12Z 已按授权打过：200/33s → 写 `id=69`，且实测零模型调用**；本条原先写的"真烧约 337 次初筛调用"是我估错的，更正见 §十二）。
   须用户授权后才做。现状＝静态接线锁（P6/P8）+ runner 生产模式执行锁（E1~E3，跑的是 `tools/collect-turso.js` 不是 Vercel）。
   → 09-24 12:44Z 更新：内联那份也有执行锁了（`tests/regression-inline-exec.test.js` I1~I3，mock req/res 跑整个 handler）。

## 十五、库体积与读放大归因（09-24 12:47Z 只读探针；回答"什么在大量读 Turso / 170MB 是谁"）

口径先说清：`LENGTH(text)` 在 SQLite 返回**字符数不是字节数**（中文一字 3 字节），下表是字符量，
真实字节更多；170MB 是 Turso 压缩后的物理值，两者不矛盾。

| 对象 | 读数 | 判读 |
|---|---|---|
| 全库文本列合计 | **541.0M 字符** | —— |
| `articles.content_html` | **521.6M 字符 / 34,521 行**（平均 15.1k 字符/篇）= **96.4%** | 体积主因就是这一列 |
| 第二名 `articles.original_html` | 3.8M | 差两个数量级 |
| `daily_reports`/`settings`/`sources`/`videos` 及其余各表 | 各 ≤1.2M | 不是体积问题 |
| `articles_archive` | **探针没出行数**（表内 0 行） | 归档工具 `tools/archive-articles.js`（>90 天迁出主表、谓词与 `lib/retention.js` 同一份实现）在 `.github/workflows/` 与 FEATURE_MATRIX 里**都搜不到引用 → 从没被调度过** |

读放大侧（谁在扫这一列）：

| 位置 | 形态 | 量级 |
|---|---|---|
| `api/[...slug].js:142` 阅读器搜索 | `a.title LIKE ? OR a.content_html LIKE ?` | **每次搜索全表扫那一列**，游标翻页每页再扫一次 |
| `api/[...slug].js:477` 空摘要兜底 | `substr(a.content_html,1,500)` | 每页 30 行都要读该列 |
| `tools/collect-turso.js:1991` 翻译批 | 按 `TRANSLATE_LIMIT`（默认 10）逐行取 | 小，但每轮采集都跑 |
| 级3 宽池读（四处候选层） | 已改为不取 `content_html` 的轻量列 | 步1 已收 |

结论：**要腾体积/降读放大，动的是"归档排期 + 搜索别扫正文"，不是再压候选量**。登记为 ISSUES **H26**（本文件只量不做）。

## 十六、新字段的真执行证据（不等生产批次的那一半）

执行锁 `tests/regression-prescreen-exec.test.js` **E3** 扩展后真跑通（spawn 生产模式 `daily-ai --rolling24`，`file:` 临时库 + AI 桩）：
`filterStats.attempted === passed + rejected`、`attempted ≤ candidates`、`timeSplit.{filterMin,analyzeMin,mediaMin}` 三项成数、
且**三段之和 ≤ 总耗时**（这条专门防"计时器套错位置导致拆账比合账还假"）。
形态锁 F5 只能证明源码里写了这些键，E3 证明的是"跑起来真会落进那一行"。
生产那一版的读数（`stats.timeSplit` 出现在真实早报行里）等 UTC 13:30 自动批 `daily-ai-evening`（cron `30 13 * * *`，北京 21:30）落库后即可回读。
