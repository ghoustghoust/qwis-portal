# 全网情报系统 · 已知问题清单（活文档）

> 只列**当前活跃**的问题（未修复 / 观察中 / 挂案）。
> 已核销历史：`docs/deprecated/ISSUES-resolved-2026-09-14.md`（09-13~09-15 全量，含热点榜三阶段/媒体治理/精选断更根治）
> 与 `docs/deprecated/ISSUES-resolved-2026-09-13.md`（更早）。
> 功能需求类事项见 `docs/NEXT-DEV-REQS.md`。
> 最后更新：2026-09-21（**第二轮核销**：B1~B26 判定轮表、产品选择裁定表、15 条已交付 B 行、B71~B85 已修 11 行、H9/H10/H17、BL2/BL4/BL8/BL10/BL11 出账，原文逐字在 `docs/archive/debugging/2026-09-21-issues-round2-closed.md`；portal 退役与 `.gitmodules` 补建随本轮落档。本档只留「现在什么坏着 + 下一步做哪条」。）
> 归档四件：`docs/archive/debugging/2026-09-21-release-approval-ledger.md`（放行清单 + 放行后落点）· `docs/archive/debugging/2026-09-21-issues-closed-rows.md`（09-21 首轮核销原文）· `docs/archive/debugging/2026-09-21-issues-round2-closed.md`（09-21 第二轮核销原文）· `docs/archive/debugging/2026-09-19-delivery-evidence-ledger.md`（B8~B26 逐条处置与证据对账）。
> 文档清洁与归档规则见 `docs/DOC_GOVERNANCE.md`。

---

## ✅ 放行清单：09-21 整表放行，已出账

> 15 行原文与放行后落点 → `docs/archive/debugging/2026-09-21-release-approval-ledger.md`；排队项 ①~⑤ 与 ⑥a 均已交付（出账行原文见 `docs/archive/debugging/2026-09-21-issues-round2-closed.md` §三，证据各随 F2P JSON）。**只剩两件**：⑥b 转储凭证入库后给 runner 与云端手动端点接同一道删除闸（见 B101/B103 行）· ⑦ B79 订阅集合（你侧动作，见 B79 行）。


---

## 🧮 B1~B26 检验结论（已归档）

> 09-21 收口判定轮三态判定表整节外迁 → `docs/archive/debugging/2026-09-21-issues-round2-closed.md` §二。活跃条目以活跃表为准，拍板结论已写进各行「去处」列。

---

## 📋 交付链状态（历史轮次，已归档）

> 09-19 夜轮 / 09-20 上午轮 / **09-20 夜 B104 收口轮**的十一条状态表与洁净轮记录已外迁：`docs/archive/debugging/2026-09-20-round-status-records.md`（判据不变：AGENTS §3 逐条标"跑了/没跑"，只准留一份活的）。

## 🔴 活跃 bug

> B8~B26 的逐条处置与取证在 `docs/archive/debugging/2026-09-19-delivery-evidence-ledger.md`（**归档 ≠ 验收**，仍待你终验）；本表只留"现在什么坏着"。
> 09-21 出账四条（B12 重锚后全绿 · B13 `/api/meta` 已一致 · B22 颜色类已定义 · B26 已拆独立端点），原文见 `docs/archive/debugging/2026-09-21-issues-closed-rows.md` §四。
> 号位说明：B9 已被 09-14 批次占用（退役源引导），故本表从 B8 起而**无 B9**；B1~B7 在 `docs/deprecated/ISSUES-resolved-2026-09-14.md`（09-12 审计轮的 B1~B4 是另一批同号不同事，引用时必须带轮次）。


> 09-21 第二轮出账：B15（BL10 实测现役库零污染、无需订正）、B19/B20（转观察段）、B25（在途改动已全部随并行会话落库）——原文逐字见 `docs/archive/debugging/2026-09-21-issues-round2-closed.md` §三。

| # | 问题 | 定性 | 去处 |
|---|------|------|------|
| B8 | 综述/文章详情无排版（加粗/重点标注丢失，纯文本渲染） | 前端渲染层（markdown 化） | T5-5 / spec 32 |
| B10 | 每日早报 AI 版仍显示关键词版栏目注解（"Codex、Claude、豆包…"） | AI 栏目 desc 未随 v2 更新 | T5-3 一并 |
| B11 | 后台 Tab 切换懒加载 chunk 冷启动卡顿（前台已做骨架屏，后台未覆盖） | 感知性能 | spec 33 |
| B14 | 「我读了多少」口径曾错：`qOne` 未定义已修、`reading.digest` 已在产出（B112 实测 558 字节）；旧库 99.94% 脏值前提随换库消失（BL10 实测现役库零污染） | 待按现役库复验一次即核销 | 观察段口径 |
| B16 | 周刊导语污染第四次复现（坑 #26）：第 2 期 `theme` 入库为「我需要找到贯穿这些文章的核心主线。」并同步进 `weekly.archive` 标签；且 `generateWeeklyMagazine` 五条 `return null` 全不出声 → coverTheme/storylines 整体为空无从判断 | 清洗器已修（句首第一人称一票否决 + 反向保护用例）+ 放弃原因已打日志；**脏数据需重跑一期周刊覆盖** | 与 B121 同批：下一次 weekly 跑批后按形态指纹复验 |
| B17 | 周刊初筛预算结构性不足：本轮 2015 条候选 × `ai.minIntervalMs=4000` 串行 ≈ 2.2 小时，而 `runWeekly` 的初筛窗只有 `BUDGET_MS*0.4`=24 分钟 → 日志必出现「初筛预算截断」，周刊实际只策展了 `published_at DESC` 前缀，**不是全周内容** | 候选：提高初筛配额 / 改为批量初筛 / 预筛降量（六维分门槛） | **已拍板 09-21**：预筛降量（六维分门槛），不抬配额 |
| B18 | 视频/播客条目的「置信度评分」与「标题翻译」无法呈现：`videos` 表实测**既无 `score` 也无 `translated_title` 列**（列清单：id,source_id,platform,title,url,vid,cover,duration,author,intro,published_at,favorite,created_at,watched_at,play_uri）。`enrichBriefTitles` 也因此结构性跳过视频（id 是 `'v'+id`，查 `articles` 永不命中） | 决策空间：给 videos 建列并接进翻译/深析管线，或放弃 | **已拍板 09-21**：只建 `score` 列，放弃视频翻译 |
| B21 | 每日早报缺「本期索引」（周刊页 T5-6 已有右侧条目索引可复用），且从别的页签切回 `/daily/` 有卡顿；期号方面 `daily_reports` 有自增 `id`（线上 `report.id=100`）但直接当"第 N 期"无意义（含非 AI 批次插入），仍应与我的早报一起走归档设计 | 索引/卡顿待查（卡顿需先定位是 chunk 冷加载还是 46 卡 + 封面重排）；期号并入 H13 一起定 | **已拍板 09-21**：并入 H13 + 40-4 立项（先建 `mybrief.archive` 再谈期号） |
| B23 | 云端 `/api/health/source-stats` 的"成功率"是**布尔伪装**：`api/[...slug].js:1693-1704` 注释自陈「云端无 job_queue 历史」→ 实现 `rate: status==='ok'?100:0`。用户要的"成功抓取概率"目前不存在，且这个假数字比没有数字更误导 | 必须先用 35B 的滚动窗口把分母补上，再改此端点；禁止继续用 100/0 冒充概率 | **已拍板 09-21**：先做 35B 滚动窗口补分母，再改端点 |
| B24 | 采集心跳 `settings.cloud.collect.history` 撑不起任何统计：代码注释写「7 天×24」，实测 168 条只覆盖 **25 小时**；且 `failures[]` **截断 20 条、只含失败源** → 有负样本无正样本，逐源算不出分母（`tools/collect-turso.js:489-505`） | 35B 用每源定长滚动窗口替代；顺带把注释与切片按 mode 分池订正 | **已拍板 09-21**：35B 每源定长滚动窗口替代 |

