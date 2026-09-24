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

## 十、仍待补

1. **读层 HTTP 实测**（`/api/meta` commit == origin/main、`/api/daily` 出报形状）：
   09-24 06:25Z 起本机代理不可用（`127.0.0.1:12000` 拒连，7890/7897/10809/8118 亦不通；
   `*.vercel.app` 直连不通而 `api.github.com` 通），**待代理恢复后补测**——这一步没做就是没做，不许用 CI 绿替代。
   本期再次实测：直连 `curl -m12 https://qwis-intel.vercel.app/api/meta` 超时、走 `127.0.0.1:12000` 拒连；
   `api.vercel.com` 可达（401/403 级）但仓库内无 Vercel token，且制度禁止交互式 login → **没有合法替代证据**，只有侧写不算实测。
   08:10Z 复测：`12000/7890/7897/10809/8118/10808` 六个端口全部不通，直连仍超时。
   - **次级证据（不是实测，只补"部署面 == origin/main"这一半）**：GitHub 上 `b1e3f71` 的提交状态
     `ctx=Vercel state=success / "Deployment has completed"`，且 `deployments` 列表首条 =
     `id 6633018370, env=Production, sha=b1e3f71`。→ 证明**读层那次部署构建完成在 main 最新提交上**；
     **不证明** `/api/meta` 返回体、不证明 `/api/daily` 出报形状、不证明读层代码真跑过。这两半不能互相替代。
2. **`analyzeNoBody` 的生产读数**：要等下一次 `daily-ai` 批次（代码已在 `ed96b46` 起入库，本期 sha 早于它）。
3. **`prescreen.perSourceCap` 调档实测**：目前只有"默认 2"一期样本；改 cap 后需看 `kept`/`keptSources` 是否按 ① 的推论走。
