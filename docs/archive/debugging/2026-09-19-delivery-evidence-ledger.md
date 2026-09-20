# 已修条目的证据对账与逐条处置（2026-09-19 深夜两批）

> 类别：调试/交付记录 | 归档自：docs/ISSUES.md 两节：B8~B26 本轮处置 + 本轮已修（自主轮证据对账表） | 归档轮次：2026-09-20 文档洁净轮
> 关联代码：`tools/collect-turso.js`、`web/src/components/ColumnSection.jsx`、`web/src/components/ui/SourceAvatar.jsx`、`lib/media.js`、`server/routes/reading.js`
> 关联坑：`docs/pitfalls/testing.md` #45/#59/#61/#62（条数与证据脱钩、F2P 分母、先改代码后补锁） | 关联 spec：`docs/specs/36-reading-semantics/`、`docs/specs/38-admin-ia-refactor/`、`docs/specs/41-e2e-whitebox-eval/` | 取代：无 —— 本份是"当时的事实"，后续以 `docs/ISSUES.md` 活跃区与 `docs/eval/**` 证据文件为准
> 状态：**待用户终验**——按 §4.1 从活文档外迁归档，**不等于已验收**；本份内自陈哪几处曾被复核降级，读的时候以 `docs/ISSUES.md` 当前行与证据文件为准。

## 为什么归档（§4.1：洁净 = 精炼 + 去冗 + 归档）

这一段是**某一轮的过程记录**，不改变下一步决策；留在 `ISSUES.md` 里会让读者打开缺陷账本先读到五份已完成工作的验收细节。
活文档该装的是"现在什么坏着、等什么决定"。原位只留一行指针。

### B8~B26 本轮处置（2026-09-19 深夜，逐条实测后动手）

图例：✅ 已修并取证 · ◐ 代码面已修、剩下的是**生产数据/授权**· ⏸ 需你拍板 · 👁 观察中