### 09-19 深夜登记 · 采集保留与删除语义（B101~B103）——B102 已收口（含代码），B101/B103 已放行待做

> 起因：用户断言「云端采集把 24 小时以前的文章删掉，而本地采集没有删除逻辑」并要求停手取证。
> **实测前提不成立**（全仓删除只有 7 天窗口，无 24h 删除；无在途提交，线上 `961fec04` == origin/main），
> 但顺藤摸出方向相反的三个真问题。完整读数、行号与判据见 `docs/specs/43-collect-retention-safety/spec.md`。

> 09-21 第二轮出账 15 条已交付行（B102/B107/B108/B109/B110/B111/B112/B113/B115/B116/B117/B124/B126/B127/B134）——逐字原文与交付证据见 `docs/archive/debugging/2026-09-21-issues-round2-closed.md` §三。

| # | 问题 | 定性 | 去处 |
|---|------|------|------|
| B101 | 保留清理触发口仍缺（`collect.yml` 的 `mode` 选项没有 cleanup）；用户 09-21 裁定「先只接观测，不动触发口」→ 观测读数（`settings['retention.pending']` + `npm run check:retention`）与**强制删除闸**已交付（锁 CO1~CO5；09-20T22:27Z 实删 50,823 条时转储恰已在手、可回放） | 调度触发链缺失（不删是现行裁定） | **仍欠**：云端手动端点 DELETE 前接同一道闸——须先 ⑥b 转储凭证入库，否则 Vercel 上接闸=永久挡下（与 B103 同批）。84.6% 待删量推演与全部读数见归档原文 |
| B103 | ✅ 内容级转储/回放已交付（`lib/content-dump.js` + `tools/dump-content.cjs`，锁 D1~D10；云端 59,832 文章 + 1,291 视频回放逐字段 0 不一致，`--gate` 报 `allowed:true`） | 删除类改动的硬前置（已就位） | **仍欠**：①转储凭证入库（manifest 摘要+校验和写 settings，形态随 ⑥b 一起定）→ 之后 runner 与云端手动端点改判凭证；②`/api/backup` 仍只三张配置表。一手读数见归档原文 |
| B105 | **`tests/regression-my-brief.test.js:82`「2. 有订阅 + settings 报告 → 正常透传」只在 `npm test` 全量套件里红**：驱动子进程以 `status: 3221225477`（`0xC0000005` 访问违例）**在退出阶段崩溃**，而断言要看的载荷已经正确打出来（stdout = `BODY {"ok":true,"report":{"date":"2026-09-12","theme":"测试导语",…}}`）。单独连跑该文件 **3/3 全绿**（每次 `EXIT=0`）。**三轮全量复跑定性完成**：run1 红 / run2 绿 / run3 绿 ⇒ 判 **`fail_flaky`**（1/3 复现，非产品红；`npm test` 的恒红只由 G3 造成）。方向：测试自建的临时库/根目录 scratch 驱动（`.mybrief-driver-<pid>.cjs`）在全量并跑下的句柄/文件竞争，属**测试地基**问题 | 测试地基（`fail_flaky`，1/3 复现；**09-21 换文件复发，见右侧**） | 待做（已放行）：把这类用例改成"退出码与断言载荷分别判"（子进程崩溃要能打出 stderr/句柄），并排查与 `regression-20260919g`（同为 execFileSync 驱动）等文件的并发资源冲突。**09-21 文档整理轮第 4 次复现，且换了文件**：`tests/regression-cloud-sources.test.js:241`「10. groups move kind 校验 + categoryLocked」以 `status: 3221225477`（同一个 `0xC0000005`）在退出阶段崩，而 stdout 已正确打出 `OUT {"status":200,"body":{"ok":true},"dbv":{"gid":2,...,"categoryLocked":1}}` —— 驱动文件形态同为**根目录 scratch**（`.cloud-sources-driver-15724.cjs`，与 `.mybrief-driver-<pid>.cjs` 同款）。⇒ 本条从"某一个文件偶发红"升级为**"execFileSync + 根目录临时驱动"这一族测试地基的缺陷**（`npm test` 该轮 462/463，唯一红即此条，读数 `.tmpchk/test-0921-final.txt`）；**09-21 门禁扩面批再抓到第三例**：`tests/regression-20260920c.test.js` 的 C2（TZ 两侧一致性，同为根目录 scratch 驱动 `.b97-cloud-<pid>.cjs`）在全量套件里红 **1/3**（另两轮 493/493 绿、单跑 7/7 绿）⇒ 同判 `fail_flaky`。当时唯一可归因的信息只有一句裸 `Command failed`，所以本轮已给该 runner 补上**子进程 status/signal + stdout/stderr 尾行**的读数（断言失败仍原样抛，不把真红伪装成环境红），下次复现即能定性 |
| B118 | 🔴 **09-20 Turso 整库读封锁 → 线上 `/api/*` 全 500**；按用户决定换新建库止血，读侧与写侧都已实测复验（`/api/meta` commit==origin/main、run `1073` 采集步 success、新库 articles 41,254→57,344）。**代价**：新库 `settings` 来自本地灾备副本，云端独有的 `weekly.*` 归档当时读不到（旧库不许删，配额解除后可回读） | 外部配额 + 可观测性缺口 + API 层无降级路径（P0，已止血） | 取证与操作口径各留一处单源：`docs/HANDOVER.md` §2.1「换库记录」· `docs/RUNBOOK.md` §10.9 · `docs/CLOUD_PIPELINE_GUIDE.md` 不变量 19。**待你**：轮换旧 `TURSO_AUTH_TOKEN`（与 B122/B125 一并） |
| B119 | 🟠 **换库后四个"能打开但没内容"**：①日报候选被 `settings.daily.articleSourceIds` 限到 87 源（同窗口可用 1,038 篇，只放行 63）；②`wemp` 893 篇、最新一篇停在 09-04（两份云端实现各有 `UNSUPPORTED_TYPES` 且都排除 wemp，属结构性、非本次故障）；③窗口内 `videos` 0 条；④全仓无 Turso 平台 API token → **配额不可观测**，按旧库 ≈38M 读/日折算，新库十余天内会再撞同一堵墙 | 内容面缺口 + 可观测性缺口（④是 P0 级"会不会再挂"） | **09-20 夜进度**：① **已做**（用户放行）—— 直写 `settings.daily.articleSourceIds = []`（空=不限制，语义见 `tools/collect-turso.js` 里 `if (selectedIds && selectedIds.length)` 那一支），**写前备份 / 写后回读 / 其余键逐键比对未变**，spotlight 53→53 未动。**故意不走 `PUT /api/settings/daily`**：该路径的 spotlight 全量替换没有 WHERE 作用域（B34），提交空列表会先把 53 个重点源清零。一手效果读数：**26h 窗口内候选 82 条/9 源 → 1,939 条/308 源**；可见面等今晚 21:30 的 daily-ai 出报后复验（不手动 dispatch，避免把免费 AI 池打两遍）。② **仍待你**：给一个 Turso 平台 token，否则配额不可观测 = 十余天内再撞同一堵墙（这条我这边造不出来）。③ **仍待你**：公众号要恢复得先选"本地端回灌云端"还是"云端可采"（AGENTS §1 三端语义，属方案级）；视频与播客实测正常（库里 1,290 条、近 7 天 54 条、`/api/videos` 返回 30 条全带封面），原记"窗口内 0 条"是候选池被限的连带症状，随 ① 一并解。 |
| B122 | 🔴 **凭据卫生：真实 `AGNES_API_KEY` 明文进过本会话输出一次**（我自己一条未掩码的 `SELECT key,value FROM settings`）。**未进任何提交**：每次提交前逐文件过明文凭据扫描（0 命中），`.tmpchk/` 已整目录 ignore | 凭据暴露（外部面） | **要你做**：在 Agnes 控制台轮换，三处同步（`.env` + Vercel env + GH Secrets，AGENTS §2.6）。我可做（等点头）：把"读 `settings`/`credentials` 的探针强制走递归掩码"做成门禁判据 —— 现在全靠我自觉，而我已经破了一次 |
| B123 | 🟠 **早报页头写着「关键词规则排序」，而线上这一期是 AI 策展版**。那串字是 `web/src/components/DailyHeader.jsx:12` 里**无条件拼进 meta 的**，组件从不读 `schemaVersion`/`degraded` | 前端文案不实（展示级 P2，与 B119 同族"页面说的与产物真实档位不一致"） | 修法一行（按 `schemaVersion===2` 出「AI 策展排序」、`degraded` 再标「降级」+ 静态锁与前端负向样本）。本轮没动 `web/`：它要过 `build:vercel`，而该命令本轮与并行会话争抢 `web/dist`。可与 B119① 同批做 |
| B125 | 🔴 **P0 凭据卫生：管理台默认口令硬编码在两份源码的兜底默认值分支**（`server/middleware/auth.js:101`、`api/[...slug].js:1390`），另有 8 处明文在跟踪文件里（`ARCHITECTURE.md:70`、`docs/deprecated/` 两处、`.cluster/test-out*.txt` 五份日志）。**关键**：`.env` 的 `ADMIN_PASSWORD` 值 == 源码里那个兜底默认常量 → 线上用的就是仓库里读得到的口令；自 `2e81cd7`（09-08）起在 `origin/main`。§5 第 6 条早登记过这个正则盲区（B80/AU-05），所以门禁一直绿 | 凭据管理（P0，鉴权面） | **要你决定，我没擅动鉴权代码**（改兜底默认值会改变登录语义）。顺序：①换口令 + 三处同步 → ②两处改成"缺 `ADMIN_PASSWORD` 即拒绝登录并发告警"，配"缺 env 必须 401"的回归锁 → ③再掩码当前 tip 的 10 处明文（历史删不掉，先掩码=假清洁）→ ④是否重写历史（force-push）你定。另记我一次流程失效：扫描报了命中我仍提交了（`scan && commit` 串着跑）——**扫描已改成闸门：命中即 exit 1** |
| B128 | **零引用资产三处（死代码候选，只出清单不删）**：①`lib/collectors/{fetcher,repo}.js` 161 行——自述「Serverless 兼容版本，对应 `server/services/collectors/fetcher.js`」，全仓 **require 数 0**（本轮实测：`.cluster/` 与 `server/` 引的都是 `server/services/collectors/*` 那一份），却仍被 `tools/eval-whitebox.cjs:39` 当 W1 的"三端"第四份比对 → 一份永不运行的代码能单独制造假红（= 冻结审计轮的 AU-01/AU-02，处置权已收回正常开发，见 B81）；②`web/src/snapshot.js` 117 行——除自己第 8 行的注释示例以外**无任何 import**，它是 portal 时代的迁移期残留，而 portal 项目已下线并删除；③`docs/specs/42-full-audit-2026-09/quarantine/` 内 13 份 `README.md` 与被隔离工具的引用关系（10 条悬空警即由此来，属隔离目录的正常形态，不是缺陷） | AU-4 级死代码与冗余资产；**删除候选，未删** | 随放行清单归档件 §三 #10 打包批次：①②一起裁决"复活 or 摘掉 + 删"，摘 `lib/collectors/fetcher.js` 必须与 W1 清单同批改（否则 W1 少一份比对=判据面缩小），并配 F2P 改前红；本轮**不自行删**，也不得只删文件留 W1 悬空 |
| B131 | 🟠 **`lib/db.js` 的 `SCHEMA`（全新建库路径）里 `articles` 少三列**：`translated_title` / `translated_content` / `translation_provider` 只存在于 `ALTERS` 与"活着的本地库"（实测本地 `data/app.db` 22 列且**有** `translated_title`），生产 Turso 则是 23 列。所以本轮第一次拿真转储做回放演练时，被逐列校验**正确挡下**：`目标库 articles 缺列：translated_title, translated_content, translation_provider`。后果不止回放——**任何一台新机按 `ensureSchema()` 建库，AI 译文写入就会抛 `no such column`**（B18 说的 videos 缺列是同一族的另一半） | schema 漂移（本地建库路径 vs 生产实况；AGENTS §1 三端一致性的数据面） | 已绕过而不是修：转储清单改为自带源库 `CREATE TABLE` 语句，回放走 `--mktarget`（锁 D10）。**真修法待做**：三列并进 `SCHEMA` 本体 + 一条白盒"生产列集 == `ensureSchema` 列集"判据（属门禁扩面批，与放行清单 §三 #12 同批） |
| B132 | 🟠 **第四份删除路径不在 `lib/retention.js` 的管辖内**：`tools/archive-articles.js`（`npm run archive`）把 >90 天文章 `INSERT OR IGNORE INTO articles_archive` 后 `DELETE FROM articles WHERE id IN (...) AND read_at IS NULL AND later=0`。W17 的派生判据按"时间列 `< ?`"认保留谓词，而它的时间过滤在前一条 SELECT 里、DELETE 只剩 `id IN (...)` → 被判成"不是保留策略形状"而放过（**不是判据写错，是这条路径当时没进视野**）。且它少一条豁免：`featured` 未参与判定，与 `lib/retention.js` 的 `ARTICLE_DELETE_COND` 不同口径。实测现状：云端 `articles_archive` **0 行**、本地无该表 → 该工具从未真跑过，属休眠弹药 | 三端一致性缺口（W17 覆盖面的洞）+ 豁免口径分叉 | **待做**：让它改读 `lib/retention.js` 同一份条件，并把 `articles_archive` 纳入转储面（`DUMP_TABLES` 当前只有 articles/videos，归档表同样"删了就回不来"）。登记不顺手改：本轮 B103 只交付转储与闸 |
| B133 | 🟠 **`#64-1` 那条"锁文件形态"判据自己会误伤样本**（本轮新锁第一次全量复跑当场抓到，0 红之外的唯一红）：`tests/regression-eval-substrate.test.js` 的 `#64-1` 那条判据里，"**顶层**读 `.env`"是用**行首缩进**近似的（`code.split('\n').filter(l => !/^\s/.test(l))` 之后再正则找 `readFileSync(... .env`），于是我把历史事故形态作为**反例文本**写在模板字符串里、且那一行恰好顶格，就被算成"这份锁在顶层读 .env"；同批还判我 `require('../lib/test-isolation')` 违规 —— 第二半句是对的（已照口径改惰性取），**第一半句是判据缺陷**：反例文本正是这条锁要教后来的锁写的内容，被自己的门禁当违规 → 结果只能是"以后别在锁里放坏样本"，而那恰好是坑 #45/#62 禁止的方向 | 门禁判据缺陷（假红，方向危险：会把"配负向样本"这项纪律逼退回注释里） | 待放行后做（属判据变更，与 §三 #12 门禁扩面同批）：`#64-1` 的两条子判据都改走 `lib/src-spans` 的**代码跨度**视图（注释与字符串内容都剥掉，"顶层"由 AST 式的深度判定而不是数缩进），并补两条负向样本：①样本字符串里出现 `readFileSync('.env')` 必须不红 ②顶层真写这句必须红。本轮只做绕行（把样本里那一句删掉，不影响 T6 的判定力：`CLOUD_REQUIRE` + 写方法两条都在） |
| — | （排除项，记此防复查）**云端删除端点有鉴权**：无 token `POST /api/data/cleanup/preview` 实测 `HTTP=401`；`requireAuth`（`api/[...slug].js:103-119`）在 `dispatch` 前统一执行（`:2919`），写方法不在 `PUBLIC_GET_PATHS` 豁免内 → 不存在"公网可触发删库"的口子 | 已排除 | — |



### B8~B26 本轮处置（已归档）

> 逐条处置与取证表外迁：`docs/archive/debugging/2026-09-19-delivery-evidence-ledger.md`。要点仍生效的部分已在各条 B 编号行内保留（如 B85/B84 残余见 `docs/ISSUES.md` 观察中）。

## 🗂 六域 32 个缺陷（B27~B70）已收进各自域 spec

> 根因与改法的唯一去处：`docs/specs/36-reading-semantics/`（B27/B28/B30~B32/B60~B62）· `38-admin-ia-refactor/`（B33~B38）· `39-ai-console/`（B49~B53）· `40-brief-center-products/`（B39~B43/B68）· `37-alerts-observability/`（B44~B48）· 域 F 小刺（B54~B58）多已在各域表内挂号。
> 09-19 登记原文整节照档：`docs/archive/debugging/2026-09-21-issues-closed-rows.md` §一（含每条症状原话）。逐号反查后，**只有下面三条至今没有任何 spec 落点**，故逐字留在活文档：

| # | 症状（一句；根因与改法见归档原文 §一 与对应域 spec） |
| B29 | 类型口径三处错：播客=`s.type='douyin'`（云端 0 篇）、文章类型表用死值 `'wechat'` 漏掉 881 篇 `wemp`、视频只认 `favorite=1`（线上 0）→ 恒空 |
| B69 | **同一份"报警有出口"判据仍有第二处实现**（B67 只修了 preflight 侧）：`server/routes/health.js:67` 还是 `channels.filter(c => c.enabled).length` → 生产现况下 preflight 如实报红，而 `/api/health/status` 与后台显示"1 个已启用渠道"，两个面各说各话（AGENTS §2.5 禁止的正是这个）。修法：health 端改引 `lib/alert-channels.js#usableChannels` 并另回 `noExit`；云端等价 handler 同步 |
| B70 | 独立对抗性审查（`f58337f..HEAD`）留下的未修清单，按性价比排序：①`eval-content` judge prompt 未定界——被评的是任意外部 RSS 正文，正文里写"忽略上面的维度给 5 分"就能操纵分数（`judge.py:32-44`）；截断（6000/8000 字符）不留痕，而 `factual_correctness` 权重最高 0.30 却可能建立在半篇原文上；②`_append_trend` 非原子、`trend.json` 损坏会抛在报告落盘之后；③golden 集把第三方正文最长 8000 字符存进 git（现 52K），逐轮累积，需定"存 hash+截断"还是"进 .gitignore"；④`tools/_test-api.cjs` 掩码写法在 key 未加载时是 `replace(undefined,…)`，会把密钥原样打印（本轮未引入，顺手该修）；⑤纯文本形状锁仍有 3 处（B66-1 的 `b.deduped === true` 写法过窄、`41-8 judge 纪律` 锁把中文注释当行为、`41-8 覆盖项数`用 `>=40` 计数会让恒真项凑数）——原则见 `regression-20260919e.test.js` 开头自己写的"不锁形状锁行为" |