| # | 结论 | 一手证据 / 剩余动作 |
|---|---|---|
| **B8** | ◐ | 真因不是"没接 markdown 组件"，而是**同一字段混两种来源**：采集正文是 HTML、AI 摘要是带 `**`/`==` 的纯文本，而三处回退无脑走 `safeHtml` → 纯文本被转义、标记变裸星号。新增 `ui/RichText.jsx` 按"像不像 HTML"分流（保留调用方 class 与 ref），接进文章详情 / 快速学习弹窗 / 热点详情（导读+推荐理由）。锁 I9（F2P base `41d6af2` 红 → 绿）。<br>**本轮第二次审查订正两处措辞**：① 带 md 标记的实际字段是 `articles.translated_content`（AI 译文正文），不是原先写的 `summary`——取值链已核（`ArticleView.jsx` 用 `translated_content \|\| content_html \|\| summary`）；② 分流只解决"走错渲染器"，**行内标记**（`**粗**`/`==高亮`/`` `码` ``）现在正常了，**块级结构**（`- 列表`、`1.`、`###` 小标题、空行分段）`mdInlineParse` 根本不支持 → 另立 **B92**。<br>**仍未做线上复验**：需要一条真含 md 标记的样本，本轮没在云端找到，故只到"契约已锁 + 构建通过"这一层 |
| **B10** | ◐ | 线上那行「Codex、Claude、豆包…等动向」出自 `server/services/ai/daily.js` 自带的那份栏目表副本，报告同步进云端后成了 AI 版注解。**代码面**：5 份副本收成 1 份 `lib/daily-columns.js`（三端 + 读层两处引用），desc 改成人话；W13 全仓库扫 + 锁 I8（含两条历史脏 desc 正向探针）。**数据面仍在库里**：`settings.daily.columns` 存的就是回声文案，生成时优先读它 → 二选一：①你在后台点「恢复默认栏目」（它现在写的是修好的默认值）；②授权我改这一条生产数据 |
| **B11** | ✅ | 后台 `TabLoader` 由「加载中…」文字换成与前台同语言的 `SkeletonList`（锁 I11）。**可见行为未线上复验**：后台在登录门后，我不代你输口令 |
| **B12** | ✅ 核销 | 4 项红在 BL1 轮已重锚到根树真文件；本轮实测 `npm test` 全绿、0 跳过（**条数唯一写死处是 `docs/FEATURE_MATRIX.md` §1.5**，本表不复制——上一版抄了个 417，下一轮跑就成假账） |
| **B13** | ✅ 核销（附口径） | 本轮实测 `/api/meta` = `6665087` = `origin/main`。**但"一致"只覆盖已提交面**：并行会话在途未提交的 5 个文件（`AGENTS.md`、`docs/DOC_GOVERNANCE.md`、`docs/INDEX.md`、`tools/doc-lint.cjs`、`server/services/{ai/daily-ai,scheduler/index}.js`）**不在线上也不在本轮审查面内** → 引用本条时别说"线上==本地工作区"。 |
| **B14** | ◐ **重开**（原记"✅ 核销"是误核） | 核销依据是"`/api/mybrief` 现在带 digest 了"，但**没验 digest 里的数**：本轮实测 `digest.readCount = 24869`，而生产库 `read_at` 非空共 25165 条，其中**字面串 `'null'` 24855 条、真 ISO 只有 310 条** → 这个 24869 里 **99.94%（24855/24869）是脏值**，等于"阅读足迹卡从来没算对过"。`qOne` 修复本身成立（digest 确实生成了），但 B14 的**用户可见面**（"我读了多少"）仍错，**被 B15 的生产数据订正阻塞**（BL10 等授权）。证据脚本 `tools/_evidence-b8b26-recheck.cjs` |
| **B15** | ◐ | 根因位点在（`tools/migrate-to-turso.js:253` 已有 `v === null` 分支）。生产 4 列脏值（`read_at` 24855 / `tags` 24355 / `reason` 24799 / `videos.watched_at` 846）**订正等授权**（BL10），且订正前按规矩先备份原值进 `docs/eval/` |
| **B16** | ◐ | 清洗器 + 放弃原因出声已在前轮完成。本轮实测线上第 5 期 `theme=null`（storylines 4 / items 20 正常）→ "脏数据要重跑一期周刊覆盖"属**生产写 + 花 AI 配额**，等授权 |
| **B17** | ⏸ | 需拍板：初筛窗 24min vs 全量 2.2h，三个方案（提配额 / 批量初筛 / 预筛降量）都改行为或花配额 |
| **B18** | ⏸ | 需拍板：给 `videos` 建 `score`/`translated_title` 列（schema + 三端采集语义 + AI 配额）还是放弃视频评分/翻译 |
| **B19** | 👁 | 实测本轮 `/api/mybrief` 报告 `theme` 缺失（症状仍在）。代码侧"reasoning 冒充正文"已断；剩模型/额度侧波动，继续观察 |
| **B20** | ◐ **回退**（原记"✅ 已生效"是误核） | 上一版拿线上 AI 版那一期（`id=102`，min 分正好 30）当"门槛生效"的证据——**只核中了 5 个写入点里的 1 个**。本轮实测最新一期 `id=103`（09-19 05:35）带 **29 分与 22 分各一条**，而它的 `stats` 形状 `{candidates,articles,sections,totalItems}` 正是 `api/[...slug].js#generateDailyInline`（读层内联兜底）的指纹 → 低质条目是从**没接门槛的那几份**进来的。<br>**要说清用户今天到底看没看见**：读层 `pickDailyReport` 会优先选 30h 内的 AI 增强版，所以 `GET /api/daily` 当前实际服务的是 `id=102`（干净、min 30），**`id=103` 是躺在表里的隐患**，在"AI 批缺失/超 30h"的日子（正是 09-18 事故那一族）才会被选中并显形。本条修的是这条潜在路径，不是今天屏幕上的一条低质条目——别按"线上没人看到"就当没修，也别按"用户天天看到"夸大。<br>**本轮动作**：门槛接到全部 5 个写入点（`runDailyAi` / `runDaily` 裸报 / `api/daily-generate.js` / 本地 `ai/daily.js` / 读层内联兜底），W14 判据同时从"手工列 3 个文件、文件级 grep"改成**从 `INSERT INTO daily_reports` 反查宿主函数、函数级核对、并断言写入点不少于 5 处**（见坑 #58）。<br>**负向取证**：`node tools/_probe-w14-selftest.cjs` 把 5 个写入函数里的门槛逐个摘掉 → **5/5 都变红且点名 `函数@文件`**，全部复原后 W14 绿。最关键的一例是 `tools/collect-turso.js`：同文件里 `runDailyAi` 与 `runDaily` 两个写入函数，旧的"文件级"判据摘掉任一个都仍显绿——B20 第三次被误核就栽在这里。<br>**剩余**：待下一批日报（尤其内联兜底与裸报告那两份）实测无 <30 分条目才允许核销；本地 `analyzeBatch` 无六维分属长期项。<br>**接线时被抓出的真缺陷（同轮修）**：门槛判"有没有评分"用的是 `Number(item.score)`，而库里 `articles.score` 允许 NULL、`Number(null) === 0` → 门槛一接上，**未评分条目全被当成"判了 0 分"剔除**（`tests/regression-phase9.test.js`「日报安检:乱码标题条目被剔除并计数」当场变红）。改为只认真数字/数字串，锁 `tests/regression-brief-guards.test.js` 用例 11（NULL / `''` / 显式 0 / 字符串分四侧都钉）；F2P base `e3fbac7` 红 → head 绿（`docs/eval/f2p/2026-09-19162655.json`）。<br>**杀伤面实测**（`node tools/_q-gate-blast.cjs`，只读复刻内联兜底取数窗口）：当前窗口 500 条候选 = **NULL 未评分 481 / <30 分 19 / ≥30 分 0** → 不修 NULL 语义会把 481 条一起杀掉、**整期出报 0 条**；修后正确行为是剔 19 留 481 |
| **B21** | ⏸ | 未动。它要的是"新增本期索引 + 期号归档"，属功能面（H13/40-4 一起定），不是 bug 修复；卡顿那一半要先定位是 chunk 冷加载还是 46 卡重排 |
| **B22** | ✅ 核销 | `index.css:84-86` 已定义 `.t-success/.t-warn/.t-danger`，`--warn` 三主题各一份；后台成功率分档现在是真颜色 |
| **B23** | ⏸ | `rate: status==='ok'?100:0` 原样在位（实测 `api/[...slug].js:1713` 一带）。没 35B 的分母就不该出百分比——本轮把 B26 拆出的**独立按需端点**形状给它做了模板（见 `daily-sources`），但没替它拍板 |
| **B24** | ⏸ | 同上：`cloud.collect` 实测 blob 260KB（超过 107KB 前例），不能当统计源；要 35B 的每源定长滚动窗口 |
| **B25** | ◐（4 项里 3 项落定） | 原记"未提交在途改动 4 个文件"。逐条复核：**已提交** ① B8 的 `DailyPage.jsx` 主题 `MdText` ② `index.css` 的 `.md-mark/.md-code`（现于 166/172 行，注释破口 `*/.rail-btn` 实测已修，全仓再扫无同类） ③ B11 的后台 `TabLoader` 骨架屏 —— 三项都在 `93eb32e`。<br>**第 4 项仍在途**：`server/services/ai/daily-ai.js#isEnabled()` 被改成"`AGNES_API_KEY` 存在即视为启用（且 `enabled` 缺省也算真）"——这不是格式改动，是**本地灾备日报何时跑 AI 的判据变更**，属并行会话的在途工作，本轮**不代它提交、不代它核销**，只登记归属 |
| **B26** | ✅ | 实测根因两条：①三组计数被合并成**一条无 WHERE 的 CASE 全扫**（79.8k 行 × 平均 15.2KB，索引全被打掉，单这步 11.8s）；②入报统计 SELECT 了从未消费的 `stats` 列（214KB/2.0s）。修法：三条各自走索引 + heavy 聚合移到 `GET /api/status/daily-sources`（60s 独立缓存），前端懒加载且失败要显示得出口。<br>**取证**：修前 `/api/status` 12.2s/12.9s（曾 30.7s→504）→ 修后 **8.32s / 3.43s / 1.76s 全 200**；同刻 SQL 对账新旧形状逐项相等（`10127 / 9626 / 30146`），耗时 **13,911ms → 1,335ms**。锁 I10（含"新端点必须进 `PUBLIC_GET_PATHS`"）+ UI-D3 重写。<br>**自查出的自打回归**：拆分时新端点漏进公开白名单 → 线上实测 **401**，`2ecf3d4` 补（静态锁全绿、只有真打线上才红） |
| **B88**（撤回） | ❌ 原判定不成立（09-20 实测自查，按规则④保留原判断） | 原写"云端 `/api/status` 不返回 `bilibili/douyin/wechat/queue`，而 `BilibiliTab`/`DouyinTab`/`WechatTab`/`QueuePanel` 都在读它们 → 后台四组件云端恒 `undefined`"。**两条前提都是错的**：① 这四个组件**根本不读 `/api/status`**——实测 `web/src/components/{BilibiliTab,DouyinTab,WechatTab,QueuePanel}.jsx` 请求的是 `/api/sources?type=…`、`/api/queue/pending?type=…`、`/api/auth/douyin/status`、`/api/backup/latest`；② 全前端只有 `OverviewRail.jsx` 与 `main.jsx` 的预取表引用 `/api/status`（都只读轻投影那 4 个键）。<br>真正的事实是另一件事：**这四个组件已经没有任何挂载入口**——`AdminPage.jsx:11-19` 只 lazy 挂 9 个 Tab，`grep -rln "BilibiliTab\|DouyinTab\|WechatTab" web/src` 只命中它们自己与 `QueuePanel` 的相互引用（`DouyinTab` 一类是 T5-10"抖音永不云端化"决策下**主动下架但组件保留**，`docs/eval/whitebox-baseline.json` 里 W7 的豁免注就是这条）。已另立 **B95** 交 38 域裁决。 |
| **B95**（新，随 B88 撤回而来） | ⏸ 需裁决 | 死组件面：`BilibiliTab.jsx`(323 行含 QueuePanel) / `DouyinTab.jsx` / `WechatTab.jsx` / `QueuePanel.jsx` 四个组件**在本机端与云端都没有入口**，但代码与它们发出的请求仍在仓库里，且 W7 判据靠 baseline 豁免维持绿色。两个选项：①**删**（连同 W7 的 2 条豁免与 `/api/auth/douyin/*` 本地路由的调用面），本机端排障能力也随之消失；②**挂回入口**（本机端专属 Tab，云端仍不暴露），则要回答"云端后台为什么要显示本机专属面板"。属 38 域信息架构，不自作主张。 |
| **B89**（新，已随 B26 修） | ✅ | 本地来源榜原本只算**最新 1 期** `daily_reports`，而界面文案写「近7天入早报」、云端算 7 期 → 同一句话两端不同值。已统一成 7 天并补头像，I10 钉住不许退回单期 |
| **B90**（新，已修） | ✅ | `todayNew/weekNew` 的"今日"用**容器本地时间**取 0 点（`new Date(); setHours(0,0,0,0)`）：Vercel 跑 UTC → 北京时间 08:00 前统计的是 UTC 那一天。同刻实测：线上（UTC 日）`todayNew=3554` vs 北京时间日 `9626`。<br>**取哪一边不是拍脑袋**：全站语义本来就是北京日（日报窗口四处都写死"北京昨日 06:00 → 今日 06:00"），所以"今日"= **北京 0 点**；本地端此前"看起来对"只因为开发机恰好在北京时区。<br>修法：新建唯一口径 `lib/time-window.js`（`beijingDayStartIso` / `weekAgoIso`），三处消费点全接：本地 `server/routes/status.js`、云端 `api/[...slug].js#handleStatus`、本地灾备日报的"今天生成过没有"(`server/services/ai/daily.js#needsGeneration`)。`weekNew` 的"近 7 天"**保持滚动 7 天**（不含时区）—— 改成日界对齐会换一个已在用的数字，属另一件事，别顺手。<br>**锁**：B1~B4（`tests/regression-20260920b.test.js`）。B2/B3 是关键的那两条：**同一份夹具数据分别在 `TZ=UTC` 与 `TZ=Asia/Shanghai` 的子进程里跑两端端点，两侧都必须等于 2**（改前 UTC 侧会得 3，夹具里刻意种了"北京日前 1 小时"那条就是为了它会翻车）；B2 还顺带补上了"云端 catch-all 的 `/api/status` 从来没有路由测试"这个洞——写它时我把 `dayStart.toISOString()` 改成 `dayStartIso` 前的一版留下 ReferenceError，正是 B2 当场抓的。B4 判"日界只许一份实现"时要过 `stripComments`：我自己的注释里就写着 `setHours(0,0,0,0)`，不过注释会把自己判红（坑 #59）。<br>**09-20 凌晨扩面（同族 B96/B97/B99 一起收）**：`lib/time-window.js` 补齐 `beijingNow / beijingDateStr / beijingDayRangeIso / dailyReportWindowIso`（日报窗口算术原来三处各抄一遍）；"只许一份实现"的判据从**三个文件写死清单**改成全仓派生扫描 `lib/time-caliber.js`（回归锁 B4 与白盒 **W16** 共用同一份事实，六种被禁形态逐个配反向样本，防"正则写空也算过"）；前端另写 `web/src/beijing-date.mjs`（浏览器不能 require CJS），由回归锁 C5 **逐时刻跑数**比对而不是比文本。锁从 B1~B4 扩到 B1~B6 + C0~C6，`npm test` 440/440。 |
| **B91**（新，已修） | ✅ | `tools/audit-cloud.js` 用**全局 fetch**，而 undici 的 `ProxyAgent` 只有配 undici 自己的 fetch 才生效 → 本机直连不通时表现是 **19/19 "fetch failed"**，被读成"云端全挂"（而这支脚本存在的意义正是发现云端问题；同一坑早写在 `eval-preflight` 注释里，只是没共享出去）。修：基址+代理+出口统一进 `lib/cloud-site#cloudFetch`，preflight 改用它不再各留一份 PROXY；新增 **isEnvOutage**——非 SKIP 全失败且一条 HTTP 响应都没拿到时判**环境红退 2**，并指路 `EVAL_PROXY`。修后实测 20 通过/0 失败/1 未验收（共 21），含 B26 两条新观测位（轻投影 200/3044ms、按需重统计 200/551ms）。锁 I12（含 isEnvOutage 的三种输入行为断言，不用字面量断言） |
| **B92**（新，随 B8 拆出） | 待办 | `mdInlineParse` 只做**行内**标记（粗体/高亮/行内码/链接），**块级结构全不支持**：AI 译文正文里的 `- 项目`、`1. 编号`、`### 小标题`、空行分段现在会被压成一整段（换行靠 `whitespace-pre-line` 兜，列表符号原样露出）。B8 的"分流"修不了这一层，别把两件事混成一件核销。归 37 域（前端渲染）；改动面：`web/src/components/ui/md-inline.js` 加块级解析 + 一条行为锁（样例两种结构都要断言，防"只解析了粗体"式假绿） |
| **B96**（新，已修） | ✅ | `POST /api/daily/regenerate` 删"今日已有日报"时，把**北京日期串当时刻用**：`todayStr = 北京日期`，边界却拼成 `${todayStr}T00:00:00.000Z` —— 那是"上一个 UTC 日"，于是**北京 00:00~08:00 之间生成的那一期删不掉**，手动重新生成会在同一天插出第二份日报（runner 每早北京 00:32 写的正好就在里面）。修法：删除区间走 `beijingDayStartMs()` 的北京日界。锁 `tests/regression-20260920c` C4（含"旧边界本来也能覆盖它"的夹具强度自证，防空跑）。同类根因见 B90/B97/B99 —— 都是"日历日"与"时刻"混用。 |
| **B97**（新，已修） | ✅ | `GET /api/daily` 判"今天已经有一期"用的是 `genDate.toDateString() === now.toDateString()`，`toDateString()` 读**容器本地**日历日，Vercel 是 UTC：runner 北京 00:32 写的那一期，其 UTC 日历日是前一天 → 同一个北京日里再打开日报就被判成"昨天"→ 走补生成分支**多插一行日报**。<br>修法：改成比 `beijingDateStr(genDate) === beijingDateStr()`。<br>**锁与一次自我纠正**：第一版 C1/C2 拿真实钟点跑，注释里写"未修必红"却没验证——该缺陷只在"北京日相同、UTC 日不同"（即北京时间 08:00~24:00）暴露，凌晨跑会绿着空跑。现在子进程里**钉住 `Date.now`**（北京今日 13:00 vs 同一北京日 00:32 那一期），C0 断言夹具前提（UTC 日必须不同），C3 把判定退回 `toDateString` 形态做负向自证：变异体必须**跑出**红读数（加载失败算探针坏，不算锁红）。<br>⚠️ 同一函数里 `hour >= 1` 那条**没改**，见 B98。 |
| **B98**（新） | ⏸ 需裁决 | `api/[...slug].js#handleDaily` 的补生成门槛：注释与历史上都写"北京时间 9:00"，代码读的却是**北京小时数 ≥ 1** → 实际门槛是**北京 01:00**。本轮只统一了时区口径（`beijingNow().getUTCHours()`），**没动触发点**——改了会挪动云端补生成的时间、进而改变"谁先写这一期"（runner 00:32 / 云端读层兜底）。要么把注释改成真话，要么把条件改成 9；两种行为不同，等用户拍。 |
| **B99**（新，已修） | ✅ | 阅读器日期筛选**差 8 小时**，而且是三层各自为政：① 服务端把前端来的日历日拼成 `T00:00:00.000Z`/`T23:59:59.999Z`（= 当 UTC 日用），本地 `articles.js`/`videos.js` 的 `buildWhere` 与云端 `[...slug].js` 的文章/视频/播客三条分支共 18 处同一写法（下游消费点 30+）；② 前端 `timePresetToDate` 三档各算各的：`today` 用 UTC 日、`week` 用浏览器本地周一再转 UTC 串、`month` 用浏览器本地年月；③ 导出文件名也直接 `new Date().toISOString().slice(0,10)`。<br>修法：服务端新增 `beijingDayRangeIso(日历日)`（`lib/time-window`，北京日区间）并把 `buildWhere` 一处收敛（多个消费点共用）；前端另写 **`web/src/beijing-date.mjs`**（浏览器不能 require CJS），"今天/本周/本月"与导出名都走它。<br>**两份实现怎么保证不分叉**：C5 **真的 `import()` 那份 ESM 跑数**，与 `lib/time-window` 在 103 个时刻（含跨月/跨年/北京 0 点两侧）逐一比对 `beijingDateStr`，再断言"拿 UTC 日当对照"时判据有区分度（否则 C5 是空的）；C6 钉住前端确实把它用在筛选参数上（不是造个没人调的函数）。<br>**云端实测**（`tools/_evidence-b90-b99-cloud.cjs`）：`from=to=2026-09-20` 返回 30 条，落在这次的北京日区间 `[09-19T16:00Z, 09-20T15:59:59.999Z]` 内、越界 0 条。 |
| **B100**（新） | ⏸ 挂 38-3 | 阅读器的**选中态与筛选都不进 URL**：实测打开 `https://…/reader/?q=Israeli%20president%20pardons`，页面 9837 字但列表不过滤（`ReaderPage.jsx` 全文没有 `location.search`/`URLSearchParams`，只有 `api.js:113` 在拼请求参数），点开某篇文章也不改地址栏 → 分享/刷新/后退都回不到那一条。E7 只覆盖了 `/hot/` 的 tab 深链，阅读器这一面从没进过任何剧本。<br>本轮**不改**：动的是路由与状态模型（38-3「深链可寻址」的前置），且和 B71/B72/B74 同一片代码，等 38 域一起落。 |
| **B93**（新，已修） | ✅ | 后台「RSS 最后同步」自上线起恒显示"从未同步"。根因：库里有 1 行 `sources.last_fetched_at` 是**字面字符串 `'null'`**（B15 同族的迁移期污染），文本序 `'null' > '2026-…'` → `MAX()` 取到它，读层归一化后又变回 `null`（详见坑 **#60**）。修法：`MAX(NULLIF(last_fetched_at,'null'))` 在 SQL 层排掉。<br>**第一轮我只修了 4 处里的 1 处**（第二次审查抓出）：现在补全 —— 本地 `status.js` 的 rss **与 bilibili** 两条、云端 `[...slug].js` 的 rss/bilibili 两条、外加诊断脚本 `tools/_diag-media.cjs` 那条（这一条是判据 **W15** 上线时自己扫出来的）。`rssNextFetch` 的 `MIN(next_fetch_at)` **故意不改**：`'null'` 抢不到最小值，改它只是让判据看起来对称（W15 只收 `MAX`，理由写在那条判据里）。<br>**锁**：I14 行为锁（种 4 条源：rss/bilibili 各一行真时间戳 + 一行字面串，断言端点回真时间戳，另带"四条真进库、两行真是 `'null'`"两条前提探针防空库假绿）+ 白盒 W15（全仓扫 `MAX(last_fetched_at)`）。<br>**注意这是绕过污染、不是订正污染**：B15 的 24855 条 `'null'` 仍在库里，订正等授权。线上侧 `GET /api/status` 的 `lastSync.rss` 本轮实测已回 `2026-09-19T16:16:47.000Z`（此前恒 null） |
| **B94**（新，代码面已修） | ◐ | 来源名/标题里带着**未解码的 XML 实体**上屏。实测面积（`node tools/_q-entities.cjs`，只读）：**`sources.name` 13 行 / `articles.title` 177 行 / `articles.summary` 4095 行**含 `&amp;` `&quot;` `&apos;` `&#39;` 等；且**不是死角**——线上 `GET /api/status/daily-sources` 的 Top3 里有 2 条被污染（来源榜就在阅读器右侧）。<br>**根因不是"忘了解码"，是同一语义有 9 份实现**：4 份各自抄的映射表（wechat 适配器 / 云端 `parseOpml` / `ai/summary.htmlToText` / `aihot/enrich.unescapeHtml`，每张都少几个实体）+ 5 份只解 `&amp;` 的 URL 属性解码。本轮把它们**收敛成 `lib/text-clean#decodeXmlEntities` 一份**，并给三端 5 处标题/源名构造点接上 `cleanTitle`（`server` RSS 条目与源名与 YouTube 标题、`api/collect.js`、`runner` 两处）。锁 A1~A4（A3 不设豁免：任何一处 `.replace(/&实体/` 重现即红）。 F2P 已出证：base `871fee4` 改前 **4/4 红**、head `ffd1f18` 改后 4/4 绿（`docs/eval/f2p/2026-09-19185813.json`）。<br>**故意没做的两件事**：① **summary/content_html 不解码**——里面 `&lt;b&gt;` 是"被转义的内容"，解一次就变成真标签，会被 B8 的"像不像 HTML"判据误判成分支（A4 钉住这个决定）；② **存量 4285 行不动**：UPDATE 是生产写，等授权（与 BL10 同一批）。<br>**待线上复验**：runner 每 15min 采集，新行标题应不再带实体；复验口径 = `tools/_q-entities.cjs` 只看最近窗口的新增行（不手推生产）。<br>**09-20 04:47 线上复验已做**（只看部署后新增行）：`articles.title` 新增 36 条 **0 条含实体** ✅；但 `articles.summary` 新增 36 条里 **2 条仍露 `&#8217;`** —— 那正是"故意不解码"那一支（A4 钉住的摘要侧不解码），所以**这条不能核销成 ✅**：卡片摘要会直接把实体串上屏，是用户可见的。要么给 summary 单独走"只解命名实体、不解 `&lt;` 类标签实体"的窄口径，要么接受它——**改法待定，别顺手**；存量 152 条标题含实体仍等授权订正。<br>**过程中的自打**：第一版测量脚本把部分模式写成 `'&amp;%'`（前缀）而非 `'%&amp;%'`（包含），于是同一张表同时得到"源名 0 条"和"6 条"两个数——是判据少了个 `%`，不是数据变了。已修正并在脚本头写明（坑 #41 补②）。|