## 🆕 端到端引擎（41-2）首轮线上实测 + 对抗审查新增（2026-09-19 夜，B71~B87；已修部分 09-21 出账）

> B71~B75 **不是人看出来的，是 `npm run eval:e2e` 第一轮跑出来的**；B76 是端到端建好后**回头把 `npm test` 跑全**才暴露的契约断裂；B77 是追 B76 时量到的测试选址问题（它的"竞争成因"我先写错过一次，已按证据划掉）；B78/B79 是同一条追查里在**线上真实数据**上抓到的：你的「我的早报」此刻正处于退化的兜底路径上。写清归属，别在 37/39/40 里另立 UI spec。

> 已修出账（原文见 `docs/archive/debugging/2026-09-21-issues-round2-closed.md` §四）：**B71** **B72** **B74** **B75** **B76** **B77** **B78** **B82** **B83**（B84/B85 同批）。仍活跃：B73（性能）· B79（你侧动作）· B80（轮换）· B81（与 B128 同批裁决）· B86（缺播客条目）· B87（探针缺口记账）。

| # | 症状 | 归属 |
|---|------|------|
| **B73** | `/api/reading?tab=all&type=article` 端到端实测**响应可达 26s**（同参数直连 curl 约 5s，点击后的请求被排在首屏那条 type=all 的慢请求之后）→ 表现是"点了筛选像没反应"，随后一次性跳出。属 B31/B26 慢性超时族在**交互路径**上的表现：接口预算 2s（§3.5），实测超一个数量级 | 36 域（阅读器/阅读页）+ 35 自愈观测；与 B31 同批治理 |
| **B79** | **生产数据修复等你点头（本轮没替你写）**：B78 的代码修完，页面会从"还没有订阅"变成"按 53 个星标源兜底出早报"，但 `subscription.ids=[2104]` 这条悬空值仍然错——你真正的订阅集合已不可从库里恢复（`axes.migrated` 闸一次性把 focus=1 迁进来过，现存 `focus=1` 有 8 条）。两条路：①你在后台重新勾选（安全可核对）；②我按 `SELECT id FROM sources WHERE COALESCE(focus,0)=1` 的 8 条写回，**这是生产写，按 2026-09-19「先不写生产，等评测就位」的裁决要先得到你明确同意**，且写前先把原值备份进 `docs/eval/`。**09-21 实测更正**：`subscription.ids` 现在原文就是 `[]`（长度 0，那条悬空 `2104` 已不在现役库 —— 09-20 换库时 settings 取自本地灾备副本），于是走的是代码里「键缺失/空数组 → 兜底 spotlight」这一支，`mybrief.latest` 有内容（generatedAt `2026-09-20T20:31Z`、带 sections）；库里现 `spotlight=1` 53 个、`focus=1` 12 个（本条原写 8 个，按实改掉）。⇒ **本条不再是"坏着等你修"**：页面不坏，缺的是"你自己的订阅集合"（已不可从库里恢复）。要不要用 53 个星标源当订阅，属产品选择，不占批准位 | 运维/数据；与 BL7/BL8 同一批"等授权"的生产写 |
| **B80** | **`.env.example` 里有一条非占位口令，且已进 git 历史**（审计轮 handoff 提出，本轮独立实测复核）：该文件共 4 个键，其中 `ADMIN_USER`/`PORT` 与本地 `.env` 逐字相同（正常），**`ADMIN_PASSWORD` 是一个 23 字符、不匹配任何占位式前缀的值，与本地真值不同**（所以它是"另一个"口令，不是抄漏的占位符），随 `6be2cf8` 提交进了 `origin/main`。`tools/doc-lint.cjs` 的明文扫描只扫文档，抓不到这种被跟踪的 example 文件。**未做**：没有拿它与 Vercel 环境变量比对（读生产 secret 本身就是越界），所以**不能断言"线上口令已泄露"**，只能说"这条值不该出现在仓库里，且一旦它曾是部署口令就必须轮换" | 安全/凭据卫生。**09-21 拆分**：**轮换仍活**（与 B122/B125 一并，你侧动作）；**"重写 git 历史"与"扩 `doc-lint` 扫 `.env.example` 非占位 secrets 键"两条随被否决的审计轮冻结，不再提问** → 见 `docs/archive/debugging/2026-09-21-release-approval-ledger.md` §四。**留一句真话**：这两条即使做，也不会让历史里的值消失——只能靠轮换失效 |
| **B86** | **本地 Express 的日报根本没有「视频与播客」栏**（09-19 对抗审查查出，本轮实测复核）：`server/services/ai/daily.js:104-115` 只构造 `kind:'video'` 条目，全 `server/` 目录**搜不到一处 `audio_url`**，也没有播客（音频封面特征）判定 → 同一份日报在云端有播客栏、在本地端结构性缺失。B84 修的是"有条目但没图标"，本条是"本地端连条目都不会有"，两件事，别混成一件 | 40 域（三报产物）+ AGENTS §1 三端口径；**本轮已补一半**：`server/services/ai/daily.js` 的视频条目现在也带 `source_avatar`（与云端三份 mediaItems 同口径，本地端不部署到 Vercel，属本地链路，无云端实测面）；**仍缺的是播客条目本身**——要引用 `lib/media.js#audioCoverSql` 才能补齐，属功能补齐不是 bug 复现，**排期待定** |
| **B87** | **B83 搬迁把全仓唯一的 B 站线上探针也一起搬走了**：`regression-bilibili` 原第 4 条打的是真实 B 站接口（可达性 + 返回形状），迁移后改成本地夹具 + `fetch` 桩。方向没错（测试不该写生产库），但代价要说清：**上游 B 站响应字段漂移，现在没有任何自动化会红**——桩是自己写的，与真实协议一起变的可能性为零。AGENTS §2 条 2「必须云端实测」在这一面上目前靠人 | 41-3/测试基础设施；候选做法：把形状探针放进 `tools/audit-cloud.js`（只读、不发库），或端到端加一条"打线上 `/api/sources` 里 B 站源的 status 与 lastError"的观测判据；**未做**，先记账 |
| **B81** | **W1 三端常量 diff 的清单里有第四份实现是"生产零调用"的**：`tools/eval-whitebox.cjs:39` 的 UA 一致性清单含 `lib/collectors/fetcher.js`，而全仓库只有 3 个测试文件 require 它，`server/ api/ tools/ lib/` 里没有任何生产调用方（审计轮可达图实测 + 本轮 grep 复核一致）。后果要判准方向：**它造成的是假红风险（一份永不运行的副本跟生产对不上就红），不是假绿**（多比一份只会更严）。真正的问题是那份副本该复活还是摘掉——属于死代码裁决 | ~~42 域 AU-4~~ → **审计轮 09-21 已冻结，处置权收回正常开发**（用户：被否决那次会话的产物冻结、索引不引用，"正常开发就行"）。本条与 **B128** 同批裁决：要么复活那份副本并给它生产调用方，要么从 `tools/eval-whitebox.cjs:39` 的清单里摘掉 + 删文件——**摘清单与删文件必须同批**，否则 W1 少一份比对 = 判据面缩小。**当前事实（本轮实测）**：`lib/collectors/{fetcher,repo}.js` 的生产 require 数仍为 0，而 W1 清单仍含它 → 一份永不运行的代码能单独把 W1 判红 |

> **一条被撤销的"发现"**：我一度写下「阅读器在移动端断点下文章列表整个不渲染（`hidden lg:block`）」，
> 那是**没实测就写的**。真去 390×844 视口跑了一遍：`div.card.card-lift.p-3.cursor-pointer.relative`
> 命中 30 行、30 行全部可见（`getBoundingClientRect().width > 0`），`ReaderPage.jsx` 里也没有 `hidden lg:block`。
> 该条已删除。留这段话是因为它正是本项目反复踩的"判据来自猜"的最新版——**写进 ISSUES 的每一条都要有取证命令**。

## 👁 观察（只留还没到点的四条）

> 🟡 观察中整节（W1~W16）已照档 `docs/archive/debugging/2026-09-21-issues-closed-rows.md` §二：W1~W5 的观察点是 09-14/09-15 当晚批次、W6/W7/W8/W11/W12 已兑现或已改判据、W13/W14/W15/W16 是那轮的**操作留痕与自我更正**。
> 从那一节抄出来、长期有效的四条规则（规则不该只活在日记里）：①整文件同时红 + 错误是 DNS/连接类 → 按 `fail_env` 重跑一次，**不许**改代码、**不许**放松断言、**不许**记成已修复（W10）；②端到端的红必须先分"判据错 / 读得太早 / 真坏了"三种，直接放宽判据是禁止动作（W12）；③偶发红必须先重定向存下整段输出再复跑，红要带两侧读数（W16 + 坑 #53）；④引用提交与门禁编号以 `tools/eval-whitebox.cjs` 里**真实存在**的号为准，拟建号一律标 `(拟)`（W14 + B124）。
> **仍在观察**：①**B19** `generateTheme`「reasoning 冒充正文」已断（无正文即抛错），剩模型/额度侧波动（W6 族）；②**B121 / E6** 周刊骨架——代码面三条已落地，但线上现存那期 report 里没有 `spineMissing` 键，E6 会一直红到下一次 weekly 跑批（**不许为绿灯放宽判据**），跑批后按 B120 的形态指纹复验；③**B20** 入报门槛的下一批跑批读数（五个写入点全走 `lib/brief-guards.js#applyDailyQualityGate` 同一份）；④**W9** `regression-ui-data` 偶发红（1/4，已改成显式校验端口）；⑤**W16** 未定性的 2 红 / 8 次全量，再复现且取到读数即升级为独立 bug。