### ✅ 本轮已修（2026-09-19 自主轮；**"双证据"只对被 `--cases` 点名的锁成立，且条数一律以证据 JSON 为准**）

按 `docs/NEXT-DEV-REQS.md` T6「第 1 步 当天可修小刺」执行，`docs/EVAL_GUIDE.md` §6 口径验收，
锁文件由 `npm run eval:f2p -- --auto-base` 出证（不再手工开 worktree）。

> **09-19 夜复查（B114）**：本节与 `docs/specs/41-e2e-whitebox-eval/spec.md` 41-3 行此前写的红/绿条数**与证据 JSON 对不上，
> 且两处互相矛盾**（同一批 `d` 在本文写 23/29、在 spec 41 写 25/31，实测该基线只有 3/3）。
> 根因是把"锁文件里的用例总数"当成了"本轮改前红的条数"——`--cases` 只点名本轮的锁，
> **Y 必须是点名的目标锁数**。下表为唯一写死处（读数直接取 `base.fail` / `head.fail`）：

| 证据文件 | 基线 | 本轮点名的锁 | 改前红 / 点名 | 改后 | 备注 |
|---|---|---|---|---|---|
| `…021348` | `4f87120` | B27 / B28 / B29 / B22 / B47 / B48 | **6/6** | 6 全绿 | base 侧另报 `missingOwn: ../lib/reading-filters`（当时属真新建文件，不影响点名条数） |
| `…021351` | `44073de` | B60 / B61 | **8/8** | 8 全绿 | |
| `…021354` | `b766bf6` | B39-1~3 | **3/3** | 3 全绿 | ← 此前"23/29 / 25/31"两个数字都无出处 |
| `…021356` | `5c28ae5` | B53 族 | **3/4** | 4 全绿 | 1 条按设计不参与 F2P（P2P 守卫） |
| `…021359` | `82a33d0` | B51 / B54 / B56 / B58 | **8/12** | 12 全绿 | 同上：4 条不参与 |
| `…021402` | `2e2c757` | F6 | **3/3** | 3 全绿 | |
| `…021747` | `947e753` | B64~B67 | **13/13** | 13 全绿 | spec 41 里写的"e 12/12"少 1 条 |
| `…021752` | `f3172b2` | 41-8 五条 | **5/5** | 5 全绿 | ← 此前"f 5/6 红"的"6"是用例总数口径 |
| `…021421` | `f58337f` | 41-3 自检族 | **7/7** | 7 全绿 | |

复核方式（不复制数字，只给取法）：`node tools/_f2p-ledger.cjs`（本轮新增的一次性汇总探针，未跟踪）
把 `docs/eval/f2p/*.json` 打成一张 `base.fail / head.fail / wantNames / missingOwn` 对照表。

| 缺陷 | 修法 | 证据 |
|---|---|---|
| BL1 测试基线 4 红 | 锚点从已独立成仓的 `portal/*` 迁到根树真文件；A9 改判"AdminPage 每个懒加载组件必须存在"（正好锁住 B13 那类"引用了但没入库"）；A10 改判"api/ 函数面必须等于白名单" | 301 项 0 红（结果见本轮 `npm test`） |
| B27 未知日期 | 云端 `/api/reading` 快路径补 `COALESCE(published_at,created_at) AS date` | 回归锁 B27 |
| B28 类型筛选被 OR 吞 | `WHERE (${tabCond})${aExtra}` 加括号 | 回归锁 B28 |
| B29 类型口径 | 文章含 `wemp`（881 篇不再隐身）；播客改按音频 enclosure 判（原 `s.type='douyin'` 云端 0 篇）。**⚠️ 更正：当时只改了云端列表，本地列表 + 两端计数没动 → 由 B60 接续修完** | 回归锁 B29（弱，见 B60-7 强锁） |
| B22 成功率颜色 | 三主题各补 `--warn` 令牌 + 定义 `.t-success/.t-warn/.t-danger`（不新造用法层硬编码色） | 回归锁 B22 |
| B47 任务队列恒 0 | `MonitorTab` 改读 `queueStats.overall`（线上真实 pending=177 此前显示 0） | 回归锁 B47 |
| B48 报警日志转义串 | JSX 文本转义改表达式 `{'（'}{rr.error}{'）'}` | 回归锁 B48 |
| B52 翻译 Skill 恒加载中 | 云端缺路由时显式报错并指向 39-6，不再停在占位文案 | 回归锁 B52 |
| **B59（新发现）** | 云端缺 `/api/auth/me`（本地 `server/routes/auth.js` 早有）→ `checkAuth()` 恒 404，**带有效 token 也被判未登录**，管理台反复要求重登。云端补路由并复用 `verifyAuth` | 回归锁 B59 |
| 坑 #35 阈值分叉 | 新建 `lib/source-breaker.js` 作三端唯一实现，`store.js`/`lib/collectors/fetcher.js`/`api/collect.js`/`tools/collect-turso.js` 全部改引用（此前本地固定 3、云端 YouTube 10） | 回归锁 坑#35 + 白盒 W1a/W1b2/W1c |
| 坑 #36 根因 | `migrate-to-turso.js` 序列化先判 `v === null`（**只修根因，已污染的 2.5 万行数据订正仍按 BL10 等授权**） | 回归锁 坑#36 |