## 🟢 挂案（外部依赖/低优先，保持跟踪）

> 已核销（原文见 `docs/archive/debugging/2026-09-21-issues-round2-closed.md` §五）：H9 随 portal 退役 + `.gitmodules` 补建闭合；H10 假开关已摘除（B51/39-2）；H17 随 doc-lint 落地、INDEX 如实标注与 portal 退役闭合。

| # | 问题 | 状态 |
|---|------|------|
| H1 | YouTube 对数据中心 IP 反爬假 404 → 熔断反复（139 源 41 启用；熔断源由 cleanup 批次自动恢复） | 挂案：彻底解需住宅代理；现状可接受 |
| H2 | 日报引擎双份实现（api/daily-generate.js 仅兜底 vs [...slug].js 内联） | 挂案：主链路在 runner，T3 系重构时收敛 |
| H3 | ~~P2-5 /api/img 无 SSRF 防护~~ **已闭合（2026-09-19）**：新增 `api/_safeimg.js`（与 `server/util/safeimg.js` 同语义：DNS 解析后校验、逐跳校验重定向、只允许 image/*、流式字节上限），云端 `handleImg` 改走它；白盒 W7/B18 双端同语义锁已加。余：P2-4 AUTH_SECRET 回退 'dev-secret' / P2-6 LIKE '%%' 慢查询 / P2-7 handleDaily UTC 日期比较 | 低危挂案（Vercel 网络隔离+量级小）；SSRF 面已收 |
| H6 | B站采集"更好的方案"调研（Cookie 主链 vs 现匿名降级） | 用户提出，待调研 |
| H7 | 云端 /api/articles 无 dedup=1 分支（本地有，pre-existing 漂移）：今日视图成默认落地路径后，双端「合并同事件」行为差异被放大 | 挂案：T5 剩余重构时收敛（2026-09-15 对抗审查记录） |
| H8 | spec30 C3「保存后前台关键数字实时预览」未做（对照卡为生效配置静态摘要，验收②只要求对照卡）；subscription.ids 跨 serverless 实例 30s 缓存窗口（人工点击速度下不可达） | 挂案：后续小 spec（2026-09-15 对抗审查 P3） |
| H11 | `weekly.archive` 每期内嵌完整 report、items 又在 `storylines[].items` 重复一份，`:878` 明确不截断；`handleWeekly` 每次请求全量解析后只投影 5 个字段，而 `[...slug]` 函数预算只有 30s | 挂案：慢性 504 面，需加投影/截断策略 |
| H12 | `settings['weekly']` 在后台可编辑（`/api/settings` merge + 周刊设置卡片），但 `runWeekly` 从不读它——窗口/条数全硬编码（`collect-turso.js:765-766`、`:844`） | 挂案：改了无效，需接配置或撤 UI |
| H13 | 我的早报**没有期号也没有归档**：`runMyBrief` 落库的 `mybrief.latest` 只有 `date/generatedAt/theme/keywords/sections/themes/degraded`，无 `issue`，且全库不存在 `mybrief.archive`（单键覆盖写，历史期直接丢失）。用户 2026-09-18 标注「我的早报也该有期号」。周刊有期号是因为 `saveWeekly` 从 `weekly.archive` 末位 +1 | 挂案：要期号必须先有归档（否则期号会随覆盖写重置）；属功能设计，需单独立项 |
| H14 | **熔断后不靠人点这件事，三端行为完全不同**（2026-09-18 应用户「你去测」做的只读实测）：本地端 `store.js:31-38` 只置 `enabled=0`，**零自动恢复路径**，实测 584 个源锁死 5~7 天（其中 458 个 `lastErrorAt` 全落在 09-13T03 同一小时、错误一律 `fetch failed`＝一次代理故障批量熔断）；云端 `collect-turso.js:697-720` 有自动恢复且真在工作（一轮 cleanup 恢复 66 个），但要等 **48h 起**（第 4 次起 7 天）而熔断只需 **45min**（3 连跪 × 15min）→ 实测 195/210 源"恢复后又坏"、间隔中位 6.2h，`frozenAt` 精确聚集在每天 cleanup 那一小时。抽样 23 个熔断源真发重试：**18 个（78%）立刻成功**（6 个 YouTube 假 404 / 3 个 xgo 桥 400 / 2 个 403 / 1 个我方解析器 bug） | 用户判断方向成立（"没坏、过一会重试就能上"＝78% 量化成立），归因需修正：云端不是"没有自愈"而是"自愈被 48h 流放 + 不看错误性质 + 本地端根本没实现"。方案见 `docs/specs/35-selfheal-admin-console/35a-selfheal-engine.md`，**待批准未动工** |
| H15 | `restore-all`（`api/[...slug].js:1606-1627`）是**全量无差别解冻**：按 `fail_count>=3 AND enabled=0` 一把梭，不试探、不排除 `mergedInto/retired`（cleanup 反而排除，`collect-turso.js:705`），`unfreezeStmt`（`:1596-1604`）也不清 `frozenAt/resumeCount` → 死源被反复放回、活源计数被污染 | 挂案：35A-F8 里改成"按类别分批试探恢复"；期间人工批量入口仍可用，但要知道它会把真死源也放回 |
| H16 | **系统性故障被折算成单源失败**：出口/代理/RSSHub 桥挂一次，本轮全部到期源 `fail_count++`，于是"我们的网络抖一下"变成"几百个源坏了"（H14 的 458 源批量熔断就是这么来的）。现有 `postRunAlerts` 已有"批量失败聚合报警"（`collect-turso.js:638-648`）但**只改报警形态，不改熔断判定** | 挂案：35A-F6 要求失败率超阈值即判基础设施故障、本轮不计入单源；这条优先级应排在 H14 其余项之前（它是唯一会一次性打瘫全库的） |

## ⛔ 阻塞项与优化方向（2026-09-18 文档清洁轮）

### 阻塞项（不先清掉，后面任何改动都无法判断"是不是我改坏的"）

> 已核销（原文见 `docs/archive/debugging/2026-09-21-issues-round2-closed.md` §六）：BL2（`reading.digest` 已产出，B112 实测）、BL4（portal 退役收尾完成）、BL8 及更正（`lib/ai-throttle.js#gapMs` 单源 + 锁）、BL10（现役库零污染，判无需动作）、BL11（spec 41 评测体系已交付）。

| # | 阻塞 | 为什么阻塞 | 清法 |
|---|---|---|---|
| BL3 | 采集尝试流水不存在（B23 假成功率 + B24 心跳只 25h 且无正样本） | 「每源成功抓取概率」现在**物理上算不出来**，35C 只能继续显示假数字 | 35B（滚动窗口，不建新表） |
| **BL7** | **P0 云端报警链路无出口**（B44：渠道被回归测试写坏成 `url:undefined` 的 TEST，09-17 起 `sent:0`） | 系统正在"哑火"：熔断/停滞/AI 失败全都不再通知，与自愈改造互为前提（没有可观测就没有可信自愈） | **2026-09-19 用户决定：先不写生产，等 spec 41 评测就位后再做** → 恢复动作与"改前必红"证据一起出；期间任何故障无人通知属**已知风险**。**2026-09-19 实测量化**：`alerts.recentLog` 近 7 天 **33 条事件全部未送达**（`results[].ok:false, error:"fetch failed"`，最后一条 09-17T08:34），生产库唯一渠道 `test-ch` 的回调是 `http://127.0.0.1:1`；而 `eval:preflight` 因判据过宽（见 B67）此前把它显示成「1 个可用渠道 ✓」——本条在门禁里长期是绿灯 |
| **BL7-更正** | ✅ **09-20 复跑 `eval:preflight`：本条两条判据转绿 → 报警出口已恢复**（渠道有真实出口 + 最新一条 `2026-09-20T03:39` 已送达、近 4 条 4 条有成功投递，另有 `mybrief` 一条真实投递文案）。**但恢复是换库副产物**（新库 `settings.alerts` 来自本地灾备副本，带的是真渠道），**不是**走放行清单 #6 那次授权写入 → 本条不许当"已修完"关闭：**旧库那份 `settings.alerts` 仍是哨兵值**，将来任何"从旧库迁 settings"的动作都会把哨兵带回来（同坑 #67 那族"别把绕过当成修好"） | 状态更正（可观测性恢复，残余在旧库） | 关闭条件补一条：**`settings['alerts'].channels` 形状要进回归锁**——现在没有任何测试钉住"渠道 URL 不是 `127.0.0.1:1` 哨兵"，下次同样的写坏仍只能靠 preflight 手工发现。属白盒新增（W 系），按 §3.6 需你点头才动工具面 |
| **BL9** | **P0 `settings.ai` 仍可被后台写回**（B50），与旧 env-only 声明冲突 | 09-11 全链路 401 停摆 2 天的合法复发通道 | **已裁决（2026-09-19）：保留可写 + 强制审计 + 变更告警 + 写后连通探测失败即回滚**；不变量表述已在 `CLOUD_PIPELINE_GUIDE.md` §6.1 作废落档。实施在 39-1/39-3 |
| **BL12** | **Vercel 构建滞后于 HEAD，「推了就等于上线」不成立**（09-19 实测，含对本条第一版判定的订正）：连推 5 次后 production 仍是 04:25 的 deployment。**我第一版判成"Git 触发器停了"是错的**——每次 push 都新建了 deployment，只是新构建长时间卡在 `● Initializing`（更早的构建 16~18 秒就完），期间 production 一直服务着旧的一份 | 后果不是"没部署"而是**线上何时变不可预测** → "云端实测"只有在线上 commit == origin/main 时才算数，否则测的是旧代码 | 判据已建：`/api/meta` 回传 `VERCEL_GIT_COMMIT_SHA` + `eval:preflight` 新增「线上 commit == origin/main」，不一致即红，不许再靠"我推过了"这种代理信号。**09-19 23:30 复测**：push 后 10 分钟内 `commit` 已等于 `origin/main`，硬前置恢复可用；但**退化成分钟级排队的根因仍未查**（需人看 Vercel Deployments 日志/配额），本条不销。**禁止手动 `vercel --prod` 绕过**，那只会把根因盖住。当轮 B58/B62 的验证读数已并到 W8 一行 |

### ✅ 本轮已修（已归档）

> 证据对账表（逐份 F2P/评测读数）外迁：`docs/archive/debugging/2026-09-19-delivery-evidence-ledger.md`。**活文档里只留结论与"条数一律以证据 JSON 为准"这条判据。**

### ✅ 产品选择：09-21 整表批准（已归档）

> 裁定表（12 行 + 已裁决行）逐字外迁 → `docs/archive/debugging/2026-09-21-issues-round2-closed.md` §七（与放行台账同批）。各条拍板结论已写进对应 B 行的「去处」列；本档不再装裁定表。


### 优化方向（已迁出）

> 未来计划归 `docs/NEXT-DEV-REQS.md` 一处（§4.1：两个事实源必分叉），本轮已整段并入其末尾。