**同轮新增工具**：`tools/eval-preflight.cjs`（41-1，环境前置 + BL7/BL8/BL9 配置告警）、`tools/eval-whitebox.cjs`（41-4，W1~W9 不变量 + `docs/eval/whitebox-baseline.json` 棘轮基线），已接 `npm run eval:preflight` / `npm run eval:whitebox`。白盒首跑即抓出 B28、B52、B59 三个真缺陷与 3 处 W4 误报（已收紧判据）。

#### 第二批（同日晚，云端实测逼出来的）

推上去后按 `DELIVERY_VERIFICATION` 打真线上端点，**第一次实测还误用了参数名**（把 `type` 当 `tab`）——
教训已进 EVAL_GUIDE §3.3：断言必须来自"读过的真实契约"，不能猜。实测坐实 B27 ✅、SSRF 三种内网地址全 400 ✅、
`/api/auth/me` 401 ✅，但暴露 B29 只修了半截 → 顺出 B60/B61：

| 缺陷 | 修法 | 证据（F2P） |
|---|---|---|
| B60 六份判定副本 | 新建 `lib/reading-filters.js`（type 口径唯一实现）+ `lib/media.js#audioCoverSql`（音频判定唯一实现），本地 `server/routes/reading.js` 与云端 `api/[...slug].js` 的**列表、计数、视频侧开关、搜索是否绑定**四处全部改引用；播客计数 0→143、article 计数 6413→7282（真 Turso 复测） | `tests/regression-20260919c.test.js` 8 条，修前 B60-3/B60-4 红（点名本地端未接入），修后 8/8 绿 |
| B61 副本少 `.opus` | 四处 runner/日报/阅读器/读层判定统一由 `audioCoverSql` 生成；顺带把 `tools/collect-turso.js` 日报+周刊两处也接上 | 回归锁 B61（全库扫，只许 `lib/media.js` 持有特征字面量） |
| B39 生成历史假窗口 | 窗口 SQL 收进 `lib/brief-guards.js`（`DAILY_HISTORY_SQL` + `historySinceIso`，59 行/7 天全露，安全上限 200），并投影 `tier`（ai/keyword/degraded）与 `windowDays/dailyCount/dailyAiCount`；前端标题改由接口回传，裸关键词版从绿色「正常」改为 warn 徽章「无 AI」并带 tips，降级徽章 gray→red。**顺带订正旧记录**：本条原写"27 行真窗"，复测真值是 59 行 | 回归锁 B39-1/2/3（`tests/regression-20260919d.test.js`，修前 3/3 红 → 修后 3/3 绿；B39-2 是真库跑真 SQL，不是字符串断言） |
| 同类问题要能自动发现 | 白盒新增 **W10**：按 **LIKE 模式集合重叠度**判"同一判定抄多份"（≥3 个共享模式即红）。不按字面量全等——本例副本间正是"差一个扩展名"，全等检测器会完全漏掉 | 负向验证：塞两份差一个扩展名的副本 → W10 红；删掉 → 绿 |
| JS 与 SQL 两份实现会漂 | 回归锁 B60-5：同一批 10 个封面 URL，`detectAudioUrl()` 与 `audioCoverSql()` 判定必须逐条相同 | B60-5（改坏任一边即红） |
| 断言自己也会假绿（新踩坑） | B53 第一版截断检测正则永不命中 → 坏代码在场仍显示绿。规则补进 `EVAL_GUIDE.md` §4.1：**禁止型断言必须配一条正向探针**（把已知坏写法喂给同一正则，断言它命中），已落 `B53-0` | B53-0（写不出探针的断言按 §7 删） |
| B53 死码与错字（归属 39-2） | 删 `tools/collect-turso.js` 里定义后全仓零调用的 `llmChat()`（53 行，含一份与 `api/_ai.js` 并行的 AI 供应商降级链——留着等于骗后来人"runner 有统一 AI 通道"）；`AiSettingsTab` 去掉 `.slice(0,20)`（API 地址此前显示成 `apihub.agnes-ai.com/`，容器本身已有 `truncate`）；「Agencs→Agnes」错字清 3 处（含 `docs/DEVELOPMENT_STANDARDS.md:176`） | 回归锁 B53-1/2/3，修前 3/3 红 → 修后 7/7 绿 |
| B62 前端第七份分类副本 | 接口为每条阅读条目回传 `kind`（`lib/reading-filters.js#readingItemKind`，视频/播客/文章三态，播客走 `detectAudioUrl`），本地与云端两处响应出口都过 `withReadingKinds`；前端 `typeLabel` 改读 `it.kind`，删掉 douyin 猜测 | 回归锁 B62-0/1/2（B62-0 是正向探针） |
| B51 假 AI 开关（用户已裁决摘除） | 摘掉 4 个复选框 + 「x/4 已启用功能」假统计 + 「操作流程说明」整块（约 3.7KB 界面代码），并**连后端的读写面一起删**：`ai.features` 此前在 GET 里回显、PUT 里写回，全库无一处行为读它。「摘要」「栏目分类」「事件关联」本就是规则实现，挂着 AI 开关是骗人 | 回归锁 B51-0/1/2（B51-0 是正向探针） |
| 假开关检测器有缝（B51 漏网的原因） | W3 原判据是「后端从不读」，而 `ai.features` **确实被读**——只是读它的那一行只是把它塞进同一个 GET 响应再显示一次。新增 **W3b**：某 settings 键的每一处 getSetting 都长成响应对象属性 → 判假开关。已负向验证：塞一个 `ai.fakeDemo`（GET 回显 + PUT 写回 + 界面含该键）→ W3 红；删掉 → 绿 | 白盒 W3b（`npm run eval:whitebox`） |
| B54 保留天数改了不保存 | 拆出独立 `saveRetention` + 「保存保留天数」按钮（不受 `previewTotal===0` 限制，按钮态显示已保存/有未保存改动），并把原先藏在 `doCleanup` 成功分支里的 `PUT /api/settings` 摘掉——设置不该是清理的副作用 | 回归锁 B54-0/1/2，修前 2 红 → 修后全绿 |
| B58 分类表显示假默认 | 三方收敛：新建 `lib/hot-categories.js` 作为六类与映射的唯一实现（含线上实际 feed 名），本地 `server/services/hot.js` 改为引用它，云端 `handleHotCategories` 补回 `{categories, map, categorySource}`，前端删掉自带 `DEFAULT_MAP`、按 `categorySource` 显示「线上生效配置 / 内置默认 / 读取失败」三态徽章，`.catch(() => {})` 改为显式 error 行 | 回归锁 B58-0/1/2（B58-0 双向探针：既要求探针能看见坏形态，也要求"必须含 map"的断言对旧坏写法**不**匹配，防止断言写太松变假绿） |
| B56 快照区把"做不到"说成"还没做" | 两端 `/api/data/list` 加**布尔能力位** `fileSnapshots`（云端 false / 本地 true），界面先判能力位再判列表长度，不支持时显示"本部署不提供该能力"并禁用生成/导入按钮；note 只当说明文字，不再是唯一载体（坑 #38） | 回归锁 B56-0/1/2（B56-2 判的是**分支顺序**：能力位必须排在长度判断之前，因为「暂无快照」在本地端是正确文案） |
| 35A-F6 系统性故障不再折算成单源失败 | `lib/source-breaker.js` 加 `errorFingerprint()` + `detectSystemicFailure()` 三闸门判据：量级（≥30% 或失败数 ≥20，样本 <5 不判）＋同源性（≥60% 同指纹，指纹须把 URL/IP/端口/数字打码）＋**环境类**（指纹须命中 ECONNREFUSED/ETIMEDOUT/EAI_AGAIN/TLS/代理/429/503 等）。runner 命中后仍记 `status='error'`+`lastError` 供排障，但**不累加 fail_count、不熔断**，并在批次统计里标 `systemicSuppressed`。第三道闸门是刻意加的：没有它，一批同源 404（源真死了）也会被整批赦免，抑制器就变永久免死金牌。本轮只做 F6 这一条判据（T6 第 1 步已批），F1-F5/F7-F9 仍属 35A 待批 | 回归锁 F6-1/2/3（7 个场景实测：代理风暴抑制 / 25 超时抑制 / 30 同源 404 **不**抑制 / 指纹分散不抑制 / 小样本不抑制 / 正常轮不抑制 / 429 风暴抑制）；F2P 见 HEAD worktree 三条真空红；坑 #39 |
| B64 云端基址 5 份手写副本，其中一份是 404 域名 | 新建 `lib/cloud-site.js` 作为云端基址唯一实现（可 `CLOUD_SITE` 覆盖），`tools/audit-cloud.js`、`tools/eval-preflight.cjs`、`tools/_test-api.cjs`（3 处）全部改引用。**发现过程**：我自己在探针里凭印象打了 `qwis-portal.vercel.app`（仓库名≠应用名）拿到 `DEPLOYMENT_NOT_FOUND`，顺查发现巡检脚本 8 天来打的一直是 2026-09-11 已下架的这个域名（坑 #42/#43） | 回归锁 B64-0/1/2：基址与 `FEATURE_MATRIX` 双向对账 + 全库活代码扫 `*.vercel.app` 字面量 + 死域名回归 |
| B65 巡检把"失败理由"算成通过：`pass: !!verdict` | 判据改为**只有 `true` 才算通过**（抽出纯函数 `verdictToResult`），失败理由字符串一律 `pass:false`；新增 `SKIP:理由` 第三态（未验收单列，不进分子也不静默删）；补诚实退出码（有失败即 1）；`main()` 加 `require.main` 守卫，被 require 时不再自动打云端 | 回归锁 B65-1/2/3（含 `undefined`/`false`/字符串/ SKIP 四种返回的判据表）；实测修后 `通过 18、失败 0、未验收 1` |
| B66 巡检的三条判据断的是不存在的契约 | 实测改正：`/api/sources` 载荷键是 `sources` 非 `items`；`/api/collect?key=wrong` 的 GET 是 405（只接 POST），鉴权语义改用 POST 断 403；`/api/articles/1` 原判据 `b.ok \|\| status===404` 是永真式，改为 200 且带 `item`；`?dedup=1` 在云端读层**无任何实现**（`api/[...slug].js` 只有日报内 `dailyDedup` 与 `POST /api/sources/dedupe`），改为显式未验收并挂本条 | 回归锁 B66-0/1（正向探针锁 + "判据必须对得上实测契约"锁，并反向锁"若将来真实现 dedup 参数则本锁必须改判"） |
| B67 报警出口判据给 P0 的 BL7 开绿灯 | `eval-preflight` 原判据是 `enabled && url.startsWith('http')`，而生产库唯一渠道是 `test-ch` → `http://127.0.0.1:1`（必然 fetch failed 的哨兵），于是门禁显示「1 个可用渠道 ✓」。新建 `lib/alert-channels.js`：回环/哨兵端口/`undefined`/非 http(s)/`test-*` id 一律不算出口；另加 **dispatched ≠ delivered** 判据（读 `alerts.recentLog` 近 7 天：全失败=红、无记录=未验证、有 ok=true=绿）。修后 preflight 如实报红 | 回归锁 B67-0/1/2/3（含正向探针：真公网 webhook 必须算有出口，防止判据写成"永远红"）；掩码要求一并锁住（webhook token 在 path/query 里，报告只许出现 `scheme://host/…`） |
| B71 后台入口漏挂 LanguageProvider | `web/src/admin.jsx` 在 `<ThemeProvider>` 内层补 `<LanguageProvider>`（包住 `AdminPage`/`Toaster`/`LoginGate`）。**并把它一般化成白盒 W11**：按入口的**模块图**判——入口可达的任何文件调了 `useI18n()`/`useTheme()`，入口自己就必须挂对应 Provider；只查入口文件本身是抓不到的（`AdminPage` 自己不碰 i18n，用的是它下面的 `LoginModal`） | 回归锁 G1/G2（`tests/regression-20260919g.test.js`：Provider 在位 + 字典键与调用点同时存在，防"删键造成看着修好"）；负向验证：把 admin.jsx 还原成修前状态 → W11 红、E8 红，挂回 → 全绿；端到端 E8 首轮证据 = `docs/eval/e2e/*/report.json` |

顺带清掉 `server/routes/reading.js` 里三个从未被引用的类型集合常量（同一分类的第三份表示）。

#### 第三批（09-19 深夜，用户两条页面批注 + B72；改前红/改后绿齐全）

| 缺陷 | 根因与修法 | 证据 |
|---|---|---|
| B85 日报「奇怪的大框」 | **不是写死高度，是 flex 宽度饿死**：`ColumnSection.jsx#CompactRow` 的来源列是 `flex-none whitespace-nowrap` 且**不设界**（该条实测 620px——来源名是 SEO 拼接串），与推荐理由/星级/标签同为不可收缩兄弟，基准宽之和 1179px > 行宽 1014px；而标题列 `flex-1` = `flex:1 1 0%`，**基准 0 意味着收缩阶段永远抢不到宽度** → 被压到 0 宽，且 **0 宽下 `-webkit-line-clamp` 不再裁剪**（`scrollHeight` 实测仍 554px）→ 标题按字换行，一行撑成 594px。修法：来源列自截断 + 上界（时间单独一段，永不参与截断）、标签列加上界、标题列给 `min-w` 下限、行 `overflow-hidden`；`MyBriefPage#RestRow` 同一字段同一形态，一并设界 | 线上实测同一页同一数据：最长行 **594px → 129px**，标题列宽 **0 → 160px**，37 行 0 行超 160px；端到端 E3 新增两条判据（行高 ≤160 且标题列 ≥100，阈值取实测 129+余量）；F2P `docs/eval/f2p/2026-09-19114959.json`（base `d679167` 红 → head 绿 I1/I2） |
| B84 早报媒体栏「没有图标」 | `lib/media.js` 的口径早就写了「cover 置空后由源头像兜底」，但**显示层只画了一枚 emoji**：`MediaRow` 无封面分支 = 56×103 灰块 + 🎧。修法：三份媒体栏实现（`api/[...slug].js` 日报、`tools/collect-turso.js` 日报、同文件我的早报）统一带出 `s.avatar AS source_avatar` 并写进 media 项；`MediaRow` 无封面分支改渲染 `SourceAvatar`（内部再兜底首字块），🎧/▶ 换内联 SVG（新增 `HeadphonesIcon`，与 `PlayIcon` 同线性风格） | 线上 `/mybrief/` 实测：视频/播客卡 **DOM=10 / API=10，左栏有真实图形 10/10，整页 🎧/▶ 计 0**，4 张播客卡铺出首字头像（跨/跨/第/T）；端到端 E6 新增三条判据（含一条与数据无关、永不空转的「整页零 emoji」）；F2P 同上 I3/I4。**残余（不算已验）**：现存报告是修前生成的、没有 `source_avatar` 字段，所以**图片分支尚未实测**，须等下一批生成后复验 |
| B72 拼错路径静默渲染阅读器 | `vercel.json` 的 catch-all 让所有非 `/api/`、`/data/` 路径回 200 + `index.html`，而 `main.jsx` 的路由末尾是**无条件 `else → ReaderPage`**。修法：加 `KNOWN_PREFIXES` 白名单 + `NotFoundPage`（404 + 回链 + `data-e2e="notfound"` 锚点）；阅读器只在白名单内渲染 | 线上 `/videos/` 实测：兜底块唯一、显示「404 没有这个页面：/videos/」、6 条回链、页面不含「加载更多/稍后阅读」；端到端 **E10 从 `KNOWN_GAPS` 摘回门禁位**（KNOWN_GAPS 现为空），F2P I5/I6 |
| 布局类缺陷怎么锁 | 可见面只能在线上量（eval:e2e 的 E3/E6 行高/图形判据）；离线锁钉**契约**——组件里写没写宽度上下限、三份实现是否同步带字段、路由有无白名单外分支。逐行匹配会误杀合法写法（界写在包裹层、字段在内层），故锁按「渲染该字段的元素其**开标签**是否含 `max-w-[`」判定 | I1/I2 第一版把修好的代码判成红（假红），改写后 base 红 6/6、head 绿 6/6 |
| **自打回归：修撑高修成了裁切**（对抗审查追问 + 本轮实测坐实） | 第一版只做"上界 + 主列下限 + `overflow-hidden`"，而带下界的兄弟列仍是 `flex-none`（不可收缩）→ 800px 视口实测 **37 行里 6 行 `scrollWidth` 超行宽 75px，被 `overflow-hidden` 剪掉行尾**（星级/来源/缩略图）。即 B85 的"空心大框"没了，但换成了一个看不见的新缺陷 | 改成"理由/标签/来源三列 `min-w-0` 可收缩，先让它们让位"；改前先在**线上真实数据**上做过几何验证（溢出 6→0、标题列仍 160、行高仍 ≤129）。锁 I7（带 `max-w` 的列必须同时可收缩）+ E3 增加 800/1024 两档视口扫描（单视口结构上抓不到"只在窄档裁切"）；F2P `docs/eval/f2p/2026-09-19122458.json`（base `bc1e4e4` 红 → head 绿） |
| 独立审查其余两条查出 | ① B84 追问"有没有第四份媒体栏实现"：媒体栏本身仍是三份（已核），但查出**本地端日报结构性没有播客栏**（≠ 本条残余）；② 搬迁把 B 站线上探针一并搬走了；③ `git check-ignore` 实测证明我"驱动文件已被 .gitignore 覆盖"的说法是**假的**（四个名字全 NOT IGNORED），此前从未有过该规则 | ①②登记 **B86 / B87**（本轮只记账未做）；③补 `.gitignore` 规则。另把 `/index.html` 加进 B72 白名单（Vercel 真会按字面路径回这个文件，否则我们的 404 会误伤自己的入口页） |
| 评测器自身的判据缺陷 | 审查指出端到端"截图文件存在"类判据可被 1 字节占位文件糊过去（E0 类空跑）；且"无缺口就不登记"使 KNOWN_GAPS 归零后那条守卫永不触发——**永不触发的守卫等于假门禁** | 判据改为**体积阈值**（`tools/eval-e2e.cjs:108` `SCREEN_MIN = 10KB`，实测本轮截图全部过阈值）；"0 缺口"改判为合法状态但归零事件必须可审计，「探针轮 ≠ 验收轮」的口径写在 `EVAL_GUIDE` §3.7。**未做**：W9 基线里仍有 31 条坑无测试字面引用（本轮没清，别声称清过） |


